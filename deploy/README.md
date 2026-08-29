# 24x7 deployment

The S.D.P backend is designed as a persistent process because SeedLink is a continuous TCP stream. The process now reconnects stalled sources automatically and exposes `/api/live`, `/api/ready`, and `/api/network/latency`.

## Always-on Linux host

For an actually persistent deployment, use the included `systemd/sdp.service` on a Linux VPS/VM. Install the project in `/opt/sdp`, create a Python virtual environment at `/opt/sdp/.venv`, install `requirements.txt`, copy `systemd/sdp.env.example` to `/etc/sdp/sdp.env`, install the unit in `/etc/systemd/system/sdp.service`, then enable it with `systemctl enable --now sdp`.

The service uses `Restart=always`, so an application crash or temporary SeedLink failure does not require a manual restart.

## Render

`render.yaml` remains available as an easy web deployment blueprint and has a liveness health check. A hosting plan that suspends an idle service cannot be considered a guaranteed 24x7 EEW collector; use an always-on plan/host for continuous SeedLink acquisition.

## Verified feeds as of 2026-08-29

- USP/IAG `seisrequest.iag.usp.br:18000`: SeedLink v3.3, streaming verified.
- Observatório Nacional `rsis1.on.br:18000`: SeedLink v3.2, streaming verified and enabled.
- UnB candidate `datisis.unb.br:18000`: DNS failed in the automated probe; disabled.
- UFRN candidate `sislink.geofisica.ufrn.br:18000`: DNS resolved but TCP/SeedLink timed out in the automated probe; disabled.

Automated reports are stored under `reports/` and are re-measured by GitHub Actions.
