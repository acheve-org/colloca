FROM python:3.14-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy \
    COLLOCA_DATA_DIR=/data PYTHONPATH=/models PATH="/srv/.venv/bin:$PATH"

WORKDIR /srv

# Dependencies first (cached layer). spaCy models are NOT bundled: they are mounted at /models
# (see docker-compose.yml, `docker compose run --rm models`).
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project

COPY src ./src
RUN uv sync --frozen --no-dev

RUN useradd -m colloca && mkdir -p /data /models && chown colloca /data /models
USER colloca
VOLUME /data /models
EXPOSE 8000
CMD ["uvicorn", "colloca.main:app", "--host", "0.0.0.0", "--port", "8000"]
