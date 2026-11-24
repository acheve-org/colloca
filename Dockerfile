# Frontend build (Svelte/Vite). Package files first so `npm ci` is cached.
# Vite writes to ../src/colloca/static (relative to frontend/), i.e. /ui/src/colloca/static.
FROM node:lts-slim AS ui
WORKDIR /ui/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.14-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy \
    COLLOCA_DATA_DIR=/data PYTHONPATH=/models PATH="/srv/.venv/bin:$PATH"

WORKDIR /srv

# Dependencies first (cached layer). spaCy models are NOT bundled: they are mounted at /models and
# downloaded on first start by docker/entrypoint.sh.
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY src ./src
# The UI is git-ignored and never in the build context: it comes from the ui stage.
COPY --from=ui /ui/src/colloca/static/ ./src/colloca/static/
RUN uv sync --frozen --no-dev

RUN useradd -m colloca && mkdir -p /data /models && chown colloca /data /models
USER colloca
VOLUME /data /models
EXPOSE 8000
ENTRYPOINT ["entrypoint.sh"]
CMD ["uvicorn", "colloca.main:app", "--host", "0.0.0.0", "--port", "8000"]
