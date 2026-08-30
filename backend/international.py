from __future__ import annotations

import copy
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
JMA_QUAKE_DATA_BASE = "https://www.jma.go.jp/bosai/quake/data/"
JMA_EEW_URL = os.getenv("SDP_JMA_EEW_URL", "").strip()
USER_AGENT = "Sideral-Disaster-Prevention/0.5 (+research; official-source-adapter)"


def _iso(epoch: float | None = None) -> str:
    dt = datetime.fromtimestamp(time.time() if epoch is None else epoch, tz=timezone.utc)
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

    area = item.get("anm") or item.get("en_anm") or item.get("ttl") or "Japão"
    max_intensity = item.get("maxi") or None
    return {
        "id": _stable_id("jma", origin, cod, magnitude),
        "country": "japan",
        "source": "JMA",
        "sourceUrl": JMA_QUAKE_LIST,
        "status": "jma_earthquake_information",
        "statusLabel": "Informação oficial de terremoto JMA",
        "official": True,
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


def _jma_level(value: Any) -> int:
    raw = str(value or "").strip().lower()
    aliases = {
        "0": 0,
        "1": 1,
        "2": 2,
        "3": 3,
        "4": 4,
        "5-": 5,
        "5+": 5,
        "5弱": 5,
        "5強": 5,
        "6-": 6,
        "6+": 6,
        "6弱": 6,
        "6強": 6,
        "7": 7,
    }
    return aliases.get(raw, 0)


def parse_jma_intensity_stations(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract observed JMA intensity stations from a detailed quake report."""
    found: list[dict[str, Any]] = []
    seen: set[str] = set()

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            station_rows = node.get("IntensityStation")
            if isinstance(station_rows, dict):
                station_rows = [station_rows]
            if isinstance(station_rows, list):
                for row in station_rows:
                    if not isinstance(row, dict):
                        continue
                    code = str(row.get("Code") or row.get("code") or "").strip()
                    name = str(row.get("Name") or row.get("name") or code or "JMA").strip()
                    intensity = row.get("Int") if row.get("Int") is not None else row.get("int")
                    latlon = row.get("latlon") or row.get("LatLon") or {}
                    try:
                        lat = float(latlon.get("lat"))
                        lon = float(latlon.get("lon"))
                    except (TypeError, ValueError, AttributeError):
                        continue
                    if not (20.0 <= lat <= 46.5 and 122.0 <= lon <= 147.5):
                        continue
                    key_code = code or f"{lat:.4f}.{lon:.4f}"
                    key = f"JMAI.{key_code}"
                    if key in seen:
                        continue
                    seen.add(key)
                    level = _jma_level(intensity)
                    found.append(
                        {
                            "key": key,
                            "network": "JMAI",
                            "station": code or key_code,
                            "name": name,
                            "lat": round(lat, 5),
                            "lon": round(lon, 5),
                            "level": level,
                            "activityLevel": level,
                            "activityScore": None,
                            "live": False,
                            "online": True,
                            "observed": True,
                            "observedShindo": str(intensity or "0"),
                            "source": "JMA intensidade observada",
                        }
                    )
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(payload)
    return found


def _xml_value(root: ET.Element, local_name: str) -> str | None:
    for elem in root.iter():
        if elem.tag.rsplit("}", 1)[-1] == local_name and elem.text and elem.text.strip():
            return elem.text.strip()
    return None


def parse_jma_eew_xml(document: str, source_url: str = "configured JMA feed") -> dict[str, Any] | None:
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
            "mexico": self._country("mexico", "México", "CIRES / SASMEX", "official-bulletin"),
            "japan": self._country(
                "japan",
                "Japão",
                "JMA",
                "official-eew" if JMA_EEW_URL else "official-postevent",
            ),
        }

    @staticmethod
    def _country(country: str, label: str, source: str, mode: str) -> dict[str, Any]:
        return {
            "country": country,
            "label": label,
            "source": source,
            "mode": mode,
            "event": None,
            "detectedEvent": None,
            "stations": [],
            "stationStreamAvailable": False,
            "stationMetadataAvailable": False,
            "stationSource": None,
            "stationError": None,
            "streamSources": {},
            "recentPicks": [],
            "lastUpdate": None,
            "error": None,
        }

    def update(self, country: str, **values: Any) -> None:
        with self._lock:
            self._data[country].update(values)
            self._data[country]["lastUpdate"] = _iso()

    def _station_map(self, country: str) -> dict[str, dict[str, Any]]:
        return {str(row.get("key")): row for row in self._data[country].get("stations", []) if row.get("key")}

    def merge_stations(self, country: str, stations: list[dict[str, Any]], source_label: str | None = None) -> None:
        with self._lock:
            rows = self._station_map(country)
            for incoming in stations:
                key = str(incoming.get("key") or "")
                if not key:
                    continue
                old = rows.get(key, {})
                preserve = {
                    name: old.get(name)
                    for name in (
                        "level",
                        "activityLevel",
                        "activityScore",
                        "live",
                        "online",
                        "lastData",
                        "lastReceived",
                        "latencySeconds",
                        "triggered",
                        "lastTrigger",
                    )
                    if old.get("live") and not incoming.get("live")
                }
                merged = {**old, **incoming, **preserve}
                merged.setdefault("level", 0)
                merged.setdefault("activityLevel", 0)
                merged.setdefault("live", False)
                merged.setdefault("online", False)
                rows[key] = merged
            self._data[country]["stations"] = list(rows.values())
            self._data[country]["stationMetadataAvailable"] = bool(rows)
            if source_label:
                self._data[country]["stationSource"] = source_label
            self._data[country]["lastUpdate"] = _iso()

    def source_status(self, country: str, key: str, **updates: Any) -> None:
        with self._lock:
            sources = self._data[country].setdefault("streamSources", {})
            current = sources.setdefault(key, {"key": key})
            current.update(updates)
            current["updatedAt"] = _iso()
            states = {str(item.get("state")) for item in sources.values()}
            self._data[country]["stationStreamAvailable"] = "streaming" in states
            self._data[country]["lastUpdate"] = _iso()

    def touch_station(
        self,
        country: str,
        key: str,
        data_ts: float,
        activity: float | None,
        source: str,
        received_ts: float | None = None,
        channel: str | None = None,
        activity_level: int | None = None,
        activity_score: float | None = None,
    ) -> None:
        received_ts = received_ts or time.time()
        latency = max(0.0, received_ts - data_ts)
        with self._lock:
            rows = self._station_map(country)
            station = rows.get(key)
            if station is None:
                return
            station["live"] = True
            station["online"] = True
            if activity is not None:
                station["activity"] = round(max(0.0, min(1.0, float(activity))), 3)
            if activity_level is not None:
                level = max(0, min(7, int(activity_level)))
                station["activityLevel"] = level
                station["level"] = level
            if activity_score is not None:
                station["activityScore"] = round(max(0.0, float(activity_score)), 3)
            station["lastData"] = _iso(data_ts)
            station["lastReceived"] = _iso(received_ts)
            station["lastReceivedEpoch"] = received_ts
            station["latencySeconds"] = round(latency, 2)
            station["source"] = source
            if channel:
                station["lastChannel"] = channel
            self._data[country]["stations"] = list(rows.values())
            self._data[country]["stationStreamAvailable"] = True
            self._data[country]["lastUpdate"] = _iso()

    def mark_trigger(self, country: str, key: str, pick_time: float, score: float, phase: str, picker: str) -> None:
        with self._lock:
            rows = self._station_map(country)
            station = rows.get(key)
            if station is None:
                return
            station["triggered"] = True
            station["lastTrigger"] = _iso(pick_time)
            station["triggerScore"] = round(float(score), 3)
            station["lastPhase"] = phase
            station["lastPicker"] = picker
            self._data[country]["stations"] = list(rows.values())
            self._data[country]["lastUpdate"] = _iso()

    def add_pick(self, country: str, pick: dict[str, Any]) -> None:
        with self._lock:
            picks = self._data[country].setdefault("recentPicks", [])
            picks.insert(0, copy.deepcopy(pick))
            del picks[80:]
            self._data[country]["lastUpdate"] = _iso()

    def set_detected_event(self, country: str, event: dict[str, Any]) -> None:
        tagged = copy.deepcopy(event)
        tagged["country"] = country
        tagged["official"] = False
        tagged["source"] = "S.D.P · waveform em tempo real"
        tagged["statusLabel"] = tagged.get("statusLabel") or "Detecção sísmica automática S.D.P"
        with self._lock:
            self._data[country]["detectedEvent"] = tagged
            self._data[country]["lastUpdate"] = _iso()

    def apply_observed_stations(self, country: str, stations: list[dict[str, Any]], observed_epoch: float | None = None) -> None:
        stamp = time.time() if observed_epoch is None else observed_epoch
        for station in stations:
            station["observedAtEpoch"] = stamp
            station["lastData"] = _iso(stamp)
        self.merge_stations(country, stations, "JMA + waveform público em tempo real")

    def expire_station_activity(self, country: str, live_seconds: float = 35.0, observed_seconds: float = 600.0) -> None:
        now = time.time()
        with self._lock:
            rows = self._station_map(country)
            changed = False
            for station in rows.values():
                if station.get("live"):
                    last = station.get("lastReceivedEpoch")
                    if not isinstance(last, (int, float)) or now - float(last) > live_seconds:
                        station["live"] = False
                        station["online"] = False
                        station["activity"] = 0.0
                        station["activityLevel"] = 0
                        station["level"] = 0
                        station["triggered"] = False
                        changed = True
                if station.get("observed"):
                    observed = station.get("observedAtEpoch")
                    if isinstance(observed, (int, float)) and now - float(observed) > observed_seconds:
                        station["observed"] = False
                        station["online"] = False
                        station["activityLevel"] = 0
                        station["level"] = 0
                        changed = True
            if changed:
                self._data[country]["stations"] = list(rows.values())
                self._data[country]["lastUpdate"] = _iso()

    @staticmethod
    def _active(event: dict[str, Any] | None, max_age: float = 600.0) -> bool:
        if not event:
            return False
        try:
            origin = float(event.get("originEpoch"))
        except (TypeError, ValueError):
            return False
        return -5.0 <= time.time() - origin <= max_age

    def snapshot(self, country: str) -> dict[str, Any]:
        with self._lock:
            data = copy.deepcopy(self._data[country])
        sources = data.get("streamSources") or {}
        if isinstance(sources, dict):
            data["streamSources"] = list(sources.values())
        official = data.get("event")
        detected = data.get("detectedEvent")
        if self._active(official, 600.0) and official.get("eewEligible"):
            display = official
        elif self._active(detected, 600.0):
            display = detected
        else:
            display = official
        data["displayEvent"] = copy.deepcopy(display) if display else None
        data["liveStationCount"] = sum(1 for row in data.get("stations", []) if row.get("live"))
        data["observedStationCount"] = sum(1 for row in data.get("stations", []) if row.get("observed"))
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
            except Exception as exc:
                self.state.update(self.country, error=str(exc)[:240])
            self.stop_event.wait(self.interval)


class MexicoCiresWatcher(_Watcher):
    def __init__(self, state: InternationalState, stop_event: threading.Event) -> None:
        super().__init__(state, stop_event, "mexico", 15.0)

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
        super().__init__(state, stop_event, "japan", 4.0)
        self._last_detail = ""

    def _apply_detail(self, item: dict[str, Any], event: dict[str, Any] | None) -> None:
        detail_name = str(item.get("json") or "").strip()
        if not detail_name or detail_name == self._last_detail:
            return
        detail_url = urljoin(JMA_QUAKE_DATA_BASE, detail_name)
        response = self.session.get(detail_url, timeout=8)
        response.raise_for_status()
        payload = response.json()
        if isinstance(payload, dict):
            stations = parse_jma_intensity_stations(payload)
            if stations:
                observed_epoch = event.get("originEpoch") if event else None
                self.state.apply_observed_stations("japan", stations, observed_epoch)
        self._last_detail = detail_name

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
                    try:
                        self._apply_detail(item, event)
                    except Exception:
                        pass
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
                    source = "JMA + EarthScope SeedLink"
                else:
                    stations = fetch_mexico_station_inventory(self.session)
                    source = "redes sísmicas públicas + CIRES/SASMEX"
                self.state.merge_stations(self.country, stations, source)
                self.state.update(self.country, stationError=None)
            except Exception as exc:
                self.state.update(self.country, stationError=str(exc)[:240])
            self.stop_event.wait(21600.0)


class StationActivityWatchdog(threading.Thread):
    def __init__(self, state: InternationalState, stop_event: threading.Event) -> None:
        super().__init__(name="international-station-activity-watchdog", daemon=True)
        self.state = state
        self.stop_event = stop_event

    def run(self) -> None:
        while not self.stop_event.wait(5.0):
            self.state.expire_station_activity("mexico")
            self.state.expire_station_activity("japan")


def start_international_watchers(state: InternationalState, stop_event: threading.Event) -> list[threading.Thread]:
    watchers: list[threading.Thread] = [
        MexicoCiresWatcher(state, stop_event),
        JapanJmaWatcher(state, stop_event),
        StationInventoryWatcher(state, stop_event, "mexico"),
        StationInventoryWatcher(state, stop_event, "japan"),
        StationActivityWatchdog(state, stop_event),
    ]
    for watcher in watchers:
        watcher.start()

    # Live waveform collectors are isolated from the official-source watchers but feed
    # the same state. Import here avoids a circular module dependency.
    from backend.international_live import start_international_live

    watchers.extend(start_international_live(state, stop_event))
    return watchers
