from __future__ import annotations

import threading

from backend.config import Settings
from backend.state import SystemState


class NetworkWatchdog(threading.Thread):
    def __init__(self, settings: Settings, state: SystemState, stop_event: threading.Event) -> None:
        super().__init__(name="network-watchdog", daemon=True)
        self.settings = settings
        self.state = state
        self.stop_event = stop_event

    def run(self) -> None:
        while not self.stop_event.wait(5.0):
            self.state.expire_stale_stations(self.settings.station_fresh_seconds)
            self.state.expire_current_event(self.settings.active_event_seconds)
