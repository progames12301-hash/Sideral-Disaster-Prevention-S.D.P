# Changelog

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
