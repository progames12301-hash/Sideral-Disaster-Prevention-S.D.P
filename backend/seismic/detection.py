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
from backend.seismic.locator import Pick, haversine_km, locate_event
from backend.seismic.stations import Station
from backend.state import SystemState, utc_iso


@dataclass
class TraceBuffer:
    sample_rate: float
    data: np.ndarray
    end_time: float


def normalized_station_activity(score: float, trigger_on: float) -> float:
    """Map STA/LTA to a conservative continuous 0..1 display value."""
    if not math.isfinite(score):
        return 0.0
    span = max(0.001, trigger_on - 1.0)
    value = max(0.0, min(1.0, (score - 1.0) / span))
    return value ** 1.25


def station_activity_level(score: float, trigger_on: float) -> int:
    """Deterministic GlobalQuake-style station level from 0 through 7.

    These are signal-to-background activity classes, not Shindo and not magnitude.
    Level 6 begins at the actual STA/LTA trigger; level 7 is reserved for a clearly
    stronger-than-trigger signal. Quiet cultural/microseismic background stays 0/1.
    """
    if not math.isfinite(score):
        return 0
    trigger = max(2.0, float(trigger_on))
    thresholds = (
        1.35,
        1.70,
        2.20,
        3.00,
        4.00,
        trigger,
        trigger * 1.45,
    )
    level = 0
    for threshold in thresholds:
        if score >= threshold:
            level += 1
        else:
            break
    return max(0, min(7, level))


def has_sustained_threshold(values: np.ndarray, threshold: float, required_samples: int) -> bool:
    """Reject isolated one-sample spikes; require a short continuous onset."""
    required_samples = max(1, int(required_samples))
    run = 0
    for value in values:
        if float(value) >= threshold:
            run += 1
            if run >= required_samples:
                return True
        else:
            run = 0
    return False


class EventAssociator:
    def __init__(self, settings: Settings, state: SystemState) -> None:
        self.settings = settings
        self.state = state
        self._lock = threading.RLock()
        self._picks: list[Pick] = []
        self._active_id: str | None = None
        self._active_last_pick = 0.0
        self._revision = 0
        self._last_public_event: dict | None = None
        self._last_revision_epoch = 0.0

    @staticmethod
    def _distinct_station_count(picks: list[Pick]) -> int:
        return len({p.station_key for p in picks})

    def _revision_reason(self, candidate: dict, now: float) -> str | None:
        previous = self._last_public_event
        if previous is None:
            return "detecção inicial multiestação"
        if bool(candidate.get("eewEligible")) != bool(previous.get("eewEligible")):
            return "estado EEW alterado"
        if bool(candidate.get("depthResolved")) and not bool(previous.get("depthResolved")):
            return "profundidade passou a ser restringida por fases"

        elapsed = now - self._last_revision_epoch
        if elapsed < self.settings.revision_min_interval_seconds:
            return None

        old_stations = int(previous.get("stationCount") or 0)
        new_stations = int(candidate.get("stationCount") or 0)
        if new_stations > old_stations:
            return f"nova estação associada ({old_stations}→{new_stations})"

        old_phases = previous.get("phaseCounts") or {}
        new_phases = candidate.get("phaseCounts") or {}
        if int(new_phases.get("S") or 0) > int(old_phases.get("S") or 0):
            return "nova fase S associada"

        try:
            shift = haversine_km(
                float(previous["lat"]),
                float(previous["lon"]),
                float(candidate["lat"]),
                float(candidate["lon"]),
            )
        except Exception:
            shift = 0.0
        if shift >= self.settings.revision_location_shift_km:
            return f"solução deslocou {shift:.0f} km"

        old_depth = previous.get("depthKm")
        new_depth = candidate.get("depthKm")
        if old_depth is not None and new_depth is not None:
            if abs(float(new_depth) - float(old_depth)) >= self.settings.revision_depth_shift_km:
                return "profundidade revisada"

        old_conf = int(previous.get("confidence") or 0)
        new_conf = int(candidate.get("confidence") or 0)
        if abs(new_conf - old_conf) >= self.settings.revision_confidence_delta:
            return f"confiança revisada ({old_conf}%→{new_conf}%)"
        if elapsed >= self.settings.revision_max_silence_seconds:
            return "atualização periódica da solução"
        return None

    def add(self, pick: Pick) -> None:
        with self._lock:
            window = self.settings.association_window_seconds
            self._picks = [p for p in self._picks if pick.time - p.time <= window]

            new_key = (pick.station_key, pick.phase)
            old_same = [p for p in self._picks if (p.station_key, p.phase) == new_key]
            self._picks = [p for p in self._picks if (p.station_key, p.phase) != new_key]
            if old_same:
                old = max(old_same, key=lambda p: p.probability)
                self._picks.append(
                    old
                    if old.probability > pick.probability and abs(old.time - pick.time) < 5
                    else pick
                )
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

            rms_quality = max(0.0, 1.0 - result.rms_seconds / self.settings.max_location_rms_seconds)
            station_quality = min(1.0, max(0.0, (station_count - 2) / 6.0))
            gap_quality = max(0.0, min(1.0, (360.0 - result.azimuthal_gap_deg) / 220.0))
            pick_quality = sum(p.probability for p in used) / max(len(used), 1)
            median_latency = float(np.median([p.latency_seconds for p in used])) if used else 999.0
            latency_quality = max(
                0.0,
                1.0 - median_latency / max(self.settings.max_data_latency_seconds, 1.0),
            )
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

            latest_pick_time = max(p.time for p in used)
            origin_age = latest_pick_time - result.origin_time
            picker_set = {str(p.picker or "").lower() for p in used}
            stalta_only = bool(used) and picker_set.issubset({"stalta"})

            public_required = max(self.settings.min_stations, self.settings.public_min_stations)
            public_rms = self.settings.public_max_rms_seconds
            public_gap = self.settings.public_max_azimuthal_gap_deg
            public_confidence = self.settings.public_min_confidence
            if stalta_only:
                public_required = max(public_required, self.settings.stalta_public_min_stations)
                public_rms = min(public_rms, self.settings.stalta_public_max_rms_seconds)
                public_gap = min(public_gap, self.settings.stalta_public_max_azimuthal_gap_deg)
                public_confidence = max(public_confidence, self.settings.stalta_public_min_confidence)

            if station_count < public_required:
                return
            if result.rms_seconds > public_rms:
                return
            if result.azimuthal_gap_deg > public_gap:
                return
            if confidence < public_confidence:
                return
            if origin_age < -3.0 or origin_age > self.settings.public_max_origin_age_seconds:
                return

            new_event = self._active_id is None or pick.time - self._active_last_pick > window
            if new_event:
                self._active_id = f"sdp-{uuid.uuid4().hex[:10]}"
                self._revision = 0
                self._last_public_event = None
                self._last_revision_epoch = 0.0
            self._active_last_pick = pick.time

            phases = {"P": 0, "S": 0}
            for p in used:
                phases["S" if p.phase.upper().startswith("S") else "P"] += 1

            low_latency_used = [
                p for p in used if p.latency_seconds <= self.settings.eew_max_pick_latency_seconds
            ]
            low_latency_station_count = self._distinct_station_count(low_latency_used)
            reliable_phase_used = [
                p
                for p in low_latency_used
                if str(p.picker or "").lower() != "stalta"
                and p.probability >= self.settings.reliable_phase_probability
            ]
            reliable_phase_station_count = self._distinct_station_count(reliable_phase_used)

            if stalta_only:
                phase_gate = low_latency_station_count >= max(
                    public_required, self.settings.stalta_wave_min_stations
                )
            else:
                phase_gate = (
                    reliable_phase_station_count
                    >= self.settings.wave_min_reliable_phase_stations
                )

            eew_eligible = low_latency_station_count >= public_required and phase_gate
            status = "automatic_preliminary" if eew_eligible else "automatic_validated"
            if eew_eligible:
                status_label = (
                    "Detecção automática preliminar · fases e latência compatíveis com EEW experimental"
                )
            elif stalta_only:
                status_label = (
                    "Agitação multiestação validada · hipocentro preliminar de baixa confiança instrumental"
                )
            else:
                status_label = "Hipocentro automático validado · sem quórum suficiente para ondas EEW"

            candidate = {
                "id": self._active_id,
                "revision": self._revision + 1,
                "status": status,
                "statusLabel": status_label,
                "eewEligible": eew_eligible,
                "waveEligible": eew_eligible,
                "publicEligible": True,
                "publicRequiredStations": public_required,
                "lowLatencyStationCount": low_latency_station_count,
                "reliablePhaseStationCount": reliable_phase_station_count,
                "phaseQuality": "stalta-only" if stalta_only else "phase-picker/mixed",
                "originTime": utc_iso(result.origin_time),
                "originEpoch": result.origin_time,
                "originAgeAtDetectionSeconds": round(origin_age, 2),
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

            now = time.time()
            reason = self._revision_reason(candidate, now)
            if reason is None:
                return
            self._revision += 1
            candidate["revision"] = self._revision
            candidate["revisionReason"] = reason
            self._last_public_event = dict(candidate)
            self._last_revision_epoch = now
            self.state.set_event(candidate)


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
        self.state.mark_trigger(
            pick.station_key, pick.time, pick.score, pick.phase, pick.picker
        )
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

        tele_key = f"{key}:{channel}"
        last_telemetry = self._last_telemetry.get(tele_key, 0.0)
        if received_time - last_telemetry >= 1.0:
            self._last_telemetry[tele_key] = received_time
            self.state.touch_station(
                key,
                end_time,
                activity=None,
                source=source_key,
                received_ts=received_time,
                channel=channel,
            )

        # The lightweight fallback uses only Z. Horizontals remain available for PhaseNet.
        if not channel.endswith("Z"):
            return

        stream_key = f"{key}:{channel}"
        with self._lock:
            existing = self._buffers.get(stream_key)
            if (
                existing is None
                or abs(existing.sample_rate - fs) > 0.01
                or end_time < existing.end_time
            ):
                merged = data
            else:
                merged = np.concatenate((existing.data, data))
            keep = int(max(40.0, self.settings.lta_seconds * 3.0) * fs)
            merged = merged[-keep:]
            self._buffers[stream_key] = TraceBuffer(fs, merged, end_time)

        min_samples = int((self.settings.lta_seconds + 2.0) * fs)
        if merged.size < min_samples:
            return

        try:
            work = detrend(merged, type="linear")
            nyquist = fs / 2.0
            low = max(0.05, self.settings.filter_low_hz)
            high = min(self.settings.filter_high_hz, nyquist * 0.80)
            if high <= low:
                return
            sos = butter(3, [low, high], btype="bandpass", fs=fs, output="sos")
            filtered = sosfiltfilt(sos, work)
            nsta = max(2, int(self.settings.sta_seconds * fs))
            nlta = max(nsta + 2, int(self.settings.lta_seconds * fs))
            cft = classic_sta_lta(filtered, nsta, nlta)
        except Exception:
            return

        # Evaluate the last 1.5 seconds, but do not accept a lone numerical spike.
        lookback = max(1, int(1.5 * fs))
        recent = cft[-lookback:]
        if recent.size == 0:
            return
        local_index = int(np.argmax(recent))
        score = float(recent[local_index])
        peak_index = cft.size - lookback + local_index
        seconds_before_end = (cft.size - 1 - peak_index) / fs
        pick_time = end_time - seconds_before_end

        required_samples = max(
            1, int(math.ceil(self.settings.trigger_persist_seconds * fs))
        )
        sustained = has_sustained_threshold(
            recent, self.settings.trigger_on, required_samples
        )

        activity = normalized_station_activity(score, self.settings.trigger_on)
        raw_level = station_activity_level(score, self.settings.trigger_on)
        # Levels 6/7 are warning states, not instantaneous amplitude colors.
        # A short STA/LTA spike may look large numerically but must stay <=5 until
        # it survives the same persistence gate used by the real trigger.
        level = raw_level if sustained else min(raw_level, 5)
        self.state.touch_station(
            key,
            end_time,
            activity=activity,
            activity_level=level,
            activity_score=score,
            source=source_key,
            received_ts=received_time,
            channel=channel,
        )

        if latency > self.settings.max_data_latency_seconds:
            return

        last_trigger = self._last_trigger.get(key, 0.0)

        if (
            sustained
            and score >= self.settings.trigger_on
            and pick_time - last_trigger >= self.settings.refractory_seconds
        ):
            self._last_trigger[key] = pick_time
            excess = max(0.0, score - self.settings.trigger_on)
            probability = 0.50 + 0.48 * (1.0 - math.exp(-excess / 3.0))
            self.add_external_pick(
                Pick(
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
            )
        elif (
            score <= self.settings.trigger_off
            and self.state.stations.get(key, {}).get("triggered")
            and end_time - last_trigger > 3.0
        ):
            self.state.clear_trigger(key)
