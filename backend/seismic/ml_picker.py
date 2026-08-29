from __future__ import annotations

import queue
import threading
import time
from dataclasses import dataclass
from typing import Callable

import numpy as np
from obspy import Stream, Trace, UTCDateTime

from backend.config import Settings
from backend.seismic.locator import Pick
from backend.seismic.stations import Station
from backend.state import SystemState


@dataclass
class ComponentBuffer:
    data: np.ndarray
    sample_rate: float
    end_time: float
    network: str
    station: str
    location: str
    channel: str
    source: str


class PhaseNetStreamingPicker:
    """Optional SeisBench/PhaseNet worker.

    This is intentionally isolated from the SeedLink collector. A slow PyTorch inference must never
    block receipt of waveform packets. The default deployment uses STA/LTA only; set
    SDP_PHASE_PICKER=phasenet or hybrid and install requirements-ml.txt to enable this worker.
    """

    def __init__(
        self,
        settings: Settings,
        state: SystemState,
        stations: dict[str, Station],
        on_pick: Callable[[Pick], None],
        stop_event: threading.Event,
    ) -> None:
        self.settings = settings
        self.state = state
        self.stations = stations
        self.on_pick = on_pick
        self.stop_event = stop_event
        self.enabled = settings.phase_picker in {"phasenet", "hybrid"}
        self._buffers: dict[str, dict[str, ComponentBuffer]] = {}
        self._last_submit: dict[str, float] = {}
        self._last_pick: dict[tuple[str, str], float] = {}
        self._lock = threading.RLock()
        self._queue: queue.Queue[tuple[str, Stream, str]] = queue.Queue(maxsize=8)
        self.thread = threading.Thread(target=self._run, name="phasenet-picker", daemon=True)
        if self.enabled:
            self.thread.start()
            self.state.source_status(
                "ml_picker",
                label="PhaseNet / SeisBench",
                endpoint=f"weights:{settings.phasenet_weights}",
                state="starting",
                stationCount=0,
            )

    def on_trace(self, trace: Trace, source_key: str) -> None:
        if not self.enabled:
            return
        key = f"{trace.stats.network}.{trace.stats.station}"
        if key not in self.stations:
            return
        channel = str(trace.stats.channel or "")
        if not channel or channel[-1:] not in {"Z", "N", "E", "1", "2"}:
            return
        data = np.asarray(trace.data, dtype=np.float32)
        if data.size < 2 or not np.isfinite(data).all():
            return
        fs = float(trace.stats.sampling_rate)
        if fs < 10:
            return
        end = float(trace.stats.endtime.timestamp)
        keep_samples = int(max(20.0, self.settings.phasenet_window_seconds) * fs)

        with self._lock:
            station_buffers = self._buffers.setdefault(key, {})
            old = station_buffers.get(channel)
            if old is None or abs(old.sample_rate - fs) > 0.01 or end < old.end_time:
                merged = data
            else:
                merged = np.concatenate([old.data, data])[-keep_samples:]
            station_buffers[channel] = ComponentBuffer(
                data=merged[-keep_samples:],
                sample_rate=fs,
                end_time=end,
                network=str(trace.stats.network),
                station=str(trace.stats.station),
                location=str(trace.stats.location or ""),
                channel=channel,
                source=source_key,
            )

            now = time.time()
            if now - self._last_submit.get(key, 0.0) < self.settings.phasenet_interval_seconds:
                return
            stream = self._build_stream(key)
            if stream is None:
                return
            self._last_submit[key] = now

        try:
            self._queue.put_nowait((key, stream, source_key))
        except queue.Full:
            # Prefer newest data over building a backlog that destroys early-warning latency.
            try:
                self._queue.get_nowait()
                self._queue.put_nowait((key, stream, source_key))
            except queue.Empty:
                pass

    def _build_stream(self, key: str) -> Stream | None:
        buffers = self._buffers.get(key, {})
        if not buffers:
            return None
        # Require a vertical component and at least one horizontal. SeisBench may impute the other.
        values = list(buffers.values())
        if not any(v.channel.endswith("Z") for v in values):
            return None
        if not any(v.channel[-1:] in {"N", "E", "1", "2"} for v in values):
            return None

        latest_end = min(v.end_time for v in values)
        window = self.settings.phasenet_window_seconds
        stream = Stream()
        for buf in values:
            fs = buf.sample_rate
            samples = int(window * fs)
            offset_seconds = max(0.0, buf.end_time - latest_end)
            trim_tail = int(round(offset_seconds * fs))
            end_index = max(0, len(buf.data) - trim_tail)
            start_index = max(0, end_index - samples)
            arr = buf.data[start_index:end_index]
            if arr.size < int(min(15.0, window * 0.5) * fs):
                continue
            start = latest_end - (arr.size - 1) / fs
            tr = Trace(data=np.asarray(arr, dtype=np.float32))
            tr.stats.network = buf.network
            tr.stats.station = buf.station
            tr.stats.location = buf.location
            tr.stats.channel = buf.channel
            tr.stats.sampling_rate = fs
            tr.stats.starttime = UTCDateTime(start)
            stream += tr
        return stream if len(stream) >= 2 else None

    def _run(self) -> None:
        try:
            import seisbench.models as sbm

            model = sbm.PhaseNet.from_pretrained(self.settings.phasenet_weights, update=True)
            try:
                model.eval()
            except Exception:
                pass
            self.state.source_status(
                "ml_picker",
                label="PhaseNet / SeisBench",
                endpoint=f"weights:{self.settings.phasenet_weights}",
                state="ready",
                stationCount=0,
            )
        except Exception as exc:
            self.state.source_status(
                "ml_picker",
                label="PhaseNet / SeisBench",
                endpoint=f"weights:{self.settings.phasenet_weights}",
                state="error",
                error=f"ML picker unavailable: {exc}"[:220],
                stationCount=0,
            )
            return

        while not self.stop_event.is_set():
            try:
                station_key, stream, source_key = self._queue.get(timeout=1.0)
            except queue.Empty:
                continue
            try:
                output = model.classify(
                    stream,
                    P_threshold=self.settings.phasenet_p_threshold,
                    S_threshold=self.settings.phasenet_s_threshold,
                    strict=False,
                    flexible_horizontal_components=True,
                    batch_size=1,
                )
                picks = getattr(output, "picks", []) or []
                emitted = 0
                for model_pick in picks:
                    phase = str(getattr(model_pick, "phase", "P")).upper()[:1]
                    if phase not in {"P", "S"}:
                        continue
                    peak_time = getattr(model_pick, "peak_time", None)
                    if peak_time is None:
                        peak_time = getattr(model_pick, "start_time", None)
                    if peak_time is None:
                        continue
                    pick_time = float(peak_time.timestamp) if hasattr(peak_time, "timestamp") else float(peak_time)
                    probability = float(getattr(model_pick, "peak_value", 0.5) or 0.5)
                    dedup_key = (station_key, phase)
                    if pick_time <= self._last_pick.get(dedup_key, 0.0) + 0.8:
                        continue
                    latency = max(0.0, time.time() - pick_time)
                    if latency > self.settings.max_data_latency_seconds:
                        continue
                    station = self.stations.get(station_key)
                    if station is None:
                        continue
                    self._last_pick[dedup_key] = pick_time
                    self.on_pick(
                        Pick(
                            station_key=station_key,
                            time=pick_time,
                            latitude=station.latitude,
                            longitude=station.longitude,
                            score=probability,
                            source=source_key,
                            phase=phase,
                            probability=max(0.0, min(1.0, probability)),
                            latency_seconds=latency,
                            picker="phasenet",
                        )
                    )
                    emitted += 1
                self.state.source_status(
                    "ml_picker",
                    label="PhaseNet / SeisBench",
                    endpoint=f"weights:{self.settings.phasenet_weights}",
                    state="running",
                    lastStation=station_key,
                    lastPickCount=emitted,
                )
            except Exception as exc:
                self.state.source_status(
                    "ml_picker",
                    label="PhaseNet / SeisBench",
                    endpoint=f"weights:{self.settings.phasenet_weights}",
                    state="degraded",
                    error=str(exc)[:220],
                )
