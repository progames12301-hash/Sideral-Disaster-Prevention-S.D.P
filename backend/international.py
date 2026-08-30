from __future__ import annotations

import hashlib
import html as html_lib
import os
import re
import threading
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urljoin

import requests

from backend.international_inventory import fetch_jma_station_inventory, fetch_mexico_station_inventory


CIRES_HOME = os.getenv("SDP_CIRES_URL", "https://www.cires.org.mx/")
JMA_QUAKE_LIST = os.getenv("SDP_JMA_QUAKE_LIST", "https://www.jma.go.jp/bosai/quake/data/list.json")
JMA_EEW_URL = os.getenv("SDP_JMA_EEW_URL", "").strip()
USER_AGENT = "Sideral-Disaster-Prevention/0.4 (+research; official-source-adapter)"


def _iso(epoch: float | None = None) -> str:
    dt = datetime.fromtimestamp(epoch or time.time(), tz=timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


def _text(value: str) -> str:
    value = re.sub(r"(?is)<script.*?</script>|<style.*?</style>", " ", value)
    value = re.sub(r"(?s)<[^>]+>", " ", value)
    value = html_lib.unescape(value)
    return re.sub(r"\s+", " ", value).strip()


def _number(pattern: str, text: str) -> float | None:
    match = re.search(pattern, text, re.I)
    if not match:
        return None
    try:
        return float(match.group(1).replace(",", "."))
    except (TypeError, ValueError):
        return None


def _stable_id(prefix: str, *parts: Any) -> str:
    raw = "|".join("" if p is None else str(p) for p in parts)
    return f"{prefix}-{hashlib.sha1(raw.encode('utf-8')).hexdigest()[:12]}"


def _coordinate_triplet(value: str | None) -> tuple[float | None, float | None, float | None]:
    if not value:
        return None, None, None
    values = re.findall(r"[+-]\d+(?:\.\d+)?", value)
    if len(values) < 2:
        return None, None, None
    try:
        lat = float(values[0])
        lon = float(values[1])
        depth = abs(float(values[2])) / 1000.0 if len(values) >= 3 else None
        return lat, lon, depth
    except ValueError:
        return None, None, None


def parse_cires_detail(document: str, source_url: str = CIRES_HOME) -> dict[str, Any] | None:
    """Parse the public CIRES/SASMEX bulletin page.

    The bulletin can include SSN hypocenter/magnitude values.  We keep the provenance
    explicit: an alert decision is CIRES/SASMEX, while hypocenter fields shown in a
    bulletin may be labelled by CIRES as SSN data.
    """
    text = _text(document)
    if "SASMEX" not in text.upper():
        return None

    date_match = re.search(r"Fecha\s+GMT\s*[:\-]?\s*(\d{1,2}/\d{1,2}/\d{4})", text, re.I)
    time_match = re.search(r"Hora\s+GMT\s*[:\-]?\s*(\d{1,2}:\d{2}:\d{2})", text, re.I)
    origin_epoch: float | None = None
    if date_match and time_match:
        try:
            origin_epoch = datetime.strptime(
                f"{date_match.group(1)} {time_match.group(1)}", "%d/%m/%Y %H:%M:%S"
            ).replace(tzinfo=timezone.utc).timestamp()
        except ValueError:
            origin_epoch = None

    magnitude = _number(r"Mag(?:nitud)?\s+(?:Inicial\s+)?Preliminar\s*[:\-]?\s*([0-9]+(?:[.,][0-9]+)?)", text)
    lat = _number(r"Latitud\s*:?\s*(-?[0-9]+(?:[.,][0-9]+)?)", text)
    lon = _number(r"Longitud\s*:?\s*(-?[0-9]+(?:[.,][0-9]+)?)", text)
    depth = _number(r"Profundidad\s*(?:\(Km\))?\s*[:\-]?\s*([0-9]+(?:[.,][0-9]+)?)", text)
    station_match = re.search(r"inicialmente\s+en\s+(\d+)\s+estaciones", text, re.I)
    station_count = int(station_match.group(1)) if station_match else None

    no_alert = bool(re.search(r"No\s+Amerit[oó].{0,80}(?:aviso\s+de\s+)?Alerta", text, re.I))
    issued_alert = not no_alert and bool(
        re.search(r"gener[oó].{0,100}(?:aviso\s+de\s+)?Alerta\s+S[ií]smica", text, re.I)
        or re.search(r"Tipo\s+de\s+Aviso.{0,80}Alerta\s+S[ií]smica", text, re.I)
    )

    if origin_epoch is None and magnitude is None and lat is None:
        return None

    return {
        "id": _stable_id("cires", origin_epoch, magnitude, lat, lon),
        "country": "mexico",
        "source": "CIRES / SASMEX",
        "sourceUrl": source_url,
        "status": "cires_alert" if issued_alert else "cires_detection",
        "statusLabel": "Alerta Sísmica SASMEX" if issued_alert else "Detección SASMEX · sin alerta pública",
        "official": True,
        "eewEligible": issued_alert,
        "waveEligible": bool(issued_alert and origin_epoch is not None and lat is not None and lon is not None),
        "originEpoch": origin_epoch,
        "originTime": _iso(origin_epoch) if origin_epoch is not None else None,
        "lat": lat,
        "lon": lon,
        "depthKm": depth,
        "magnitude": magnitude,
        "magnitudeType": "M preliminar (SSN en boletín CIRES)" if magnitude is not None else None,
        "stationCount": station_count,
        "maxIntensity": None,
        "pVelocityKmS": 6.0,
        "sVelocityKmS": 3.5,
        "updatedAt": _iso(),
    }


def _find_cires_detail(home_html: str) -> str | None:
    links = re.findall(r"(?is)href\s*=\s*[\"']([^\"']+)[\"']", home_html)
    for href in links:
        if "sasmex_reporte_alerta" in href.lower():
            return urljoin(CIRES_HOME, href)
    return None


def parse_jma_quake_item(item: dict[str, Any]) -> dict[str, Any] | None:
    origin = item.get("at") or item.get("ot")
    cod = item.get("cod") or item.get("coord")
    lat, lon, depth = _coordinate_triplet(str(cod or ""))
    magnitude_raw = item.get("mag")
    try:
        magnitude = float(magnitude_raw) if magnitude_raw not in (None, "", "不明") else None
    except (TypeError, ValueError):
        magnitude = None

    origin_epoch: float | None = None
    if origin:
        try:
            origin_epoch = datetime.fromisoformat(str(origin).replace("Z", "+00:00")).timestamp()
        except ValueError:
            origin_epoch = None

    if origin_epoch is None and lat is None and magnitude is None:
        return None

    area = item.get("anm") or item.get("en_anm") or item.get("ttl") or "Japon"
    max_intensity = item.get("maxi") or None
    return {
        "id": _stable_id("jma", origin, cod, magnitude),
        "country": "japan",
        "source": "JMA",
        "sourceUrl": JMA_QUAKE_LIST,
        "status": "jma_earthquake_information",
        "statusLabel": "Informação oficial de terremoto JMA",
        "official": True,
        # The public quake list is post-event information, not the JMA EEW telegram.
        "eewEligible": False,
        "waveEligible": False,
        "originEpoch": origin_epoch,
        "originTime": _iso(origin_epoch) if origin_epoch is not None else str(origin or ""),
        "lat": lat,
        "lon": lon,
        "depthKm": depth,
        "magnitude": magnitude,
        "magnitudeType": "Mj/JMA",
        "maxIntensity": str(max_intensity) if max_intensity not in (None, "") else None,
        "area": area,
        "pVelocityKmS": 6.0,
        "sVelocityKmS": 3.5,
        "updatedAt": _iso(),
    }


def _xml_value(root: ET.Element, local_name: str) -> str | None:
    for elem in root.iter():
        if elem.tag.rsplit("}", 1)[-1] == local_name and elem.text and elem.text.strip():
            return elem.text.strip()
    return None


def parse_jma_eew_xml(document: str, source_url: str = "configured JMA feed") -> dict[str, Any] | None:
    """Parse a JMA VXSE44/VXSE45-style disaster XML document.

    JMA's immediate EEW telegrams are distributed through the JMA Support Center.
    S.D.P does not invent a public endpoint: set SDP_JMA_EEW_URL to an authorized
    JMA XML relay/feed when one is available.
    """
    try:
        root = ET.fromstring(document)
    except ET.ParseError:
        return None

    origin = _xml_value(root, "OriginTime") or _xml_value(root, "ArrivalTime")
    coordinate = _xml_value(root, "Coordinate")
    magnitude_text = _xml_value(root, "Magnitude")
    event_id = _xml_value(root, "EventID") or _xml_value(root, "Serial")
    area = _xml_value(root, "Name")
    lat, lon, depth = _coordinate_triplet(coordinate)

    try:
        magnitude = float(magnitude_text) if magnitude_text else None
    except ValueError:
        magnitude = None
    try:
        origin_epoch = datetime.fromisoformat(str(origin).replace("Z", "+00:00")).timestamp() if origin else None
    except ValueError:
        origin_epoch = None

    if origin_epoch is None and lat is None:
        return None
    return {
        "id": f"jma-eew-{event_id}" if event_id else _stable_id("jma-eew", origin, coordinate, magnitude),
        "country": "japan",
        "source": "JMA EEW",
        "sourceUrl": source_url,
        "status": "jma_eew",
        "statusLabel": "緊急地震速報 · JMA EEW",
        "official": True,
        "eewEligible": True,
        "waveEligible": bool(origin_epoch is not None and lat is not None and lon is not None),
        "originEpoch": origin_epoch,
        "originTime": _iso(origin_epoch) if origin_epoch is not None else origin,
        "lat": lat,
        "lon": lon,
        "depthKm": depth,
        "magnitude": magnitude,
        "magnitudeType": "Mj/JMA EEW",
        "maxIntensity": None,
        "area": area,
        "pVelocityKmS": 6.0,
        "sVelocityKmS": 3.5,
        "updatedAt": _iso(),
    }


class InternationalState:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._data: dict[str, dict[str, Any]] = {
            "mexico": {
                "country": "mexico",
                "label": "México",
                "source": "CIRES / SASMEX",
                "mode": "official-bulletin",
                "event": None,
                "stations": [],
                "stationStreamAvailable": False,
                "stationMetadataAvailable": False,
                "stationSource": None,
                "stationError": None,
                "lastUpdate": None,
                "error": None,
            },
            "japan": {
                "country": "japan",
                "label": "Japão",
                "source": "JMA",
                "mode": "official-eew" if JMA_EEW_URL else "official-postevent",
                "event": None,
                "stations": [],
                "stationStreamAvailable": False,
                "stationMetadataAvailable": False,
                "stationSource": None,
                "stationError": None,
                "lastUpdate": None,
                "error": None,
            },
        }

    def update(self, country: str, **values: Any) -> None:
        with self._lock:
            self._data[country].update(values)
            self._data[country]["lastUpdate"] = _iso()

    def snapshot(self, country: str) -> dict[str, Any]:
        with self._lock:
            data = dict(self._data[country])
            data["stations"] = [dict(x) for x in self._data[country].get("stations", [])]
            data["event"] = dict(data["event"]) if data.get("event") else None
            return data


@dataclass
class _Watcher(threading.Thread):
    state: InternationalState
    stop_event: threading.Event
    country: str
    interval: float

    def __post_init__(self) -> None:
        threading.Thread.__init__(self, name=f"international-{self.country}", daemon=True)
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json,text/html,application/xml,*/*"})

    def fetch_event(self) -> dict[str, Any] | None:
        raise NotImplementedError

    def run(self) -> None:
        while not self.stop_event.is_set():
            try:
                event = self.fetch_event()
                self.state.update(self.country, event=event, error=None)
            except Exception as exc:  # keep last good event visible
                self.state.update(self.country, error=str(exc)[:240])
            self.stop_event.wait(self.interval)


class MexicoCiresWatcher(_Watcher):
    def __init__(self, state: InternationalState, stop_event: threading.Event) -> None:
        super().__init__(state, stop_event, "mexico", 20.0)

    def fetch_event(self) -> dict[str, Any] | None:
        home = self.session.get(CIRES_HOME, timeout=12)
        home.raise_for_status()
        detail_url = _find_cires_detail(home.text)
        if detail_url:
            detail = self.session.get(detail_url, timeout=12)
            detail.raise_for_status()
            event = parse_cires_detail(detail.text, detail_url)
            if event:
                return event
        return parse_cires_detail(home.text, CIRES_HOME)


class JapanJmaWatcher(_Watcher):
    def __init__(self, state: InternationalState, stop_event: threading.Event) -> None:
        super().__init__(state, stop_event, "japan", 4.0 if JMA_EEW_URL else 15.0)

    def fetch_event(self) -> dict[str, Any] | None:
        if JMA_EEW_URL:
            response = self.session.get(JMA_EEW_URL, timeout=8)
            response.raise_for_status()
            event = parse_jma_eew_xml(response.text, JMA_EEW_URL)
            if event:
                return event

        response = self.session.get(JMA_QUAKE_LIST, timeout=10)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, list):
            return None
        for item in payload:
            if isinstance(item, dict):
                event = parse_jma_quake_item(item)
                if event:
                    return event
        return None


class StationInventoryWatcher(threading.Thread):
    def __init__(self, state: InternationalState, stop_event: threading.Event, country: str) -> None:
        super().__init__(name=f"international-stations-{country}", daemon=True)
        self.state = state
        self.stop_event = stop_event
        self.country = country
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT, "Accept": "text/plain,text/html,*/*"})

    def run(self) -> None:
        while not self.stop_event.is_set():
            try:
                if self.country == "japan":
                    stations = fetch_jma_station_inventory(self.session)
                    source = "JMA seismic-intensity stations"
                else:
                    stations = fetch_mexico_station_inventory(self.session)
                    source = "Raspberry Shake public stations in Mexico"
                self.state.update(
                    self.country,
                    stations=stations,
                    stationMetadataAvailable=bool(stations),
                    stationStreamAvailable=False,
                    stationSource=source,
                    stationError=None,
                )
            except Exception as exc:
                self.state.update(self.country, stationError=str(exc)[:240])
            self.stop_event.wait(21600.0)


def start_international_watchers(state: InternationalState, stop_event: threading.Event) -> list[threading.Thread]:
    watchers: list[threading.Thread] = [
        MexicoCiresWatcher(state, stop_event),
        JapanJmaWatcher(state, stop_event),
        StationInventoryWatcher(state, stop_event, "mexico"),
        StationInventoryWatcher(state, stop_event, "japan"),
    ]
    for watcher in watchers:
        watcher.start()
    return watchers
