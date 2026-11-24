#!/bin/sh
# Optionally prefetch spaCy models into /models (a mounted volume), then run the command. Models are normally
# installed from the app (Languages screen); this is for prefetching or offline installs.
#   docker compose run --rm colloca download-models [CODE...]   # default: es it; sizes: SPACY_SIZE (sm|md|lg)
set -eu

size="${SPACY_SIZE:-lg}"
version=3.8.0
base=https://github.com/explosion/spacy-models/releases/download

download_models() {
  langs="$*"
  [ -z "$langs" ] && langs="es it"
  urls=""
  names=""
  for lang in $langs; do
    case "$lang" in *[!a-z]*|"") echo "colloca: bad language code '$lang'" >&2; exit 2;; esac
    # en models are called en_core_web_*, the others xx_core_news_*
    stem="${lang}_core_news"
    [ "$lang" = "en" ] && stem="en_core_web"
    pkg="${stem}_${size}"
    names="$names $pkg"
    if [ ! -d "/models/$pkg" ]; then
      echo "colloca: downloading spaCy model $pkg-$version" >&2
      urls="$urls $base/$pkg-$version/$pkg-$version-py3-none-any.whl"
    fi
  done
  [ -z "$urls" ] && return 0
  # SPACY_WHEELS: a directory of model wheels (scripts/fetch_model_wheels.py) installed without any download.
  if [ -n "${SPACY_WHEELS:-}" ] && [ -d "$SPACY_WHEELS" ]; then
    # shellcheck disable=SC2086
    uv pip install --no-cache --no-deps --no-index --find-links "$SPACY_WHEELS" --target /models $names
    return
  fi
  # shellcheck disable=SC2086
  uv pip install --no-cache --no-deps --target /models $urls
}

if [ "${1:-}" = "download-models" ]; then
  shift
  download_models "$@"
  exit 0
fi

exec "$@"
