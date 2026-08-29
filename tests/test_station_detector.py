import numpy as np

from backend.seismic.detection import has_sustained_threshold, normalized_station_activity


def test_quiet_ratio_stays_blue():
    assert normalized_station_activity(1.0, 6.175) == 0.0
    assert normalized_station_activity(1.5, 6.175) < 0.18


def test_trigger_ratio_reaches_full_activity():
    assert normalized_station_activity(6.175, 6.175) == 1.0


def test_single_spike_does_not_trigger():
    values = np.array([1.0, 1.1, 7.0, 1.2, 1.0])
    assert not has_sustained_threshold(values, 6.175, required_samples=2)


def test_sustained_onset_triggers():
    values = np.array([1.0, 6.4, 6.7, 6.8, 1.1])
    assert has_sustained_threshold(values, 6.175, required_samples=3)
