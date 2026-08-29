import time

from backend.state import SystemState


def test_latency_report_marks_fast_stream_eligible():
    state = SystemState(latency_history_size=10)
    state.register_station({"key": "BL.TEST", "network": "BL", "station": "TEST", "lat": -23.0, "lon": -46.0})
    base = time.time()
    for latency in (1.0, 2.0, 3.0, 2.5):
        state.touch_station("BL.TEST", data_ts=base - latency, received_ts=base, activity=0.1, source="usp")
    report = state.latency_report(eew_threshold_seconds=8.0, fresh_seconds=10_000.0)
    assert report["eligibleCount"] == 1
    assert report["stations"][0]["eewStreamEligible"] is True
    assert report["stations"][0]["p95LatencySeconds"] <= 3.0


def test_expire_stale_station():
    state = SystemState()
    state.register_station({"key": "BL.TEST", "network": "BL", "station": "TEST", "lat": -23.0, "lon": -46.0})
    state.touch_station("BL.TEST", data_ts=1.0, received_ts=1.0, activity=0.1, source="usp")
    assert state.expire_stale_stations(fresh_seconds=1.0) == 1
    assert state.snapshot()["stations"][0]["online"] is False
