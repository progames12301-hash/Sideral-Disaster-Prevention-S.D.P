from __future__ import annotations

import random
import threading
import time
from collections import defaultdict
from typing import Callable

from obspy import Trace
from obspy.clients.seedlink.easyseedlink import create_client

from backend.config import SeedLinkSource
from backend.seismic.stations import Station
from backend.state import SystemState, utc_iso


class SeedLinkCollector:
    """Supervised SeedLink client with stall detection and automatic reconnect."""

    def __init__(
        self,
        source: SeedLinkSource,
        stations: list[Station],
        state: SystemState,
        on_trace: Callable[[Trace, str], None],
        stop_event: threading.Event,
        stall_seconds: float = 120.0,
    ) -> None:
        self.source = source
        self.stations = stations
        self.state = state
        self.on_trace = on_trace
        self.stop_event = stop_event
        self.stall_seconds = max(30.0, stall_seconds)
        self.thread = threading.Thread(target=self._run, name=f"seedlink-{source.key}", daemon=True)
        self.watchdog_thread = threading.Thread(target=self._watchdog, name=f"seedlink-watchdog-{source.key}", daemon=True)
        self._client = None
        self._client_lock = threading.RLock()
        self._last_trace_monotonic: float | None = None
        self._connected_monotonic: float | None = None

    def start(self) -> None:
        self.thread.start()
        self.watchdog_thread.start()

    def _close_client(self) -> None:
        with self._client_lock:
            client = self._client
        if client is not None:
            try:
                client.close()
            except Exception:
                pass

    def _watchdog(self) -> None:
        while not self.stop_event.wait(10.0):
            now = time.monotonic()
            last = self._last_trace_monotonic
            connected = self._connected_monotonic
            reference = last or connected
            if reference is None or now - reference <= self.stall_seconds:
                continue
            self.state.source_status(
                self.source.key,
                label=self.source.label,
                endpoint=self.source.endpoint,
                state="stalled",
                stationCount=len(self.stations),
                stalledForSeconds=round(now - reference, 1),
                lastTraceAt=utc_iso(time.time() - (now - reference)) if last else None,
            )
            self._close_client()
            self._last_trace_monotonic = None
            self._connected_monotonic = None

    def _run(self) -> None:
        retries = 0
        while not self.stop_event.is_set():
            try:
                self.state.source_status(
                    self.source.key,
                    label=self.source.label,
                    endpoint=self.source.endpoint,
                    state="connecting",
                    stationCount=len(self.stations),
                )
                streaming_announced = False

                def on_data(trace: Trace) -> None:
                    nonlocal streaming_announced
                    self._last_trace_monotonic = time.monotonic()
                    if not streaming_announced:
                        streaming_announced = True
                        self.state.source_status(
                            self.source.key,
                            label=self.source.label,
                            endpoint=self.source.endpoint,
                            state="streaming",
                            stationCount=len(self.stations),
                            firstTraceAt=utc_iso(),
                        )
                    self.on_trace(trace, self.source.key)

                def on_error() -> None:
                    self.state.source_status(
                        self.source.key,
                        label=self.source.label,
                        endpoint=self.source.endpoint,
                        state="error",
                    )

                client = create_client(self.source.endpoint, on_data=on_data, on_seedlink_error=on_error)
                with self._client_lock:
                    self._client = client

                selections = defaultdict(set)
                for station in self.stations:
                    selections[(station.network, station.station)].add(station.channel)
                for (network, station), channels in selections.items():
                    for channel in channels:
                        client.select_stream(network, station, channel)

                retries = 0
                self._connected_monotonic = time.monotonic()
                self._last_trace_monotonic = None
                self.state.source_status(
                    self.source.key,
                    label=self.source.label,
                    endpoint=self.source.endpoint,
                    state="connected",
                    stationCount=len(self.stations),
                )
                client.run()
                if not self.stop_event.is_set():
                    raise RuntimeError("SeedLink stream ended; reconnecting")
            except Exception as exc:
                retries += 1
                delay = min(60.0, 2.0 * (2 ** min(retries, 5))) + random.uniform(0.0, 2.0)
                self.state.source_status(
                    self.source.key,
                    label=self.source.label,
                    endpoint=self.source.endpoint,
                    state="retrying",
                    error=str(exc)[:220],
                    retryInSeconds=round(delay, 1),
                    stationCount=len(self.stations),
                )
                self.stop_event.wait(delay)
            finally:
                with self._client_lock:
                    self._client = None
                self._connected_monotonic = None
                self._last_trace_monotonic = None
