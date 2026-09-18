"""Anthropic Messages API."""
import requests

from .base import LLMError, LLMProvider, LLMResult, ToolCall

API = "https://api.anthropic.com/v1/messages"
VERSION = "2023-06-01"


class Anthropic(LLMProvider):
    name = "anthropic"

    def supports_tools(self) -> bool:
        return True

    @staticmethod
    def _convert(messages):
        out = []
        for m in messages:
            if m["role"] == "tool":
                out.append({"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": m.get("tool_call_id"),
                     "content": m.get("content", "")}]})
            elif m["role"] == "assistant" and m.get("tool_calls"):
                content = []
                if m.get("content"):
                    content.append({"type": "text", "text": m["content"]})
                for c in m["tool_calls"]:
                    content.append({"type": "tool_use", "id": c["id"],
                                    "name": c["name"], "input": c["arguments"]})
                out.append({"role": "assistant", "content": content})
            else:
                out.append({"role": m["role"], "content": m.get("content", "")})
        # Anthropic requires the first message to be from the user
        while out and out[0]["role"] != "user":
            out[0]["content"] = out[0].get("content", "")
            out[0] = {"role": "user", "content": out[0]["content"] or "(continue)"}
        return out

    def chat(self, system, messages, tools=None, temperature=0.4,
             max_tokens=1200, api_key=None, model="") -> LLMResult:
        if not api_key:
            raise LLMError("No Anthropic API key configured. Add one in Admin → API Settings.", "no_key")
        if not model:
            raise LLMError("No model selected. Choose one in Admin → Settings.", "no_model")
        body = {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "system": system,
            "messages": self._convert(messages),
        }
        if tools:
            body["tools"] = [{"name": t.name, "description": t.description,
                              "input_schema": t.parameters} for t in tools]
        try:
            r = requests.post(API, json=body, timeout=180, headers={
                "x-api-key": api_key, "anthropic-version": VERSION,
                "content-type": "application/json"})
        except requests.RequestException as e:
            raise LLMError("Could not reach the Anthropic API (network error). Try again.", "network") from e

        if r.status_code == 401:
            raise LLMError("Anthropic rejected the API key (401). Check it in Admin → API Settings.", "auth")
        if r.status_code == 429:
            raise LLMError("Anthropic rate limit hit (429). Wait a moment and retry.", "rate_limit")
        if r.status_code >= 500:
            raise LLMError("Anthropic returned a server error. Try again in a moment.", "provider")
        if r.status_code != 200:
            raise LLMError(f"Anthropic API error (HTTP {r.status_code}). Please try again.", "provider")
        data = r.json()
        text, tool_calls = "", []
        for block in data.get("content", []):
            if block.get("type") == "text":
                text += block.get("text", "")
            elif block.get("type") == "tool_use":
                tool_calls.append(ToolCall(id=block.get("id", "tc"), name=block.get("name", ""),
                                           arguments=block.get("input") or {}))
        usage = data.get("usage") or {}
        return LLMResult(content=text, tool_calls=tool_calls,
                         tokens_in=usage.get("input_tokens", 0),
                         tokens_out=usage.get("output_tokens", 0),
                         model=data.get("model", model))

    def health(self, api_key=None) -> tuple:
        if not api_key:
            return False, "No API key configured"
        try:
            r = requests.get("https://api.anthropic.com/v1/models", timeout=15,
                             headers={"x-api-key": api_key, "anthropic-version": VERSION})
            return (True, "Connected") if r.status_code == 200 else (False, f"HTTP {r.status_code}")
        except requests.RequestException as e:
            return False, f"Network error: {e.__class__.__name__}"
