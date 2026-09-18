"""OpenAI-compatible chat completions API (Groq, OpenAI, OpenRouter, Ollama, ...)."""
import json

import requests

from .base import LLMError, LLMProvider, LLMResult, ToolCall


class OpenAICompat(LLMProvider):
    def __init__(self, name: str, base_url: str):
        self.name = name
        self.base_url = base_url.rstrip("/")

    def supports_tools(self) -> bool:
        return True

    @staticmethod
    def _convert(messages):
        out = []
        for m in messages:
            role = m["role"]
            if role == "tool":
                out.append({"role": "tool", "tool_call_id": m.get("tool_call_id"),
                            "content": m.get("content", "")})
            elif role == "assistant" and m.get("tool_calls"):
                out.append({"role": "assistant", "content": m.get("content") or None,
                            "tool_calls": [{"id": c["id"], "type": "function",
                                            "function": {"name": c["name"],
                                                         "arguments": json.dumps(c["arguments"])}}
                                           for c in m["tool_calls"]]})
            else:
                out.append({"role": role, "content": m.get("content", "")})
        return out

    def chat(self, system, messages, tools=None, temperature=0.4,
             max_tokens=1200, api_key=None, model="") -> LLMResult:
        if not api_key and self.name != "ollama":
            raise LLMError(
                f"No API key configured for {self.name}. Add one in Admin → API Settings "
                "(or set the "
                f"{self.name.upper()}_API_KEY environment variable).", "no_key")
        if not model:
            raise LLMError("No model selected. Choose one in Admin → Settings.", "no_model")

        payload = {
            "model": model,
            "messages": [{"role": "system", "content": system}] + self._convert(messages),
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if tools and self.supports_tools():
            payload["tools"] = [
                {"type": "function", "function": {"name": t.name, "description": t.description,
                                                  "parameters": t.parameters}}
                for t in tools
            ]
        headers = {"Content-Type": "application/json",
                   "Authorization": f"Bearer {api_key or 'ollama'}"}
        try:
            r = requests.post(f"{self.base_url}/chat/completions", json=payload,
                              headers=headers, timeout=180)
        except requests.RequestException as e:
            raise LLMError(f"Could not reach the {self.name} API (network error). "
                           "Check your connection and try again.", "network") from e

        err_body = r.text[:300] if r.status_code >= 400 else None
        if r.status_code == 401:
            raise LLMError(f"The {self.name} API rejected the API key (401). "
                           "Check it in Admin → API Settings.", "auth", detail=err_body)
        if r.status_code == 429:
            raise LLMError(f"The {self.name} rate limit was hit (429). Wait a moment and retry.", "rate_limit")
        if r.status_code >= 500:
            raise LLMError(f"The {self.name} service returned a server error ({r.status_code}). "
                           "Try again in a moment.", "provider", detail=err_body)
        if r.status_code != 200:
            raise LLMError(f"The {self.name} API returned an error (HTTP {r.status_code}). "
                           "Please try again.", "provider", detail=err_body)
        try:
            data = r.json()
        except ValueError:
            raise LLMError("The AI provider returned an unreadable response. Please try again.", "provider")

        choice = (data.get("choices") or [{}])[0].get("message") or {}
        tool_calls = []
        for c in choice.get("tool_calls") or []:
            fn = c.get("function") or {}
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except ValueError:
                args = {}
            tool_calls.append(ToolCall(id=c.get("id", "tc"), name=fn.get("name", ""), arguments=args))
        usage = data.get("usage") or {}
        return LLMResult(
            content=choice.get("content") or "",
            tool_calls=tool_calls,
            tokens_in=usage.get("prompt_tokens", 0),
            tokens_out=usage.get("completion_tokens", 0),
            model=data.get("model", model),
        )

    def health(self, api_key=None) -> tuple:
        if not api_key and self.name != "ollama":
            return False, "No API key configured"
        headers = {"Authorization": f"Bearer {api_key or 'ollama'}"}
        try:
            r = requests.get(f"{self.base_url}/models", headers=headers, timeout=15)
            if r.status_code == 200:
                return True, "Connected"
            return False, f"HTTP {r.status_code}"
        except requests.RequestException as e:
            return False, f"Network error: {e.__class__.__name__}"

    def list_models(self, api_key=None) -> list:
        if not api_key and self.name != "ollama":
            return []
        headers = {"Authorization": f"Bearer {api_key or 'ollama'}"}
        try:
            r = requests.get(f"{self.base_url}/models", headers=headers, timeout=15)
            if r.status_code != 200:
                return []
            return [m.get("id") for m in r.json().get("data", []) if m.get("id")]
        except requests.RequestException:
            return []
