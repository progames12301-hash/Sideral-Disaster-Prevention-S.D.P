from __future__ import annotations

import io
import math
import threading
from datetime import datetime, timedelta, timezone

import requests
from obspy import read_events

from backend.config import Settings
from backend.seismic.locator import haversine_km
from backend.state import SystemState, utc_iso


class CatalogWatcher:
    def __init__(self, settings: Settings, state: SystemState, stop_event: threading.Event) -> None:
        self.settings = settings
        self.state = state
        self.stop_event = stop_event
        self.thread = threading.Thread(target=self._run, name="catalog-watcher", daemon=True)
        self._known: set[str] = set()

    def start(self) -> None:
        self.thread.start()

    def _run(self) -> None:
        # Polling is only a confirmation/history layer. Detection itself comes from SeedLink.
        while not self.stop_event.is_set():
            try:
                events = self._fetch_recent()
                for event in events:
                    self._known.add(event["id"])
                    self.state.add_catalog_event(event)
                    self._try_confirm_current(event)
            except Exception:
                pass
            self.stop_event.wait(45)

    def _fetch_recent(self) -> list[dict]:
        start = datetime.now(timezone.utc) - timedelta(hours=12)
        params = {
            "starttime": start.isoformat().replace("+00:00", "Z"),
            "minlatitude": -40,
            "maxlatitude": 10,
            "minlongitude": -82,
            "maxlongitude": -24,
            "orderby": "time",
            "limit": 50,
        }
        response = requests.get(self.settings.catalog_url, params=params, timeout=30)
        response.raise_for_status()
        catalog = read_events(io.BytesIO(response.content))
        result: list[dict] = []
        for evt in catalog:
            origin = evt.preferred_origin() or (evt.origins[0] if evt.origins else None)
            if origin is None:
                continue
            mag = evt.preferred_magnitude() or (evt.magnitudes[0] if evt.magnitudes else None)
            event_id = str(evt.resource_id or "")
            if not event_id:
                event_id = f"catalog-{float(origin.time.timestamp):.0f}-{origin.latitude:.3f}-{origin.longitude:.3f}"
            depth_km = (origin.depth / 1000.0) if origin.depth is not None else None
            result.append(
                {
                    "id": event_id,
                    "status": "catalog",
                    "statusLabel": "Catálogo sísmico",
                    "originTime": utc_iso(float(origin.time.timestamp)),
                    "originEpoch": float(origin.time.timestamp),
                    "lat": float(origin.latitude),
                    "lon": float(origin.longitude),
                    "depthKm": round(depth_km, 1) if depth_km is not None else None,
                    "magnitude": float(mag.mag) if mag and mag.mag is not None else None,
                    "magnitudeType": mag.magnitude_type if mag else None,
                    "stationCount": None,
                    "confidence": 100,
                    "updatedAt": utc_iso(),
                }
            )
        return result

    def _try_confirm_current(self, catalog_event: dict) -> None:
        current = self.state.snapshot().get("currentEvent")
        if not current or current.get("status") == "catalog_confirmed":
            return
        dt = abs(float(current["originEpoch"]) - float(catalog_event["originEpoch"]))
        if dt > 180:
            return
        distance = haversine_km(
            float(current["lat"]),
            float(current["lon"]),
            float(catalog_event["lat"]),
            float(catalog_event["lon"]),
        )
        if distance > 180:
            return
        confirmed = {
            **current,
            "status": "catalog_confirmed",
            "statusLabel": "Correspondência encontrada no catálogo",
            "catalogId": catalog_event["id"],
            "lat": catalog_event["lat"],
            "lon": catalog_event["lon"],
            "depthKm": catalog_event.get("depthKm"),
            "depthResolved": True,
            "magnitude": catalog_event.get("magnitude"),
            "magnitudeType": catalog_event.get("magnitudeType"),
            "updatedAt": utc_iso(),
        }
        self.state.set_event(confirmed)
