"""Saf-Python BLAKE3 (yalnız düz hash modu) — verify_audit_log.py fallback'i.

Rust tabanlı `blake3` pip paketi kurulamayan (ör. hava boşluklu) ortamlarda
denetim zinciri doğrulamasının çalışabilmesi için, BLAKE3 referans
implementasyonunun (CC0) düz-hash yolu buraya taşınmıştır. Yavaştır (saf
Python) ama bit-bit aynı çıktıyı üretir; keyed/derive-key modları bilinçli
olarak kapsam dışıdır (denetim zinciri yalnız düz hash kullanır).

API, verify_audit_log.py'nin ihtiyacı olan alt kümeyle `blake3` paketini
taklit eder:

    from pure_blake3 import blake3
    blake3(b"data").digest()      # 32 bayt
    blake3(b"data").hexdigest()

Doğrulama: tests/test_pure_blake3.py, kurulu gerçek blake3 paketine karşı
sınır boyutlarda (0, 1, 63..65, 1023..1025, çok-chunk ağaç) bit-bit eşitlik
sınar; CI'da koşar.
"""

from __future__ import annotations

import struct

_IV = (
    0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A,
    0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19,
)
_MSG_PERMUTATION = (2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8)

_CHUNK_START = 1 << 0
_CHUNK_END = 1 << 1
_PARENT = 1 << 2
_ROOT = 1 << 3

_BLOCK_LEN = 64
_CHUNK_LEN = 1024
_MASK = 0xFFFFFFFF


def _rotr(x: int, n: int) -> int:
    return ((x >> n) | (x << (32 - n))) & _MASK


def _g(s: list[int], a: int, b: int, c: int, d: int, mx: int, my: int) -> None:
    s[a] = (s[a] + s[b] + mx) & _MASK
    s[d] = _rotr(s[d] ^ s[a], 16)
    s[c] = (s[c] + s[d]) & _MASK
    s[b] = _rotr(s[b] ^ s[c], 12)
    s[a] = (s[a] + s[b] + my) & _MASK
    s[d] = _rotr(s[d] ^ s[a], 8)
    s[c] = (s[c] + s[d]) & _MASK
    s[b] = _rotr(s[b] ^ s[c], 7)


def _round(s: list[int], m: list[int]) -> None:
    _g(s, 0, 4, 8, 12, m[0], m[1])
    _g(s, 1, 5, 9, 13, m[2], m[3])
    _g(s, 2, 6, 10, 14, m[4], m[5])
    _g(s, 3, 7, 11, 15, m[6], m[7])
    _g(s, 0, 5, 10, 15, m[8], m[9])
    _g(s, 1, 6, 11, 12, m[10], m[11])
    _g(s, 2, 7, 8, 13, m[12], m[13])
    _g(s, 3, 4, 9, 14, m[14], m[15])


def _compress(cv: list[int], block_words: list[int], counter: int,
              block_len: int, flags: int) -> list[int]:
    state = [
        cv[0], cv[1], cv[2], cv[3], cv[4], cv[5], cv[6], cv[7],
        _IV[0], _IV[1], _IV[2], _IV[3],
        counter & _MASK, (counter >> 32) & _MASK, block_len, flags,
    ]
    m = list(block_words)
    for r in range(7):
        _round(state, m)
        if r < 6:
            m = [m[i] for i in _MSG_PERMUTATION]
    for i in range(8):
        state[i] ^= state[i + 8]
        state[i + 8] ^= cv[i]
    return state


def _words_from_block(block: bytes) -> list[int]:
    if len(block) < _BLOCK_LEN:
        block = block + b"\x00" * (_BLOCK_LEN - len(block))
    return list(struct.unpack("<16I", block))


class _Output:
    """Sıkıştırılmaya hazır son blok; root modunda XOF sayacıyla genişler."""

    def __init__(self, input_cv: list[int], block_words: list[int],
                 counter: int, block_len: int, flags: int) -> None:
        self.input_cv = input_cv
        self.block_words = block_words
        self.counter = counter
        self.block_len = block_len
        self.flags = flags

    def chaining_value(self) -> list[int]:
        return _compress(self.input_cv, self.block_words, self.counter,
                         self.block_len, self.flags)[:8]

    def root_bytes(self, length: int) -> bytes:
        out = bytearray()
        block_counter = 0
        while len(out) < length:
            words = _compress(self.input_cv, self.block_words, block_counter,
                              self.block_len, self.flags | _ROOT)
            out.extend(struct.pack("<16I", *words))
            block_counter += 1
        return bytes(out[:length])


class _ChunkState:
    def __init__(self, key_words: tuple[int, ...], chunk_counter: int) -> None:
        self.cv = list(key_words)
        self.chunk_counter = chunk_counter
        self.block = b""
        self.blocks_compressed = 0

    def _start_flag(self) -> int:
        return _CHUNK_START if self.blocks_compressed == 0 else 0

    def length(self) -> int:
        return _BLOCK_LEN * self.blocks_compressed + len(self.block)

    def update(self, data: bytes) -> None:
        pos = 0
        while pos < len(data):
            if len(self.block) == _BLOCK_LEN:
                self.cv = _compress(self.cv, _words_from_block(self.block),
                                    self.chunk_counter, _BLOCK_LEN,
                                    self._start_flag())[:8]
                self.blocks_compressed += 1
                self.block = b""
            take = min(_BLOCK_LEN - len(self.block), len(data) - pos)
            self.block += data[pos:pos + take]
            pos += take

    def output(self) -> _Output:
        return _Output(self.cv, _words_from_block(self.block),
                       self.chunk_counter, len(self.block),
                       self._start_flag() | _CHUNK_END)


def _parent_output(left_cv: list[int], right_cv: list[int],
                   key_words: tuple[int, ...]) -> _Output:
    return _Output(list(key_words), left_cv + right_cv, 0, _BLOCK_LEN, _PARENT)


class blake3:
    """`blake3.blake3(data)` paket API'sinin düz-hash alt kümesi."""

    digest_size = 32

    def __init__(self, data: bytes = b"") -> None:
        self._key_words = _IV
        self._chunk = _ChunkState(self._key_words, 0)
        self._cv_stack: list[list[int]] = []
        self._total_chunks = 0
        if data:
            self.update(data)

    def _push_chunk_cv(self, new_cv: list[int], total_chunks: int) -> None:
        while total_chunks & 1 == 0:
            new_cv = _parent_output(self._cv_stack.pop(), new_cv,
                                    self._key_words).chaining_value()
            total_chunks >>= 1
        self._cv_stack.append(new_cv)

    def update(self, data: bytes) -> "blake3":
        pos = 0
        while pos < len(data):
            if self._chunk.length() == _CHUNK_LEN:
                self._total_chunks += 1
                self._push_chunk_cv(self._chunk.output().chaining_value(),
                                    self._total_chunks)
                self._chunk = _ChunkState(self._key_words, self._total_chunks)
            take = min(_CHUNK_LEN - self._chunk.length(), len(data) - pos)
            self._chunk.update(data[pos:pos + take])
            pos += take
        return self

    def digest(self, length: int = 32) -> bytes:
        output = self._chunk.output()
        for cv in reversed(self._cv_stack):
            output = _parent_output(cv, output.chaining_value(),
                                    self._key_words)
        return output.root_bytes(length)

    def hexdigest(self, length: int = 32) -> str:
        return self.digest(length).hex()
