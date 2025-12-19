#!/usr/bin/env python3
"""Lightweight TypeScript filter for Doxygen.

Strips TypeScript-only syntax (access modifiers, readonly keywords, type
annotations, and generics) so that Breathe can render the resulting
JavaScript-like signatures without tripping the C++ parser.
"""
from __future__ import annotations

import re
import sys
from typing import Iterable

ACCESS_MODIFIER = re.compile(r"\b(public|private|protected)\s+")
READONLY = re.compile(r"\breadonly\s+")
# Remove simple type annotations (": Type") and return types.
TYPE_ANNOTATION = re.compile(r"(:\s*[A-Za-z0-9_\[\]\|?<>{}()\.]+)")
# Remove generic angle brackets like "Class<T>".
GENERICS = re.compile(r"<[^>]+>")


def _strip_line(line: str) -> str:
    line = ACCESS_MODIFIER.sub("", line)
    line = READONLY.sub("", line)
    line = GENERICS.sub("", line)
    # Remove type annotations but keep optional markers and identifiers.
    line = TYPE_ANNOTATION.sub("", line)
    return line


def main(stdin: Iterable[str], stdout) -> None:
    for raw in stdin:
        stdout.write(_strip_line(raw))


if __name__ == "__main__":
    main(sys.stdin, sys.stdout)
