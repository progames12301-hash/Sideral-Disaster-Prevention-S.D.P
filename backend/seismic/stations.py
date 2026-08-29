from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime, timedelta, timezone
from typing import Iterable

import requests

from backend.config import SeedLinkSource


FAMILY_PRIORITY = {"HH": 0, "BH": 1, "EH": 2, "HN": 3, "SH": 4}
COMPONENT_PRIORITY = {"Z": 0, "N": 1, "1": 1, "E": 2, "2": 2}


@dataclass(frozen=True)
class Station:
    source: str
    network: str
    station: str
    location: str
    channel: str
    latitude: float
    longitude: float
    elevation_m: float | None
    sample_rate: float | None

    @property
    def key(self) -> str:
        return f"{self.network}.{self.station}"

    @property
    def stream_key(self) -> str:
        loc = self.location or "--"
        return f"{self.network}.{self.station}.{loc}.{self.channel}"

    @property
    def family(self) -> str:
        return self.channel[:2] if len(self.channel) >= 2 else self.channel

    @property
    def component(self) -> str:
        return self.channel[-1:] if self.channel else ""

    def public(self) -> dict:
        return {
            **asdict(self),
            "key": self.key,
            "lat": self.latitude,
            "lon": self.longitude,
        }


def _parse_fdsn_text(text: str, source_key: str) -> list[Station]:
    stations: list[Station] = []
    for raw in text.splitlines():
        if not raw or raw.startswith("#"):
            continue
        parts = raw.split("|")
        if len(parts) < 15:
            continue
        try:
            stations.append(
                Station(
                    source=source_key,
                    network=parts[0].strip(),
                    station=parts[1].strip(),
                    location=parts[2].strip(),
                    channel=parts[3].strip(),
                    latitude=float(parts[4]),
                    longitude=float(parts[5]),
                    elevation_m=float(parts[6]) if parts[6].strip() else None,
                    sample_rate=float(parts[14]) if parts[14].strip() else None,
                )
            )
        except (ValueError, IndexError):
            continue
    return stations


def _family_score(family: str) -> int:
    return FAMILY_PRIORITY.get(family, 99)


def _choose_station_channels(channels: list[Station], three_component: bool) -> list[Station]:
    """Choose one coherent instrument family per station, preferring broadband/high-rate channels.

    PhaseNet and other 3-C pickers work best when Z + two horizontal components come from the
    same instrument family/location. If 3-C is unavailable we still return the best Z channel.
    """
    by_family: dict[tuple[str, str], list[Station]] = {}
    for st in channels:
        if st.component not in COMPONENT_PRIORITY:
            continue
        by_family.setdefault((st.location, st.family), []).append(st)

    candidates: list[tuple[int, int, float, tuple[str, str], list[Station]]] = []
    for key, items in by_family.items():
        components = {s.component for s in items}
        has_z = "Z" in components
        has_h1 = bool({"N", "1"} & components)
        has_h2 = bool({"E", "2"} & components)
        completeness = int(has_z) + int(has_h1) + int(has_h2)
        if not has_z:
            continue
        rate = max((s.sample_rate or 0.0) for s in items)
        candidates.append((_family_score(key[1]), -completeness, -rate, key, items))

    if not candidates:
        return []
    candidates.sort()
    _, _, _, _, selected_family = candidates[0]

    best_by_component: dict[str, Station] = {}
    for st in selected_family:
        canonical = st.component
        if canonical == "1":
            canonical = "N"
        elif canonical == "2":
            canonical = "E"
        old = best_by_component.get(canonical)
        if old is None or (st.sample_rate or 0) > (old.sample_rate or 0):
            best_by_component[canonical] = st

    if not three_component:
        z = best_by_component.get("Z")
        return [z] if z else []

    ordered = [best_by_component[c] for c in ("Z", "N", "E") if c in best_by_component]
    return ordered


def fetch_source_stations(
    source: SeedLinkSource,
    max_stations: int = 90,
    three_component: bool = True,
) -> list[Station]:
    start = datetime.now(timezone.utc) - timedelta(days=2)
    params = {
        "network": ",".join(source.networks),
        "channel": "HH?,BH?,EH?,HN?,SH?",
        "level": "channel",
        "format": "text",
        "starttime": start.isoformat().replace("+00:00", "Z"),
        "minlatitude": -38,
        "maxlatitude": 8,
        "minlongitude": -82,
        "maxlongitude": -28,
        "nodata": 404,
    }
    response = requests.get(source.metadata_url, params=params, timeout=25)
    response.raise_for_status()
    channels = _parse_fdsn_text(response.text, source.key)

    grouped: dict[tuple[str, str], list[Station]] = {}
    for st in channels:
        grouped.setdefault((st.network, st.station), []).append(st)

    station_choices: list[tuple[tuple[int, float, str, str], list[Station]]] = []
    for (network, station), items in grouped.items():
        chosen = _choose_station_channels(items, three_component=three_component)
        if not chosen:
            continue
        z = next((s for s in chosen if s.component == "Z"), chosen[0])
        score = (_family_score(z.family), -(z.sample_rate or 0), network, station)
        station_choices.append((score, chosen))

    station_choices.sort(key=lambda item: item[0])
    selected_groups = station_choices[:max_stations]
    result: list[Station] = []
    for _, group in selected_groups:
        result.extend(group)
    return result


def merge_station_sets(groups: Iterable[Iterable[Station]]) -> dict[str, Station]:
    result: dict[str, Station] = {}
    for group in groups:
        for station in group:
            # Prefer the vertical channel as representative station metadata.
            old = result.get(station.key)
            if old is None or (station.component == "Z" and old.component != "Z"):
                result[station.key] = station
    return result
