from backend.seismic.locator import Pick, haversine_km, locate_event, travel_time_seconds


def _synthetic_picks(event_lat=-23.55, event_lon=-46.63, depth=10.0, origin=1_000_000.0):
    stations = [
        ("A", -23.0, -46.0),
        ("B", -24.0, -47.0),
        ("C", -22.8, -47.2),
        ("D", -24.2, -45.8),
        ("E", -23.6, -45.5),
    ]
    picks = []
    for key, lat, lon in stations:
        distance = haversine_km(event_lat, event_lon, lat, lon)
        arrival = origin + travel_time_seconds(distance, depth, "P", 6.0, 3.5)
        picks.append(Pick(key, arrival, lat, lon, 7.0, "test", "P", 0.9, 1.0, "synthetic"))
    return picks


def test_p_only_solution_keeps_depth_unresolved():
    result = locate_event(_synthetic_picks())
    assert result is not None
    assert haversine_km(-23.55, -46.63, result.latitude, result.longitude) < 25
    assert result.rms_seconds < 2
    assert result.depth_km == 10.0
    assert result.depth_resolved is False


def test_outlier_does_not_destroy_solution():
    picks = _synthetic_picks()
    p = picks[-1]
    picks[-1] = Pick(
        p.station_key,
        p.time + 12.0,
        p.latitude,
        p.longitude,
        p.score,
        p.source,
        p.phase,
        p.probability,
        p.latency_seconds,
        p.picker,
    )
    result = locate_event(picks, max_pick_residual_seconds=4.0)
    assert result is not None
    assert len(result.outlier_pick_ids) >= 1
    assert haversine_km(-23.55, -46.63, result.latitude, result.longitude) < 60
