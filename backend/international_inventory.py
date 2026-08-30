from __future__ import annotations

import re
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urlencode

import requests

JMA_STATION_URL = "https://www.data.jma.go.jp/eqev/data/bulletin/catalog/appendix/stint_e.html"
RASPISHAKE_STATION_URL = "https://data.raspberryshake.org/fdsnws/station/1/query"


class _TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs) -> None:
        tag = tag.lower()
        if tag == "tr":
            self._row = []
        elif tag in {"td", "th"} and self._row is not None:
            self._cell = []

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"td", "th"} and self._row is not None and self._cell is not None:
            self._row.append(" ".join("".join(self._cell).split()))
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if self._row:
                self.rows.append(self._row)
            self._row = None
            self._cell = None


def _to_float(value: str) -> float | None:
    try:
        return float(value.strip())
    except (TypeError, ValueError):
        return None


def parse_jma_station_html(document: str) -> list[dict[str, Any]]:
    """Parse JMA's public seismic-intensity station table.

    These are real station coordinates.  No live shaking value is fabricated: every
    station starts at S.D.P level 0 until a compatible observation stream exists.
    """
    parser = _TableParser()
    parser.feed(document)
    stations: list[dict[str, Any]] = []
    seen: set[str] = set()

    for row in parser.rows:
        # Expected start: code, English name, lat deg, lat min, lon deg, lon min, ...
        if len(row) < 6:
            continue
        code = re.sub(r"\s+", "", row[0]).upper()
        if not re.fullmatch(r"J[A-Z0-9]{4,7}", code):
            continue
        lat_deg = _to_float(row[2])
        lat_min = _to_float(row[3])
        lon_deg = _to_float(row[4])
        lon_min = _to_float(row[5])
        if None in {lat_deg, lat_min, lon_deg, lon_min}:
            continue
        lat = float(lat_deg) + (float(lat_min) / 60.0 if float(lat_deg) >= 0 else -float(lat_min) / 60.0)
        lon = float(lon_deg) + (float(lon_min) / 60.0 if float(lon_deg) >= 0 else -float(lon_min) / 60.0)
        if not (20.0 <= lat <= 46.5 and 122.0 <= lon <= 147.0):
            continue
        if code in seen:
            continue
        seen.add(code)
        stations.append({
            "key": f"JMA.{code}",
            "network": "JMA",
            "station": code,
            "name": row[1].strip() or code,
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            "level": 0,
            "activityLevel": 0,
            "live": False,
            "source": "JMA station inventory",
        })
    return stations


def parse_fdsn_station_text(document: str, *, source_label: str) -> list[dict[str, Any]]:
    stations: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in document.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("|")
        if len(parts) < 4:
            continue
        network, station = parts[0].strip(), parts[1].strip()
        lat, lon = _to_float(parts[2]), _to_float(parts[3])
        if not network or not station or lat is None or lon is None:
            continue
        key = f"{network}.{station}"
        if key in seen:
            continue
        seen.add(key)
        site_name = parts[5].strip() if len(parts) > 5 and parts[5].strip() else station
        stations.append({
            "key": key,
            "network": network,
            "station": station,
            "name": site_name,
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            "level": 0,
            "activityLevel": 0,
            "live": False,
            "source": source_label,
        })
    return stations


def fetch_jma_station_inventory(session: requests.Session) -> list[dict[str, Any]]:
    response = session.get(JMA_STATION_URL, timeout=15)
    response.raise_for_status()
    return parse_jma_station_html(response.text)


def fetch_mexico_station_inventory(session: requests.Session) -> list[dict[str, Any]]:
    # Public Raspberry Shake network metadata within Mexico.  This is station metadata,
    # not redistribution of Raspberry Shake real-time waveform data.
    query = {
        "network": "AM",
        "level": "station",
        "format": "text",
        "minlatitude": "14.0",
        "maxlatitude": "33.5",
        "minlongitude": "-119.0",
        "maxlongitude": "-86.0",
    }
    response = session.get(f"{RASPISHAKE_STATION_URL}?{urlencode(query)}", timeout=20)
    response.raise_for_status()
    return parse_fdsn_station_text(response.text, source_label="Raspberry Shake public inventory")
