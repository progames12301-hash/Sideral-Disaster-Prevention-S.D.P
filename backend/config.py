from __future__ import annotations

import os
from dataclasses import dataclass


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def _env_float_tuple(name: str, default: tuple[float, ...]) -> tuple[float, ...]:
    raw = os.getenv(name)
    if not raw:
        return default
    values: list[float] = []
    for part in raw.split(","):
        try:
            values.append(float(part.strip()))
        except ValueError:
            continue
    return tuple(values) or default


@dataclass(frozen=True)
class SeedLinkSource:
    key: str
    label: str
    endpoint: str
    networks: tuple[str, ...]
    metadata_url: str
    enabled: bool


@dataclass(frozen=True)
class Settings:
    # GlobalQuake-inspired fallback detector. The archived GlobalQuake 0.11 analysis uses
    # a 2-5 Hz default band, a ~0.5 s short average, a 30 s comparison average and a
    # practical event onset near 4.75 * 1.3 = 6.175. S.D.P keeps its own association and
    # location gates because Brazilian station spacing and instrumentation are different.
    min_stations: int = _env_int("SDP_MIN_STATIONS", 3)
    trigger_on: float = _env_float("SDP_TRIGGER_ON", 6.175)
    trigger_off: float = _env_float("SDP_TRIGGER_OFF", 1.25)
    sta_seconds: float = _env_float("SDP_STA_SECONDS", 0.5)
    lta_seconds: float = _env_float("SDP_LTA_SECONDS", 30.0)
    trigger_persist_seconds: float = _env_float("SDP_TRIGGER_PERSIST_SECONDS", 0.35)
    filter_low_hz: float = _env_float("SDP_FILTER_LOW_HZ", 2.0)
    filter_high_hz: float = _env_float("SDP_FILTER_HIGH_HZ", 5.0)
    refractory_seconds: float = _env_float("SDP_REFRACTORY_SECONDS", 20.0)
    association_window_seconds: float = _env_float("SDP_ASSOC_WINDOW_SECONDS", 150.0)
    max_location_rms_seconds: float = _env_float("SDP_MAX_LOCATION_RMS", 5.0)
    max_pick_residual_seconds: float = _env_float("SDP_MAX_PICK_RESIDUAL", 4.0)

    # A public alert is deliberately stricter than an internal candidate. Three picks can
    # mathematically define a hypocenter too easily, so the dashboard waits for a stronger
    # multi-station solution before drawing a public event.
    public_min_stations: int = _env_int("SDP_PUBLIC_MIN_STATIONS", 4)
    public_max_rms_seconds: float = _env_float("SDP_PUBLIC_MAX_RMS", 3.0)
    public_max_azimuthal_gap_deg: float = _env_float("SDP_PUBLIC_MAX_AZIMUTHAL_GAP", 300.0)
    public_min_confidence: int = _env_int("SDP_PUBLIC_MIN_CONFIDENCE", 45)
    public_max_origin_age_seconds: float = _env_float("SDP_PUBLIC_MAX_ORIGIN_AGE", 240.0)
    active_event_seconds: float = _env_float("SDP_ACTIVE_EVENT_SECONDS", 600.0)

    # STA/LTA-only solutions need a much stronger network quorum before they become public.
    stalta_public_min_stations: int = _env_int("SDP_STALTA_PUBLIC_MIN_STATIONS", 6)
    stalta_public_max_rms_seconds: float = _env_float("SDP_STALTA_PUBLIC_MAX_RMS", 2.2)
    stalta_public_max_azimuthal_gap_deg: float = _env_float("SDP_STALTA_PUBLIC_MAX_GAP", 260.0)
    stalta_public_min_confidence: int = _env_int("SDP_STALTA_PUBLIC_MIN_CONFIDENCE", 60)
    stalta_wave_min_stations: int = _env_int("SDP_STALTA_WAVE_MIN_STATIONS", 7)
    reliable_phase_probability: float = _env_float("SDP_RELIABLE_PHASE_PROBABILITY", 0.45)
    wave_min_reliable_phase_stations: int = _env_int("SDP_WAVE_MIN_RELIABLE_PHASE_STATIONS", 2)

    # Revisions behave like successive EEW bulletins instead of one revision per raw pick.
    revision_min_interval_seconds: float = _env_float("SDP_REVISION_MIN_INTERVAL", 1.0)
    revision_max_silence_seconds: float = _env_float("SDP_REVISION_MAX_SILENCE", 8.0)
    revision_location_shift_km: float = _env_float("SDP_REVISION_LOCATION_SHIFT_KM", 10.0)
    revision_depth_shift_km: float = _env_float("SDP_REVISION_DEPTH_SHIFT_KM", 8.0)
    revision_confidence_delta: int = _env_int("SDP_REVISION_CONFIDENCE_DELTA", 5)

    p_velocity_km_s: float = _env_float("SDP_P_VELOCITY", 6.0)
    s_velocity_km_s: float = _env_float("SDP_S_VELOCITY", 3.5)
    depth_candidates_km: tuple[float, ...] = _env_float_tuple(
        "SDP_DEPTH_CANDIDATES_KM", (5.0, 10.0, 20.0, 35.0)
    )

    max_data_latency_seconds: float = _env_float("SDP_MAX_DATA_LATENCY", 40.0)
    eew_max_pick_latency_seconds: float = _env_float("SDP_EEW_MAX_PICK_LATENCY", 8.0)
    station_fresh_seconds: float = _env_float("SDP_STATION_FRESH_SECONDS", 45.0)
    seedlink_stall_seconds: float = _env_float("SDP_SEEDLINK_STALL_SECONDS", 120.0)
    latency_history_size: int = _env_int("SDP_LATENCY_HISTORY_SIZE", 120)

    max_stations_per_source: int = _env_int("SDP_MAX_STATIONS_PER_SOURCE", 90)
    three_component_streams: bool = _env_bool("SDP_THREE_COMPONENT_STREAMS", True)

    phase_picker: str = os.getenv("SDP_PHASE_PICKER", "stalta").strip().lower()
    phasenet_weights: str = os.getenv("SDP_PHASENET_WEIGHTS", "stead")
    phasenet_p_threshold: float = _env_float("SDP_PHASENET_P_THRESHOLD", 0.45)
    phasenet_s_threshold: float = _env_float("SDP_PHASENET_S_THRESHOLD", 0.45)
    phasenet_window_seconds: float = _env_float("SDP_PHASENET_WINDOW_SECONDS", 45.0)
    phasenet_interval_seconds: float = _env_float("SDP_PHASENET_INTERVAL_SECONDS", 4.0)

    debug_simulator: bool = _env_bool("SDP_DEBUG_SIMULATOR", False)
    catalog_url: str = os.getenv(
        "SDP_CATALOG_URL",
        "https://www.moho.iag.usp.br/fdsnws/event/1/query",
    )

    @property
    def sources(self) -> tuple[SeedLinkSource, ...]:
        usp_meta = "http://seisrequest.iag.usp.br/fdsnws/station/1/query"
        earthscope_meta = "https://service.earthscope.org/fdsnws/station/1/query"
        return (
            SeedLinkSource(
                key="usp",
                label="USP / IAG",
                endpoint="seisrequest.iag.usp.br:18000",
                networks=("BL", "BR"),
                metadata_url=usp_meta,
                enabled=_env_bool("SDP_ENABLE_USP", True),
            ),
            SeedLinkSource(
                key="on",
                label="Observatório Nacional",
                endpoint=os.getenv("SDP_ON_SEEDLINK", "rsis1.on.br:18000"),
                networks=("ON",),
                metadata_url=earthscope_meta,
                enabled=_env_bool("SDP_ENABLE_ON", True),
            ),
            SeedLinkSource(
                key="unb",
                label="Universidade de Brasília",
                endpoint=os.getenv("SDP_UNB_SEEDLINK", "datisis.unb.br:18000"),
                networks=("BR",),
                metadata_url=earthscope_meta,
                enabled=_env_bool("SDP_ENABLE_UNB", False),
            ),
            SeedLinkSource(
                key="ufrn",
                label="UFRN",
                endpoint=os.getenv("SDP_UFRN_SEEDLINK", "sislink.geofisica.ufrn.br:18000"),
                networks=("NB",),
                metadata_url=earthscope_meta,
                enabled=_env_bool("SDP_ENABLE_UFRN", False),
            ),
        )


settings = Settings()
