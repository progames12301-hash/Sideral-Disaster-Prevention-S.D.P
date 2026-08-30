import time

from backend.international import InternationalState, parse_jma_intensity_stations
from backend.international_live import PROFILES, _parse_channel_text, _select_best_vertical


def test_jma_detailed_intensity_maps_to_sdp_levels():
    payload = {
        "Body": {
            "Intensity": {
                "Observation": {
                    "Pref": [
                        {
                            "Area": [
                                {
                                    "City": [
                                        {
                                            "IntensityStation": [
                                                {"Name": "A", "Code": "0164920", "Int": "5+", "latlon": {"lat": 42.81, "lon": 143.66}},
                                                {"Name": "B", "Code": "1300001", "Int": "2", "latlon": {"lat": 35.68, "lon": 139.76}},
                                                {"Name": "C", "Code": "4700001", "Int": "7", "latlon": {"lat": 26.21, "lon": 127.68}},
                                            ]
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            }
        }
    }
    rows = parse_jma_intensity_stations(payload)
    levels = {row["station"]: row["level"] for row in rows}
    assert levels == {"0164920": 5, "1300001": 2, "4700001": 7}
    assert all(row["observed"] for row in rows)


def test_live_fdsn_channel_selection_keeps_best_vertical_per_station():
    text = "\n".join(
        [
            "JP|AAA|00|BHZ|35.1|139.2|20|0|0|Sensor|1|M/S|100|20|20|2026-01-01T00:00:00|2599-12-31T23:59:59",
            "JP|AAA|00|HHZ|35.1|139.2|20|0|0|Sensor|1|M/S|100|20|100|2026-01-01T00:00:00|2599-12-31T23:59:59",
            "JP|AAA|00|HHN|35.1|139.2|20|0|0|Sensor|1|M/S|100|20|100|2026-01-01T00:00:00|2599-12-31T23:59:59",
            "JP|BBB||BHZ|36.1|140.2|10|0|0|Sensor|1|M/S|100|20|20|2026-01-01T00:00:00|2599-12-31T23:59:59",
        ]
    )
    channels = _parse_channel_text(text, "japan_seedlink")
    selected = _select_best_vertical(channels, PROFILES[0])
    by_key = {station.key: station for station in selected}
    assert by_key["JP.AAA"].channel == "HHZ"
    assert by_key["JP.BBB"].channel == "BHZ"
    assert len(selected) == 2


def test_international_state_live_station_moves_from_zero_to_real_level():
    state = InternationalState()
    state.merge_stations(
        "japan",
        [{"key": "JP.TEST", "network": "JP", "station": "TEST", "name": "Test", "lat": 35.0, "lon": 140.0, "level": 0, "activityLevel": 0, "live": False}],
        "test",
    )
    now = time.time()
    state.touch_station(
        "japan",
        "JP.TEST",
        now - 0.2,
        activity=4 / 7,
        source="japan_seedlink",
        received_ts=now,
        channel="HHZ",
        activity_level=4,
        activity_score=5.5,
    )
    snapshot = state.snapshot("japan")
    station = next(row for row in snapshot["stations"] if row["key"] == "JP.TEST")
    assert station["live"] is True
    assert station["level"] == 4
    assert station["activityLevel"] == 4
    assert snapshot["stationStreamAvailable"] is True


def test_detected_event_becomes_display_event_until_official_eew_exists():
    state = InternationalState()
    now = time.time()
    state.set_detected_event(
        "mexico",
        {"id": "sdp-test", "originEpoch": now - 2, "lat": 18.0, "lon": -99.0, "waveEligible": True},
    )
    assert state.snapshot("mexico")["displayEvent"]["id"] == "sdp-test"

    state.update(
        "mexico",
        event={"id": "cires-test", "originEpoch": now - 1, "eewEligible": True, "waveEligible": True},
    )
    assert state.snapshot("mexico")["displayEvent"]["id"] == "cires-test"
