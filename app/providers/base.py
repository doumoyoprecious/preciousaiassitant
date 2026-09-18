"""Provider-agnostic abstractions shared by all LLM backends.

Internal message format (dicts):
  {"role": "user"|"assistant"|"tool", "content": str,
   "tool_calls": [{"id","name","arguments"}] (assistant only),
   "tool_call_id": str, "name": str (tool results)}
"""
from dataclasses import dataclass, field


class LLMError(Exception):
    """Error with a user-safe message. Never contains stack traces or secrets."""

    def __init__(self, message, code=None):
        self.message = message
        self.code = code
        super().__init__(message)


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: dict


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict


@dataclass
class LLMResult:
    content: str = ""
    tool_calls: list = field(default_factory=list)
    tokens_in: int = 0
    tokens_out: int = 0
    model: str = ""


class LLMProvider:
    name = "base"

    def chat(self, system, messages, tools=None, temperature=0.4,
             max_tokens=1200, api_key=None, model="") -> LLMResult:
        raise NotImplementedError

    def supports_tools(self) -> bool:
        return False

    def health(self, api_key=None) -> tuple:
        return False, "Not configured"

    def list_models(self, api_key=None) -> list:
        return []
