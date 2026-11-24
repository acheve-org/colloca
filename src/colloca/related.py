"""Related terms from word vectors (T21): "terms that behave like this one", always labelled statistical.

Two sources, both optional and neither added to the termbase automatically:
  corpus  word vectors trained here on the corpus's own text (and, if asked, the language's base corpus): positive
          pointwise mutual information of the co-occurrence of content lemmas within a window, reduced to 100
          dimensions with a randomised SVD (the count-based method of Levy and Goldberg, 2015). Needs only numpy.
          It learns the vocabulary of *your* corpus, so it suits specialist terms, and it needs a corpus of some size.
  model   the word vectors that ship with the spaCy `md` and `lg` models (general language, trained elsewhere).
          The `sm` models have none.
A thesaurus (for example Open Thesaurus data) is not included: it would add data with its own licence to check."""
import threading
from collections import OrderedDict

import numpy as np

from . import analysis, nlp

DIMS = 100
WINDOW = 5                       # content lemmas on each side
MAX_VOCAB = 4000                 # most frequent content lemmas that get a vector
MIN_FREQ = 3
MAX_TOKENS = 3_000_000           # per source corpus: more is subsampled from the start of each document list
SMALL_CORPUS = 100_000           # below this many content tokens the neighbours are rough
CACHE_SIZE = 4

_cache: OrderedDict[tuple, "Embedding | None"] = OrderedDict()
_lock = threading.Lock()


class Embedding:
    """Unit vectors for the most frequent content lemmas of a corpus."""

    def __init__(self, lemmas: list[str], vectors: np.ndarray, freq: np.ndarray, pos: list[str], tokens: int):
        self.lemmas = lemmas
        self.index = {w: i for i, w in enumerate(lemmas)}
        self.vectors = vectors
        self.freq = freq
        self.pos = pos
        self.tokens = tokens          # content tokens the vectors were trained on

    def neighbours(self, lemma: str, n: int = 20, pos: set[str] | None = None) -> list[dict]:
        i = self.index[lemma]
        sims = self.vectors @ self.vectors[i]
        out = []
        for j in np.argsort(-sims):
            if j == i:
                continue
            if pos and self.pos[j] not in pos:
                continue
            out.append({"item": self.lemmas[j], "pos": self.pos[j], "similarity": round(float(sims[j]), 3),
                        "freq": int(self.freq[j])})
            if len(out) >= n:
                break
        return out


def _randomised_svd(a: np.ndarray, k: int, seed: int = 0, iterations: int = 3) -> tuple[np.ndarray, np.ndarray]:
    """The top `k` left singular vectors and values of `a` (Halko, Martinsson and Tropp)."""
    rng = np.random.default_rng(seed)
    k = min(k, min(a.shape))
    q = np.linalg.qr(a @ rng.standard_normal((a.shape[1], k + 10)).astype(a.dtype))[0]
    for _ in range(iterations):
        q = np.linalg.qr(a.T @ q)[0]
        q = np.linalg.qr(a @ q)[0]
    u_small, s, _ = np.linalg.svd(q.T @ a, full_matrices=False)
    return (q @ u_small)[:, :k], s[:k]


def train(sequences: list[list[str]], pos_of: dict[str, str], *, window: int = WINDOW, dims: int = DIMS,
          max_vocab: int = MAX_VOCAB, min_freq: int = MIN_FREQ) -> Embedding | None:
    """Vectors from lists of content lemmas (one list per document). None when there is nothing to learn from."""
    counts: dict[str, int] = {}
    for seq in sequences:
        for w in seq:
            counts[w] = counts.get(w, 0) + 1
    vocab = [w for w, c in sorted(counts.items(), key=lambda x: (-x[1], x[0])) if c >= min_freq][:max_vocab]
    if len(vocab) < 10:
        return None
    ids = {w: i for i, w in enumerate(vocab)}
    v = len(vocab)
    flat = np.zeros(v * v, dtype=np.float64)
    for seq in sequences:
        arr = np.array([ids.get(w, -1) for w in seq], dtype=np.int64)
        for k in range(1, window + 1):
            if len(arr) <= k:
                break
            a, b = arr[:-k], arr[k:]
            ok = (a >= 0) & (b >= 0) & (a != b)
            weight = 1.0 / k                       # nearer words count more
            idx = a[ok] * v + b[ok]
            flat += weight * np.bincount(idx, minlength=v * v)
            idx = b[ok] * v + a[ok]
            flat += weight * np.bincount(idx, minlength=v * v)
    co = flat.reshape(v, v)
    total = co.sum()
    if total == 0:
        return None
    rows = co.sum(axis=1, keepdims=True)
    cols = co.sum(axis=0, keepdims=True) ** 0.75          # context smoothing: rare contexts do not dominate
    cols = cols / cols.sum() * total
    with np.errstate(divide="ignore", invalid="ignore"):
        ppmi = np.log((co * total) / (rows * cols))
    ppmi = np.where(np.isfinite(ppmi) & (ppmi > 0), ppmi, 0.0).astype(np.float32)
    # a small vocabulary gets fewer dimensions: keeping them all would only reproduce the raw associations
    u, s = _randomised_svd(ppmi, min(dims, max(8, v // 5)))
    vectors = u * np.sqrt(s)
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    vectors = vectors / np.where(norms == 0, 1, norms)
    freq = np.array([counts[w] for w in vocab])
    return Embedding(vocab, vectors.astype(np.float32), freq, [pos_of.get(w, "") for w in vocab],
                     sum(counts.values()))


def _sequences(conn, scope, limit: int) -> tuple[list[list[str]], dict[str, str]]:
    """The content lemmas (letters only, no stop words) of each document of the scope, and the commonest part of
    speech of each lemma."""
    where, params = scope.where("d")
    seqs: list[list[str]] = []
    pos_counts: dict[str, dict[str, int]] = {}
    taken = 0
    current: list[str] = []
    doc: int | None = None
    for r in conn.execute(f"""SELECT t.doc_id, t.lemma, t.upos FROM tokens t JOIN documents d ON d.id=t.doc_id
                              WHERE {where} AND t.alpha=1 AND t.stop=0 ORDER BY t.doc_id, t.pos""", params):
        if r["doc_id"] != doc:
            if current:
                seqs.append(current)
            current, doc = [], r["doc_id"]
        if taken >= limit:
            break
        current.append(r["lemma"])
        taken += 1          # noqa: SIM113 (a running total that stops the loop, not an index)
        by = pos_counts.setdefault(r["lemma"], {})
        by[r["upos"]] = by.get(r["upos"], 0) + 1
    if current:
        seqs.append(current)
    return seqs, {w: max(c, key=lambda k: c[k]) for w, c in pos_counts.items()}


def embedding(conn, scope, lang: str, with_base: bool = False) -> Embedding | None:
    """The trained vectors for this scope (cached; a change to the corpus gives a new key)."""
    scope = analysis.as_scope(scope)
    base = analysis.reference_corpus(conn, lang) if with_base else None
    key = (scope, analysis.corpus_size(conn, scope), analysis.n_docs(conn, scope),
           base["id"] if base else None, analysis.corpus_size(conn, base["id"]) if base else 0)
    with _lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
    seqs, pos_of = _sequences(conn, scope, MAX_TOKENS)
    if base:
        extra, extra_pos = _sequences(conn, analysis.Scope(base["id"]), MAX_TOKENS)
        seqs += extra
        for w, p in extra_pos.items():
            pos_of.setdefault(w, p)
    emb = train(seqs, pos_of)
    with _lock:
        _cache[key] = emb          # a failed training is cached too: None is a valid answer
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)
    return emb


def model_neighbours(model, lemma: str, n: int = 20) -> list[dict] | None:
    """Nearest words in the vectors of a spaCy model (None if the model has no vectors or does not know the word)."""
    vectors = model.vocab.vectors
    if vectors.shape[0] == 0:
        return None
    key = model.vocab.strings[lemma] if lemma in model.vocab.strings else None  # noqa: SIM401
    if key is None or key not in vectors:
        return None
    keys, _, scores = vectors.most_similar(np.asarray([vectors[key]]), n=min(n * 6, vectors.n_keys))
    out = []
    for k, s in zip(keys[0], scores[0], strict=True):
        word = model.vocab.strings[int(k)]
        if word.lower() == lemma.lower() or not word.isalpha() or word != word.lower():
            continue
        out.append({"item": word, "pos": "", "similarity": round(float(s), 3), "freq": None})
        if len(out) >= n:
            break
    return out


def available(lang: str) -> dict:
    """Whether the spaCy model of `lang` ships word vectors, and its name."""
    try:
        model = nlp.load_model(lang)
    except (RuntimeError, ValueError, OSError):
        return {"available": False, "name": None}
    return {"available": model.vocab.vectors.shape[0] > 0, "name": model.meta.get("name")}
