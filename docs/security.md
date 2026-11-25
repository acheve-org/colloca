# Password and encryption

## Default

- No login. Meant for your own machine; `docker-compose.yml` publishes on `127.0.0.1` only, which is the whole protection.
- On a shared network, set a password.

## Password

```bash
COLLOCA_PASSWORD='a long passphrase' uv run uvicorn colloca.main:app   # or in docker-compose.yml: environment
```

| Item | Behaviour |
|---|---|
| Scope | Every page and API call needs a session. |
| Login | `/login` (en/es/it by browser language, no script) sets a cookie: `HttpOnly`, `SameSite=Strict`, signed with a key derived from the password. |
| Lifetime | `COLLOCA_SESSION_HOURS` (12). Changing the password ends all sessions; restarting does not. |
| Scripts | `Authorization: Bearer <password>` |
| Log out | Menu in the rail. |
| Open without session | `/login`, `/logout`, `/api/auth/status`, `/healthz` (health checks). |
| Rate limit | `COLLOCA_LOGIN_ATTEMPTS` 5 per `COLLOCA_LOGIN_WINDOW` 300 s per address, then HTTP 429 with `Retry-After`. Each failure costs 0.5 s. |

## Reverse proxy

- Terminate HTTPS at the proxy (nginx, Caddy, Traefik). Without HTTPS, password and cookie travel in clear text.
- `COLLOCA_TRUST_PROXY=1` only if the proxy sets `X-Forwarded-For` / `X-Forwarded-Proto` itself. Effect: rate limit counts the real client; cookie gets `Secure`.
- The app must be reachable only through the proxy.

## Encrypted backups

- *Backup and Trash* passphrase field: *Back up the whole database* and *Export project* produce `.zip.enc`.
- AES-256-GCM, authenticated 1 MiB chunks, key from passphrase via scrypt. `POST /api/backup/encrypted` (passphrase never in a URL).
- Import with the same passphrase. Wrong passphrase, or a damaged, truncated or reordered file: refused.
- **No recovery** if the passphrase is lost.

## Encryption at rest

Not provided by Colloca (no SQLCipher). Keep `COLLOCA_DATA_DIR` (the `colloca-data` volume) on an encrypted volume: FileVault, BitLocker, LUKS, or an encrypted Docker volume.

| Layer | Protects against |
|---|---|
| Password | Casual visitors on a network |
| Encrypted volume | A stolen disk |
| Encrypted backups | Files you move around |

Does not protect against:
- anyone who can run code on the machine or read its memory;
- a leaked shared password (no accounts, roles or audit log);
- traffic sniffing without HTTPS.
