"""Optional password protection (T23)."""
import pytest

from colloca import auth

SECRET = "correct horse battery staple"


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    auth._failures.clear()
    monkeypatch.setattr(auth, "MAX_FAILURES", 3)
    yield
    auth._failures.clear()


@pytest.fixture()
def locked(client, monkeypatch):
    monkeypatch.setenv("COLLOCA_PASSWORD", SECRET)
    monkeypatch.setattr("colloca.main.asyncio.sleep", _nosleep)
    return client


async def _nosleep(_s):
    return None


def login(client, password=SECRET, **form):
    return client.post("/login", data={"password": password, **form}, follow_redirects=False)


# --------------------------------------------------------------------------- off by default
def test_without_a_password_nothing_changes(client):
    assert client.get("/api/auth/status").json() == {"required": False, "authenticated": True}
    assert client.get("/api/languages").status_code == 200
    r = client.get("/login", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/"


# --------------------------------------------------------------------------- with a password
def test_every_api_call_needs_a_session(locked):
    r = locked.get("/api/corpora")
    assert r.status_code == 401 and r.json() == {"detail": "Authentication required"}
    assert locked.post("/api/corpora", json={"name": "x", "lang": "es"}).status_code == 401
    assert locked.get("/api/auth/status").json() == {"required": True, "authenticated": False}


def test_the_interface_redirects_to_the_login_page(locked):
    r = locked.get("/", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/login?next=%2F"
    r = locked.get("/assets/app.js?v=1", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/login?next=%2Fassets%2Fapp.js%3Fv%3D1"


def test_health_check_stays_public_and_reveals_nothing(locked):
    assert locked.get("/healthz").json() == {"ok": True}


def test_login_page_is_self_contained_and_follows_the_browser_language(locked):
    page = locked.get("/login")
    assert page.status_code == 200 and 'type="password"' in page.text and "<script" not in page.text
    assert 'lang="en"' in page.text
    es = locked.get("/login", headers={"accept-language": "es-ES,es;q=0.9"})
    assert 'lang="es"' in es.text and "Contraseña" in es.text
    assert 'lang="it"' in locked.get("/login", headers={"accept-language": "it"}).text
    assert 'lang="en"' in locked.get("/login", headers={"accept-language": "fr"}).text


def test_a_good_password_opens_a_session(locked):
    r = login(locked, next="/api/corpora")
    assert r.status_code == 303 and r.headers["location"] == "/api/corpora"
    cookie = r.headers["set-cookie"]
    assert "colloca_session=" in cookie and "HttpOnly" in cookie and "SameSite=strict" in cookie
    assert "Secure" not in cookie                                   # plain http on localhost
    assert locked.get("/api/corpora").status_code == 200            # the client keeps the cookie
    assert locked.get("/api/auth/status").json() == {"required": True, "authenticated": True}
    assert locked.get("/login", follow_redirects=False).status_code == 303   # already in


def test_the_cookie_is_secure_over_https_only_when_the_proxy_is_trusted(locked, monkeypatch):
    r = locked.post("/login", data={"password": SECRET}, headers={"x-forwarded-proto": "https"},
                    follow_redirects=False)
    assert "Secure" not in r.headers["set-cookie"]                  # a forwarded header is ignored by default
    monkeypatch.setenv("COLLOCA_TRUST_PROXY", "1")
    r = locked.post("/login", data={"password": SECRET}, headers={"x-forwarded-proto": "https"},
                    follow_redirects=False)
    assert "Secure" in r.headers["set-cookie"]


def test_a_wrong_password_is_refused_and_leaves_no_session(locked):
    r = login(locked, "nope")
    assert r.status_code == 401 and "Wrong password" in r.text and "set-cookie" not in r.headers
    assert locked.get("/api/corpora").status_code == 401


def test_logout_ends_the_session(locked):
    login(locked)
    assert locked.get("/api/corpora").status_code == 200
    r = locked.post("/logout", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/login"
    locked.cookies.clear()
    assert locked.get("/api/corpora").status_code == 401


def test_scripts_can_use_the_password_as_a_bearer_token(locked):
    assert locked.get("/api/corpora", headers={"Authorization": f"Bearer {SECRET}"}).status_code == 200
    assert locked.get("/api/corpora", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert locked.get("/api/corpora", headers={"Authorization": SECRET}).status_code == 401
    assert locked.get("/api/corpora", headers={"Authorization": "Basic abc"}).status_code == 401


# --------------------------------------------------------------------------- cookies
def test_cookie_round_trip_expiry_and_tampering(monkeypatch):
    monkeypatch.setenv("COLLOCA_PASSWORD", SECRET)
    value, life = auth.make_cookie(now=1000)
    assert life == int(auth.SESSION_HOURS * 3600)
    assert auth.valid_cookie(value, now=1001)
    assert not auth.valid_cookie(value, now=1000 + life + 1)         # expired
    stamp, _, sig = value.partition(".")
    assert not auth.valid_cookie(f"{int(stamp) + 99999}.{sig}", now=1001)   # a longer life with the old signature
    assert not auth.valid_cookie(f"{stamp}.{'0' * 64}", now=1001)
    assert not auth.valid_cookie("garbage", now=1001) and not auth.valid_cookie("", now=1001)
    assert not auth.valid_cookie(None)
    monkeypatch.setenv("COLLOCA_PASSWORD", "another password")
    assert not auth.valid_cookie(value, now=1001)                    # changing the password ends every session


def test_a_session_survives_a_restart_but_not_a_password_change(locked, monkeypatch):
    login(locked)
    auth._key.cache_clear()                                          # a new process derives the same key
    assert locked.get("/api/corpora").status_code == 200
    monkeypatch.setenv("COLLOCA_PASSWORD", "changed")
    assert locked.get("/api/corpora").status_code == 401


# --------------------------------------------------------------------------- rate limit
def test_too_many_wrong_passwords_lock_the_address_out(locked):
    for _ in range(3):
        assert login(locked, "bad").status_code == 401
    r = login(locked, SECRET)                                        # even the right one waits now
    assert r.status_code == 429 and int(r.headers["retry-after"]) > 0 and "Too many attempts" in r.text
    assert locked.get("/api/corpora").status_code == 401
    assert int(r.headers["retry-after"]) <= auth.WINDOW_SECONDS + 1


def test_the_limit_expires_and_success_resets_it(monkeypatch):
    now = 10_000.0
    for _ in range(3):
        auth.record_failure("a", now)
    assert auth.retry_after("a", now + 1) > 0
    assert auth.retry_after("a", now + auth.WINDOW_SECONDS + 1) == 0
    assert auth.retry_after("other", now) == 0                       # per address
    auth.record_failure("b", now)
    auth.clear_failures("b")
    assert auth.retry_after("b", now) == 0


def test_a_forwarded_address_counts_only_when_the_proxy_is_trusted(locked, monkeypatch):
    for i in range(3):
        locked.post("/login", data={"password": "bad"}, headers={"x-forwarded-for": f"1.2.3.{i}"})
    assert login(locked, SECRET).status_code == 429                  # all counted against the real peer
    auth._failures.clear()
    monkeypatch.setenv("COLLOCA_TRUST_PROXY", "1")
    for _ in range(3):
        locked.post("/login", data={"password": "bad"}, headers={"x-forwarded-for": "9.9.9.9"})
    assert login(locked, SECRET).status_code == 303                  # the peer itself is not locked out


# --------------------------------------------------------------------------- redirects
@pytest.mark.parametrize("target,expected", [
    ("/api/corpora", "/api/corpora"), ("/#/job?x=1", "/#/job?x=1"), ("//evil.example/x", "/"),
    ("https://evil.example/", "/"), ("/\\evil.example", "/"), ("/login?next=/", "/"), ("", "/"), (None, "/"),
])
def test_next_is_always_a_path_on_this_site(target, expected):
    assert auth.safe_next(target) == expected


def test_login_page_escapes_what_it_echoes(locked):
    page = locked.get("/login", params={"next": '/"><script>alert(1)</script>'})
    assert "<script>alert" not in page.text
