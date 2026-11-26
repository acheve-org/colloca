# Frontend build (Svelte/Vite). Package files first so `npm ci` is cached.
# Vite writes to ../src/colloca/static (relative to frontend/), i.e. /ui/src/colloca/static.
FROM node:lts-slim AS ui
WORKDIR /ui/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.14-slim

# Optional OCR for scanned PDFs: docker build --build-arg WITH_OCR=1 .   (adds Tesseract with Spanish and Italian
# data, about 100 MB, and the `ocr` Python extra; data for other languages is installed from the Languages screen)
ARG WITH_OCR=0
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy \
    COLLOCA_DATA_DIR=/data COLLOCA_MODELS_DIR=/models PYTHONPATH=/models PATH="/srv/.venv/bin:$PATH"

WORKDIR /srv

# Dependencies first (cached layer). spaCy models are NOT bundled: they are mounted at /models and
# installed from the Languages screen (or prefetched with docker/entrypoint.sh download-models).
COPY pyproject.toml uv.lock README.md ./
RUN if [ "$WITH_OCR" = "1" ]; then apt-get update && apt-get install -y --no-install-recommends \
        tesseract-ocr tesseract-ocr-spa tesseract-ocr-ita && rm -rf /var/lib/apt/lists/*; fi
RUN uv sync --frozen --no-dev --no-install-project $([ "$WITH_OCR" = "1" ] && echo --extra ocr)

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
# A Windows checkout may give the script CRLF line endings and no exec bit: normalise both.
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh && chmod 755 /usr/local/bin/entrypoint.sh
COPY src ./src
# The UI is git-ignored and never in the build context: it comes from the ui stage.
COPY --from=ui /ui/src/colloca/static/ ./src/colloca/static/
RUN uv sync --frozen --no-dev $([ "$WITH_OCR" = "1" ] && echo --extra ocr)

RUN useradd -m colloca && mkdir -p /data /models && chown colloca /data /models
USER colloca
VOLUME /data /models
EXPOSE 8000
ENTRYPOINT ["entrypoint.sh"]
CMD ["uvicorn", "colloca.main:app", "--host", "0.0.0.0", "--port", "8000"]
