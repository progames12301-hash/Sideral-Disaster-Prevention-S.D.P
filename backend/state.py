from __future__ import annotations

import copy
import queue
import threading
import time
from datetime import datetime, timezone
from typing import Any


def utc_iso(ts: float | None = None) -> str:
    if ts is None:
        dt = datetime.now(timezone.utc)
    else:
        dt = datetime.fromtimestamp(ts, tz=timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


class SystemState:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.outbox: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=5000)
        self.stations: dict[str, dict[str, Any]] = {}
        self.sources: dict[str, dict[str, Any]] = {}
        self.current_event: dict[str, Any] | None = None
        self.history: list[dict[str, Any]] = []
        self.recent_picks: list[dict[str, Any]] = []
        self.started_at = utc_iso()

    def emit(self, message: dict[str, Any]) -> None:
        try:
            self.outbox.put_nowait(message)
        except queue.Full:
            try:
                self.outbox.get_nowait()
                self.outbox.put_nowait(message)
            except queue.Empty:
                pass

    def source_status(self, key: str, **updates: Any) -> None:
        with self._lock:
            current = self.sources.setdefault(key, {"key": key})
            current.update(updates)
            current["updatedAt"] = utc_iso()
            payload = copy.deepcopy(current)
        self.emit({"type": "source", "data": payload})

    def register_station(self, station: dict[str, Any]) -> None:
        key = station["key"]
        with self._lock:
            existing = self.stations.get(key, {})
            merged = {**existing, **station}
            merged.setdefault("online", False)
            merged.setdefault("activity", 0.0)
            merged.setdefault("triggered", False)
            merged.setdefault("lastData", None)
            merged.setdefault("latencySeconds", None)
            merged.setdefault("latencyClass", "unknown")
            merged.setdefault("channels", [])
            channel = station.get("channel")
            channels = list(merged.get("channels") or [])
            if channel and channel not in channels:
                channels.append(channel)
            merged["channels"] = sorted(channels)
            self.stations[key] = merged

    @staticmethod
    def _latency_class(latency: float) -> str:
        if latency <= 3:
            return "realtime"
        if latency <= 10:
            return "delayed"
        if latency <= 40:
            return "late"
        return "stale"

    def touch_station(
        self,
        key: str,
        data_ts: float,
        activity: float,
        source: str,
        received_ts: float | None = None,
        channel: str | None = None,
    ) -> None:
        received_ts = received_ts or time.time()
        latency = max(0.0, received_ts - data_ts)
        with self._lock:
            station = self.stations.get(key)
            if not station:
                return
            station["online"] = True
            station["activity"] = round(max(0.0, min(activity, 1.0)), 3)
            station["lastData"] = utc_iso(data_ts)
            station["lastReceived"] = utc_iso(received_ts)
            station["latencySeconds"] = round(latency, 2)
            station["latencyClass"] = self._latency_class(latency)
            station["source"] = source
            if channel:
                station["lastChannel"] = channel
            payload = {
                "key": key,
                "online": True,
                "activity": station["activity"],
                "lastData": station["lastData"],
                "lastReceived": station["lastReceived"],
                "latencySeconds": station["latencySeconds"],
                "latencyClass": station["latencyClass"],
                "triggered": station.get("triggered", False),
                "lastChannel": station.get("lastChannel"),
            }
        self.emit({"type": "station", "data": payload})

    def mark_trigger(self, key: str, pick_time: float, score: float, phase: str = "P", picker: str = "stalta") -> None:
        with self._lock:
            station = self.stations.get(key)
            if not station:
                return
            station["triggered"] = True
            station["lastTrigger"] = utc_iso(pick_time)
            station["triggerScore"] = round(score, 2)
            station["lastPhase"] = phase
            station["lastPicker"] = picker
            payload = {
                "key": key,
                "triggered": True,
                "lastTrigger": station["lastTrigger"],
                "triggerScore": station["triggerScore"],
                "lastPhase": phase,
                "lastPicker": picker,
            }
        self.emit({"type": "station", "data": payload})

    def clear_trigger(self, key: str) -> None:
        with self._lock:
            station = self.stations.get(key)
            if not station or not station.get("triggered"):
                return
            station["triggered"] = False
        self.emit({"type": "station", "data": {"key": key, "triggered": False}})

    def add_pick(self, pick: dict[str, Any]) -> None:
        with self._lock:
            self.recent_picks.insert(0, copy.deepcopy(pick))
            del self.recent_picks[100:]
            payload = copy.deepcopy(pick)
        self.emit({"type": "pick", "data": payload})

    def set_event(self, event: dict[str, Any]) -> None:
        with self._lock:
            self.current_event = copy.deepcopy(event)
            self._merge_history(event)
            payload = copy.deepcopy(event)
        self.emit({"type": "event", "data": payload})

    def _merge_history(self, event: dict[str, Any]) -> None:
        event_id = event.get("id")
        for i, old in enumerate(self.history):
            if old.get("id") == event_id:
                self.history[i] = copy.deepcopy(event)
                break
        else:
            self.history.insert(0, copy.deepcopy(event))
        del self.history[30:]

    def add_catalog_event(self, event: dict[str, Any]) -> None:
        with self._lock:
            self._merge_history(event)
            payload = copy.deepcopy(event)
        self.emit({"type": "history", "data": payload})

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            stations = copy.deepcopy(list(self.stations.values()))
            latencies = [
                float(s["latencySeconds"])
                for s in stations
                if s.get("latencySeconds") is not None and s.get("online")
            ]
            latencies.sort()
            median_latency = latencies[len(latencies) // 2] if latencies else None
            network_health = {
                "stationCount": len(stations),
                "onlineCount": sum(1 for s in stations if s.get("online")),
                "realtimeCount": sum(1 for s in stations if s.get("latencyClass") == "realtime"),
                "delayedCount": sum(1 for s in stations if s.get("latencyClass") == "delayed"),
                "lateCount": sum(1 for s in stations if s.get("latencyClass") == "late"),
                "staleCount": sum(1 for s in stations if s.get("latencyClass") == "stale"),
                "medianLatencySeconds": round(median_latency, 2) if median_latency is not None else None,
            }
            return {
                "startedAt": self.started_at,
                "stations": stations,
                "sources": copy.deepcopy(list(self.sources.values())),
                "currentEvent": copy.deepcopy(self.current_event),
                "history": copy.deepcopy(self.history),
                "recentPicks": copy.deepcopy(self.recent_picks[:30]),
                "networkHealth": network_health,
            }
