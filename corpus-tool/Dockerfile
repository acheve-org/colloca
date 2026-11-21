FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 CORPUS_DATA_DIR=/data

WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt

# NLP models. SPACY_SIZE: sm (fast, ~15 MB) | md (default, better lemmas) | lg
ARG SPACY_SIZE=md
ENV SPACY_SIZE=${SPACY_SIZE}
RUN python -m spacy download es_core_news_${SPACY_SIZE} \
 && python -m spacy download it_core_news_${SPACY_SIZE}

COPY app ./app

RUN useradd -m corpus && mkdir -p /data && chown corpus /data
USER corpus
VOLUME /data
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
