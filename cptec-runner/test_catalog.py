#!/usr/bin/env python3
"""Offline contract tests for the CPTEC Nowcasting path format."""
from __future__ import annotations
import collector

SAMPLES = [
    {
        "url": "https://nowcasting.cptec.inpe.br/api/v1/paths/frames/radar/sdcsc~lontras~ppi~ppicz/202610241103/full?v=3840203563",
        "provider": "sdcsc", "radar": "lontras", "group": "ppi", "variable": "ppicz",
        "stamp": "202610241103",
    },
    {
        "url": "https://nowcasting.cptec.inpe.br/api/v1/paths/frames/radar/sdcsc~lontras~agua_liquida~dvil/202610241113/full?v=3840203563",
        "provider": "sdcsc", "radar": "lontras", "group": "agua_liquida", "variable": "dvil",
        "stamp": "202610241113",
    },
    {
        "url": "https://nowcasting.cptec.inpe.br/api/v1/paths/frames/radar/sdcsc~lontras~echotop~echotop20dbz/202610241117/full?v=3840203563",
        "provider": "sdcsc", "radar": "lontras", "group": "echotop", "variable": "echotop20dbz",
        "stamp": "202610241117",
    },
    {
        "url": "https://nowcasting.cptec.inpe.br/api/v1/paths/frames/radar/decea~santiago~cappi~cappi3km/202610241120/full?v=3840203563",
        "provider": "decea", "radar": "santiago", "group": "cappi", "variable": "cappi3km",
        "stamp": "202610241120",
    },
]


def run():
    canonical_refs = []
    for sample in SAMPLES:
        ref = collector.canon(sample["url"])
        expected = (
            "/api/v1/paths/frames/radar/"
            + sample["provider"] + "~" + sample["radar"] + "~"
            + sample["group"] + "~" + sample["variable"] + "/"
            + sample["stamp"] + "/full"
        )
        assert ref == expected, (sample["url"], ref, expected)
        meta = collector.parse_ref(ref)
        assert meta["provider"] == sample["provider"]
        assert meta["radar"] == sample["radar"]
        assert meta["group"] == sample["group"]
        assert meta["variable"] == sample["variable"]
        assert meta["timestamp"] == sample["stamp"]
        assert ref in collector.extract({"url": sample["url"]})
        canonical_refs.append(ref)

    root = collector.CATALOG_ROOT
    product = root + "sdcsc~lontras~ppi~ppicz/"
    dirs, refs = collector._catalog_links(
        '<html><a href="sdcsc~lontras~ppi~ppicz/">produto</a></html>', root
    )
    assert product in dirs, dirs

    stamp_dir = product + "202610241103/"
    dirs, refs = collector._catalog_links(
        '<html><a href="202610241103/">horário</a></html>', product
    )
    assert stamp_dir in dirs, dirs

    dirs, refs = collector._catalog_links(
        '<html><a href="full">quadro</a></html>', stamp_dir
    )
    assert canonical_refs[0] in refs, refs

    # Directories from another host must never be crawled.
    assert collector.radar_directory_url(
        "https://example.org/api/v1/paths/frames/radar/sdcsc~lontras~ppi~ppicz/",
        root
    ) is None

    print(f"OK: {len(SAMPLES)} URLs observadas, provedor/radar/produto/horário e navegação hierárquica.")


if __name__ == "__main__":
    run()
