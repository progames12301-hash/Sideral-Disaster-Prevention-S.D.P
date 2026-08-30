from __future__ import annotations

import math
import queue
import time
import uuid
from dataclasses import dataclass

import numpy as np
from obspy import Trace, UTCDateTime

from backend.config import Settings
from backend.seismic.detection import WaveformProcessor
from backend.seismic.locator import haversine_km, travel_time_seconds
from backend.seismic.stations import Station
from backend.state import SystemState


@dataclass(frozen=True)
class _HiddenSource:
    """Generator truth. It is NEVER passed to WaveformProcessor or EventAssociator."""

    lat: float
    lon: float
    depth_km: float
    origin_epoch: float


def _azimuth_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360.0) % 360.0


def _select_rj_network(stations: dict[str, Station], count: int) -> list[Station]:
    # Hidden generator center only chooses a useful test network. It is not given to the locator.
    center = (-22.86, -43.30)
    candidates: list[tuple[float, float, Station]] = []
    for station in stations.values():
        if station.component and station.component != "Z":
            continue
        d = haversine_km(center[0], center[1], station.latitude, station.longitude)
        if d <= 650.0:
            candidates.append((d, _azimuth_deg(center[0], center[1], station.latitude, station.longitude), station))
    candidates.sort(key=lambda row: row[0])
    if len(candidates) < count:
        candidates = []
        for station in stations.values():
            if station.component and station.component != "Z":
                continue
            d = haversine_km(center[0], center[1], station.latitude, station.longitude)
            candidates.append((d, _azimuth_deg(center[0], center[1], station.latitude, station.longitude), station))
        candidates.sort(key=lambda row: row[0])

    # Pick across azimuth sectors first so the locator is tested with actual geometry rather than
    # a convenient single cluster. Then fill the remaining slots by distance.
    chosen: list[Station] = []
    chosen_keys: set[str] = set()
    sectors = 8
    for sector in range(sectors):
        lo = sector * 360.0 / sectors
        hi = (sector + 1) * 360.0 / sectors
        sector_rows = [row for row in candidates if lo <= row[1] < hi]
        if sector_rows:
            station = sector_rows[0][2]
            if station.key not in chosen_keys:
                chosen.append(station)
                chosen_keys.add(station.key)
        if len(chosen) >= count:
            break

    for _, _, station in candidates:
        if len(chosen) >= count:
            break
        if station.key in chosen_keys:
            continue
        chosen.append(station)
        chosen_keys.add(station.key)
    return chosen[:count]


def _packet(t: np.ndarray, arrival: float, frequency: float, amplitude: float, duration: float) -> np.ndarray:
    rel = t - arrival
    mask = (rel >= 0.0) & (rel <= duration)
    result = np.zeros_like(t)
    n = int(mask.sum())
    if n < 3:
        return result
    taper = np.hanning(n)
    result[mask] = amplitude * np.sin(2.0 * np.pi * frequency * rel[mask]) * taper
    return result


def _waveform_for_station(
    station: Station,
    source: _HiddenSource,
    settings: Settings,
    start_epoch: float,
    end_epoch: float,
    sample_rate: float,
) -> np.ndarray:
    samples = max(1, int(round((end_epoch - start_epoch) * sample_rate)))
    t = start_epoch + np.arange(samples, dtype=np.float64) / sample_rate
    seed = sum((i + 1) * ord(ch) for i, ch in enumerate(station.key)) % (2**32 - 1)
    rng = np.random.default_rng(seed)

    # Background is intentionally non-zero and includes slow cultural modulation. A real detector
    # must establish its own LTA before the onset instead of receiving a clean/noiseless pulse.
    noise = rng.normal(0.0, 0.34, samples)
    noise += 0.08 * np.sin(2.0 * np.pi * 2.25 * (t - start_epoch) + (seed % 17))

    surface = haversine_km(source.lat, source.lon, station.latitude, station.longitude)
    p_arrival = source.origin_epoch + travel_time_seconds(
        surface,
        source.depth_km,
        "P",
        settings.p_velocity_km_s,
        settings.s_velocity_km_s,
    )
    s_arrival = source.origin_epoch + travel_time_seconds(
        surface,
        source.depth_km,
        "S",
        settings.p_velocity_km_s,
        settings.s_velocity_km_s,
    )

    # Distance controls only waveform amplitude. No epicenter/depth/magnitude field is injected
    # into the detector; it sees the samples below exactly through WaveformProcessor.on_trace().
    p_amp = 8.0 + 9.0 * math.exp(-surface / 320.0)
    signal = noise + _packet(t, p_arrival, 3.15, p_amp, 2.1)

    # A weaker vertical S/coda component changes station activity later without intentionally
    # creating a second STA/LTA pick. True P/S classification remains the job of the 3-C picker.
    s_amp = 0.75 + 0.9 * math.exp(-surface / 350.0)
    signal += _packet(t, s_arrival, 2.35, s_amp, 4.0)
    coda_start = p_arrival + 1.4
    coda_mask = t >= coda_start
    signal[coda_mask] += 0.28 * np.sin(2.0 * np.pi * 2.7 * (t[coda_mask] - coda_start)) * np.exp(
        -(t[coda_mask] - coda_start) / 12.0
    )
    return signal.astype(np.float64)


def _drain_messages(state: SystemState, at_ms: int, timeline: list[dict], station_cache: dict[str, tuple]) -> bool:
    emitted_event = False
    while True:
        try:
            message = state.outbox.get_nowait()
        except queue.Empty:
            break
        msg_type = message.get("type")
        data = message.get("data")
        if msg_type == "station" and isinstance(data, dict):
            key = str(data.get("key") or "")
            fingerprint = (
                data.get("activityLevel"),
                data.get("triggered"),
                data.get("lastPhase"),
            )
            if key and station_cache.get(key) == fingerprint:
                continue
            if key:
                station_cache[key] = fingerprint
            timeline.append({"atMs": at_ms, "type": "station", "data": data})
        elif msg_type == "event" and isinstance(data, dict):
            test_event = dict(data)
            test_event["testOnly"] = True
            test_event["testLabel"] = "SIMULAÇÃO RJ · resultado calculado pelo pipeline"
            timeline.append({"atMs": at_ms, "type": "event", "data": test_event})
            emitted_event = True
        elif msg_type == "pick" and isinstance(data, dict):
            timeline.append({"atMs": at_ms, "type": "pick", "data": data})
    return emitted_event


def run_rj_waveform_test(settings: Settings, stations: dict[str, Station]) -> dict:
    """Run an isolated raw-waveform test through the real lightweight production pipeline.

    The operational `SystemState` is never touched, so the simulation cannot enter real history,
    WebSocket broadcasts, catalog association or alerts. The frontend receives only the detector's
    outputs and replays them visually.
    """
    required = max(8, settings.stalta_wave_min_stations + 1, settings.stalta_public_min_stations + 2)
    selected = _select_rj_network(stations, required)
    if len(selected) < settings.stalta_public_min_stations:
        raise RuntimeError(
            f"Poucas estações disponíveis para teste: {len(selected)}; "
            f"necessárias {settings.stalta_public_min_stations}."
        )

    test_state = SystemState(latency_history_size=20)
    test_stations = {station.key: station for station in selected}
    for station in selected:
        test_state.register_station(station.public())

    processor = WaveformProcessor(settings, test_state, test_stations)

    now = time.time()
    hidden = _HiddenSource(
        lat=-22.86,
        lon=-43.30,
        depth_km=12.0,
        origin_epoch=now - 3.0,
    )
    sample_rate = 50.0
    start_epoch = hidden.origin_epoch - max(34.0, settings.lta_seconds + 4.0)

    p_arrivals = []
    for station in selected:
        d = haversine_km(hidden.lat, hidden.lon, station.latitude, station.longitude)
        p_arrivals.append(
            hidden.origin_epoch
            + travel_time_seconds(
                d,
                hidden.depth_km,
                "P",
                settings.p_velocity_km_s,
                settings.s_velocity_km_s,
            )
        )
    end_epoch = max(p_arrivals) + 8.0
    duration_seconds = int(math.ceil(end_epoch - start_epoch))

    waveforms = {
        station.key: _waveform_for_station(
            station,
            hidden,
            settings,
            start_epoch,
            end_epoch + 1.0,
            sample_rate,
        )
        for station in selected
    }

    timeline: list[dict] = []
    station_cache: dict[str, tuple] = {}
    event_seen = False
    last_revision = 0

    for second in range(duration_seconds):
        offset = int(second * sample_rate)
        next_offset = int((second + 1) * sample_rate)
        for station in selected:
            full = waveforms[station.key]
            chunk = full[offset:next_offset]
            if chunk.size < 2:
                continue
            trace = Trace(data=chunk.copy())
            trace.stats.network = station.network
            trace.stats.station = station.station
            trace.stats.location = station.location
            trace.stats.channel = station.channel if station.channel.endswith("Z") else "BHZ"
            trace.stats.sampling_rate = sample_rate
            trace.stats.starttime = UTCDateTime(start_epoch + second)
            processor.on_trace(trace, "synthetic-rj-waveform")

        at_ms = max(0, int((start_epoch + second - hidden.origin_epoch + 8.0) * 240.0))
        emitted = _drain_messages(test_state, at_ms, timeline, station_cache)
        current_revision = int((test_state.current_event or {}).get("revision") or 0)
        if emitted and current_revision > last_revision:
            event_seen = True
            last_revision = current_revision
            # Keep the real revision timing gate intact. Waiting here is preferable to changing
            # Settings just to make a simulation look nicer.
            if second + 1 < duration_seconds:
                time.sleep(settings.revision_min_interval_seconds + 0.05)

    _drain_messages(test_state, max([row.get("atMs", 0) for row in timeline] + [0]) + 250, timeline, station_cache)
    final = test_state.snapshot()
    derived = final.get("currentEvent")
    if isinstance(derived, dict):
        derived = dict(derived)
        derived["testOnly"] = True
        derived["testLabel"] = "SIMULAÇÃO RJ · resultado calculado pelo pipeline"

    # Do not return the hidden source. The UI cannot use generator truth to draw the epicenter,
    # depth or waves. If the detector fails, the correct visible result is a failed test.
    return {
        "ok": bool(derived),
        "testId": f"rj-{uuid.uuid4().hex[:8]}",
        "mode": "isolated-raw-waveform",
        "pipeline": "waveform bruto → filtro 2–5 Hz → STA/LTA → picks → associação → localizador → revisões",
        "selectedStations": [test_state.stations[station.key] for station in selected],
        "timeline": timeline,
        "derivedEvent": derived,
        "pickCount": len(final.get("recentPicks") or []),
        "eventSeen": event_seen,
        "magnitudeDerived": bool(derived and derived.get("magnitude") is not None),
        "note": (
            "Magnitude/Shindo permanecem vazios se não houver amplitude calibrada. "
            "O teste não injeta magnitude, epicentro, profundidade ou Shindo no detector."
        ),
    }
