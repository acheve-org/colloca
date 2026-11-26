"""Passphrase encryption of backup files (T23, for T14).

A backup holds client documents, so it can be written encrypted: AES-256-GCM, key from the passphrase with scrypt,
the file cut into 1 MiB chunks that are each authenticated (a wrong passphrase, a damaged chunk, a missing end or a
reordered chunk all fail to decrypt). The file is `CORPORA-ENC1`, the scrypt parameters and salt, then the chunks.
Nothing here is secret except the passphrase; losing it loses the backup."""
import os
import struct

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

MAGIC = b"CORPORA-ENC1\n"
CHUNK = 1024 * 1024
MIN_PASSPHRASE = 8
_LOG_N, _R, _P = 15, 8, 1                       # scrypt cost (about 32 MB of memory, a fraction of a second)
_HEADER = struct.Struct(">BBB16s")              # log2(N), r, p, salt


class CryptError(ValueError):
    pass


def is_encrypted(head: bytes) -> bool:
    return head[: len(MAGIC)] == MAGIC


def _key(passphrase: str, log_n: int, r: int, p: int, salt: bytes) -> bytes:
    return Scrypt(salt=salt, length=32, n=1 << log_n, r=r, p=p).derive(passphrase.encode())


def _nonce(prefix: bytes, index: int) -> bytes:
    return prefix + struct.pack(">Q", index)


def encrypt_file(src: str, dst: str, passphrase: str) -> None:
    """Encrypt the file `src` into `dst` (streaming: memory use stays at about one chunk)."""
    if len(passphrase) < MIN_PASSPHRASE:
        raise CryptError(f"The passphrase must have at least {MIN_PASSPHRASE} characters")
    salt, prefix = os.urandom(16), os.urandom(4)
    head = MAGIC + _HEADER.pack(_LOG_N, _R, _P, salt) + prefix
    aes = AESGCM(_key(passphrase, _LOG_N, _R, _P, salt))
    with open(src, "rb") as fin, open(dst, "wb") as fout:
        fout.write(head)
        index = 0
        block = fin.read(CHUNK)
        while True:
            nxt = fin.read(CHUNK)
            last = not nxt                        # the final chunk is marked, so a cut-off file is detected
            ct = aes.encrypt(_nonce(prefix, index), block, head + (b"\x01" if last else b"\x00"))
            fout.write(struct.pack(">I", len(ct)) + ct)
            if last:
                break
            block, index = nxt, index + 1


def decrypt_bytes(data: bytes, passphrase: str, limit: int | None = None) -> bytes:
    """The plain content of an encrypted backup. `limit` caps the decrypted size (a decompression-bomb guard
    does not apply to a cipher, but memory does)."""
    if not is_encrypted(data):
        raise CryptError("Not an encrypted Corpora file")
    pos = len(MAGIC)
    try:
        log_n, r, p, salt = _HEADER.unpack_from(data, pos)
    except struct.error as exc:
        raise CryptError("The encrypted file is damaged") from exc
    pos += _HEADER.size
    prefix = data[pos:pos + 4]
    pos += 4
    head = data[:pos]
    if not (10 <= log_n <= 20 and 1 <= r <= 16 and 1 <= p <= 4) or len(prefix) != 4:
        raise CryptError("The encrypted file is damaged")
    aes = AESGCM(_key(passphrase, log_n, r, p, salt))
    out = bytearray()
    index = 0
    while True:
        if pos + 4 > len(data):
            raise CryptError("The encrypted file is incomplete")
        (size,) = struct.unpack_from(">I", data, pos)
        pos += 4
        ct = data[pos:pos + size]
        if len(ct) != size or size < 16:
            raise CryptError("The encrypted file is incomplete")
        pos += size
        last = pos >= len(data)
        try:
            out += aes.decrypt(_nonce(prefix, index), ct, head + (b"\x01" if last else b"\x00"))
        except InvalidTag as exc:
            raise CryptError("Wrong passphrase, or the file is damaged or incomplete") from exc
        if limit is not None and len(out) > limit:
            raise CryptError("The decrypted file is larger than the limit")
        if last:
            return bytes(out)
        index += 1
