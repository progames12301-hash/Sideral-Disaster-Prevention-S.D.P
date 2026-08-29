# Changelog

## 0.3.0

- Added supervised 24x7 SeedLink connections with stall detection, reconnect and jittered backoff.
- Added a network watchdog that marks stations stale when waveform packets stop arriving.
- Added rolling per-station latency histories with median and p95 measurements.
- Added `/api/live`, `/api/ready` and `/api/network/latency` operational endpoints.
- Added strict low-latency stream qualification before the backend reports itself EEW-ready.
- Added a real USP/IAG SeedLink probe that measures stations from `seisrequest.iag.usp.br:18000`.
- Added a GitHub Actions probe every six hours, with the latest measurement stored under `reports/`.
- Added Render liveness health-check configuration.
- Added latency-state tests; local suite passes 4 tests.

## 0.2.0

- Added per-station waveform latency tracking and latency classes.
- Added `eewEligible` distinction between low-latency and late detections.
- Added phase-aware P/S pick model.
- Added optional three-component metadata/SeedLink selection.
- Added optional PhaseNet/SeisBench worker isolated from SeedLink ingestion.
- Added robust consensus-first location and outlier rejection.
- Added multiple depth candidates, with conservative unresolved-depth handling for P-only solutions.
- Added event revisions and richer quality metrics.
- Added UI telemetry for P/S picks, latency, azimuthal gap and revision number.
- Added synthetic locator tests.
- Added architecture notes and ML dependency split.
