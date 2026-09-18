"""Tool framework.

Tools are registered in the DB (tools_registry) so the owner can enable/disable
them from Admin without code changes. Adding a new tool:
  1. add a handler function below,  2. add a row in tools_registry.

Safety: every tool must be non-destructive. Destructive capabilities (deleting
data, sending messages) are NOT tools — they are explicit, confirmed admin/user
actions in the UI. The `confirm_required` convention is reserved for the future.
"""
import ast
import datetime
import json
import operator
import re
import time

from .. import db
from ..providers.base import ToolSpec
from ..rag import embedder, store

OPS = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
    ast.Div: operator.truediv, ast.Pow: operator.pow, ast.Mod: operator.mod,
    ast.FloorDiv: operator.floordiv, ast.USub: operator.neg, ast.UAdd: operator.pos,
}


def _calc(expr: str) -> str:
    try:
        tree = ast.parse(expr or "", mode="eval")

        def ev(n):
            if isinstance(n, ast.Expression):
                return ev(n.body)
            if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)):
                return n.value
            if isinstance(n, ast.BinOp) and type(n.op) in OPS:
                return OPS[type(n.op)](ev(n.left), ev(n.right))
            if isinstance(n, ast.UnaryOp) and type(n.op) in OPS:
                return OPS[type(n.op)](ev(n.operand))
            raise ValueError("unsupported expression")

        result = ev(tree)
        if isinstance(result, float) and result.is_integer():
            result = int(result)
        return str(result)
    except ZeroDivisionError:
        return "Error: division by zero"
    except Exception:
        return "Error: invalid arithmetic expression"


def _now_tool(timezone: str = None) -> str:
    tz = timezone or db.get_setting("timezone", "Africa/Lagos")
    dt = None
    try:
        from zoneinfo import ZoneInfo
        dt = datetime.datetime.now(ZoneInfo(tz))
    except Exception:
        pass
    if dt is None:
        # Lagos fallback (UTC+1, no DST)
        try:
            off = int(re.search(r"-?(\d{2})", tz).group(1)) if re.search(r"-?(\d{2})", tz) else 1
        except Exception:
            off = 1
        dt = datetime.datetime.utcnow() + datetime.timedelta(hours=off)
        tz = "UTC+1 (approx)"
    return f"{dt.strftime('%A, %d %B %Y, %H:%M:%S %Z').strip()} ({tz})"


def _kb_search(query: str = "", category: str = None) -> str:
    query = (query or "").strip()
    if not query:
        return "No query provided."
    vec = embedder.embed([query])[0]
    min_score = float(db.get_setting("rag_min_score", "0.25") or 0.25)
    results = store.search(vec, top_k=4, min_score=min_score, category=category or None)
    if not results:
        return "No relevant information found in the knowledge base."
    parts = []
    for r in results:
        loc = ""
        if r.get("page"):
            loc += f" p.{r['page']}"
        if r.get("section"):
            loc += f" — {r['section']}"
        parts.append(f"[{r['doc_name']}{loc}] (relevance {r['score']})\n{r['content']}")
    return "\n\n".join(parts)


def _list_docs(category: str = None) -> str:
    if category:
        rows = db.query("SELECT name, category, chunks FROM documents "
                        "WHERE status='ready' AND category=? ORDER BY name", (category,))
    else:
        rows = db.query("SELECT name, category, chunks FROM documents "
                        "WHERE status='ready' ORDER BY category, name")
    if not rows:
        return "The knowledge base is empty."
    lines = [f"- {r['name']} (category: {r['category']}, {r['chunks']} chunks)" for r in rows[:100]]
    return "\n".join(lines)


HANDLERS = {
    "calculator": lambda a: _calc(a.get("expression", "")),
    "get_current_datetime": lambda a: _now_tool(a.get("timezone")),
    "search_knowledge_base": lambda a: _kb_search(a.get("query", ""), a.get("category")),
    "list_knowledge_documents": lambda a: _list_docs(a.get("category")),
}


def run_tool(name: str, arguments: dict) -> str:
    handler = HANDLERS.get(name)
    if not handler:
        return f"Error: tool '{name}' is not available."
    try:
        started = time.time()
        out = handler(arguments or {})
        db.log_event("tool", detail={"tool": name, "ms": int((time.time() - started) * 1000)})
        return str(out)[:6000]
    except Exception as e:  # noqa: BLE001
        db.log_error("tool", f"Tool {name} failed", detail=f"{e!r}")
        return f"Error: the {name} tool failed to run."


def enabled_specs() -> list:
    rows = db.query("SELECT name, description, params FROM tools_registry WHERE enabled=1 "
                    "AND name IN ({})".format(",".join("?" * len(HANDLERS))), tuple(HANDLERS))
    specs = []
    for r in rows:
        try:
            params = json.loads(r["params"])
        except ValueError:
            params = {"type": "object", "properties": {}}
        specs.append(ToolSpec(name=r["name"], description=r["description"], parameters=params))
    return specs
