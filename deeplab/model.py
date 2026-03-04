from __future__ import annotations

import json
import uuid
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, ClassVar, Generic, TypeVar

from deeplab.db.query import Count, Q
from deeplab.db.repositories import delete_rows, fetch_all, fetch_one


TModel = TypeVar("TModel", bound="BaseModel")


@dataclass
class RelationSpec:
    name: str
    target: str
    fk_attr: str
    fk_column: str
    related_name: str | None = None


@dataclass
class ReverseRelationSpec:
    name: str
    source_model: str
    fk_attr: str


@dataclass
class ModelMeta:
    table: str
    pk_attr: str
    fields: dict[str, str]
    relations: dict[str, RelationSpec] = field(default_factory=dict)
    reverse_relations: dict[str, ReverseRelationSpec] = field(default_factory=dict)
    json_fields: set[str] = field(default_factory=set)
    uuid_fields: set[str] = field(default_factory=set)
    datetime_fields: set[str] = field(default_factory=set)
    defaults: dict[str, Any] = field(default_factory=dict)
    default_factories: dict[str, Any] = field(default_factory=dict)
    auto_now_add: set[str] = field(default_factory=set)
    auto_now: set[str] = field(default_factory=set)
    ordering: list[str] = field(default_factory=list)

    @property
    def pk_column(self) -> str:
        return self.fields[self.pk_attr]

    @property
    def column_to_attr(self) -> dict[str, str]:
        return {column: attr for attr, column in self.fields.items()}


_MODEL_REGISTRY: dict[str, type[BaseModel]] = {}
_LOOKUP_OPERATORS = {"in", "icontains", "gte", "gt", "lte", "lt", "startswith", "exact"}


def _quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _qualified(alias: str, column: str) -> str:
    return f"{alias}.{_quote_ident(column)}"


def _normalize_datetime(value: datetime | str | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value)
        except ValueError:
            return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def _copy_default(value: Any) -> Any:
    if isinstance(value, (dict, list, set, tuple)):
        return deepcopy(value)
    return value


class QueryContext:
    def __init__(self) -> None:
        self.joins: list[str] = []
        self.join_cache: dict[tuple[str, str], tuple[str, type[BaseModel]]] = {}
        self.alias_counter = 1

    def ensure_join(
        self,
        alias: str,
        model: type[BaseModel],
        relation_name: str,
    ) -> tuple[str, type[BaseModel]]:
        key = (alias, relation_name)
        cached = self.join_cache.get(key)
        if cached is not None:
            return cached

        relation = model._meta.relations[relation_name]
        target = _MODEL_REGISTRY[relation.target]
        target_alias = f"t{self.alias_counter}"
        self.alias_counter += 1
        clause = (
            f"LEFT JOIN {_quote_ident(target._meta.table)} {target_alias} "
            f"ON {_qualified(alias, relation.fk_column)} = {_qualified(target_alias, target._meta.pk_column)}"
        )
        self.joins.append(clause)
        cached = (target_alias, target)
        self.join_cache[key] = cached
        return cached


class QuerySet(Generic[TModel]):
    def __init__(
        self,
        model: type[TModel],
        *,
        filters: list[Q] | None = None,
        order_fields: list[str] | None = None,
        limit_count: int | None = None,
        offset_count: int | None = None,
        select_related_fields: list[str] | None = None,
        prefetch_related_fields: list[str] | None = None,
        annotations: dict[str, Count] | None = None,
        group_fields: list[str] | None = None,
    ) -> None:
        self.model = model
        self._filters = list(filters or [])
        self._order_fields = list(order_fields or [])
        self._limit_count = limit_count
        self._offset_count = offset_count
        self._select_related_fields = list(select_related_fields or [])
        self._prefetch_related_fields = list(prefetch_related_fields or [])
        self._annotations = dict(annotations or {})
        self._group_fields = list(group_fields or [])

    def _clone(self) -> QuerySet[TModel]:
        return QuerySet(
            self.model,
            filters=self._filters,
            order_fields=self._order_fields,
            limit_count=self._limit_count,
            offset_count=self._offset_count,
            select_related_fields=self._select_related_fields,
            prefetch_related_fields=self._prefetch_related_fields,
            annotations=self._annotations,
            group_fields=self._group_fields,
        )

    def filter(self, *q_objects: Q, **kwargs: Any) -> QuerySet[TModel]:
        cloned = self._clone()
        for q_obj in q_objects:
            cloned._filters.append(q_obj)
        if kwargs:
            cloned._filters.append(Q(**kwargs))
        return cloned

    def exclude(self, *q_objects: Q, **kwargs: Any) -> QuerySet[TModel]:
        cloned = self._clone()
        for q_obj in q_objects:
            cloned._filters.append(~q_obj)
        if kwargs:
            cloned._filters.append(~Q(**kwargs))
        return cloned

    def order_by(self, *fields: str) -> QuerySet[TModel]:
        cloned = self._clone()
        cloned._order_fields = list(fields)
        return cloned

    def limit(self, count: int) -> QuerySet[TModel]:
        cloned = self._clone()
        cloned._limit_count = int(count)
        return cloned

    def offset(self, count: int) -> QuerySet[TModel]:
        cloned = self._clone()
        cloned._offset_count = int(count)
        return cloned

    def select_related(self, *relations: str) -> QuerySet[TModel]:
        cloned = self._clone()
        cloned._select_related_fields = [*cloned._select_related_fields, *relations]
        return cloned

    def prefetch_related(self, *relations: str) -> QuerySet[TModel]:
        cloned = self._clone()
        cloned._prefetch_related_fields = [*cloned._prefetch_related_fields, *relations]
        return cloned

    def annotate(self, **annotations: Count) -> QuerySet[TModel]:
        cloned = self._clone()
        cloned._annotations.update(annotations)
        return cloned

    def group_by(self, *fields: str) -> QuerySet[TModel]:
        cloned = self._clone()
        cloned._group_fields = list(fields)
        return cloned

    def _coerce_value(self, value: Any) -> Any:
        if isinstance(value, BaseModel):
            return getattr(value, value._meta.pk_attr)
        if isinstance(value, datetime):
            return _normalize_datetime(value)
        return value

    def _resolve_lookup(
        self,
        context: QueryContext,
        key: str,
    ) -> tuple[str, str, type[BaseModel], str]:
        parts = key.split("__")
        operator = "exact"
        if parts[-1] in _LOOKUP_OPERATORS:
            operator = parts.pop()

        if not parts:
            raise ValueError(f"Invalid lookup key: {key}")

        alias = "t0"
        model: type[BaseModel] = self.model

        if len(parts) == 1:
            field_name = parts[0]
            relation = model._meta.relations.get(field_name)
            if relation is not None:
                return alias, relation.fk_column, model, operator
            if field_name not in model._meta.fields:
                raise ValueError(f"Unknown field for {model.__name__}: {field_name}")
            return alias, model._meta.fields[field_name], model, operator

        for name in parts[:-1]:
            if name not in model._meta.relations:
                raise ValueError(f"Unknown relation for {model.__name__}: {name}")
            alias, model = context.ensure_join(alias, model, name)

        field_name = parts[-1]
        relation = model._meta.relations.get(field_name)
        if relation is not None:
            return alias, relation.fk_column, model, operator
        if field_name not in model._meta.fields:
            raise ValueError(f"Unknown field for {model.__name__}: {field_name}")
        return alias, model._meta.fields[field_name], model, operator

    def _compile_lookup(
        self,
        context: QueryContext,
        key: str,
        value: Any,
    ) -> tuple[str, list[Any]]:
        alias, column, _model, operator = self._resolve_lookup(context, key)
        expression = _qualified(alias, column)

        coerced = self._coerce_value(value)
        if operator == "exact":
            if coerced is None:
                return f"{expression} IS NULL", []
            return f"{expression} = ?", [coerced]

        if operator == "in":
            values = [self._coerce_value(item) for item in list(coerced or [])]
            if not values:
                return "1 = 0", []
            placeholders = ", ".join("?" for _ in values)
            return f"{expression} IN ({placeholders})", values

        if coerced is None:
            return "1 = 0", []

        if operator == "icontains":
            return (
                f"LOWER(CAST({expression} AS VARCHAR)) LIKE ?",
                [f"%{str(coerced).lower()}%"],
            )

        if operator == "startswith":
            return (
                f"LOWER(CAST({expression} AS VARCHAR)) LIKE ?",
                [f"{str(coerced).lower()}%"],
            )

        if operator in {"gte", "gt", "lte", "lt"}:
            mapping = {
                "gte": ">=",
                "gt": ">",
                "lte": "<=",
                "lt": "<",
            }
            return f"{expression} {mapping[operator]} ?", [coerced]

        raise ValueError(f"Unsupported lookup operator: {operator}")

    def _compile_q(self, context: QueryContext, q_obj: Q) -> tuple[str, list[Any]]:
        parts: list[str] = []
        params: list[Any] = []

        for key, value in q_obj.kwargs.items():
            fragment, frag_params = self._compile_lookup(context, key, value)
            parts.append(f"({fragment})")
            params.extend(frag_params)

        for child in q_obj.children:
            fragment, frag_params = self._compile_q(context, child)
            if fragment:
                parts.append(f"({fragment})")
                params.extend(frag_params)

        if not parts:
            sql = "1 = 1"
        else:
            sql = f" {q_obj.connector} ".join(parts)

        if q_obj.negated:
            sql = f"NOT ({sql})"
        return sql, params

    def _compile_where(self, context: QueryContext) -> tuple[str, list[Any]]:
        if not self._filters:
            return "", []

        fragments: list[str] = []
        params: list[Any] = []
        for q_obj in self._filters:
            fragment, frag_params = self._compile_q(context, q_obj)
            if fragment:
                fragments.append(f"({fragment})")
                params.extend(frag_params)
        if not fragments:
            return "", []
        return "WHERE " + " AND ".join(fragments), params

    def _compile_order_by(self, context: QueryContext) -> str:
        if self._group_fields and not self._order_fields:
            return ""
        fields = self._order_fields or self.model._meta.ordering
        if not fields:
            return ""

        rendered: list[str] = []
        for item in fields:
            desc = item.startswith("-")
            field_name = item[1:] if desc else item
            alias, column, _, _ = self._resolve_lookup(context, field_name)
            rendered.append(f"{_qualified(alias, column)} {'DESC' if desc else 'ASC'}")
        return "ORDER BY " + ", ".join(rendered)

    def _compile_limit_offset(self) -> str:
        parts: list[str] = []
        if self._limit_count is not None:
            parts.append(f"LIMIT {int(self._limit_count)}")
        if self._offset_count is not None:
            parts.append(f"OFFSET {int(self._offset_count)}")
        return " ".join(parts)

    async def _hydrate_rows(self, rows: list[dict[str, Any]]) -> list[TModel]:
        return [self.model._from_row(row, row_uses_attr_names=True) for row in rows]

    async def _apply_select_related(self, items: list[TModel]) -> None:
        if not items or not self._select_related_fields:
            return

        for relation_name in self._select_related_fields:
            relation = self.model._meta.relations.get(relation_name)
            if relation is None:
                continue
            target_model = _MODEL_REGISTRY[relation.target]
            ids = [getattr(item, relation.fk_attr) for item in items]
            ids = [item for item in ids if item is not None]
            if not ids:
                continue

            target_rows = await target_model.filter(
                **{f"{target_model._meta.pk_attr}__in": ids}
            ).all()
            target_map = {
                getattr(target, target_model._meta.pk_attr): target for target in target_rows
            }
            for item in items:
                fk_value = getattr(item, relation.fk_attr)
                setattr(item, relation_name, target_map.get(fk_value))

    async def _apply_prefetch_related(self, items: list[TModel]) -> None:
        if not items or not self._prefetch_related_fields:
            return

        model_pk_attr = self.model._meta.pk_attr
        model_ids = [getattr(item, model_pk_attr) for item in items]
        model_ids = [item for item in model_ids if item is not None]
        if not model_ids:
            return

        item_map = {getattr(item, model_pk_attr): item for item in items}

        for relation_name in self._prefetch_related_fields:
            reverse = self.model._meta.reverse_relations.get(relation_name)
            if reverse is None:
                continue
            source_model = _MODEL_REGISTRY[reverse.source_model]
            children = await source_model.filter(
                **{f"{reverse.fk_attr}__in": model_ids}
            ).all()

            grouped: dict[Any, list[Any]] = {key: [] for key in model_ids}
            for child in children:
                key = getattr(child, reverse.fk_attr)
                grouped.setdefault(key, []).append(child)

            for parent_key, parent in item_map.items():
                setattr(parent, relation_name, grouped.get(parent_key, []))

    async def _evaluate_models(self) -> list[TModel]:
        context = QueryContext()
        rendered_select_fields: list[str] = []
        for attr, column in self.model._meta.fields.items():
            expression = _qualified("t0", column)
            if attr in self.model._meta.datetime_fields:
                expression = f"CAST({expression} AS VARCHAR)"
            rendered_select_fields.append(f"{expression} AS {_quote_ident(attr)}")
        select_fields = ", ".join(rendered_select_fields)
        where_clause, params = self._compile_where(context)
        join_clause = " ".join(context.joins)
        order_clause = self._compile_order_by(context)
        limit_clause = self._compile_limit_offset()

        sql = " ".join(
            part
            for part in [
                f"SELECT {select_fields}",
                f"FROM {_quote_ident(self.model._meta.table)} t0",
                join_clause,
                where_clause,
                order_clause,
                limit_clause,
            ]
            if part
        )
        rows = fetch_all(sql + ";", params)
        items = await self._hydrate_rows(rows)
        await self._apply_select_related(items)
        await self._apply_prefetch_related(items)
        return items

    def __await__(self):
        return self._evaluate_models().__await__()

    async def all(self) -> list[TModel]:
        return await self._evaluate_models()

    async def first(self) -> TModel | None:
        rows = await self.limit(1)._evaluate_models()
        if not rows:
            return None
        return rows[0]

    async def count(self) -> int:
        context = QueryContext()
        where_clause, params = self._compile_where(context)
        join_clause = " ".join(context.joins)
        sql = " ".join(
            part
            for part in [
                "SELECT COUNT(*) AS total",
                f"FROM {_quote_ident(self.model._meta.table)} t0",
                join_clause,
                where_clause,
            ]
            if part
        )
        row = fetch_one(sql + ";", params)
        return int((row or {}).get("total", 0))

    async def delete(self) -> int:
        context = QueryContext()
        where_clause, params = self._compile_where(context)
        join_clause = " ".join(context.joins)

        if join_clause:
            pk_col = self.model._meta.pk_column
            pk_expr = _qualified("t0", pk_col)
            subquery = " ".join(
                part
                for part in [
                    f"SELECT {pk_expr}",
                    f"FROM {_quote_ident(self.model._meta.table)} t0",
                    join_clause,
                    where_clause,
                ]
                if part
            )
            sql = (
                f"DELETE FROM {_quote_ident(self.model._meta.table)} "
                f"WHERE {_quote_ident(pk_col)} IN ({subquery});"
            )
            return delete_rows(sql, params)

        # DuckDB does not accept table aliases in DELETE predicates
        # (e.g. DELETE ... WHERE t0."id" = ?), so strip the base alias.
        delete_where_clause = where_clause.replace("t0.", "")
        sql = " ".join(
            part
            for part in [
                f"DELETE FROM {_quote_ident(self.model._meta.table)}",
                delete_where_clause,
            ]
            if part
        )
        return delete_rows(sql + ";", params)

    async def values(self, *field_names: str) -> list[dict[str, Any]]:
        context = QueryContext()
        where_clause, params = self._compile_where(context)

        rendered_fields: list[str] = []
        for name in field_names:
            annotation = self._annotations.get(name)
            if annotation is not None:
                alias, column, _, _ = self._resolve_lookup(context, annotation.field)
                rendered_fields.append(f"COUNT({_qualified(alias, column)}) AS {_quote_ident(name)}")
                continue

            alias, column, _, _ = self._resolve_lookup(context, name)
            rendered_fields.append(f"{_qualified(alias, column)} AS {_quote_ident(name)}")

        group_clause = ""
        if self._group_fields:
            group_exprs = []
            for name in self._group_fields:
                alias, column, _, _ = self._resolve_lookup(context, name)
                group_exprs.append(_qualified(alias, column))
            group_clause = "GROUP BY " + ", ".join(group_exprs)

        join_clause = " ".join(context.joins)
        order_clause = self._compile_order_by(context)
        limit_clause = self._compile_limit_offset()

        sql = " ".join(
            part
            for part in [
                "SELECT " + ", ".join(rendered_fields),
                f"FROM {_quote_ident(self.model._meta.table)} t0",
                join_clause,
                where_clause,
                group_clause,
                order_clause,
                limit_clause,
            ]
            if part
        )
        return fetch_all(sql + ";", params)

    async def values_list(self, field_name: str, flat: bool = False) -> list[Any]:
        rows = await self.values(field_name)
        values = [row.get(field_name) for row in rows]
        if flat:
            return values
        return [(value,) for value in values]


class BaseModel:
    _meta: ClassVar[ModelMeta]

    @classmethod
    def all(cls: type[TModel]) -> QuerySet[TModel]:
        return QuerySet(cls)

    @classmethod
    def filter(cls: type[TModel], *q_objects: Q, **kwargs: Any) -> QuerySet[TModel]:
        return QuerySet(cls).filter(*q_objects, **kwargs)

    @classmethod
    async def get_or_none(cls: type[TModel], **kwargs: Any) -> TModel | None:
        return await cls.filter(**kwargs).first()

    @classmethod
    async def get(cls: type[TModel], **kwargs: Any) -> TModel:
        item = await cls.get_or_none(**kwargs)
        if item is None:
            raise ValueError(f"{cls.__name__} not found")
        return item

    @classmethod
    def _normalize_create_kwargs(cls, kwargs: dict[str, Any]) -> dict[str, Any]:
        payload = dict(kwargs)
        for relation_name, relation in cls._meta.relations.items():
            if relation_name in payload:
                value = payload.pop(relation_name)
                if isinstance(value, BaseModel):
                    payload[relation.fk_attr] = getattr(value, value._meta.pk_attr)
                else:
                    payload[relation.fk_attr] = value

        now = datetime.now(tz=UTC)
        for attr in cls._meta.auto_now_add:
            if payload.get(attr) is None:
                payload[attr] = now
        for attr in cls._meta.auto_now:
            if payload.get(attr) is None:
                payload[attr] = now

        for attr, factory in cls._meta.default_factories.items():
            if payload.get(attr) is None:
                payload[attr] = factory()

        for attr, default in cls._meta.defaults.items():
            if payload.get(attr) is None:
                payload[attr] = _copy_default(default)

        if payload.get(cls._meta.pk_attr) is None and cls._meta.pk_attr in cls._meta.uuid_fields:
            payload[cls._meta.pk_attr] = uuid.uuid4()

        return payload

    @classmethod
    def _to_db_value(cls, attr: str, value: Any) -> Any:
        if isinstance(value, BaseModel):
            value = getattr(value, value._meta.pk_attr)

        if value is None:
            return None

        if attr in cls._meta.json_fields:
            if isinstance(value, str):
                return value
            return json.dumps(value, ensure_ascii=False)

        if attr in cls._meta.uuid_fields and isinstance(value, uuid.UUID):
            return str(value)

        if attr in cls._meta.datetime_fields and isinstance(value, datetime):
            return _normalize_datetime(value)

        return value

    @classmethod
    def _from_db_value(cls, attr: str, value: Any) -> Any:
        if value is None:
            return None

        if attr in cls._meta.json_fields:
            if isinstance(value, (dict, list)):
                return value
            if isinstance(value, str):
                try:
                    return json.loads(value)
                except json.JSONDecodeError:
                    factory = cls._meta.default_factories.get(attr)
                    if factory is dict:
                        return {}
                    if factory is list:
                        return []
                    default = cls._meta.defaults.get(attr)
                    if isinstance(default, dict):
                        return {}
                    if isinstance(default, list):
                        return []
                    return value
            return value

        if attr in cls._meta.uuid_fields:
            if isinstance(value, uuid.UUID):
                return value
            return uuid.UUID(str(value))

        if attr in cls._meta.datetime_fields:
            return _normalize_datetime(value)

        return value

    @classmethod
    def _from_row(cls: type[TModel], row: dict[str, Any], *, row_uses_attr_names: bool) -> TModel:
        payload: dict[str, Any] = {}
        if row_uses_attr_names:
            for attr in cls._meta.fields:
                payload[attr] = cls._from_db_value(attr, row.get(attr))
        else:
            column_to_attr = cls._meta.column_to_attr
            for column, value in row.items():
                attr = column_to_attr.get(column)
                if attr is None:
                    continue
                payload[attr] = cls._from_db_value(attr, value)

        for attr, default in cls._meta.defaults.items():
            payload.setdefault(attr, _copy_default(default))
        for attr, factory in cls._meta.default_factories.items():
            payload.setdefault(attr, factory())

        return cls(**payload)  # type: ignore[arg-type]

    @classmethod
    async def create(cls: type[TModel], **kwargs: Any) -> TModel:
        payload = cls._normalize_create_kwargs(kwargs)
        columns = []
        params: list[Any] = []
        for attr, value in payload.items():
            if attr not in cls._meta.fields:
                continue
            columns.append(_quote_ident(cls._meta.fields[attr]))
            params.append(cls._to_db_value(attr, value))

        if columns:
            placeholders = ", ".join("?" for _ in columns)
            sql = (
                f"INSERT INTO {_quote_ident(cls._meta.table)} ({', '.join(columns)}) "
                f"VALUES ({placeholders}) RETURNING {_quote_ident(cls._meta.pk_column)} AS pk;"
            )
            row = fetch_one(sql, params)
        else:
            sql = (
                f"INSERT INTO {_quote_ident(cls._meta.table)} DEFAULT VALUES "
                f"RETURNING {_quote_ident(cls._meta.pk_column)} AS pk;"
            )
            row = fetch_one(sql)

        if row is None or row.get("pk") is None:
            raise RuntimeError(f"Failed to create {cls.__name__}")

        return await cls.get(**{cls._meta.pk_attr: row["pk"]})

    @classmethod
    async def update_or_create(
        cls: type[TModel],
        defaults: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> tuple[TModel, bool]:
        existing = await cls.get_or_none(**kwargs)
        if existing is None:
            created = await cls.create(**kwargs, **(defaults or {}))
            return created, True

        changed_fields: list[str] = []
        for key, value in (defaults or {}).items():
            setattr(existing, key, value)
            changed_fields.append(key)

        if changed_fields:
            await existing.save(update_fields=changed_fields)
        return existing, False

    @classmethod
    async def bulk_create(cls: type[TModel], objects: list[TModel]) -> None:
        for item in objects:
            payload = {
                attr: getattr(item, attr)
                for attr in cls._meta.fields
                if attr != cls._meta.pk_attr or getattr(item, attr, None) is not None
            }
            for relation_name, relation in cls._meta.relations.items():
                if payload.get(relation.fk_attr) is not None:
                    continue
                relation_obj = getattr(item, relation_name, None)
                if isinstance(relation_obj, BaseModel):
                    payload[relation.fk_attr] = getattr(
                        relation_obj,
                        relation_obj._meta.pk_attr,
                    )
            await cls.create(**payload)

    async def save(self, update_fields: list[str] | None = None) -> None:
        fields = list(update_fields or [])
        normalized_fields: list[str] = []

        for field_name in fields:
            relation = self._meta.relations.get(field_name)
            if relation is not None:
                normalized_fields.append(relation.fk_attr)
            else:
                normalized_fields.append(field_name)

        now = datetime.now(tz=UTC)
        for auto_now_field in self._meta.auto_now:
            setattr(self, auto_now_field, now)
            if update_fields is None or auto_now_field in normalized_fields or not normalized_fields:
                if auto_now_field not in normalized_fields:
                    normalized_fields.append(auto_now_field)

        if not normalized_fields:
            normalized_fields = [
                attr for attr in self._meta.fields if attr != self._meta.pk_attr
            ]

        set_parts: list[str] = []
        params: list[Any] = []
        for attr in normalized_fields:
            if attr == self._meta.pk_attr or attr not in self._meta.fields:
                continue
            column = self._meta.fields[attr]
            set_parts.append(f"{_quote_ident(column)} = ?")
            params.append(self._to_db_value(attr, getattr(self, attr)))

        if not set_parts:
            return

        params.append(self._to_db_value(self._meta.pk_attr, getattr(self, self._meta.pk_attr)))
        sql = (
            f"UPDATE {_quote_ident(self._meta.table)} SET {', '.join(set_parts)} "
            f"WHERE {_quote_ident(self._meta.pk_column)} = ?;"
        )
        fetch_all(sql, params)


@dataclass
class Paper(BaseModel):
    id: str = ""
    title: str = ""
    authors: list[Any] = field(default_factory=list)
    organization: str | None = None
    summary: str = ""
    ai_summary: str | None = None
    ai_keywords: list[Any] = field(default_factory=list)
    upvotes: int = 0
    github_repo: str | None = None
    github_stars: int | None = None
    published_at: datetime | None = None
    collected_at: datetime | None = None


@dataclass
class ScreeningRule(BaseModel):
    id: int | None = None
    rule: str = ""
    created_by: str = ""
    created_at: datetime | None = None


@dataclass
class TodoTask(BaseModel):
    id: int | None = None
    title: str = ""
    description: str = ""
    is_completed: bool = False
    created_at: datetime | None = None
    completed_at: datetime | None = None


@dataclass
class WorkflowExecution(BaseModel):
    id: uuid.UUID | None = None
    workflow_name: str = ""
    trigger_type: str = ""
    status: str = "running"
    context: dict[str, Any] = field(default_factory=dict)
    error_message: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None


@dataclass
class WorkflowStageExecution(BaseModel):
    id: uuid.UUID | None = None
    workflow_id: uuid.UUID | None = None
    stage: str = ""
    status: str = "running"
    input_payload: dict[str, Any] = field(default_factory=dict)
    output_payload: dict[str, Any] | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    workflow: WorkflowExecution | None = field(default=None, repr=False, compare=False)


@dataclass
class LLMInvocationLog(BaseModel):
    id: uuid.UUID | None = None
    provider: str = "google-genai"
    model: str = ""
    stage: str = ""
    task: str = ""
    workflow_id: uuid.UUID | None = None
    stage_execution_id: uuid.UUID | None = None
    input_payload: dict[str, Any] = field(default_factory=dict)
    output_payload: dict[str, Any] | None = None
    output_text: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    status: str = "running"
    latency_ms: int | None = None
    error_message: str | None = None
    created_at: datetime | None = None
    workflow: WorkflowExecution | None = field(default=None, repr=False, compare=False)
    stage_execution: WorkflowStageExecution | None = field(default=None, repr=False, compare=False)


@dataclass
class PaperFilteringRun(BaseModel):
    id: uuid.UUID | None = None
    trigger_type: str = ""
    status: str = "running"
    workflow_id: uuid.UUID | None = None
    stage_execution_id: uuid.UUID | None = None
    llm_invocation_id: uuid.UUID | None = None
    candidate_paper_ids: list[str] = field(default_factory=list)
    selected_paper_ids: list[str] = field(default_factory=list)
    raw_result: dict[str, Any] | None = None
    summary: str | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    workflow: WorkflowExecution | None = field(default=None, repr=False, compare=False)
    stage_execution: WorkflowStageExecution | None = field(default=None, repr=False, compare=False)
    llm_invocation: LLMInvocationLog | None = field(default=None, repr=False, compare=False)


@dataclass
class PaperFilteringDecision(BaseModel):
    id: uuid.UUID | None = None
    filtering_run_id: uuid.UUID | None = None
    paper_id: str = ""
    selected: bool = False
    reason: str | None = None
    score: float | None = None
    rank: int | None = None
    extra: dict[str, Any] = field(default_factory=dict)
    created_at: datetime | None = None
    filtering_run: PaperFilteringRun | None = field(default=None, repr=False, compare=False)
    paper: Paper | None = field(default=None, repr=False, compare=False)


@dataclass
class PaperReadingRun(BaseModel):
    id: uuid.UUID | None = None
    trigger_type: str = ""
    status: str = "running"
    workflow_id: uuid.UUID | None = None
    stage_execution_id: uuid.UUID | None = None
    source_filtering_run_id: uuid.UUID | None = None
    paper_ids: list[str] = field(default_factory=list)
    succeeded_paper_ids: list[str] = field(default_factory=list)
    failed_paper_ids: list[str] = field(default_factory=list)
    error_message: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    workflow: WorkflowExecution | None = field(default=None, repr=False, compare=False)
    stage_execution: WorkflowStageExecution | None = field(default=None, repr=False, compare=False)
    source_filtering_run: PaperFilteringRun | None = field(default=None, repr=False, compare=False)


@dataclass
class PaperReadingReport(BaseModel):
    id: uuid.UUID | None = None
    reading_run_id: uuid.UUID | None = None
    paper_id: str = ""
    llm_invocation_stage1_id: uuid.UUID | None = None
    llm_invocation_stage2_id: uuid.UUID | None = None
    status: str = "succeeded"
    stage1_overview: str = ""
    stage1_outline: list[Any] = field(default_factory=list)
    stage1_questions: list[Any] = field(default_factory=list)
    overview: str = ""
    method_details: str = ""
    experiment_analysis: str = ""
    qa_answers: str = ""
    review: str = ""
    related_readings: list[Any] = field(default_factory=list)
    full_report: str = ""
    comment: str = ""
    created_at: datetime | None = None
    updated_at: datetime | None = None
    reading_run: PaperReadingRun | None = field(default=None, repr=False, compare=False)
    paper: Paper | None = field(default=None, repr=False, compare=False)
    llm_invocation_stage1: LLMInvocationLog | None = field(default=None, repr=False, compare=False)
    llm_invocation_stage2: LLMInvocationLog | None = field(default=None, repr=False, compare=False)


@dataclass
class KnowledgeQuestion(BaseModel):
    id: uuid.UUID | None = None
    question: str = ""
    fingerprint: str = ""
    embedding: list[float] = field(default_factory=list)
    embedding_model: str = ""
    created_by: str = ""
    created_at: datetime | None = None
    updated_at: datetime | None = None
    solutions: list[KnowledgeSolution] = field(default_factory=list, repr=False, compare=False)


@dataclass
class KnowledgeSolution(BaseModel):
    id: uuid.UUID | None = None
    question_id: uuid.UUID | None = None
    paper_id: str = ""
    report_id: uuid.UUID | None = None
    method_summary: str = ""
    effect_summary: str = ""
    limitations: str = ""
    created_at: datetime | None = None
    updated_at: datetime | None = None
    question: KnowledgeQuestion | None = field(default=None, repr=False, compare=False)
    paper: Paper | None = field(default=None, repr=False, compare=False)
    report: PaperReadingReport | None = field(default=None, repr=False, compare=False)


@dataclass
class KnowledgeExtractionRun(BaseModel):
    id: uuid.UUID | None = None
    report_id: uuid.UUID | None = None
    status: str = "running"
    attempt_count: int = 1
    question_ids: list[str] = field(default_factory=list)
    raw_candidates_xml: str | None = None
    raw_final_xml: str | None = None
    error_message: str | None = None
    llm_invocation_stage1_id: uuid.UUID | None = None
    llm_invocation_stage2_id: uuid.UUID | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    updated_at: datetime | None = None
    report: PaperReadingReport | None = field(default=None, repr=False, compare=False)
    llm_invocation_stage1: LLMInvocationLog | None = field(default=None, repr=False, compare=False)
    llm_invocation_stage2: LLMInvocationLog | None = field(default=None, repr=False, compare=False)


@dataclass
class KnowledgeNote(BaseModel):
    id: uuid.UUID | None = None
    title: str = ""
    content_json: dict[str, Any] = field(default_factory=dict)
    plain_text: str = ""
    created_by: str = "user"
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass
class KnowledgeNoteLink(BaseModel):
    id: uuid.UUID | None = None
    source_note_id: uuid.UUID | None = None
    target_type: str = ""
    target_id: str = ""
    target_label: str | None = None
    created_at: datetime | None = None
    source_note: KnowledgeNote | None = field(default=None, repr=False, compare=False)


@dataclass
class RuntimeSetting(BaseModel):
    key: str = ""
    value: str = ""
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass
class DailyWorkReport(BaseModel):
    id: uuid.UUID | None = None
    workflow_id: uuid.UUID | None = None
    business_date: str = ""
    source_date: str = ""
    status: str = "succeeded"
    source_markdown: str = ""
    activity_summary: dict[str, Any] = field(default_factory=dict)
    report_markdown: str = ""
    error_message: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    workflow: WorkflowExecution | None = field(default=None, repr=False, compare=False)


@dataclass
class DailyWorkNoteSnapshot(BaseModel):
    id: uuid.UUID | None = None
    note_id: uuid.UUID | None = None
    snapshot_markdown: str = ""
    note_updated_at: datetime | None = None
    snapshot_updated_at: datetime | None = None
    created_at: datetime | None = None
    note: KnowledgeNote | None = field(default=None, repr=False, compare=False)


Paper._meta = ModelMeta(
    table="papers",
    pk_attr="id",
    fields={
        "id": "id",
        "title": "title",
        "authors": "authors",
        "organization": "organization",
        "summary": "summary",
        "ai_summary": "ai_summary",
        "ai_keywords": "ai_keywords",
        "upvotes": "upvotes",
        "github_repo": "githubRepo",
        "github_stars": "githubStars",
        "published_at": "publishedAt",
        "collected_at": "collectedAt",
    },
    json_fields={"authors", "ai_keywords"},
    datetime_fields={"published_at", "collected_at"},
    default_factories={"authors": list, "ai_keywords": list},
    auto_now_add={"collected_at"},
    ordering=["-collected_at"],
)

ScreeningRule._meta = ModelMeta(
    table="screening_rules",
    pk_attr="id",
    fields={
        "id": "id",
        "rule": "rule",
        "created_by": "createdBy",
        "created_at": "createdAt",
    },
    datetime_fields={"created_at"},
    auto_now_add={"created_at"},
    ordering=["-created_at", "-id"],
)

TodoTask._meta = ModelMeta(
    table="todo_tasks",
    pk_attr="id",
    fields={
        "id": "id",
        "title": "title",
        "description": "description",
        "is_completed": "isCompleted",
        "created_at": "createdAt",
        "completed_at": "completedAt",
    },
    datetime_fields={"created_at", "completed_at"},
    defaults={"is_completed": False},
    auto_now_add={"created_at"},
    ordering=["is_completed", "-created_at", "-id"],
)

WorkflowExecution._meta = ModelMeta(
    table="workflow_executions",
    pk_attr="id",
    fields={
        "id": "id",
        "workflow_name": "workflowName",
        "trigger_type": "triggerType",
        "status": "status",
        "context": "context",
        "error_message": "errorMessage",
        "started_at": "startedAt",
        "finished_at": "finishedAt",
    },
    json_fields={"context"},
    uuid_fields={"id"},
    datetime_fields={"started_at", "finished_at"},
    default_factories={"context": dict},
    defaults={"status": "running"},
    auto_now_add={"started_at"},
    ordering=["-started_at"],
)

WorkflowStageExecution._meta = ModelMeta(
    table="workflow_stage_executions",
    pk_attr="id",
    fields={
        "id": "id",
        "workflow_id": "workflowId",
        "stage": "stage",
        "status": "status",
        "input_payload": "inputPayload",
        "output_payload": "outputPayload",
        "error_message": "errorMessage",
        "started_at": "startedAt",
        "finished_at": "finishedAt",
    },
    relations={
        "workflow": RelationSpec(
            name="workflow",
            target="WorkflowExecution",
            fk_attr="workflow_id",
            fk_column="workflowId",
            related_name="stages",
        )
    },
    json_fields={"input_payload", "output_payload"},
    uuid_fields={"id", "workflow_id"},
    datetime_fields={"started_at", "finished_at"},
    defaults={"status": "running"},
    default_factories={"input_payload": dict},
    auto_now_add={"started_at"},
    ordering=["-started_at"],
)

LLMInvocationLog._meta = ModelMeta(
    table="llm_invocation_logs",
    pk_attr="id",
    fields={
        "id": "id",
        "provider": "provider",
        "model": "model",
        "stage": "stage",
        "task": "task",
        "workflow_id": "workflowId",
        "stage_execution_id": "stageExecutionId",
        "input_payload": "inputPayload",
        "output_payload": "outputPayload",
        "output_text": "outputText",
        "metadata": "metadata",
        "status": "status",
        "latency_ms": "latencyMs",
        "error_message": "errorMessage",
        "created_at": "createdAt",
    },
    relations={
        "workflow": RelationSpec(
            name="workflow",
            target="WorkflowExecution",
            fk_attr="workflow_id",
            fk_column="workflowId",
            related_name="llm_invocations",
        ),
        "stage_execution": RelationSpec(
            name="stage_execution",
            target="WorkflowStageExecution",
            fk_attr="stage_execution_id",
            fk_column="stageExecutionId",
            related_name="llm_invocations",
        ),
    },
    json_fields={"input_payload", "output_payload", "metadata"},
    uuid_fields={"id", "workflow_id", "stage_execution_id"},
    datetime_fields={"created_at"},
    defaults={"provider": "google-genai", "status": "running"},
    default_factories={"metadata": dict, "input_payload": dict},
    auto_now_add={"created_at"},
    ordering=["-created_at"],
)

PaperFilteringRun._meta = ModelMeta(
    table="paper_filtering_runs",
    pk_attr="id",
    fields={
        "id": "id",
        "trigger_type": "triggerType",
        "status": "status",
        "workflow_id": "workflowId",
        "stage_execution_id": "stageExecutionId",
        "llm_invocation_id": "llmInvocationId",
        "candidate_paper_ids": "candidatePaperIds",
        "selected_paper_ids": "selectedPaperIds",
        "raw_result": "rawResult",
        "summary": "summary",
        "error_message": "errorMessage",
        "started_at": "startedAt",
        "finished_at": "finishedAt",
    },
    relations={
        "workflow": RelationSpec(
            name="workflow",
            target="WorkflowExecution",
            fk_attr="workflow_id",
            fk_column="workflowId",
            related_name="filtering_runs",
        ),
        "stage_execution": RelationSpec(
            name="stage_execution",
            target="WorkflowStageExecution",
            fk_attr="stage_execution_id",
            fk_column="stageExecutionId",
            related_name="filtering_runs",
        ),
        "llm_invocation": RelationSpec(
            name="llm_invocation",
            target="LLMInvocationLog",
            fk_attr="llm_invocation_id",
            fk_column="llmInvocationId",
            related_name="filtering_runs",
        ),
    },
    json_fields={"candidate_paper_ids", "selected_paper_ids", "raw_result"},
    uuid_fields={"id", "workflow_id", "stage_execution_id", "llm_invocation_id"},
    datetime_fields={"started_at", "finished_at"},
    defaults={"status": "running"},
    default_factories={"candidate_paper_ids": list, "selected_paper_ids": list},
    auto_now_add={"started_at"},
    ordering=["-started_at"],
)

PaperFilteringDecision._meta = ModelMeta(
    table="paper_filtering_decisions",
    pk_attr="id",
    fields={
        "id": "id",
        "filtering_run_id": "filtering_run_id",
        "paper_id": "paper_id",
        "selected": "selected",
        "reason": "reason",
        "score": "score",
        "rank": "rank",
        "extra": "extra",
        "created_at": "createdAt",
    },
    relations={
        "filtering_run": RelationSpec(
            name="filtering_run",
            target="PaperFilteringRun",
            fk_attr="filtering_run_id",
            fk_column="filtering_run_id",
            related_name="decisions",
        ),
        "paper": RelationSpec(
            name="paper",
            target="Paper",
            fk_attr="paper_id",
            fk_column="paper_id",
            related_name="filtering_decisions",
        ),
    },
    json_fields={"extra"},
    uuid_fields={"id", "filtering_run_id"},
    datetime_fields={"created_at"},
    defaults={"selected": False},
    default_factories={"extra": dict},
    auto_now_add={"created_at"},
    ordering=["rank", "-score", "-created_at"],
)

PaperReadingRun._meta = ModelMeta(
    table="paper_reading_runs",
    pk_attr="id",
    fields={
        "id": "id",
        "trigger_type": "triggerType",
        "status": "status",
        "workflow_id": "workflow_id",
        "stage_execution_id": "stage_execution_id",
        "source_filtering_run_id": "sourceFilteringRunId",
        "paper_ids": "paperIds",
        "succeeded_paper_ids": "succeededPaperIds",
        "failed_paper_ids": "failedPaperIds",
        "error_message": "errorMessage",
        "started_at": "startedAt",
        "finished_at": "finishedAt",
    },
    relations={
        "workflow": RelationSpec(
            name="workflow",
            target="WorkflowExecution",
            fk_attr="workflow_id",
            fk_column="workflow_id",
            related_name="reading_runs",
        ),
        "stage_execution": RelationSpec(
            name="stage_execution",
            target="WorkflowStageExecution",
            fk_attr="stage_execution_id",
            fk_column="stage_execution_id",
            related_name="reading_runs",
        ),
        "source_filtering_run": RelationSpec(
            name="source_filtering_run",
            target="PaperFilteringRun",
            fk_attr="source_filtering_run_id",
            fk_column="sourceFilteringRunId",
            related_name="reading_runs",
        ),
    },
    json_fields={"paper_ids", "succeeded_paper_ids", "failed_paper_ids"},
    uuid_fields={"id", "workflow_id", "stage_execution_id", "source_filtering_run_id"},
    datetime_fields={"started_at", "finished_at"},
    defaults={"status": "running"},
    default_factories={"paper_ids": list, "succeeded_paper_ids": list, "failed_paper_ids": list},
    auto_now_add={"started_at"},
    ordering=["-started_at"],
)

PaperReadingReport._meta = ModelMeta(
    table="paper_reading_reports",
    pk_attr="id",
    fields={
        "id": "id",
        "reading_run_id": "reading_run_id",
        "paper_id": "paper_id",
        "llm_invocation_stage1_id": "llmInvocationStage1Id",
        "llm_invocation_stage2_id": "llmInvocationStage2Id",
        "status": "status",
        "stage1_overview": "stage1Overview",
        "stage1_outline": "stage1Outline",
        "stage1_questions": "stage1Questions",
        "overview": "overview",
        "method_details": "methodDetails",
        "experiment_analysis": "experimentAnalysis",
        "qa_answers": "qaAnswers",
        "review": "review",
        "related_readings": "relatedReadings",
        "full_report": "fullReport",
        "comment": "comment",
        "created_at": "createdAt",
        "updated_at": "updatedAt",
    },
    relations={
        "reading_run": RelationSpec(
            name="reading_run",
            target="PaperReadingRun",
            fk_attr="reading_run_id",
            fk_column="reading_run_id",
            related_name="reports",
        ),
        "paper": RelationSpec(
            name="paper",
            target="Paper",
            fk_attr="paper_id",
            fk_column="paper_id",
            related_name="reading_reports",
        ),
        "llm_invocation_stage1": RelationSpec(
            name="llm_invocation_stage1",
            target="LLMInvocationLog",
            fk_attr="llm_invocation_stage1_id",
            fk_column="llmInvocationStage1Id",
            related_name="reading_reports_stage1",
        ),
        "llm_invocation_stage2": RelationSpec(
            name="llm_invocation_stage2",
            target="LLMInvocationLog",
            fk_attr="llm_invocation_stage2_id",
            fk_column="llmInvocationStage2Id",
            related_name="reading_reports_stage2",
        ),
    },
    json_fields={"stage1_outline", "stage1_questions", "related_readings"},
    uuid_fields={"id", "reading_run_id", "llm_invocation_stage1_id", "llm_invocation_stage2_id"},
    datetime_fields={"created_at", "updated_at"},
    defaults={
        "status": "succeeded",
        "stage1_overview": "",
        "overview": "",
        "method_details": "",
        "experiment_analysis": "",
        "qa_answers": "",
        "review": "",
        "full_report": "",
        "comment": "",
    },
    default_factories={"stage1_outline": list, "stage1_questions": list, "related_readings": list},
    auto_now_add={"created_at"},
    auto_now={"updated_at"},
    ordering=["-created_at"],
)

KnowledgeQuestion._meta = ModelMeta(
    table="knowledge_questions",
    pk_attr="id",
    fields={
        "id": "id",
        "question": "question",
        "fingerprint": "fingerprint",
        "embedding": "embedding",
        "embedding_model": "embeddingModel",
        "created_by": "createdBy",
        "created_at": "createdAt",
        "updated_at": "updatedAt",
    },
    json_fields={"embedding"},
    uuid_fields={"id"},
    datetime_fields={"created_at", "updated_at"},
    default_factories={"embedding": list},
    auto_now_add={"created_at"},
    auto_now={"updated_at"},
    ordering=["-updated_at", "-created_at"],
)

KnowledgeSolution._meta = ModelMeta(
    table="knowledge_solutions",
    pk_attr="id",
    fields={
        "id": "id",
        "question_id": "question_id",
        "paper_id": "paper_id",
        "report_id": "report_id",
        "method_summary": "methodSummary",
        "effect_summary": "effectSummary",
        "limitations": "limitations",
        "created_at": "createdAt",
        "updated_at": "updatedAt",
    },
    relations={
        "question": RelationSpec(
            name="question",
            target="KnowledgeQuestion",
            fk_attr="question_id",
            fk_column="question_id",
            related_name="solutions",
        ),
        "paper": RelationSpec(
            name="paper",
            target="Paper",
            fk_attr="paper_id",
            fk_column="paper_id",
            related_name="knowledge_solutions",
        ),
        "report": RelationSpec(
            name="report",
            target="PaperReadingReport",
            fk_attr="report_id",
            fk_column="report_id",
            related_name="knowledge_solutions",
        ),
    },
    uuid_fields={"id", "question_id", "report_id"},
    datetime_fields={"created_at", "updated_at"},
    auto_now_add={"created_at"},
    auto_now={"updated_at"},
    ordering=["-updated_at", "-created_at"],
)

KnowledgeExtractionRun._meta = ModelMeta(
    table="knowledge_extraction_runs",
    pk_attr="id",
    fields={
        "id": "id",
        "report_id": "report_id",
        "status": "status",
        "attempt_count": "attemptCount",
        "question_ids": "questionIds",
        "raw_candidates_xml": "rawCandidatesXml",
        "raw_final_xml": "rawFinalXml",
        "error_message": "errorMessage",
        "llm_invocation_stage1_id": "llm_invocation_stage1_id",
        "llm_invocation_stage2_id": "llm_invocation_stage2_id",
        "started_at": "startedAt",
        "finished_at": "finishedAt",
        "updated_at": "updatedAt",
    },
    relations={
        "report": RelationSpec(
            name="report",
            target="PaperReadingReport",
            fk_attr="report_id",
            fk_column="report_id",
            related_name="knowledge_extraction_run",
        ),
        "llm_invocation_stage1": RelationSpec(
            name="llm_invocation_stage1",
            target="LLMInvocationLog",
            fk_attr="llm_invocation_stage1_id",
            fk_column="llm_invocation_stage1_id",
            related_name="knowledge_extraction_runs_stage1",
        ),
        "llm_invocation_stage2": RelationSpec(
            name="llm_invocation_stage2",
            target="LLMInvocationLog",
            fk_attr="llm_invocation_stage2_id",
            fk_column="llm_invocation_stage2_id",
            related_name="knowledge_extraction_runs_stage2",
        ),
    },
    json_fields={"question_ids"},
    uuid_fields={"id", "report_id", "llm_invocation_stage1_id", "llm_invocation_stage2_id"},
    datetime_fields={"started_at", "finished_at", "updated_at"},
    default_factories={"question_ids": list},
    defaults={"status": "running", "attempt_count": 1},
    auto_now_add={"started_at"},
    auto_now={"updated_at"},
    ordering=["-updated_at", "-started_at"],
)

KnowledgeNote._meta = ModelMeta(
    table="knowledge_notes",
    pk_attr="id",
    fields={
        "id": "id",
        "title": "title",
        "content_json": "content_json",
        "plain_text": "plain_text",
        "created_by": "created_by",
        "created_at": "created_at",
        "updated_at": "updated_at",
    },
    json_fields={"content_json"},
    uuid_fields={"id"},
    datetime_fields={"created_at", "updated_at"},
    default_factories={"content_json": dict},
    defaults={"plain_text": "", "created_by": "user"},
    auto_now_add={"created_at"},
    auto_now={"updated_at"},
    ordering=["-updated_at", "-created_at"],
)

KnowledgeNoteLink._meta = ModelMeta(
    table="knowledge_note_links",
    pk_attr="id",
    fields={
        "id": "id",
        "source_note_id": "source_note_id",
        "target_type": "target_type",
        "target_id": "target_id",
        "target_label": "target_label",
        "created_at": "created_at",
    },
    relations={
        "source_note": RelationSpec(
            name="source_note",
            target="KnowledgeNote",
            fk_attr="source_note_id",
            fk_column="source_note_id",
            related_name="links",
        )
    },
    uuid_fields={"id", "source_note_id"},
    datetime_fields={"created_at"},
    auto_now_add={"created_at"},
    ordering=["-created_at"],
)

RuntimeSetting._meta = ModelMeta(
    table="runtime_settings",
    pk_attr="key",
    fields={
        "key": "key",
        "value": "value",
        "created_at": "createdAt",
        "updated_at": "updatedAt",
    },
    datetime_fields={"created_at", "updated_at"},
    defaults={"value": ""},
    auto_now_add={"created_at"},
    auto_now={"updated_at"},
    ordering=["key"],
)

DailyWorkReport._meta = ModelMeta(
    table="daily_work_reports",
    pk_attr="id",
    fields={
        "id": "id",
        "workflow_id": "workflowId",
        "business_date": "businessDate",
        "source_date": "sourceDate",
        "status": "status",
        "source_markdown": "sourceMarkdown",
        "activity_summary": "activitySummary",
        "report_markdown": "reportMarkdown",
        "error_message": "errorMessage",
        "created_at": "createdAt",
        "updated_at": "updatedAt",
    },
    relations={
        "workflow": RelationSpec(
            name="workflow",
            target="WorkflowExecution",
            fk_attr="workflow_id",
            fk_column="workflowId",
            related_name="daily_work_reports",
        )
    },
    json_fields={"activity_summary"},
    uuid_fields={"id", "workflow_id"},
    datetime_fields={"created_at", "updated_at"},
    default_factories={"activity_summary": dict},
    defaults={"status": "succeeded", "source_markdown": "", "report_markdown": ""},
    auto_now_add={"created_at"},
    auto_now={"updated_at"},
    ordering=["-business_date", "-updated_at"],
)

DailyWorkNoteSnapshot._meta = ModelMeta(
    table="daily_work_note_snapshots",
    pk_attr="id",
    fields={
        "id": "id",
        "note_id": "noteId",
        "snapshot_markdown": "snapshotMarkdown",
        "note_updated_at": "noteUpdatedAt",
        "snapshot_updated_at": "snapshotUpdatedAt",
        "created_at": "createdAt",
    },
    relations={
        "note": RelationSpec(
            name="note",
            target="KnowledgeNote",
            fk_attr="note_id",
            fk_column="noteId",
            related_name="daily_work_snapshot",
        )
    },
    uuid_fields={"id", "note_id"},
    datetime_fields={"note_updated_at", "snapshot_updated_at", "created_at"},
    defaults={"snapshot_markdown": ""},
    auto_now_add={"created_at"},
    auto_now={"snapshot_updated_at"},
    ordering=["-snapshot_updated_at", "-created_at"],
)


def _register_models() -> None:
    for model in [
        Paper,
        ScreeningRule,
        TodoTask,
        WorkflowExecution,
        WorkflowStageExecution,
        LLMInvocationLog,
        PaperFilteringRun,
        PaperFilteringDecision,
        PaperReadingRun,
        PaperReadingReport,
        KnowledgeQuestion,
        KnowledgeSolution,
        KnowledgeExtractionRun,
        KnowledgeNote,
        KnowledgeNoteLink,
        RuntimeSetting,
        DailyWorkReport,
        DailyWorkNoteSnapshot,
    ]:
        _MODEL_REGISTRY[model.__name__] = model


def _bind_reverse_relations() -> None:
    for model in _MODEL_REGISTRY.values():
        model._meta.reverse_relations = {}

    for model in _MODEL_REGISTRY.values():
        for relation in model._meta.relations.values():
            if not relation.related_name:
                continue
            target_model = _MODEL_REGISTRY[relation.target]
            target_model._meta.reverse_relations[relation.related_name] = ReverseRelationSpec(
                name=relation.related_name,
                source_model=model.__name__,
                fk_attr=relation.fk_attr,
            )


_register_models()
_bind_reverse_relations()


def list_registered_models() -> list[type[BaseModel]]:
    return list(_MODEL_REGISTRY.values())
