"""Optional password protection (T23).

With the environment variable COLLOCA_PASSWORD set, every request needs either a session cookie obtained from the
login page or the password as a bearer token (`Authorization: Bearer <password>`, for scripts). Unset, nothing
changes: Colloca stays a local tool bound to localhost. This is a single shared password, not user accounts: it
keeps casual visitors on a network out; it is not a defence against someone who can read the machine or the
traffic (use HTTPS in front of it, see the README).

The session cookie is `<expiry>.<HMAC-SHA256>` with a key derived from the password, so it survives a restart,
cannot be forged without the password, and stops working when the password changes. Failed logins are rate
limited per client address."""
import functools
import hashlib
import hmac
import os
import time
from html import escape
from urllib.parse import quote

COOKIE = "colloca_session"
SESSION_HOURS = float(os.environ.get("COLLOCA_SESSION_HOURS", "12"))
MAX_FAILURES = int(os.environ.get("COLLOCA_LOGIN_ATTEMPTS", "5"))          # failed logins ...
WINDOW_SECONDS = int(os.environ.get("COLLOCA_LOGIN_WINDOW", "300"))        # ... per this many seconds, per address
PUBLIC = ("/login", "/logout", "/api/auth/status", "/healthz")


def password() -> str:
    return os.environ.get("COLLOCA_PASSWORD", "")


def enabled() -> bool:
    return bool(password())


@functools.lru_cache(maxsize=4)
def _key(secret: str) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", secret.encode(), b"colloca-session-v1", 100_000)


def _sign(expiry: int) -> str:
    return hmac.new(_key(password()), str(expiry).encode(), hashlib.sha256).hexdigest()


def make_cookie(now: float | None = None) -> tuple[str, int]:
    """(cookie value, lifetime in seconds)."""
    life = int(SESSION_HOURS * 3600)
    expiry = int((now if now is not None else time.time()) + life)
    return f"{expiry}.{_sign(expiry)}", life


def valid_cookie(value: str | None, now: float | None = None) -> bool:
    if not value or "." not in value:
        return False
    stamp, _, sig = value.partition(".")
    if not stamp.isdigit():
        return False
    if int(stamp) < (now if now is not None else time.time()):
        return False
    return hmac.compare_digest(sig, _sign(int(stamp)))


def check_password(candidate: str) -> bool:
    return hmac.compare_digest(candidate.encode(), password().encode())


def authenticated(headers, cookies) -> bool:
    """True when auth is off, or the request carries a valid session cookie or the password as a bearer token."""
    if not enabled():
        return True
    if valid_cookie(cookies.get(COOKIE)):
        return True
    auth = headers.get("authorization", "")
    return auth[:7].lower() == "bearer " and check_password(auth[7:].strip())


def safe_next(target: str | None) -> str:
    """Where to go after logging in: a path on this site only (never another site, never the login page)."""
    t = target or "/"
    if not t.startswith("/") or t.startswith("//") or "\\" in t or t.startswith("/login"):
        return "/"
    return t


# --------------------------------------------------------------------------- rate limit
_failures: dict[str, list[float]] = {}


def retry_after(client: str, now: float | None = None) -> int:
    """Seconds until `client` may try again (0 = allowed now)."""
    now = now if now is not None else time.time()
    recent = [t for t in _failures.get(client, []) if now - t < WINDOW_SECONDS]
    _failures[client] = recent
    if len(recent) < MAX_FAILURES:
        return 0
    return max(1, int(recent[0] + WINDOW_SECONDS - now) + 1)


def record_failure(client: str, now: float | None = None) -> None:
    _failures.setdefault(client, []).append(now if now is not None else time.time())
    if len(_failures) > 10_000:                      # a flood of addresses must not grow memory without bound
        for stale in [k for k, v in _failures.items() if not v or time.time() - v[-1] > WINDOW_SECONDS][:5000]:
            _failures.pop(stale, None)


def clear_failures(client: str) -> None:
    _failures.pop(client, None)


# --------------------------------------------------------------------------- the login page
_TEXT = {
    "en": ("Sign in", "Password", "Sign in", "Wrong password.", "Too many attempts. Try again in {n} seconds."),
    "es": ("Iniciar sesión", "Contraseña", "Entrar", "Contraseña incorrecta.",
           "Demasiados intentos. Vuelve a intentarlo en {n} segundos."),
    "it": ("Accedi", "Password", "Accedi", "Password errata.", "Troppi tentativi. Riprova tra {n} secondi."),
}


def language(accept: str) -> str:
    for part in accept.split(","):
        code = part.split(";")[0].strip().lower()[:2]
        if code in _TEXT:
            return code
    return "en"


def login_page(lang: str, target: str, error: str = "", retry: int = 0) -> str:
    title, label, button, wrong, limited = _TEXT[lang]
    message = limited.format(n=retry) if error == "limited" else wrong if error else ""
    note = f'<p class="err" role="alert">{escape(message)}</p>' if message else ""
    return f"""<!doctype html>
<html lang="{lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Colloca · {escape(title)}</title>
<style>
 body{{font:16px system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;
 background:#f6f7f9;color:#1c2024}}
 form{{background:#fff;padding:2rem;border:1px solid #d9dde3;border-radius:8px;width:min(22rem,90vw);
 display:grid;gap:.8rem}}
 h1{{margin:0;font-size:1.3rem}} label{{display:grid;gap:.3rem}} input{{font:inherit;padding:.5rem}}
 button{{font:inherit;padding:.55rem;background:#1d4ed8;color:#fff;border:0;border-radius:6px;cursor:pointer}}
 .err{{color:#b42318;margin:0}}
 @media (prefers-color-scheme:dark){{body{{background:#14171a;color:#e6e8eb}}
 form{{background:#1c2024;border-color:#2e343b}}
 input{{background:#14171a;color:inherit;border:1px solid #3a424a}}.err{{color:#ff8a80}}}}
</style></head><body>
<form method="post" action="/login"><h1>Colloca</h1>{note}
<label>{escape(label)}<input type="password" name="password" autocomplete="current-password" autofocus required></label>
<input type="hidden" name="next" value="{escape(target)}">
<button type="submit">{escape(button)}</button></form></body></html>"""


def login_redirect(path: str, query: str = "") -> str:
    return "/login?next=" + quote(path + (f"?{query}" if query else ""), safe="")
