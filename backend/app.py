from __future__ import annotations

import asyncio
import json
import os
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.catalog import CatalogWatcher
from backend.config import settings
from backend.monitoring import NetworkWatchdog
from backend.seismic.detection import WaveformProcessor
from backend.seismic.ml_picker import PhaseNetStreamingPicker
from backend.seismic.seedlink import SeedLinkCollector
from backend.seismic.stations import Station, fetch_source_stations
from backend.state import SystemState, utc_iso

BASE_DIR = Path(__file__).resolve().parent.parent
WEB_DIR = BASE_DIR / "web"
state = SystemState(latency_history_size=settings.latency_history_size)
stop_event = threading.Event()
collectors: list[SeedLinkCollector] = []
clients: set[WebSocket] = set()
ml_picker: PhaseNetStreamingPicker | None = None


async def dispatcher() -> None:
    while True:
        message = await asyncio.to_thread(state.outbox.get)
        dead: list[WebSocket] = []
        payload = json.dumps(message, ensure_ascii=False)
        for ws in list(clients):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            clients.discard(ws)


def bootstrap_streaming() -> None:
    global ml_picker
    station_groups: dict[str, list[Station]] = {}
    all_stations: dict[str, Station] = {}

    for source in settings.sources:
        state.source_status(
            source.key,
            label=source.label,
            endpoint=source.endpoint,
            state="disabled" if not source.enabled else "loading-metadata",
            stationCount=0,
        )
        if not source.enabled:
            continue
        try:
            source_streams = fetch_source_stations(
                source,
                settings.max_stations_per_source,
                three_component=settings.three_component_streams,
            )
            station_groups[source.key] = source_streams
            for station in source_streams:
                old = all_stations.get(station.key)
                if old is None or (station.component == "Z" and old.component != "Z"):
                    all_stations[station.key] = station
                state.register_station(station.public())
            state.source_status(
                source.key,
                label=source.label,
                endpoint=source.endpoint,
                state="metadata-ready",
                stationCount=len({s.key for s in source_streams}),
                streamCount=len(source_streams),
            )
        except Exception as exc:
            state.source_status(
                source.key,
                label=source.label,
                endpoint=source.endpoint,
                state="metadata-error",
                error=str(exc)[:220],
                stationCount=0,
            )

    processor = WaveformProcessor(settings, state, all_stations)
    ml_picker = PhaseNetStreamingPicker(
        settings=settings,
        state=state,
        stations=all_stations,
        on_pick=processor.add_external_pick,
        stop_event=stop_event,
    )

    def ingest(trace, source_key: str) -> None:
        processor.on_trace(trace, source_key)
        if ml_picker is not None:
            ml_picker.on_trace(trace, source_key)

    for source in settings.sources:
        if not source.enabled:
            continue
        source_stations = station_groups.get(source.key, [])
        if not source_stations:
            continue
        collector = SeedLinkCollector(
            source=source,
            stations=source_stations,
            state=state,
            on_trace=ingest,
            stop_event=stop_event,
            stall_seconds=settings.seedlink_stall_seconds,
        )
        collectors.append(collector)
        collector.start()

    CatalogWatcher(settings, state, stop_event).start()
    NetworkWatchdog(settings, state, stop_event).start()


@asynccontextmanager
async def lifespan(app: FastAPI):
    stop_event.clear()
    task = asyncio.create_task(dispatcher())
    bootstrap_thread = threading.Thread(target=bootstrap_streaming, name="bootstrap", daemon=True)
    bootstrap_thread.start()
    yield
    stop_event.set()
    task.cancel()


app = FastAPI(title="Sideral Disaster Prevention — S.D.P", version="0.3.1", lifespan=lifespan)

_default_origins = (
    "https://progames12301-hash.github.io,"
    "http://localhost:5500,http://127.0.0.1:5500,"
    "http://localhost:5501,http://127.0.0.1:5501"
)
_allowed_origins = [
    item.strip()
    for item in os.getenv("SDP_ALLOWED_ORIGINS", _default_origins).split(",")
    if item.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    snapshot = state.snapshot()
    enabled = [s for s in snapshot["sources"] if s.get("state") != "disabled" and s.get("key") != "ml_picker"]
    streaming = [s for s in enabled if s.get("state") == "streaming"]
    return {
        "ok": True,
        "version": "0.3.1",
        "time": utc_iso(),
        "enabledSources": len(enabled),
        "streamingSources": len(streaming),
        "stations": len(snapshot["stations"]),
        "networkHealth": snapshot.get("networkHealth", {}),
        "activeEvent": bool(snapshot["currentEvent"]),
        "phasePicker": settings.phase_picker,
    }


@app.get("/api/live")
def live() -> dict:
    return {"ok": True, "version": "0.3.1", "time": utc_iso()}


@app.get("/api/ready")
def ready():
    snapshot = state.snapshot()
    report = state.latency_report(settings.eew_max_pick_latency_seconds, settings.station_fresh_seconds)
    enabled = [s for s in snapshot["sources"] if s.get("state") != "disabled" and s.get("key") != "ml_picker"]
    streaming = [s for s in enabled if s.get("state") == "streaming"]
    ready_now = bool(streaming and report["eligibleCount"] >= settings.min_stations)
    payload = {
        "ready": ready_now,
        "streamingSources": len(streaming),
        "lowLatencyStations": report["eligibleCount"],
        "requiredStations": settings.min_stations,
        "time": utc_iso(),
    }
    if not ready_now:
        raise HTTPException(status_code=503, detail=payload)
    return payload


@app.get("/api/network/latency")
def network_latency() -> dict:
    return state.latency_report(settings.eew_max_pick_latency_seconds, settings.station_fresh_seconds)


@app.get("/api/state")
def api_state() -> dict:
    payload = state.snapshot()
    payload["config"] = {
        "version": "0.3.1",
        "pVelocityKmS": settings.p_velocity_km_s,
        "sVelocityKmS": settings.s_velocity_km_s,
        "minStations": settings.min_stations,
        "depthCandidatesKm": settings.depth_candidates_km,
        "phasePicker": settings.phase_picker,
        "threeComponentStreams": settings.three_component_streams,
        "eewMaxPickLatencySeconds": settings.eew_max_pick_latency_seconds,
        "debugSimulator": settings.debug_simulator,
        "seedlinkStallSeconds": settings.seedlink_stall_seconds,
    }
    return payload


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    clients.add(websocket)
    await websocket.send_json({"type": "snapshot", "data": state.snapshot()})
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        clients.discard(websocket)
    except Exception:
        clients.discard(websocket)


@app.post("/api/simulate")
def simulate_event() -> dict:
    if not settings.debug_simulator:
        raise HTTPException(status_code=404, detail="Simulator disabled")
    now = time.time() - 2.0
    event = {
        "id": f"sim-{uuid.uuid4().hex[:8]}",
        "revision": 1,
        "status": "simulation",
        "statusLabel": "Simulação de interface",
        "eewEligible": True,
        "originTime": utc_iso(now),
        "originEpoch": now,
        "lat": -19.92,
        "lon": -43.94,
        "depthKm": 10,
        "depthResolved": True,
        "magnitude": 4.2,
        "magnitudeType": "M(sim)",
        "stationCount": 5,
        "pickCount": 7,
        "phaseCounts": {"P": 5, "S": 2},
        "stations": [],
        "rmsSeconds": 0.82,
        "azimuthalGap": 118,
        "uncertaintyKm": 24,
        "confidence": 84,
        "medianPickLatencySeconds": 2.1,
        "outlierCount": 0,
        "pickerMix": ["stalta", "phasenet"],
        "pVelocityKmS": settings.p_velocity_km_s,
        "sVelocityKmS": settings.s_velocity_km_s,
        "updatedAt": utc_iso(),
    }
    state.set_event(event)
    return event


@app.get("/")
def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")
