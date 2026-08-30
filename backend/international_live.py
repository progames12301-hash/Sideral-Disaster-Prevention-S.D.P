from __future__ import annotations

import threading
import time
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

from backend.config import SeedLinkSource, settings
from backend.seismic.detection import WaveformProcessor
from backend.seismic.seedlink import SeedLinkCollector
from backend.seismic.stations import Station


EARTHSCOPE_STATION = "https://service.earthscope.org/fdsnws/station/1/query"
EARTHSCOPE_SEEDLINK = "rtserve.earthscope.org:18000"


@dataclass(frozen=True)
class LiveProfile:
    country: str
    key: str
    label: str
    networks: tuple[str, ...]
    min_lat: float
    max_lat: float
    min_lon: float
    max_lon: float
    max_stations: int


PROFILES = (
    LiveProfile(
        country="japan",
        key="japan_seedlink",
        label="JMA/JP + redes abertas · EarthScope SeedLink",
        networks=("JP", "IU", "II", "G"),
        min_lat=20.0,
        max_lat=46.5,
        min_lon=122.0,
        max_lon=147.5,
        max_stations=70,
    ),
    LiveProfile(
        country="mexico",
        key="mexico_seedlink",
        label="Redes sísmicas abertas do México · EarthScope SeedLink",
        networks=("MX", "JA", "UC", "IU", "II", "CU"),
        min_lat=14.0,
        max_lat=33.5,
        min_lon=-119.0,
        max_lon=-86.0,
        max_stations=55,
    ),
)

FAMILY_PRIORITY = {"HH": 0, "BH": 1, "EH": 2, "HN": 3, "SH": 4}
_collectors: list[SeedLinkCollector] = []


def _parse_channel_text(text: str, source_key: str) -> list[Station]:
    result: list[Station] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("|")
        if len(parts) < 15:
            continue
        channel = parts[3].strip()
        if not channel.endswith("Z") or channel[:2] not in FAMILY_PRIORITY:
            continue
        try:
            sample_rate = float(parts[14]) if parts[14].strip() else None
            station = Station(
                source=source_key,
                network=parts[0].strip(),
                station=parts[1].strip(),
                location=parts[2].strip(),
                channel=channel,
                latitude=float(parts[4]),
                longitude=float(parts[5]),
                elevation_m=float(parts[6]) if parts[6].strip() else None,
                sample_rate=sample_rate,
            )
        except (ValueError, IndexError):
            continue
        if not station.network or not station.station or (station.sample_rate or 0.0) < 10.0:
            continue
        result.append(station)
    return result


def _select_best_vertical(channels: list[Station], profile: LiveProfile) -> list[Station]:
    network_priority = {network: index for index, network in enumerate(profile.networks)}
    best: dict[str, Station] = {}
    for station in channels:
        old = best.get(station.key)
        if old is None:
            best[station.key] = station
            continue
        current_score = (
            FAMILY_PRIORITY.get(station.family, 99),
            -(station.sample_rate or 0.0),
            station.location,
        )
        old_score = (
            FAMILY_PRIORITY.get(old.family, 99),
            -(old.sample_rate or 0.0),
            old.location,
        )
        if current_score < old_score:
            best[station.key] = station

    ordered = sorted(
        best.values(),
        key=lambda station: (
            network_priority.get(station.network, 99),
            FAMILY_PRIORITY.get(station.family, 99),
            -(station.sample_rate or 0.0),
            station.network,
            station.station,
        ),
    )
    return ordered[: profile.max_stations]


def fetch_live_stations(profile: LiveProfile, session: requests.Session | None = None) -> list[Station]:
    """Resolve current open vertical streams without polling waveform web services."""
    session = session or requests.Session()
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=2)
    channels: list[Station] = []

    for network in profile.networks:
        params = {
            "network": network,
            "channel": "HHZ,BHZ,EHZ,HNZ,SHZ",
            "level": "channel",
            "format": "text",
            "starttime": start.isoformat().replace("+00:00", "Z"),
            "endtime": now.isoformat().replace("+00:00", "Z"),
            "minlatitude": profile.min_lat,
            "maxlatitude": profile.max_lat,
            "minlongitude": profile.min_lon,
            "maxlongitude": profile.max_lon,
            "nodata": 404,
        }
        try:
            response = session.get(EARTHSCOPE_STATION, params=params, timeout=20)
            if response.status_code == 404:
                continue
            response.raise_for_status()
        except requests.RequestException:
            continue
        channels.extend(_parse_channel_text(response.text, profile.key))

    return _select_best_vertical(channels, profile)


class InternationalProcessorState:
    """Bind the generic S.D.P waveform detector to one international country state."""

    def __init__(self, international_state: Any, country: str) -> None:
        self.state = international_state
        self.country = country

    def source_status(self, key: str, **updates: Any) -> None:
        self.state.source_status(self.country, key, **updates)

    def touch_station(
        self,
        key: str,
        data_ts: float,
        activity: float | None,
        source: str,
        received_ts: float | None = None,
        channel: str | None = None,
        activity_level: int | None = None,
        activity_score: float | None = None,
    ) -> None:
        self.state.touch_station(
            self.country,
            key,
            data_ts,
            activity,
            source,
            received_ts=received_ts,
            channel=channel,
            activity_level=activity_level,
            activity_score=activity_score,
        )

    def mark_trigger(self, key: str, pick_time: float, score: float, phase: str = "P", picker: str = "stalta") -> None:
        self.state.mark_trigger(self.country, key, pick_time, score, phase, picker)

    def add_pick(self, pick: dict[str, Any]) -> None:
        self.state.add_pick(self.country, pick)

    def set_event(self, event: dict[str, Any]) -> None:
        self.state.set_detected_event(self.country, event)


class LiveBootstrap(threading.Thread):
    def __init__(self, profile: LiveProfile, international_state: Any, stop_event: threading.Event) -> None:
        super().__init__(name=f"international-live-bootstrap-{profile.country}", daemon=True)
        self.profile = profile
        self.state = international_state
        self.stop_event = stop_event
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "Sideral-Disaster-Prevention/0.5"})

    def run(self) -> None:
        while not self.stop_event.is_set():
            try:
                adapter = InternationalProcessorState(self.state, self.profile.country)
                adapter.source_status(
                    self.profile.key,
                    label=self.profile.label,
                    endpoint=EARTHSCOPE_SEEDLINK,
                    state="loading-metadata",
                    stationCount=0,
                )
                streams = fetch_live_stations(self.profile, self.session)
                if not streams:
                    raise RuntimeError("nenhum stream vertical aberto encontrado no inventário atual")

                public_rows = []
                registry: dict[str, Station] = {}
                for station in streams:
                    registry[station.key] = station
                    public_rows.append(
                        {
                            **station.public(),
                            "name": station.station,
                            "level": 0,
                            "activityLevel": 0,
                            "activityScore": 1.0,
                            "live": False,
                            "online": False,
                            "source": self.profile.label,
                            "streamCapable": True,
                        }
                    )
                self.state.merge_stations(self.profile.country, public_rows, self.profile.label)
                adapter.source_status(
                    self.profile.key,
                    label=self.profile.label,
                    endpoint=EARTHSCOPE_SEEDLINK,
                    state="metadata-ready",
                    stationCount=len(streams),
                )

                # International live streams deliberately use the exact same conservative
                # 0..7 STA/LTA/persistence calibration as the operational Brazil detector.
                detector_settings = replace(settings, phase_picker="stalta")
                processor = WaveformProcessor(detector_settings, adapter, registry)

                source = SeedLinkSource(
                    key=self.profile.key,
                    label=self.profile.label,
                    endpoint=EARTHSCOPE_SEEDLINK,
                    networks=self.profile.networks,
                    metadata_url=EARTHSCOPE_STATION,
                    enabled=True,
                )
                collector = SeedLinkCollector(
                    source=source,
                    stations=streams,
                    state=adapter,
                    on_trace=lambda trace, source_key: processor.on_trace(trace, source_key),
                    stop_event=self.stop_event,
                    stall_seconds=settings.seedlink_stall_seconds,
                )
                _collectors.append(collector)
                collector.start()
                return
            except Exception as exc:
                self.state.source_status(
                    self.profile.country,
                    self.profile.key,
                    label=self.profile.label,
                    endpoint=EARTHSCOPE_SEEDLINK,
                    state="metadata-retry",
                    error=str(exc)[:220],
                    retryInSeconds=90,
                )
                if self.stop_event.wait(90.0):
                    return


def start_international_live(international_state: Any, stop_event: threading.Event) -> list[threading.Thread]:
    threads = [LiveBootstrap(profile, international_state, stop_event) for profile in PROFILES]
    for thread in threads:
        thread.start()
    return threads
