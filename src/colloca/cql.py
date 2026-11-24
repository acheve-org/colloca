"""Advanced concordance queries (T13): parser, plain-words description and SQL compiler.

Grammar (documented with examples in docs/query-language.md):

    query  := item+
    item   := token | gap
    token  := '[' cond ']'  |  WORD  |  '"' literal '"'  |  '/' regex '/'  |  POS
    gap    := '[]' quant?  |  '+' N  |  '+' M '-' N
    quant  := '{' N '}'  |  '{' M ',' N '}'  |  '?'
    cond   := and ('|' and)*          and := atom ('&' atom)*
    atom   := ATTR ('=' | '!=') '"' value '"'       ATTR := lemma | form | word | pos

Everything is compiled to one SELECT over `tokens`, driven by an *anchor* token that an index can look up, so a
query can never scan the whole corpus. This module imports nothing from the rest of colloca.
"""
import re
import unicodedata
from dataclasses import dataclass, field
from functools import lru_cache

MAX_TOKENS = 6          # tokens (not counting gaps) in one query
MAX_GAP = 15            # words in one gap
MAX_QUERY_LEN = 300
MAX_REGEX_LEN = 100
MIN_LITERALS = 3        # letters before a wildcard / in a regex prefix that an index can use
MAX_ROWS = 50_000       # hits fetched from SQLite
TIMEOUT_SECONDS = 10.0
PROGRESS_STEPS = 20_000   # SQLite VM steps between two looks at the clock

UPOS = {"ADJ": "adjective", "ADP": "adposition", "ADV": "adverb", "AUX": "auxiliary verb",
        "CCONJ": "coordinating conjunction", "DET": "determiner", "INTJ": "interjection", "NOUN": "noun",
        "NUM": "numeral", "PART": "particle", "PRON": "pronoun", "PROPN": "proper noun",
        "PUNCT": "punctuation mark", "SCONJ": "subordinating conjunction", "SYM": "symbol",
        "VERB": "verb", "X": "other"}
ATTRS = {"lemma": "lemma", "form": "form", "word": "form", "pos": "pos", "upos": "pos"}
_REGEX_META = set(".^$*+?{}[]()|\\")
_NESTED_QUANT = re.compile(r"\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)[+*{]")   # (a+)+ and friends: ReDoS


class QueryError(ValueError):
    """A query that cannot be used. `position` is 1-based, the character the problem starts at."""

    def __init__(self, message: str, position: int | None = None):
        self.message, self.position = message, position
        super().__init__(f"{message} (at character {position})" if position else message)


# --------------------------------------------------------------------------- accents and regex helpers
def strip_accents(s: str) -> str:
    """`café` -> `cafe`. The tilde of ñ is kept (año and ano are different words); everything else
    combining (acute, grave, circumflex, diaeresis, cedilla...) is dropped."""
    out: list[str] = []
    for ch in unicodedata.normalize("NFD", s):
        if unicodedata.category(ch) == "Mn" and not (ch == "̃" and out and out[-1] in "nN"):
            continue
        out.append(ch)
    return unicodedata.normalize("NFC", "".join(out))


def glob_escape(term: str) -> str:
    """Escape GLOB's own special characters (? [) in the literal part of a word; `*` stays a wildcard."""
    return term.replace("[", "[[]").replace("?", "[?]")


@lru_cache(maxsize=512)
def _compiled(pattern: str, flags: int):
    return re.compile(pattern, flags)


def sql_regexp(text, pattern: str, flags: int) -> int:
    """SQL function `colloca_re(text, pattern, flags)`: the pattern must match the whole text."""
    return 1 if _compiled(pattern, flags).fullmatch(text or "") else 0


def register(conn) -> None:
    """Make the SQL functions the compiled queries (and the accent index) rely on available on `conn`."""
    conn.create_function("colloca_ascii", 1, strip_accents, deterministic=True)
    conn.create_function("colloca_re", 3, sql_regexp, deterministic=True)


def _literal_alternatives(pattern: str) -> list[str] | None:
    """`a|b|c` with no other regex syntax -> ['a','b','c']; anything else -> None."""
    if any(c in _REGEX_META and c != "|" for c in pattern):
        return None
    alts = pattern.split("|")
    return alts if all(alts) else None


def _regex_prefix(pattern: str) -> str:
    """Literal characters every match of `pattern` must start with ('' if unknown)."""
    depth, in_class, i = 0, False, 0
    while i < len(pattern):                      # a | outside any group makes the alternatives start differently
        c = pattern[i]
        if c == "\\":
            i += 1
        elif in_class:
            in_class = c != "]"
        elif c == "[":
            in_class = True
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
        elif c == "|" and depth == 0:
            return ""
        i += 1
    i = 0
    while i < len(pattern) and pattern[i] not in _REGEX_META:
        i += 1
    if i < len(pattern) and pattern[i] in "*?{" and i:
        i -= 1                              # the last literal is optional: `ab*`
    return pattern[:i]


# --------------------------------------------------------------------------- the parsed query
@dataclass(frozen=True)
class Atom:
    attr: str            # lemma | form | pos
    kind: str            # lit | glob | re | pos
    value: str           # the word, glob, or regex; for pos the tags joined by |
    neg: bool = False
    at: int = 0          # 1-based position in the query, for messages


@dataclass(frozen=True)
class Token:
    branches: tuple      # OR of ANDs: tuple[tuple[Atom, ...], ...]
    at: int = 0


@dataclass(frozen=True)
class Gap:
    min: int             # words between the tokens on each side
    max: int
    at: int = 0


@dataclass
class Query:
    items: list = field(default_factory=list)        # Token and Gap, alternating, starting and ending with Token
    case_sensitive: bool = False
    accent_insensitive: bool = False

    @property
    def tokens(self) -> list[Token]:
        return [i for i in self.items if isinstance(i, Token)]


# --------------------------------------------------------------------------- parsing
_GAP_RE = re.compile(r"\+(\d+)(?:-(\d+))?")
_QUANT_RE = re.compile(r"\{(\d+)(?:,(\d+))?\}")


def _check_regex(pattern: str, start: int) -> None:
    if len(pattern) > MAX_REGEX_LEN:
        raise QueryError(f"A regular expression can have at most {MAX_REGEX_LEN} characters", start + 1)
    if _NESTED_QUANT.search(pattern):
        raise QueryError("A repeated group that itself repeats (such as (a+)+) is not allowed in a regular "
                         "expression: it can take forever", start + 1)
    try:
        re.compile(pattern)
    except re.error as exc:
        raise QueryError(f"Invalid regular expression: {exc.msg}", start + 1 + (exc.pos or 0)) from exc


def _word_atom(word: str, attr: str, at: int) -> Atom:
    """A bare word of the friendly syntax: a POS tag (NOUN), a word or `*` wildcard (contrat*, *miento)."""
    if word in UPOS:
        return Atom("pos", "pos", word, at=at)
    if "*" in word:
        if "*" in word.strip("*"):
            raise QueryError("The wildcard * can only start or end a word, as in contrat* or *miento", at)
        if len(word.strip("*")) < MIN_LITERALS:
            raise QueryError(f"A word with a wildcard needs at least {MIN_LITERALS} letters besides *", at)
        return Atom(attr, "glob", word, at=at)
    return Atom(attr, "lit", word, at=at)


def _parse_cond(q: str, start: int, end: int) -> tuple:
    """The inside of [ ... ] (q[start:end]) -> OR of ANDs of atoms."""
    i, branches, current = start, [], []

    def skip():
        nonlocal i
        while i < end and q[i].isspace():
            i += 1

    while True:
        skip()
        m = re.compile(r"[A-Za-z_]+").match(q, i, end)
        if not m:
            raise QueryError('Expected an attribute (lemma, form, word or pos), as in [lemma="tomar"]', i + 1)
        name, at = m.group(), i + 1
        if name.lower() not in ATTRS:
            raise QueryError(f"Unknown attribute '{name}'; use lemma, form, word or pos", at)
        attr = ATTRS[name.lower()]
        i = m.end()
        skip()
        neg = False
        if q.startswith("!=", i, end):
            neg, i = True, i + 2
        elif q.startswith("=", i, end):
            i += 1
        else:
            raise QueryError(f"Expected = or != after {name}", i + 1)
        skip()
        if i >= end or q[i] != '"':
            raise QueryError('A value must be written between double quotes, as in lemma="tomar"', i + 1)
        j, chars = i + 1, []
        while j < end and q[j] != '"':
            if q[j] == "\\" and j + 1 < end and q[j + 1] == '"':
                chars.append('"')
                j += 2
                continue
            chars.append(q[j])
            j += 1
        if j >= end:
            raise QueryError("This value is missing its closing double quote", i + 1)
        value, vstart = "".join(chars), i + 1
        if not value:
            raise QueryError("An empty value would match nothing useful", vstart)
        if attr == "pos":
            tags = value.split("|")
            for tag in tags:
                if tag not in UPOS:
                    raise QueryError(f"'{tag}' is not a part-of-speech tag; use one of {', '.join(sorted(UPOS))}",
                                     vstart)
            atom = Atom("pos", "pos", value, neg, at)
        else:
            _check_regex(value, vstart)
            lit = _literal_alternatives(value)
            atom = Atom(attr, "lit" if lit and len(lit) == 1 else "re", value, neg, at)
        current.append(atom)
        i = j + 1
        skip()
        if i >= end:
            branches.append(tuple(current))
            return tuple(branches)
        if q[i] == "&":
            i += 1
        elif q[i] == "|":
            branches.append(tuple(current))
            current = []
            i += 1
        else:
            raise QueryError("Expected & (and), | (or) or ] after a condition", i + 1)


def _close_bracket(q: str, open_at: int) -> int:
    """Index of the ] that closes the [ at `open_at`, skipping quoted values."""
    i, quoted, quote_at = open_at + 1, False, 0
    while i < len(q):
        c = q[i]
        if quoted:
            if c == "\\":
                i += 1
            elif c == '"':
                quoted = False
        elif c == '"':
            quoted, quote_at = True, i
        elif c == "]":
            return i
        i += 1
    if quoted:
        raise QueryError("This value is missing its closing double quote", quote_at + 1)
    raise QueryError("This [ has no closing ]", open_at + 1)


def parse(q: str, unit_attr: str = "lemma", case_sensitive: bool = False, accent_insensitive: bool = False) -> Query:
    """Parse an advanced query. `unit_attr` ('lemma' or 'form') is what bare words match."""
    if len(q) > MAX_QUERY_LEN:
        raise QueryError(f"A query can have at most {MAX_QUERY_LEN} characters")
    items: list = []
    i, n = 0, len(q)
    while i < n:
        c = q[i]
        if c.isspace():
            i += 1
            continue
        at = i + 1
        if c == "[":
            j = _close_bracket(q, i)
            if not q[i + 1:j].strip():                                   # [] : any word(s)
                lo = hi = 1
                i = j + 1
                if i < n and q[i] == "?":
                    lo, hi, i = 0, 1, i + 1
                elif i < n and q[i] == "{":
                    m = _QUANT_RE.match(q, i)
                    if not m:
                        raise QueryError("Write the repeat as {n} or {min,max}, as in []{0,3}", i + 1)
                    lo = int(m.group(1))
                    hi = int(m.group(2)) if m.group(2) is not None else lo
                    i = m.end()
                elif i < n and q[i] in "*+":
                    raise QueryError("An open-ended gap is not allowed: give an upper limit, as in []{0,5}", i + 1)
                if hi < lo:
                    raise QueryError("The maximum of a repeat cannot be smaller than the minimum", at)
                if hi > MAX_GAP:
                    raise QueryError(f"A gap can span at most {MAX_GAP} words", at)
                items.append(Gap(lo, hi, at))
                continue
            items.append(Token(_parse_cond(q, i + 1, j), at))
            i = j + 1
            if i < n and q[i] in "{?*+":
                raise QueryError("A repeat can only follow [] (any word), as in []{0,3}", i + 1)
        elif c == "+":
            m = _GAP_RE.match(q, i)
            if not m:
                raise QueryError("After + write the number of words allowed in between, as in +3 or +1-3", at)
            first = int(m.group(1))
            lo, hi = (0, first) if m.group(2) is None else (first, int(m.group(2)))
            if hi < lo:
                raise QueryError("The maximum of a gap cannot be smaller than the minimum", at)
            if hi > MAX_GAP or hi == 0:
                raise QueryError(f"A gap must span 1 to {MAX_GAP} words", at)
            items.append(Gap(lo, hi, at))
            i = m.end()
        elif c == "/":
            j = i + 1
            while j < n and q[j] != "/":
                j += 2 if q[j] == "\\" else 1
            if j >= n:
                raise QueryError("This regular expression is missing its closing /", at)
            pattern = q[i + 1:j]
            if not pattern:
                raise QueryError("An empty regular expression", at)
            _check_regex(pattern, i + 1)
            items.append(Token(((Atom(unit_attr, "re", pattern, at=at),),), at))
            i = j + 1
        elif c == '"':
            j = q.find('"', i + 1)
            if j < 0:
                raise QueryError("This quote is missing its closing quote", at)
            if j == i + 1:
                raise QueryError("An empty word", at)
            items.append(Token(((Atom(unit_attr, "lit", q[i + 1:j], at=at),),), at))
            i = j + 1
        else:
            j = i
            while j < n and not q[j].isspace() and q[j] != "[":
                j += 1
            word = q[i:j]
            if any(ch in word for ch in '{}]"/+') and word not in UPOS:
                bad = next(k for k, ch in enumerate(word) if ch in '{}]"/+')
                raise QueryError(f"Unexpected '{word[bad]}' in a word; separate it with a space or quote the word",
                                 at + bad)
            branches, pos_in = [], 0
            for alt in word.split("|"):
                if not alt:
                    raise QueryError("An empty alternative around |", at + pos_in)
                branches.append((_word_atom(alt, unit_attr, at + pos_in),))
                pos_in += len(alt) + 1
            items.append(Token(tuple(branches), at))
            i = j
    return _normalise(items, q, case_sensitive, accent_insensitive)


def _normalise(items: list, q: str, case_sensitive: bool, accent: bool) -> Query:
    """Merge neighbouring gaps, put an (empty) gap between neighbouring tokens, enforce the structural limits."""
    out: list = []
    for it in items:
        if isinstance(it, Gap):
            if not out:
                raise QueryError("A query cannot start with a gap: it needs a word first", it.at)
            if isinstance(out[-1], Gap):
                prev = out[-1]
                if prev.max + it.max > MAX_GAP:
                    raise QueryError(f"A gap can span at most {MAX_GAP} words", it.at)
                out[-1] = Gap(prev.min + it.min, prev.max + it.max, prev.at)
                continue
        elif out and isinstance(out[-1], Token):
            out.append(Gap(0, 0, it.at))
        out.append(it)
    if not out:
        raise QueryError("The query is empty")
    if isinstance(out[-1], Gap):
        raise QueryError("A query cannot end with a gap: it needs a word after it", out[-1].at)
    tokens = [i for i in out if isinstance(i, Token)]
    if len(tokens) > MAX_TOKENS:
        raise QueryError(f"A query can have at most {MAX_TOKENS} tokens", tokens[MAX_TOKENS].at)
    if case_sensitive and accent:
        raise QueryError("Case-sensitive and accent-insensitive cannot be combined")
    query = Query(out, case_sensitive, accent)
    if all(anchor_rank(t, query) is None for t in tokens):
        first = tokens[0]
        raise QueryError("This query would have to look at every word of the corpus. Include at least one word, "
                         "lemma or pattern that starts with 3 or more fixed letters (for example contrat* or "
                         'lemma="tomar"); a part-of-speech tag, [] or a pattern like .*ado cannot lead a search',
                         first.at)
    return query


# --------------------------------------------------------------------------- what an index can look up
def _atom_prefix_len(atom: Atom, query: Query) -> int | None:
    """Fixed letters an index lookup on this atom starts with (None: the atom cannot use an index)."""
    if atom.neg or atom.kind == "pos":
        return None
    if atom.kind == "lit":
        return len(atom.value)
    if atom.kind == "glob":
        return None if atom.value.startswith("*") else len(atom.value.rstrip("*"))
    alts = _literal_alternatives(atom.value)
    if alts:
        return min(map(len, alts))
    prefix = _regex_prefix(atom.value)
    return len(prefix) if len(prefix) >= MIN_LITERALS else None


def anchor_rank(token: Token, query: Query) -> int | None:
    """How selective an index lookup on this token is (longer fixed text = higher); None if some branch of
    the token has no indexable atom, so it cannot start a search."""
    ranks = []
    for branch in token.branches:
        lens = [x for x in (_atom_prefix_len(a, query) for a in branch) if x is not None]
        if not lens:
            return None
        ranks.append(max(lens))
    return min(ranks)


# --------------------------------------------------------------------------- in plain words
def _atom_words(atom: Atom) -> str:
    if atom.kind == "pos":
        tags = " or ".join(UPOS[t] for t in atom.value.split("|"))
        return f"not a {tags}" if atom.neg else f"part of speech {tags}"
    name = "lemma" if atom.attr == "lemma" else "word"
    what = {"lit": f'{name} "{atom.value}"', "glob": f'{name} "{atom.value}" (* = any letters)',
            "re": f"{name} matching /{atom.value}/"}[atom.kind]
    return ("not " + what) if atom.neg else what


def _token_words(token: Token) -> str:
    alts = []
    for branch in token.branches:
        if len(branch) == 1 and branch[0].kind == "pos" and not branch[0].neg:
            tags = [UPOS[t] for t in branch[0].value.split("|")]
            alts.append("a " + " or ".join(tags) if len(tags) > 1 else _article(tags[0]) + tags[0])
        else:
            alts.append(" and ".join(_atom_words(a) for a in branch))
    return " or ".join(alts)


def _article(noun: str) -> str:
    return "an " if noun[0] in "aeiou" else "a "


def _gap_words(gap: Gap) -> str:
    if gap.min == gap.max:
        return f"exactly {gap.min} word{'s' if gap.max != 1 else ''}"
    return f"{gap.min} to {gap.max} words"


def describe(query: Query) -> str:
    """'lemma "tomar", then 0 to 3 words, then a noun'."""
    parts = []
    for it in query.items:
        if isinstance(it, Gap):
            if it.max:
                parts.append(_gap_words(it))
        else:
            parts.append(_token_words(it))
    text = ", then ".join(parts)
    notes = [n for n, on in (("case-sensitive", query.case_sensitive),
                             ("accents ignored", query.accent_insensitive)) if on]
    return text + (f" ({', '.join(notes)})" if notes else "")


# --------------------------------------------------------------------------- compiling to SQL
def _col(alias: str, attr: str, accent: bool) -> str:
    base = f"{alias}.{'lemma' if attr == 'lemma' else 'norm'}"
    return f"colloca_ascii({base})" if accent else base


def _fold(text: str, query: Query) -> str:
    """The query text, in the same shape as the column it is compared with."""
    text = text.lower()          # norm and lemma are lower-case; a case-sensitive form is also checked on `form`
    return strip_accents(text) if query.accent_insensitive else text


def _atom_sql(alias: str, atom: Atom, query: Query) -> tuple[str, list]:
    cs = query.case_sensitive and atom.attr == "form"
    acc = query.accent_insensitive
    if atom.kind == "pos":
        tags = atom.value.split("|")
        sql, params = f"{alias}.upos IN ({','.join('?' * len(tags))})", list(tags)
    else:
        col = _col(alias, atom.attr, acc)
        if atom.kind == "lit":
            sql, params = f"{col}=?", [_fold(atom.value, query)]
            if cs:
                sql, params = sql + f" AND {alias}.form=?", params + [atom.value]
        elif atom.kind == "glob":
            sql, params = f"{col} GLOB ?", [glob_escape(_fold(atom.value, query))]
            if cs:
                sql, params = sql + f" AND {alias}.form GLOB ?", params + [glob_escape(atom.value)]
        else:
            sql, params = _regex_sql(alias, atom, col, cs, query)
    return (f"NOT ({sql})" if atom.neg else sql), params


def _regex_sql(alias: str, atom: Atom, col: str, cs: bool, query: Query) -> tuple[str, list]:
    pattern = strip_accents(atom.value) if query.accent_insensitive else atom.value
    alts = _literal_alternatives(atom.value)
    if alts:
        sql = f"{col} IN ({','.join('?' * len(alts))})"
        params: list = [_fold(a, query) for a in alts]
        if cs:
            sql += f" AND {alias}.form IN ({','.join('?' * len(alts))})"
            params += alts
        return sql, params
    flags = 0 if cs else re.I
    sql = f"colloca_re({alias + '.form' if cs else col}, ?, ?)"
    params = [pattern, flags]
    prefix = _regex_prefix(atom.value)
    if len(prefix) >= MIN_LITERALS and not atom.neg:
        sql = f"{col} GLOB ? AND {sql}"
        params = [glob_escape(_fold(prefix, query)) + "*"] + params
    return sql, params


def _token_sql(alias: str, token: Token, query: Query) -> tuple[str, list]:
    parts, params = [], []
    for branch in token.branches:
        sqls = []
        for atom in branch:
            s, p = _atom_sql(alias, atom, query)
            sqls.append(s)
            params += p
        parts.append("(" + " AND ".join(sqls) + ")")
    return (parts[0] if len(parts) == 1 else "(" + " OR ".join(parts) + ")"), params


def compile_sql(query: Query, scope_where: str, scope_params: list) -> tuple[str, list, list[int]]:
    """SQL returning doc_id, sent, p0..pk (the position of each token of the query) and the list of the
    token numbers in the order the joins run. The best-indexed token drives the search; the others are
    reached by primary-key range lookups relative to it, in the same sentence."""
    tokens = query.tokens
    gaps = [i for i in query.items if isinstance(i, Gap)]            # gaps[i] sits between tokens[i] and tokens[i+1]
    anchor = max(range(len(tokens)), key=lambda k: anchor_rank(tokens[k], query) or -1)
    params: list = []
    conds: list[str] = []
    joins: list[str] = []
    sql0, p0 = _token_sql(f"t{anchor}", tokens[anchor], query)
    conds.append(sql0)
    params += p0
    for k in range(anchor + 1, len(tokens)):                          # to the right of the anchor
        g = gaps[k - 1]
        s, p = _token_sql(f"t{k}", tokens[k], query)
        joins.append(f"CROSS JOIN tokens t{k} ON t{k}.doc_id=t{k - 1}.doc_id AND t{k}.sent=t{k - 1}.sent "
                     f"AND t{k}.pos BETWEEN t{k - 1}.pos+{g.min + 1} AND t{k - 1}.pos+{g.max + 1} AND {s}")
        params += p
    for k in range(anchor - 1, -1, -1):                               # to the left
        g = gaps[k]
        s, p = _token_sql(f"t{k}", tokens[k], query)
        joins.append(f"CROSS JOIN tokens t{k} ON t{k}.doc_id=t{k + 1}.doc_id AND t{k}.sent=t{k + 1}.sent "
                     f"AND t{k}.pos BETWEEN t{k + 1}.pos-{g.max + 1} AND t{k + 1}.pos-{g.min + 1} AND {s}")
        params += p
    select = f"t{anchor}.doc_id, t{anchor}.sent, " + ", ".join(f"t{k}.pos AS p{k}" for k in range(len(tokens)))
    sql = (f"SELECT {select} FROM tokens t{anchor} {' '.join(joins)} "
           f"JOIN documents d ON d.id=t{anchor}.doc_id WHERE {scope_where} AND {conds[0]} LIMIT {MAX_ROWS + 1}")
    # the scope parameters come before the anchor's, the joins' parameters are bound in text order
    return sql, _order_params(joins, params, scope_params, p0), list(range(len(tokens)))


def _order_params(joins, params, scope_params, p0):
    """Placeholders appear in the text as: joins (in order), then the scope, then the anchor condition."""
    join_params = params[len(p0):]
    return join_params + list(scope_params) + list(p0)
