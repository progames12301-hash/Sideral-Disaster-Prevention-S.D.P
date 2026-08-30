import numpy as np

from backend.seismic.detection import (
    has_sustained_threshold,
    normalized_station_activity,
    station_activity_level,
    sustained_station_activity_level,
)


def test_quiet_ratio_stays_zero():
    assert normalized_station_activity(1.0, 8.5) == 0.0
    assert station_activity_level(2.4, 8.5) == 0
    values = np.full(40, 2.2)
    assert sustained_station_activity_level(values, 8.5, 20.0, 0.75) == 0


def test_scalar_levels_start_only_after_significant_signal():
    samples = [1.0, 2.7, 3.4, 4.2, 5.1, 6.3, 8.6, 11.6]
    assert [station_activity_level(value, 8.5) for value in samples] == list(range(8))


def test_single_large_spike_stays_zero_on_display():
    values = np.ones(40)
    values[20] = 20.0
    assert sustained_station_activity_level(values, 8.5, 20.0, 0.75) == 0


def test_sustained_moderate_signal_becomes_level_two():
    values = np.concatenate([np.ones(20), np.full(12, 3.5), np.ones(8)])
    assert sustained_station_activity_level(values, 8.5, 20.0, 0.75) == 2


def test_level_six_requires_full_trigger_persistence():
    short = np.concatenate([np.ones(20), np.full(10, 9.0), np.ones(10)])
    long = np.concatenate([np.ones(20), np.full(16, 9.0), np.ones(4)])
    assert sustained_station_activity_level(short, 8.5, 20.0, 0.75) == 5
    assert sustained_station_activity_level(long, 8.5, 20.0, 0.75) == 6


def test_single_spike_does_not_trigger():
    values = np.array([1.0, 1.1, 12.0, 1.2, 1.0])
    assert not has_sustained_threshold(values, 8.5, required_samples=2)


def test_sustained_onset_triggers():
    values = np.array([1.0, 8.7, 9.0, 9.2, 1.1])
    assert has_sustained_threshold(values, 8.5, required_samples=3)
