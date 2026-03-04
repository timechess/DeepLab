from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Count:
    field: str


class Q:
    def __init__(self, **kwargs: Any) -> None:
        self.kwargs = dict(kwargs)
        self.children: list[Q] = []
        self.connector = "AND"
        self.negated = False

    def __and__(self, other: "Q") -> "Q":
        node = Q()
        node.kwargs = {}
        node.children = [self, other]
        node.connector = "AND"
        return node

    def __or__(self, other: "Q") -> "Q":
        node = Q()
        node.kwargs = {}
        node.children = [self, other]
        node.connector = "OR"
        return node

    def __invert__(self) -> "Q":
        node = Q()
        node.kwargs = dict(self.kwargs)
        node.children = list(self.children)
        node.connector = self.connector
        node.negated = not self.negated
        return node

    def is_leaf(self) -> bool:
        return not self.children
