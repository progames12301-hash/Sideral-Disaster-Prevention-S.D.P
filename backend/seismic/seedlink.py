from __future__ import annotations

import threading
import time
from collections import defaultdict
from typing import Callable

from obspy import Trace
from obspy.clients.seedlink.easyseedlink import create_client

from backend.config import SeedLinkSource
from backend.seismic.stations import Station
from backend.state import SystemState


class SeedLinkCollector:
    def __init__(
        self,
        source: SeedLinkSource,
        stations: list[Station],
        state: SystemState,
        on_trace: Callable[[Trace, str], None],
        stop_event: threading.Event,
    ) -> None:
        self.source = source
        self.stations = stations
        self.state = state
        self.on_trace = on_trace
        self.stop_event = stop_event
        self.thread = threading.Thread(target=self._run, name=f"seedlink-{source.key}", daemon=True)

    def start(self) -> None:
        self.thread.start()

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
                    if not streaming_announced:
                        streaming_announced = True
                        self.state.source_status(
                            self.source.key,
                            label=self.source.label,
                            endpoint=self.source.endpoint,
                            state="streaming",
                            stationCount=len(self.stations),
                        )
                    self.on_trace(trace, self.source.key)

                def on_error() -> None:
                    self.state.source_status(
                        self.source.key,
                        label=self.source.label,
                        endpoint=self.source.endpoint,
                        state="error",
                    )

                client = create_client(
                    self.source.endpoint,
                    on_data=on_data,
                    on_seedlink_error=on_error,
                )

                selections = defaultdict(set)
                for station in self.stations:
                    selections[(station.network, station.station)].add(station.channel)
                for (network, station), channels in selections.items():
                    for channel in channels:
                        client.select_stream(network, station, channel)

                retries = 0
                self.state.source_status(
                    self.source.key,
                    label=self.source.label,
                    endpoint=self.source.endpoint,
                    state="connected",
                    stationCount=len(self.stations),
                )
                client.run()
            except Exception as exc:
                retries += 1
                delay = min(60, 3 * (2 ** min(retries, 4)))
                self.state.source_status(
                    self.source.key,
                    label=self.source.label,
                    endpoint=self.source.endpoint,
                    state="retrying",
                    error=str(exc)[:220],
                    retryInSeconds=delay,
                    stationCount=len(self.stations),
                )
                self.stop_event.wait(delay)
