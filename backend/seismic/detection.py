from __future__ import annotations

import math
import threading
import time
import uuid
from dataclasses import dataclass

import numpy as np
from obspy import Trace
from obspy.signal.trigger import classic_sta_lta
from scipy.signal import butter, detrend, sosfiltfilt

from backend.config import Settings
from backend.seismic.locator import Pick, locate_event
from backend.seismic.stations import Station
from backend.state import SystemState, utc_iso


@dataclass
class TraceBuffer:
    sample_rate: float
    data: np.ndarray
    end_time: float


class EventAssociator:
    def __init__(self, settings: Settings, state: SystemState) -> None:
        self.settings = settings
        self.state = state
        self._lock = threading.RLock()
        self._picks: list[Pick] = []
        self._active_id: str | None = None
        self._active_last_pick: float = 0.0
        self._revision = 0

    @staticmethod
    def _distinct_station_count(picks: list[Pick]) -> int:
        return len({p.station_key for p in picks})

    def add(self, pick: Pick) -> None:
        with self._lock:
            window = self.settings.association_window_seconds
            self._picks = [p for p in self._picks if pick.time - p.time <= window]

            # One best pick for each station/phase in the current association window.
            new_key = (pick.station_key, pick.phase)
            old_same = [p for p in self._picks if (p.station_key, p.phase) == new_key]
            self._picks = [p for p in self._picks if (p.station_key, p.phase) != new_key]
            if old_same:
                old = max(old_same, key=lambda p: p.probability)
                if old.probability > pick.probability and abs(old.time - pick.time) < 5:
                    self._picks.append(old)
                else:
                    self._picks.append(pick)
            else:
                self._picks.append(pick)

            if self._distinct_station_count(self._picks) < self.settings.min_stations:
                return

            result = locate_event(
                self._picks,
                vp_km_s=self.settings.p_velocity_km_s,
                vs_km_s=self.settings.s_velocity_km_s,
                depth_candidates_km=self.settings.depth_candidates_km,
                max_pick_residual_seconds=self.settings.max_pick_residual_seconds,
            )
            if result is None or result.rms_seconds > self.settings.max_location_rms_seconds:
                return

            used_ids = set(result.used_pick_ids)
            used = [p for p in self._picks if p.id in used_ids]
            station_count = self._distinct_station_count(used)
            if station_count < self.settings.min_stations:
                return

            if self._active_id is None or pick.time - self._active_last_pick > window:
                self._active_id = f"sdp-{uuid.uuid4().hex[:10]}"
                self._revision = 0
            self._active_last_pick = pick.time
            self._revision += 1

            rms_quality = max(0.0, 1.0 - result.rms_seconds / self.settings.max_location_rms_seconds)
            station_quality = min(1.0, max(0.0, (station_count - 2) / 6.0))
            gap_quality = max(0.0, min(1.0, (360.0 - result.azimuthal_gap_deg) / 220.0))
            pick_quality = sum(p.probability for p in used) / max(len(used), 1)
            median_latency = float(np.median([p.latency_seconds for p in used])) if used else 999.0
            latency_quality = max(0.0, 1.0 - median_latency / max(self.settings.max_data_latency_seconds, 1.0))
            outlier_penalty = min(0.25, 0.05 * len(result.outlier_pick_ids))
            confidence = round(
                100
                * max(
                    0.0,
                    0.34 * rms_quality
                    + 0.22 * station_quality
                    + 0.16 * gap_quality
                    + 0.18 * pick_quality
                    + 0.10 * latency_quality
                    - outlier_penalty,
                )
            )

            eew_eligible = median_latency <= self.settings.eew_max_pick_latency_seconds
            status = "automatic_preliminary" if eew_eligible else "automatic_late"
            status_label = (
                "Detecção automática preliminar · baixa latência"
                if eew_eligible
                else "Detecção automática · dados com atraso"
            )

            phases = {"P": 0, "S": 0}
            for p in used:
                phase = "S" if p.phase.upper().startswith("S") else "P"
                phases[phase] += 1

            event = {
                "id": self._active_id,
                "revision": self._revision,
                "status": status,
                "statusLabel": status_label,
                "eewEligible": eew_eligible,
                "originTime": utc_iso(result.origin_time),
                "originEpoch": result.origin_time,
                "lat": round(result.latitude, 4),
                "lon": round(result.longitude, 4),
                "depthKm": round(result.depth_km, 1),
                "depthResolved": result.depth_resolved,
                "magnitude": None,
                "magnitudeType": None,
                "stationCount": station_count,
                "pickCount": len(used),
                "phaseCounts": phases,
                "stations": sorted({p.station_key for p in used}),
                "rmsSeconds": round(result.rms_seconds, 2),
                "robustScore": round(result.robust_score, 3),
                "azimuthalGap": round(result.azimuthal_gap_deg, 1),
                "uncertaintyKm": round(result.uncertainty_km),
                "confidence": confidence,
                "medianPickLatencySeconds": round(median_latency, 2),
                "outlierCount": len(result.outlier_pick_ids),
                "pVelocityKmS": self.settings.p_velocity_km_s,
                "sVelocityKmS": self.settings.s_velocity_km_s,
                "pickerMix": sorted({p.picker for p in used}),
                "updatedAt": utc_iso(),
            }
            self.state.set_event(event)


class WaveformProcessor:
    def __init__(
        self,
        settings: Settings,
        state: SystemState,
        stations: dict[str, Station],
    ) -> None:
        self.settings = settings
        self.state = state
        self.stations = stations
        self.associator = EventAssociator(settings, state)
        self._buffers: dict[str, TraceBuffer] = {}
        self._last_trigger: dict[str, float] = {}
        self._last_telemetry: dict[str, float] = {}
        self._lock = threading.RLock()

    def add_external_pick(self, pick: Pick) -> None:
        """Entry point for optional ML pickers (PhaseNet/SeisBench worker)."""
        self.state.add_pick(
            {
                "station": pick.station_key,
                "phase": pick.phase,
                "time": utc_iso(pick.time),
                "epoch": pick.time,
                "probability": round(pick.probability, 3),
                "score": round(pick.score, 3),
                "latencySeconds": round(pick.latency_seconds, 2),
                "picker": pick.picker,
                "source": pick.source,
            }
        )
        self.state.mark_trigger(pick.station_key, pick.time, pick.score, pick.phase, pick.picker)
        self.associator.add(pick)

    def on_trace(self, trace: Trace, source_key: str) -> None:
        channel = str(trace.stats.channel or "")
        key = f"{trace.stats.network}.{trace.stats.station}"
        station = self.stations.get(key)
        if station is None:
            return
        data = np.asarray(trace.data, dtype=np.float64)
        if data.size < 2 or not np.isfinite(data).all():
            return
        fs = float(trace.stats.sampling_rate)
        if fs < 10:
            return
        end_time = float(trace.stats.endtime.timestamp)
        received_time = time.time()
        latency = max(0.0, received_time - end_time)

        # Keep network telemetry for every component, even if it is too old to be EEW-useful.
        tele_key = f"{key}:{channel}"
        last_telemetry = self._last_telemetry.get(tele_key, 0.0)
        if received_time - last_telemetry >= 1.0:
            self._last_telemetry[tele_key] = received_time
            self.state.touch_station(
                key,
                end_time,
                activity=0.0,
                source=source_key,
                received_ts=received_time,
                channel=channel,
            )

        # Classic lightweight picker is vertical-component only. Horizontal data remain available
        # to the optional PhaseNet worker and future S-wave algorithms.
        if not channel.endswith("Z"):
            return

        stream_key = f"{key}:{channel}"
        with self._lock:
            existing = self._buffers.get(stream_key)
            if existing is None or abs(existing.sample_rate - fs) > 0.01 or end_time < existing.end_time:
                merged = data
            else:
                merged = np.concatenate((existing.data, data))
            keep = int(max(20.0, self.settings.lta_seconds * 3.0) * fs)
            merged = merged[-keep:]
            self._buffers[stream_key] = TraceBuffer(fs, merged, end_time)

        min_samples = int((self.settings.lta_seconds + 2.0) * fs)
        if merged.size < min_samples:
            return

        try:
            work = detrend(merged, type="linear")
            nyquist = fs / 2.0
            high = min(12.0, nyquist * 0.80)
            low = 0.8
            if high <= low:
                return
            sos = butter(3, [low, high], btype="bandpass", fs=fs, output="sos")
            filtered = sosfiltfilt(sos, work)
            nsta = max(2, int(self.settings.sta_seconds * fs))
            nlta = max(nsta + 2, int(self.settings.lta_seconds * fs))
            cft = classic_sta_lta(filtered, nsta, nlta)
        except Exception:
            return

        lookback = max(1, int(1.5 * fs))
        recent = cft[-lookback:]
        if recent.size == 0:
            return
        local_index = int(np.argmax(recent))
        score = float(recent[local_index])
        peak_index = cft.size - lookback + local_index
        seconds_before_end = (cft.size - 1 - peak_index) / fs
        pick_time = end_time - seconds_before_end
        activity = score / max(self.settings.trigger_on, 0.001)

        self.state.touch_station(
            key,
            end_time,
            activity=activity,
            source=source_key,
            received_ts=received_time,
            channel=channel,
        )

        # Extremely stale chunks should never create a fresh alarm. They still appear as telemetry.
        if latency > self.settings.max_data_latency_seconds:
            return

        last_trigger = self._last_trigger.get(key, 0.0)
        if score >= self.settings.trigger_on and pick_time - last_trigger >= self.settings.refractory_seconds:
            self._last_trigger[key] = pick_time
            # Convert STA/LTA strength to a bounded heuristic confidence; not a calibrated probability.
            excess = max(0.0, score - self.settings.trigger_on)
            probability = 0.50 + 0.48 * (1.0 - math.exp(-excess / 3.0))
            pick = Pick(
                station_key=key,
                time=pick_time,
                latitude=station.latitude,
                longitude=station.longitude,
                score=score,
                source=source_key,
                phase="P",
                probability=probability,
                latency_seconds=latency,
                picker="stalta",
            )
            self.add_external_pick(pick)
        elif score <= self.settings.trigger_off and self.state.stations.get(key, {}).get("triggered"):
            if end_time - last_trigger > 3.0:
                self.state.clear_trigger(key)
