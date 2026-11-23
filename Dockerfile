FROM python:3.14-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy \
    COLLOCA_DATA_DIR=/data PATH="/srv/.venv/bin:$PATH"

WORKDIR /srv

# Dependencies first (cached layer). pyproject.toml pins the "sm" spaCy models.
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project

# NLP models. SPACY_SIZE: sm (fast, ~15 MB) | md (default, better lemmas) | lg
ARG SPACY_SIZE=md
ENV SPACY_SIZE=${SPACY_SIZE}
RUN if [ "$SPACY_SIZE" != "sm" ]; then \
      base=https://github.com/explosion/spacy-models/releases/download; \
      uv pip install \
        "$base/es_core_news_${SPACY_SIZE}-3.8.0/es_core_news_${SPACY_SIZE}-3.8.0-py3-none-any.whl" \
        "$base/it_core_news_${SPACY_SIZE}-3.8.0/it_core_news_${SPACY_SIZE}-3.8.0-py3-none-any.whl"; \
    fi

COPY src ./src
RUN uv sync --frozen --no-dev

RUN useradd -m colloca && mkdir -p /data && chown colloca /data
USER colloca
VOLUME /data
EXPOSE 8000
CMD ["uvicorn", "colloca.main:app", "--host", "0.0.0.0", "--port", "8000"]
