"""On-demand CPTEC Nowcasting catalog and image proxy.

This module crawls only the public path tree down to product/timestamp folders.
It never downloads the whole archive and does not depend on a GitHub Actions run.
"""
from __future__ import annotations

import copy
import datetime as dt
import importlib.util
import re
import sys
import threading
import time
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

import requests

ROOT_DIR = Path(__file__).resolve().parents[1]
COLLECTOR_FILE = ROOT_DIR / "cptec-runner" / "collector.py"
SITE = "https://nowcasting.cptec.inpe.br"
CATALOG_ROOT = SITE + "/api/v1/paths/frames/radar/"
PRODUCT_RE = re.compile(r"^[A-Za-z0-9_.-]+~[A-Za-z0-9_.-]+~[A-Za-z0-9_.-]+~[A-Za-z0-9_.-]+$")
STAMP_RE = re.compile(r"^\d{12}$")
MAX_CATALOG_PAGES = 1800
MAX_FRAME_BYTES = 25 * 1024 * 1024
CACHE_SECONDS = 300

_spec = importlib.util.spec_from_file_location("sdp_cptec_collector", COLLECTOR_FILE)
if _spec is None or _spec.loader is None:
    raise RuntimeError("O coletor oficial do catálogo CPTEC não está disponível.")
_collector = importlib.util.module_from_spec(_spec)
sys.modules.setdefault("sdp_cptec_collector", _collector)
_spec.loader.exec_module(_collector)

_state_lock = threading.RLock()
_refresh_lock = threading.Lock()
_worker_lock = threading.Lock()
_worker: threading.Thread | None = None
_snapshot: dict = {
    "status": "loading",
    "source": "CPTEC/INPE Nowcasting",
    "sourceUrl": SITE + "/",
    "generatedAt": None,
    "products": [],
    "providers": [],
    "radars": [],
    "summary": {"radarCount": 0, "productCount": 0, "frameCount": 0},
    "message": "Descobrindo os produtos publicados pelo CPTEC.",
}


def _url_path(url: str) -> str:
    parsed = urlsplit(url)
    return unquote(parsed.path)


def _radar_path_parts(url_or_path: str) -> list[str] | None:
    path = _url_path(url_or_path) if url_or_path.startswith("http") else unquote(url_or_path.split("?", 1)[0])
    marker = "/api/v1/paths/"
    if marker not in path:
        return None
    parts = path.split(marker, 1)[1].strip("/").split("/")
    if len(parts) < 2 or parts[:2] != ["frames", "radar"]:
        return None
    return parts


def _directory_kind(url: str) -> tuple[str, str | None, str | None] | None:
    parts = _radar_path_parts(url)
    if not parts:
        return None
    if len(parts) == 2:
        return ("root", None, None)
    if len(parts) == 3 and PRODUCT_RE.fullmatch(parts[2]):
        return ("product", parts[2], None)
    if len(parts) == 4 and PRODUCT_RE.fullmatch(parts[2]) and STAMP_RE.fullmatch(parts[3]):
        return ("timestamp", parts[2], parts[3])
    return None


def _add_frame(products: dict[str, set[str]], ref_or_url: str) -> None:
    if not isinstance(ref_or_url, str):
        return
    path = _url_path(ref_or_url) if ref_or_url.startswith("http") else ref_or_url.split("?", 1)[0]
    match = re.search(r"/api/v1/paths/frames/radar/([^/]+)/(\d{12})/full/?$", path)
    if not match:
        return
    product_id, stamp = unquote(match.group(1)), match.group(2)
    if PRODUCT_RE.fullmatch(product_id):
        products.setdefault(product_id, set()).add(stamp)


def _build_catalog() -> dict:
    """Read CPTEC's real catalog, stopping at each timestamp directory."""
    frontend_dirs, frontend_refs, exact_data_urls, frontend_diagnostics = (
        _collector.frontend_catalog_sources()
    )
    pending: list[str] = [CATALOG_ROOT]
    queued: set[str] = {CATALOG_ROOT}
    visited: set[str] = set()
    products: dict[str, set[str]] = {}

    # Assets and the CPTEC frontend provide the first observed references.
    for ref in frontend_refs:
        _add_frame(products, ref)

    # Walk only the documented catalog hierarchy. Timestamp directories are
    # recorded as frames but never enqueued; their /full leaf is fetched only
    # when a user selects the frame in the browser.
    for directory in sorted(frontend_dirs):
        kind = _directory_kind(directory)
        if not kind:
            continue
        if kind[0] == "timestamp":
            _add_frame(products, directory.rstrip("/") + "/full")
        elif directory not in queued:
            queued.add(directory)
            pending.append(directory)

    # Additional route URLs are only accepted when they point to the official
    # CPTEC API. This avoids crawling unrelated links or arbitrary domains.
    for data_url in sorted(exact_data_urls):
        parsed = urlsplit(data_url)
        if parsed.scheme != "https" or parsed.hostname != "nowcasting.cptec.inpe.br":
            continue
        if not parsed.path.startswith("/api/v1/"):
            continue
        if _directory_kind(data_url) and data_url not in queued:
            queued.add(data_url)
            pending.append(data_url)

    pages_with_children = 0
    while pending and len(visited) < MAX_CATALOG_PAGES:
        batch: list[str] = []
        while pending and len(batch) < 24 and len(visited) + len(batch) < MAX_CATALOG_PAGES:
            url = pending.pop(0)
            if url not in visited:
                visited.add(url)
                batch.append(url)
        if not batch:
            break

        from concurrent.futures import ThreadPoolExecutor, as_completed

        with ThreadPoolExecutor(max_workers=min(8, max(1, len(batch)))) as pool:
            futures = {pool.submit(_collector._read_catalog_page, url): url for url in batch}
            for future in as_completed(futures):
                try:
                    child_dirs, found_refs, _info = future.result()
                except Exception:
                    continue
                for ref in found_refs:
                    _add_frame(products, ref)
                if child_dirs:
                    pages_with_children += 1
                for child in child_dirs:
                    kind = _directory_kind(child)
                    if not kind:
                        continue
                    if kind[0] == "timestamp":
                        _product_id, stamp = kind[1], kind[2]
                        if _product_id and stamp:
                            products.setdefault(_product_id, set()).add(stamp)
                        # Deliberately do not crawl old frame contents; compose /full directly.
                        continue
                    if child not in queued and child not in visited:
                        queued.add(child)
                        pending.append(child)

    rows = []
    for product_id, stamps_set in products.items():
        parts = product_id.split("~")
        if len(parts) != 4:
            continue
        stamps = sorted(stamps_set)
        if not stamps:
            continue
        provider, radar, group, variable = parts
        frames = [
            {
                "timestamp": stamp,
                "path": f"/api/v1/paths/frames/radar/{quote(product_id, safe='~')}/{stamp}/full",
            }
            for stamp in stamps[-12:]
        ]
        rows.append({
            "id": product_id,
            "productId": product_id,
            "provider": provider,
            "radar": radar,
            "group": group,
            "variable": variable,
            "timestamps": stamps[-12:],
            "latestTimestamp": stamps[-1],
            "latestPath": frames[-1]["path"],
            "frames": frames,
            "label": f"{radar} · {group} · {variable}",
        })
    rows.sort(key=lambda row: (row["provider"], row["radar"], row["group"], row["variable"]))

    providers = sorted({row["provider"] for row in rows})
    radars = sorted({f'{row["provider"]}~{row["radar"]}' for row in rows})
    frame_count = sum(len(row["timestamps"]) for row in rows)
    return {
        "status": "ready" if rows else "error",
        "source": "CPTEC/INPE Nowcasting",
        "sourceUrl": SITE + "/",
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "products": rows,
        "providers": providers,
        "radars": radars,
        "summary": {
            "radarCount": len(radars),
            "productCount": len(rows),
            "frameCount": frame_count,
            "pagesVisited": len(visited),
            "pagesWithChildren": pages_with_children,
            "pageLimitReached": bool(pending),
        },
        "message": (
            f"{len(rows)} combinações de radar/produto descobertas na árvore oficial."
            if rows else
            "O catálogo oficial não retornou produtos. O serviço tentará novamente."
        ),
        "diagnostics": {
            "frontendChecks": len(frontend_diagnostics),
            "catalogPagesVisited": len(visited),
            "pageLimit": MAX_CATALOG_PAGES,
        },
    }


def _refresh_loop(stop_event: threading.Event) -> None:
    global _snapshot
    while not stop_event.is_set():
        if not _refresh_lock.acquire(blocking=False):
            stop_event.wait(3)
            continue
        try:
            try:
                result = _build_catalog()
            except Exception as exc:
                result = {
                    "status": "error",
                    "source": "CPTEC/INPE Nowcasting",
                    "sourceUrl": SITE + "/",
                    "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                    "products": [],
                    "providers": [],
                    "radars": [],
                    "summary": {"radarCount": 0, "productCount": 0, "frameCount": 0},
                    "message": f"Falha na consulta ao catálogo oficial: {type(exc).__name__}.",
                    "diagnostics": {"detail": str(exc)[:240]},
                }
            with _state_lock:
                _snapshot = result
        finally:
            _refresh_lock.release()
        stop_event.wait(CACHE_SECONDS)


def start_catalog_refresh(stop_event: threading.Event) -> None:
    """Start one daemon worker; the browser reads cached results, never runs a queue."""
    global _worker
    with _worker_lock:
        if _worker is not None and _worker.is_alive():
            return
        _worker = threading.Thread(
            target=_refresh_loop,
            args=(stop_event,),
            name="cptec-nowcasting-catalog",
            daemon=True,
        )
        _worker.start()


def catalog_snapshot() -> dict:
    with _state_lock:
        return copy.deepcopy(_snapshot)


def fetch_frame(product_id: str, timestamp: str) -> tuple[bytes, str]:
    """Fetch one verified public frame. The URL is assembled locally, never user-supplied."""
    product_id = unquote(str(product_id or "").strip())
    timestamp = str(timestamp or "").strip()
    if not PRODUCT_RE.fullmatch(product_id) or not STAMP_RE.fullmatch(timestamp):
        raise ValueError("Produto ou horário CPTEC inválido.")
    path = f"/api/v1/paths/frames/radar/{quote(product_id, safe='~')}/{timestamp}/full"
    url = SITE + path
    try:
        with requests.get(
            url,
            headers={
                "User-Agent": "Sideral-CPTEC-Nowcasting/1.0",
                "Accept": "image/png,image/jpeg,image/webp,image/gif,*/*;q=0.8",
                "Cache-Control": "no-cache",
            },
            timeout=(8, 30),
            stream=True,
        ) as response:
            if response.status_code >= 400:
                raise RuntimeError(f"CPTEC respondeu HTTP {response.status_code}.")
            media_type = response.headers.get("content-type", "image/png").split(";", 1)[0].strip()
            if not media_type.startswith("image/"):
                raise RuntimeError("A resposta do CPTEC não é uma imagem.")
            data = bytearray()
            for chunk in response.iter_content(65536):
                if chunk:
                    if len(data) + len(chunk) > MAX_FRAME_BYTES:
                        raise RuntimeError("Imagem CPTEC excede o limite de 25 MiB.")
                    data.extend(chunk)
            if not data:
                raise RuntimeError("O CPTEC retornou uma imagem vazia.")
            return bytes(data), media_type
    except ValueError:
        raise
    except RuntimeError:
        raise
    except requests.RequestException as exc:
        raise RuntimeError(f"Fonte CPTEC indisponível: {type(exc).__name__}.") from exc
