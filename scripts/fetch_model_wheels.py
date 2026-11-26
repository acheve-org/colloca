"""Download the spaCy model wheels once, to install them later without GitHub (offline or locked-down builds).

    uv run python scripts/fetch_model_wheels.py wheels --size lg --langs es it   # on a machine with internet
    uv pip install --no-index --find-links wheels es_core_news_lg it_core_news_lg    # on the offline machine
    SPACY_WHEELS=/wheels docker compose run --rm colloca download-models # Docker: installs from the directory
"""
import argparse
import sys
import urllib.request
from pathlib import Path

from colloca import langcatalog

BASE = "https://github.com/explosion/spacy-models/releases/download"


def wheel_urls(size: str, langs, version: str = "3.8.0") -> list[str]:
    pkgs = [langcatalog.package(lang, size) for lang in langs]
    return [f"{BASE}/{pkg}-{version}/{pkg}-{version}-py3-none-any.whl" for pkg in pkgs]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("directory", type=Path)
    ap.add_argument("--size", choices=("sm", "md", "lg"), default="lg")
    ap.add_argument("--version", default="3.8.0")
    ap.add_argument("--langs", nargs="+", choices=sorted(langcatalog.CATALOG), required=True,
                    help="language codes from the catalog")
    ap.add_argument("--dry-run", action="store_true", help="print the URLs only")
    args = ap.parse_args(argv)
    urls = wheel_urls(args.size, args.langs, args.version)
    if args.dry_run:
        print("\n".join(urls))
        return 0
    args.directory.mkdir(parents=True, exist_ok=True)
    for url in urls:
        target = args.directory / url.rsplit("/", 1)[1]
        if target.exists():
            print(f"have {target}")
            continue
        print(f"downloading {url}", file=sys.stderr)
        urllib.request.urlretrieve(url, target)  # noqa: S310 - fixed https GitHub release URL
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
