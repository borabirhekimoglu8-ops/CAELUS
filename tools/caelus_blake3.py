#!/usr/bin/env python3
"""Small dependency-free Blake3 verifier backend.

This is a deliberately narrow, unkeyed, 32-byte digest implementation for
offline audit verification. It follows the Blake3 specification's seven-round
compression function and binary tree reduction. Production hashing remains in
the pinned Rust `blake3` crate; tests bind this verifier to official vectors and
the committed Rust-generated neural weights digest.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Sequence


_MASK32 = 0xFFFF_FFFF
_BLOCK_LEN = 64
_CHUNK_LEN = 1024
_MAX_INPUT_BYTES = 64 * 1024 * 1024
_MAX_OUTPUT_BYTES = 64

_CHUNK_START = 1 << 0
_CHUNK_END = 1 << 1
_PARENT = 1 << 2
_ROOT = 1 << 3

_IV = (
    0x6A09E667,
    0xBB67AE85,
    0x3C6EF372,
    0xA54FF53A,
    0x510E527F,
    0x9B05688C,
    0x1F83D9AB,
    0x5BE0CD19,
)
_MSG_PERMUTATION = (2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8)


def _rotr32(value: int, count: int) -> int:
    return ((value >> count) | (value << (32 - count))) & _MASK32


def _g(
    state: list[int],
    a: int,
    b: int,
    c: int,
    d: int,
    message_x: int,
    message_y: int,
) -> None:
    state[a] = (state[a] + state[b] + message_x) & _MASK32
    state[d] = _rotr32(state[d] ^ state[a], 16)
    state[c] = (state[c] + state[d]) & _MASK32
    state[b] = _rotr32(state[b] ^ state[c], 12)
    state[a] = (state[a] + state[b] + message_y) & _MASK32
    state[d] = _rotr32(state[d] ^ state[a], 8)
    state[c] = (state[c] + state[d]) & _MASK32
    state[b] = _rotr32(state[b] ^ state[c], 7)


def _round(state: list[int], message: Sequence[int]) -> None:
    _g(state, 0, 4, 8, 12, message[0], message[1])
    _g(state, 1, 5, 9, 13, message[2], message[3])
    _g(state, 2, 6, 10, 14, message[4], message[5])
    _g(state, 3, 7, 11, 15, message[6], message[7])
    _g(state, 0, 5, 10, 15, message[8], message[9])
    _g(state, 1, 6, 11, 12, message[10], message[11])
    _g(state, 2, 7, 8, 13, message[12], message[13])
    _g(state, 3, 4, 9, 14, message[14], message[15])


def _compress(
    chaining_value: Sequence[int],
    block_words: Sequence[int],
    counter: int,
    block_len: int,
    flags: int,
) -> tuple[int, ...]:
    if (
        len(chaining_value) != 8
        or len(block_words) != 16
        or not 0 <= counter <= 0xFFFF_FFFF_FFFF_FFFF
        or not 0 <= block_len <= _BLOCK_LEN
    ):
        raise ValueError("invalid Blake3 compression input")
    state = list(chaining_value) + list(_IV[:4]) + [
        counter & _MASK32,
        (counter >> 32) & _MASK32,
        block_len,
        flags,
    ]
    message = list(block_words)
    for round_index in range(7):
        _round(state, message)
        if round_index != 6:
            message = [message[index] for index in _MSG_PERMUTATION]

    output = [0] * 16
    for index in range(8):
        output[index] = state[index] ^ state[index + 8]
        output[index + 8] = state[index + 8] ^ chaining_value[index]
    return tuple(output)


def _block_words(block: bytes) -> tuple[int, ...]:
    if len(block) > _BLOCK_LEN:
        raise ValueError("Blake3 block exceeds 64 bytes")
    return struct.unpack("<16I", block.ljust(_BLOCK_LEN, b"\0"))


@dataclass(frozen=True)
class _Output:
    input_chaining_value: tuple[int, ...]
    block_words: tuple[int, ...]
    counter: int
    block_len: int
    flags: int

    def chaining_value(self) -> tuple[int, ...]:
        return _compress(
            self.input_chaining_value,
            self.block_words,
            self.counter,
            self.block_len,
            self.flags,
        )[:8]

    def root_bytes(self, length: int) -> bytes:
        if not 0 <= length <= _MAX_OUTPUT_BYTES:
            raise ValueError(
                f"Blake3 output length must be 0..{_MAX_OUTPUT_BYTES} bytes"
            )
        output = bytearray()
        output_block_counter = 0
        while len(output) < length:
            words = _compress(
                self.input_chaining_value,
                self.block_words,
                output_block_counter,
                self.block_len,
                self.flags | _ROOT,
            )
            output.extend(struct.pack("<16I", *words))
            output_block_counter += 1
        return bytes(output[:length])


def _chunk_output(chunk: bytes, chunk_counter: int) -> _Output:
    if len(chunk) > _CHUNK_LEN:
        raise ValueError("Blake3 chunk exceeds 1024 bytes")
    chaining_value = _IV
    block_count = max(1, (len(chunk) + _BLOCK_LEN - 1) // _BLOCK_LEN)
    for block_index in range(block_count):
        block = chunk[
            block_index * _BLOCK_LEN : (block_index + 1) * _BLOCK_LEN
        ]
        flags = 0
        if block_index == 0:
            flags |= _CHUNK_START
        if block_index == block_count - 1:
            flags |= _CHUNK_END
        output = _Output(
            tuple(chaining_value),
            _block_words(block),
            chunk_counter,
            len(block),
            flags,
        )
        if block_index == block_count - 1:
            return output
        chaining_value = output.chaining_value()
    raise AssertionError("unreachable Blake3 chunk state")


def _parent_output(
    left_child: Sequence[int], right_child: Sequence[int]
) -> _Output:
    if len(left_child) != 8 or len(right_child) != 8:
        raise ValueError("invalid Blake3 parent chaining values")
    return _Output(
        _IV,
        tuple(left_child) + tuple(right_child),
        0,
        _BLOCK_LEN,
        _PARENT,
    )


def digest(data: bytes, length: int = 32) -> bytes:
    """Return an unkeyed Blake3 digest for a bounded bytes value."""
    if not isinstance(data, bytes):
        raise TypeError("Blake3 input must be bytes")
    if len(data) > _MAX_INPUT_BYTES:
        raise ValueError(f"Blake3 input exceeds {_MAX_INPUT_BYTES}-byte safety limit")

    chunks = [
        data[offset : offset + _CHUNK_LEN]
        for offset in range(0, len(data), _CHUNK_LEN)
    ] or [b""]
    chaining_stack: list[tuple[int, ...]] = []

    for chunk_index, chunk in enumerate(chunks[:-1]):
        chaining_value = _chunk_output(chunk, chunk_index).chaining_value()
        total_chunks = chunk_index + 1
        while total_chunks & 1 == 0:
            left_child = chaining_stack.pop()
            chaining_value = _parent_output(
                left_child, chaining_value
            ).chaining_value()
            total_chunks >>= 1
        chaining_stack.append(chaining_value)

    output = _chunk_output(chunks[-1], len(chunks) - 1)
    for left_child in reversed(chaining_stack):
        output = _parent_output(left_child, output.chaining_value())
    return output.root_bytes(length)


class _Hash:
    def __init__(self, data: bytes) -> None:
        self._data = data

    def digest(self, length: int = 32) -> bytes:
        return digest(self._data, length)

    def hexdigest(self, length: int = 32) -> str:
        return self.digest(length).hex()


def blake3(data: bytes = b"") -> _Hash:
    """Compatibility surface used by `tools/verify_audit_log.py`."""
    return _Hash(data)
