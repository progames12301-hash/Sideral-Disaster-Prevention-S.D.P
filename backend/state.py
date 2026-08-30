from __future__ import annotations

import copy
import queue
import statistics
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any


def utc_iso(ts: float | None = None) -> str:
    if ts is None:
        dt = datetime.now(timezone.utc)
    else:
        dt = datetime.fromtimestamp(ts, tz=timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


def _percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    pos = (len(ordered) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(ordered) - 1)
    frac = pos - lo
    return ordered[lo] * (1 - frac) + ordered[hi] * frac


class SystemState:
    def __init__(self, latency_history_size: int = 120) -> None:
        self._lock = threading.RLock()
        self.outbox: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=5000)
        self.stations: dict[str, dict[str, Any]] = {}
        self.sources: dict[str, dict[str, Any]] = {}
        self.current_event: dict[str, Any] | None = None
        self.history: list[dict[str, Any]] = []
        self.recent_picks: list[dict[str, Any]] = []
        self.started_epoch = time.time()
        self.started_at = utc_iso(self.started_epoch)
        self._latencies: dict[str, deque[float]] = {}
        self._last_received_epoch: dict[str, float] = {}
        self._latency_history_size = max(10, latency_history_size)

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
            merged.setdefault("activityLevel", 0)
            merged.setdefault("activityScore", 1.0)
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
            self._latencies.setdefault(key, deque(maxlen=self._latency_history_size))

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
        activity: float | None,
        source: str,
        received_ts: float | None = None,
        channel: str | None = None,
        activity_level: int | None = None,
        activity_score: float | None = None,
    ) -> None:
        """Update telemetry without letting non-Z packets erase the last shaking level.

        `activity=None` means that this packet is only a network/latency heartbeat.  That is
        important with 3-component streams: an N/E packet arriving just after Z must not reset
        a station back to level 0.
        """
        received_ts = received_ts or time.time()
        latency = max(0.0, received_ts - data_ts)
        with self._lock:
            station = self.stations.get(key)
            if not station:
                return
            self._latencies.setdefault(key, deque(maxlen=self._latency_history_size)).append(latency)
            self._last_received_epoch[key] = received_ts
            station["online"] = True
            if activity is not None:
                station["activity"] = round(max(0.0, min(float(activity), 1.0)), 3)
            if activity_level is not None:
                station["activityLevel"] = max(0, min(7, int(activity_level)))
            if activity_score is not None:
                station["activityScore"] = round(max(0.0, float(activity_score)), 3)
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
                "activity": station.get("activity", 0.0),
                "activityLevel": station.get("activityLevel", 0),
                "activityScore": station.get("activityScore", 1.0),
                "lastData": station["lastData"],
                "lastReceived": station["lastReceived"],
                "latencySeconds": station["latencySeconds"],
                "latencyClass": station["latencyClass"],
                "triggered": station.get("triggered", False),
                "lastChannel": station.get("lastChannel"),
            }
        self.emit({"type": "station", "data": payload})

    def expire_stale_stations(self, fresh_seconds: float) -> int:
        now = time.time()
        changed: list[str] = []
        with self._lock:
            for key, station in self.stations.items():
                last = self._last_received_epoch.get(key)
                if station.get("online") and (last is None or now - last > fresh_seconds):
                    station["online"] = False
                    station["latencyClass"] = "stale"
                    changed.append(key)
        for key in changed:
            self.emit({"type": "station", "data": {"key": key, "online": False, "latencyClass": "stale"}})
        return len(changed)

    def expire_current_event(self, max_age_seconds: float) -> bool:
        """Remove the active-map event after its useful warning window, keeping history intact."""
        now = time.time()
        expired = False
        with self._lock:
            event = self.current_event
            if event is not None:
                try:
                    origin = float(event.get("originEpoch"))
                except (TypeError, ValueError):
                    origin = now
                if now - origin > max(30.0, max_age_seconds):
                    self.current_event = None
                    expired = True
        if expired:
            self.emit({"type": "event", "data": None})
        return expired

    def latency_report(self, eew_threshold_seconds: float, fresh_seconds: float) -> dict[str, Any]:
        now = time.time()
        rows: list[dict[str, Any]] = []
        with self._lock:
            for key, station in self.stations.items():
                samples = list(self._latencies.get(key, ()))
                last_received = self._last_received_epoch.get(key)
                fresh = last_received is not None and now - last_received <= fresh_seconds
                median = statistics.median(samples) if samples else None
                p95 = _percentile(samples, 0.95)
                row = {
                    "key": key,
                    "source": station.get("source"),
                    "network": station.get("network"),
                    "station": station.get("station"),
                    "lat": station.get("lat"),
                    "lon": station.get("lon"),
                    "sampleCount": len(samples),
                    "lastLatencySeconds": round(samples[-1], 2) if samples else None,
                    "medianLatencySeconds": round(median, 2) if median is not None else None,
                    "p95LatencySeconds": round(p95, 2) if p95 is not None else None,
                    "fresh": fresh,
                    "eewStreamEligible": bool(fresh and len(samples) >= 3 and p95 is not None and p95 <= eew_threshold_seconds),
                    "lastReceived": station.get("lastReceived"),
                }
                rows.append(row)
        rows.sort(key=lambda r: (not r["eewStreamEligible"], r["p95LatencySeconds"] is None, r["p95LatencySeconds"] or 1e9, r["key"]))
        eligible = [r for r in rows if r["eewStreamEligible"]]
        return {
            "generatedAt": utc_iso(now),
            "thresholdSeconds": eew_threshold_seconds,
            "freshSeconds": fresh_seconds,
            "stationCount": len(rows),
            "eligibleCount": len(eligible),
            "stations": rows,
        }

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
            latencies = [float(s["latencySeconds"]) for s in stations if s.get("latencySeconds") is not None and s.get("online")]
            latencies.sort()
            median_latency = statistics.median(latencies) if latencies else None
            network_health = {
                "stationCount": len(stations),
                "onlineCount": sum(1 for s in stations if s.get("online")),
                "realtimeCount": sum(1 for s in stations if s.get("online") and s.get("latencyClass") == "realtime"),
                "delayedCount": sum(1 for s in stations if s.get("online") and s.get("latencyClass") == "delayed"),
                "lateCount": sum(1 for s in stations if s.get("online") and s.get("latencyClass") == "late"),
                "staleCount": sum(1 for s in stations if s.get("latencyClass") == "stale"),
                "medianLatencySeconds": round(median_latency, 2) if median_latency is not None else None,
            }
            return {
                "startedAt": self.started_at,
                "uptimeSeconds": round(time.time() - self.started_epoch, 1),
                "stations": stations,
                "sources": copy.deepcopy(list(self.sources.values())),
                "currentEvent": copy.deepcopy(self.current_event),
                "history": copy.deepcopy(self.history),
                "recentPicks": copy.deepcopy(self.recent_picks[:30]),
                "networkHealth": network_health,
            }
