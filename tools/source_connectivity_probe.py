from __future__ import annotations

import json
import socket
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.config import settings
from backend.state import utc_iso


def probe(endpoint: str, timeout: float = 8.0) -> dict:
    host, port_text = endpoint.rsplit(":", 1)
    port = int(port_text)
    started = time.perf_counter()
    result = {"endpoint": endpoint, "host": host, "port": port, "tcp": False, "seedlinkHello": False}
    try:
        addresses = sorted({item[4][0] for item in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)})
        result["addresses"] = addresses
    except Exception as exc:
        result["error"] = f"DNS: {exc}"
        return result
    try:
        with socket.create_connection((host, port), timeout=timeout) as sock:
            result["tcp"] = True
            result["connectMs"] = round((time.perf_counter() - started) * 1000, 1)
            sock.settimeout(timeout)
            sock.sendall(b"HELLO\r\n")
            data = sock.recv(512)
            text = data.decode("ascii", errors="replace").strip()
            result["hello"] = text[:300]
            upper = text.upper()
            result["seedlinkHello"] = bool(text and ("SEEDLINK" in upper or "SLPROTO" in upper))
    except Exception as exc:
        result["error"] = f"TCP/SeedLink: {exc}"
    return result


def main() -> int:
    rows = []
    for source in settings.sources:
        item = probe(source.endpoint)
        item.update({"key": source.key, "label": source.label, "configuredEnabled": source.enabled, "networks": list(source.networks)})
        rows.append(item)
    report = {
        "generatedAt": utc_iso(),
        "sources": rows,
        "note": "Connectivity probe only. A successful SeedLink HELLO does not imply data access for every configured network/station.",
    }
    out = Path("reports/latest-source-connectivity.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
