#!/bin/sh
# Ensure the spaCy models for $SPACY_SIZE exist in /models (a mounted volume), then run the command.
#   docker compose run --rm colloca download-models   # prefetch only, then exit
set -eu

size="${SPACY_SIZE:-lg}"
version=3.8.0
base=https://github.com/explosion/spacy-models/releases/download

download_models() {
  urls=""
  for lang in es it; do
    pkg="${lang}_core_news_${size}"
    if [ ! -d "/models/$pkg" ]; then
      echo "colloca: downloading spaCy model $pkg-$version" >&2
      urls="$urls $base/$pkg-$version/$pkg-$version-py3-none-any.whl"
    fi
  done
  [ -z "$urls" ] && return 0
  # SPACY_WHEELS: a directory of model wheels (scripts/fetch_model_wheels.py) installed without any download.
  if [ -n "${SPACY_WHEELS:-}" ] && [ -d "$SPACY_WHEELS" ]; then
    names=""
    for lang in es it; do names="$names ${lang}_core_news_${size}"; done
    # shellcheck disable=SC2086
    uv pip install --no-cache --no-deps --no-index --find-links "$SPACY_WHEELS" --target /models $names
    return
  fi
  # shellcheck disable=SC2086
  uv pip install --no-cache --no-deps --target /models $urls
}

if [ "${1:-}" = "download-models" ]; then
  download_models
  exit 0
fi

# A failed download must not stop the app: it falls back to any installed model size.
download_models || echo "colloca: WARNING: could not download spaCy models; continuing without them" >&2

exec "$@"
