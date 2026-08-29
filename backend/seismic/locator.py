from __future__ import annotations

from dataclasses import dataclass
from itertools import pairwise
from math import atan2, cos, degrees, radians, sin

import numpy as np

EARTH_RADIUS_KM = 6371.0088


@dataclass(frozen=True)
class Pick:
    station_key: str
    time: float
    latitude: float
    longitude: float
    score: float
    source: str
    phase: str = "P"
    probability: float = 0.5
    latency_seconds: float = 0.0
    picker: str = "stalta"

    @property
    def id(self) -> str:
        return f"{self.station_key}:{self.phase}:{self.time:.3f}"


@dataclass(frozen=True)
class LocationResult:
    latitude: float
    longitude: float
    depth_km: float
    origin_time: float
    rms_seconds: float
    robust_score: float
    azimuthal_gap_deg: float
    uncertainty_km: float
    used_pick_ids: tuple[str, ...]
    outlier_pick_ids: tuple[str, ...]
    residuals_seconds: dict[str, float]
    depth_resolved: bool


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = radians(lat1), radians(lat2)
    dlat = p2 - p1
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(p1) * cos(p2) * sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * atan2(a ** 0.5, (1 - a) ** 0.5)


def _distance_grid(lat_grid: np.ndarray, lon_grid: np.ndarray, station_lat: float, station_lon: float) -> np.ndarray:
    p1 = np.radians(lat_grid)
    p2 = radians(station_lat)
    dlat = p1 - p2
    dlon = np.radians(lon_grid - station_lon)
    a = np.sin(dlat / 2) ** 2 + np.cos(p1) * cos(p2) * np.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * np.arctan2(np.sqrt(a), np.sqrt(np.maximum(0, 1 - a)))


def _velocity_for_phase(phase: str, vp_km_s: float, vs_km_s: float) -> float:
    return vs_km_s if str(phase).upper().startswith("S") else vp_km_s


def travel_time_seconds(distance_km: float, depth_km: float, phase: str, vp_km_s: float, vs_km_s: float) -> float:
    hypo = (distance_km * distance_km + depth_km * depth_km) ** 0.5
    return hypo / _velocity_for_phase(phase, vp_km_s, vs_km_s)


def _pick_weight(pick: Pick) -> float:
    probability = max(0.05, min(1.0, float(pick.probability)))
    # Late packets are still useful for earthquake monitoring/location, but receive less EEW weight.
    latency_penalty = 1.0 / (1.0 + max(0.0, pick.latency_seconds - 2.0) / 20.0)
    return max(0.12, probability * latency_penalty)


def _evaluate_grid(
    picks: list[Pick],
    lat_values: np.ndarray,
    lon_values: np.ndarray,
    vp_km_s: float,
    vs_km_s: float,
    depth_km: float,
) -> tuple[float, float, float, float, float]:
    lon_grid, lat_grid = np.meshgrid(lon_values, lat_values)
    origin_candidates: list[np.ndarray] = []
    travel_grids: list[np.ndarray] = []
    weights = np.array([_pick_weight(p) for p in picks], dtype=float)

    for pick in picks:
        surface = _distance_grid(lat_grid, lon_grid, pick.latitude, pick.longitude)
        hypo = np.sqrt(surface**2 + depth_km**2)
        velocity = _velocity_for_phase(pick.phase, vp_km_s, vs_km_s)
        travel = hypo / velocity
        travel_grids.append(travel)
        origin_candidates.append(pick.time - travel)

    # Median origin is resistant to one bad trigger and is cheap to evaluate over the full grid.
    origin_stack = np.stack(origin_candidates, axis=0)
    origin = np.median(origin_stack, axis=0)

    residuals = []
    for pick, travel in zip(picks, travel_grids):
        residuals.append(pick.time - (origin + travel))
    residuals_arr = np.stack(residuals, axis=0)

    # Consensus-first robust objective. A valid epicenter should make the largest possible set
    # of stations agree on one origin time. We therefore maximize the weighted number of inliers
    # first, then minimize residual energy inside that consensus. This is much safer than a plain
    # robust loss, which can still prefer a distant solution that fits only three stations well.
    delta = 3.5
    inlier_mask = np.abs(residuals_arr) <= delta
    weighted_inliers = np.sum(inlier_mask * weights[:, None, None], axis=0)
    robust_loss = np.minimum(residuals_arr**2, delta**2)
    weighted_cost = np.sum(robust_loss * weights[:, None, None], axis=0) / max(weights.sum(), 1e-6)

    max_consensus = float(np.max(weighted_inliers))
    consensus_cells = weighted_inliers >= (max_consensus - 1e-6)
    objective = np.where(consensus_cells, weighted_cost, np.inf)

    # Report RMS for inliers at the selected solution; the gross outliers are removed in the
    # caller and a second search is then performed.
    inlier_weight_sum = np.sum(inlier_mask * weights[:, None, None], axis=0)
    inlier_sq = np.sum((residuals_arr**2) * inlier_mask * weights[:, None, None], axis=0)
    wrms = np.sqrt(inlier_sq / np.maximum(inlier_weight_sum, 1e-6))

    index = np.unravel_index(np.argmin(objective), objective.shape)
    return (
        float(lat_grid[index]),
        float(lon_grid[index]),
        float(origin[index]),
        float(wrms[index]),
        float(weighted_cost[index]),
    )


def _azimuth(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = radians(lat1), radians(lat2)
    dlon = radians(lon2 - lon1)
    x = sin(dlon) * cos(phi2)
    y = cos(phi1) * sin(phi2) - sin(phi1) * cos(phi2) * cos(dlon)
    return (degrees(atan2(x, y)) + 360) % 360


def _azimuthal_gap(lat: float, lon: float, picks: list[Pick]) -> float:
    by_station: dict[str, Pick] = {}
    for p in picks:
        by_station.setdefault(p.station_key, p)
    angles = sorted(_azimuth(lat, lon, p.latitude, p.longitude) for p in by_station.values())
    if len(angles) < 2:
        return 360.0
    wrapped = angles + [angles[0] + 360]
    return max(b - a for a, b in pairwise(wrapped))


def _residuals_for_solution(
    picks: list[Pick],
    lat: float,
    lon: float,
    depth_km: float,
    origin: float,
    vp_km_s: float,
    vs_km_s: float,
) -> dict[str, float]:
    result: dict[str, float] = {}
    for pick in picks:
        distance = haversine_km(lat, lon, pick.latitude, pick.longitude)
        predicted = origin + travel_time_seconds(distance, depth_km, pick.phase, vp_km_s, vs_km_s)
        result[pick.id] = pick.time - predicted
    return result


def _distinct_station_count(picks: list[Pick]) -> int:
    return len({p.station_key for p in picks})


def _search(
    picks: list[Pick],
    vp_km_s: float,
    vs_km_s: float,
    depth_candidates_km: tuple[float, ...],
) -> tuple[float, float, float, float, float, float, bool]:
    s_pick_count = sum(1 for p in picks if p.phase.upper().startswith("S"))
    # In the first seconds of an EEW event we normally only have P arrivals. Depth is strongly
    # trade-offed with origin time in that regime, so keep a shallow-crust prior until at least
    # two independent S picks arrive. This is deliberately conservative: an unresolved depth is
    # better than a precise-looking but arbitrary number.
    if s_pick_count < 2:
        depth_candidates_km = (min(depth_candidates_km, key=lambda d: abs(d - 10.0)),)

    depth_rows: list[tuple[float, float, float, float, float, float]] = []
    for depth in depth_candidates_km:
        station_lats = [p.latitude for p in picks]
        station_lons = [p.longitude for p in picks]
        lat_min = max(-40.0, min(station_lats) - 7.0)
        lat_max = min(10.0, max(station_lats) + 7.0)
        lon_min = max(-82.0, min(station_lons) - 7.0)
        lon_max = min(-24.0, max(station_lons) + 7.0)
        span = max(lat_max - lat_min, lon_max - lon_min)
        coarse_step = 0.25 if span <= 20.0 else 0.5
        coarse_lat = np.arange(lat_min, lat_max + 0.001, coarse_step)
        coarse_lon = np.arange(lon_min, lon_max + 0.001, coarse_step)
        lat, lon, origin, rms, score = _evaluate_grid(
            picks, coarse_lat, coarse_lon, vp_km_s, vs_km_s, depth
        )
        depth_rows.append((score, depth, lat, lon, origin, rms))

    if not depth_rows:
        raise ValueError("No depth candidates")
    depth_rows.sort(key=lambda row: row[0])
    best_score = depth_rows[0][0]
    second_score = depth_rows[1][0] if len(depth_rows) > 1 else best_score + 999.0
    depth_resolved = s_pick_count >= 2 and (second_score - best_score) > 0.15
    # P-only regional picks often cannot constrain depth. If several depths fit almost equally well,
    # prefer a shallow-crust prior rather than reporting an arbitrary deep solution as measured.
    near_best = [row for row in depth_rows if row[0] <= best_score + 0.12]
    chosen = min(near_best, key=lambda row: abs(row[1] - 10.0)) if not depth_resolved else depth_rows[0]
    _, depth, lat, lon, _, _ = chosen
    fine_lat = np.arange(max(-40, lat - 1.6), min(10, lat + 1.6) + 0.001, 0.12)
    fine_lon = np.arange(max(-82, lon - 1.6), min(-24, lon + 1.6) + 0.001, 0.12)
    lat, lon, origin, rms, score = _evaluate_grid(
        picks, fine_lat, fine_lon, vp_km_s, vs_km_s, depth
    )

    micro_lat = np.arange(max(-40, lat - 0.22), min(10, lat + 0.22) + 0.001, 0.03)
    micro_lon = np.arange(max(-82, lon - 0.22), min(-24, lon + 0.22) + 0.001, 0.03)
    lat, lon, origin, rms, score = _evaluate_grid(
        picks, micro_lat, micro_lon, vp_km_s, vs_km_s, depth
    )
    return lat, lon, depth, origin, rms, score, depth_resolved


def locate_event(
    picks: list[Pick],
    vp_km_s: float = 6.0,
    vs_km_s: float = 3.5,
    depth_candidates_km: tuple[float, ...] = (5.0, 10.0, 20.0, 35.0),
    max_pick_residual_seconds: float = 4.0,
) -> LocationResult | None:
    if _distinct_station_count(picks) < 3:
        return None

    # Avoid duplicate phase picks from the same station dominating the cost.
    dedup: dict[tuple[str, str], Pick] = {}
    for pick in sorted(picks, key=lambda p: (p.time, -p.probability)):
        key = (pick.station_key, pick.phase.upper()[:1])
        old = dedup.get(key)
        if old is None or pick.probability > old.probability:
            dedup[key] = pick
    working = list(dedup.values())

    lat, lon, depth, origin, rms, score, depth_resolved = _search(
        working, vp_km_s, vs_km_s, depth_candidates_km
    )
    residuals = _residuals_for_solution(working, lat, lon, depth, origin, vp_km_s, vs_km_s)

    outliers = {pid for pid, res in residuals.items() if abs(res) > max_pick_residual_seconds}
    filtered = [p for p in working if p.id not in outliers]
    if outliers and _distinct_station_count(filtered) >= 3 and len(filtered) >= 3:
        lat, lon, depth, origin, rms, score, depth_resolved = _search(
            filtered, vp_km_s, vs_km_s, depth_candidates_km
        )
        residuals = _residuals_for_solution(filtered, lat, lon, depth, origin, vp_km_s, vs_km_s)
        working = filtered

    gap = _azimuthal_gap(lat, lon, working)
    geometry_penalty = max(0.0, (gap - 180.0) / 180.0)
    depth_penalty = 1.0 if len(depth_candidates_km) > 1 else 1.2
    uncertainty = max(8.0, rms * vp_km_s * 1.8 + 5.0) * (1.0 + geometry_penalty) * depth_penalty

    return LocationResult(
        latitude=lat,
        longitude=lon,
        depth_km=depth,
        origin_time=origin,
        rms_seconds=rms,
        robust_score=score,
        azimuthal_gap_deg=gap,
        uncertainty_km=uncertainty,
        used_pick_ids=tuple(p.id for p in working),
        outlier_pick_ids=tuple(sorted(outliers)),
        residuals_seconds={k: round(v, 3) for k, v in residuals.items()},
        depth_resolved=depth_resolved,
    )
