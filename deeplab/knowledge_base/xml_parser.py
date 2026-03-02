import re
import xml.etree.ElementTree as ET
import uuid
from html import escape
from typing import Any
import json


def _extract_xml_block(text: str, root_tag: str) -> str:
    pattern = rf"<{root_tag}\b[^>]*>[\s\S]*?</{root_tag}>"
    match = re.search(pattern, text, flags=re.IGNORECASE)
    if not match:
        raise ValueError(f"模型输出缺少 <{root_tag}> 根标签。")
    return match.group(0).strip()


def _parse_xml_root(text: str, expected_root: str) -> ET.Element:
    block = _extract_xml_block(text, expected_root)
    try:
        root = ET.fromstring(block)
    except ET.ParseError as exc:
        raise ValueError(f"{expected_root} XML 解析失败: {exc}") from exc
    if root.tag.strip().lower() != expected_root.lower():
        raise ValueError(f"根标签必须为 <{expected_root}>。")
    return root


def _node_text(node: ET.Element | None) -> str:
    if node is None:
        return ""
    return "".join(node.itertext()).strip()


def parse_question_candidates(
    text: str,
    *,
    min_items: int = 1,
    max_items: int = 10,
) -> tuple[list[str], str]:
    root = _parse_xml_root(text, "question_candidates")

    questions: list[str] = []
    seen: set[str] = set()
    for node in root.findall("./question"):
        value = _node_text(node)
        if not value:
            continue
        if value in seen:
            continue
        seen.add(value)
        questions.append(value)
        if len(questions) >= max_items:
            break

    if len(questions) < min_items:
        raise ValueError("候选问题数量不足，无法继续知识提炼。")
    return questions, ET.tostring(root, encoding="unicode")


def parse_final_question_set(
    text: str,
    *,
    min_items: int = 1,
    max_items: int = 8,
) -> tuple[list[dict[str, str]], str]:
    root = _parse_xml_root(text, "final_question_set")

    parsed: list[dict[str, str]] = []
    for node in root.findall("./question"):
        action = _node_text(node.find("./action")).lower()
        target_question_id = _node_text(node.find("./target_question_id"))
        question_text = _node_text(node.find("./text"))
        method_summary = _node_text(node.find("./method_summary"))
        effect_summary = _node_text(node.find("./effect_summary"))
        limitations = _node_text(node.find("./limitations"))

        if action not in {"reuse", "create"}:
            raise ValueError("final_question_set 中 action 必须是 reuse 或 create。")
        if action == "reuse" and not target_question_id:
            raise ValueError("action=reuse 时必须提供 target_question_id。")
        if action == "reuse":
            try:
                uuid.UUID(target_question_id)
            except ValueError as exc:
                raise ValueError("target_question_id 必须是合法 UUID。") from exc
        if not question_text:
            raise ValueError("final_question_set 中 text 不能为空。")
        if not method_summary:
            raise ValueError("final_question_set 中 method_summary 不能为空。")
        if not effect_summary:
            raise ValueError("final_question_set 中 effect_summary 不能为空。")
        if not limitations:
            raise ValueError("final_question_set 中 limitations 不能为空。")

        parsed.append(
            {
                "action": action,
                "target_question_id": target_question_id,
                "text": question_text,
                "method_summary": method_summary,
                "effect_summary": effect_summary,
                "limitations": limitations,
            }
        )
        if len(parsed) >= max_items:
            break

    if len(parsed) < min_items:
        raise ValueError("final_question_set 中没有有效 question。")
    return parsed, ET.tostring(root, encoding="unicode")


def candidates_to_xml(questions: list[str]) -> str:
    lines = ["<question_candidates>"]
    for question in questions:
        safe = str(question).strip()
        if not safe:
            continue
        lines.append(f"  <question>{escape(safe)}</question>")
    lines.append("</question_candidates>")
    return "\n".join(lines)


def recall_context_to_json_like(recall_rows: list[dict[str, Any]]) -> str:
    fragments = []
    for row in recall_rows:
        candidate = str(row.get("candidate_question", "")).strip()
        recalls = row.get("retrieved", [])
        if not isinstance(recalls, list):
            recalls = []
        snippets = []
        for item in recalls:
            if not isinstance(item, dict):
                continue
            snippets.append(
                {
                    "id": str(item.get("id", "")),
                    "question": str(item.get("question", "")),
                    "score": round(float(item.get("score", 0)), 6),
                }
            )
        fragments.append({"candidate_question": candidate, "retrieved": snippets})
    return json.dumps(fragments, ensure_ascii=False, indent=2)
