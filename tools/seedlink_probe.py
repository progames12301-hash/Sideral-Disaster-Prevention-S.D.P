from __future__ import annotations

import argparse
import json
import statistics
import sys
import threading
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.config import settings
from backend.seismic.seedlink import SeedLinkCollector
from backend.seismic.stations import Station, fetch_source_stations
from backend.state import SystemState, utc_iso


def percentile(values: list[float], q: float) -> float | None:
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Measure packet latency from enabled S.D.P SeedLink sources")
    parser.add_argument("--duration", type=int, default=75)
    parser.add_argument("--max-stations", type=int, default=60)
    parser.add_argument("--output", default="reports/latest-seedlink-probe.json")
    args = parser.parse_args()

    stop = threading.Event()
    state = SystemState()
    metrics: dict[str, list[float]] = defaultdict(list)
    metadata: dict[str, Station] = {}
    collectors: list[SeedLinkCollector] = []
    lock = threading.RLock()
    errors: list[dict] = []

    for source in settings.sources:
        if not source.enabled:
            continue
        try:
            streams = fetch_source_stations(source, args.max_stations, three_component=False)
            for station in streams:
                metadata[station.key] = station
                state.register_station(station.public())

            def ingest(trace, source_key: str) -> None:
                key = f"{trace.stats.network}.{trace.stats.station}"
                latency = max(0.0, time.time() - float(trace.stats.endtime.timestamp))
                with lock:
                    if len(metrics[key]) < 500:
                        metrics[key].append(latency)

            collector = SeedLinkCollector(
                source,
                streams,
                state,
                ingest,
                stop,
                stall_seconds=max(40, args.duration + 20),
            )
            collectors.append(collector)
            collector.start()
        except Exception as exc:
            errors.append({"source": source.key, "error": str(exc)[:300]})

    started = time.time()
    time.sleep(max(15, args.duration))
    stop.set()

    rows = []
    with lock:
        items = list(metrics.items())
    for key, values in items:
        st = metadata.get(key)
        med = statistics.median(values)
        p95 = percentile(values, 0.95)
        rows.append({
            "key": key,
            "network": st.network if st else key.split(".")[0],
            "station": st.station if st else key.split(".")[-1],
            "lat": st.latitude if st else None,
            "lon": st.longitude if st else None,
            "samples": len(values),
            "medianLatencySeconds": round(med, 3),
            "p95LatencySeconds": round(p95, 3) if p95 is not None else None,
            "minLatencySeconds": round(min(values), 3),
            "maxLatencySeconds": round(max(values), 3),
            "eewCandidate": bool(
                len(values) >= 3
                and p95 is not None
                and p95 <= settings.eew_max_pick_latency_seconds
            ),
        })
    rows.sort(key=lambda r: (not r["eewCandidate"], r["p95LatencySeconds"], r["key"]))
    report = {
        "generatedAt": utc_iso(),
        "probeSeconds": round(time.time() - started, 1),
        "thresholdSeconds": settings.eew_max_pick_latency_seconds,
        "enabledSources": [s.key for s in settings.sources if s.enabled],
        "stationMetadataCount": len(metadata),
        "stationsWithPackets": len(rows),
        "eewCandidateCount": sum(1 for r in rows if r["eewCandidate"]),
        "errors": errors,
        "sources": state.snapshot()["sources"],
        "stations": rows,
        "note": "Measurement of transport/data latency at one runner. It is not a guarantee of public warning lead time.",
    }
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("generatedAt", "stationsWithPackets", "eewCandidateCount", "errors")}, ensure_ascii=False))
    return 0 if rows else 2


if __name__ == "__main__":
    raise SystemExit(main())
