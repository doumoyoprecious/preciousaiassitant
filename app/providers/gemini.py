"""Google Gemini generateContent API."""
import requests

from .base import LLMError, LLMProvider, LLMResult, ToolCall

BASE = "https://generativelanguage.googleapis.com/v1beta"


class Gemini(LLMProvider):
    name = "gemini"

    def supports_tools(self) -> bool:
        return True

    @staticmethod
    def _convert(messages):
        out = []
        for m in messages:
            role = "model" if m["role"] == "assistant" else "user"
            if m["role"] == "tool":
                out.append({"role": "user", "parts": [
                    {"functionResponse": {"name": m.get("name", "tool"),
                                          "response": {"result": m.get("content", "")}}}]})
                continue
            parts = []
            if m.get("content"):
                parts.append({"text": m["content"]})
            for c in m.get("tool_calls") or []:
                parts.append({"functionCall": {"name": c["name"], "args": c["arguments"]}})
            if parts:
                out.append({"role": role, "parts": parts})
        while out and out[0]["role"] != "user":
            out[0]["role"] = "user"
        return out

    def chat(self, system, messages, tools=None, temperature=0.4,
             max_tokens=1200, api_key=None, model="") -> LLMResult:
        if not api_key:
            raise LLMError("No Google AI (Gemini) API key configured. Add one in Admin → API Settings.", "no_key")
        if not model:
            raise LLMError("No model selected. Choose one in Admin → Settings.", "no_model")
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": self._convert(messages),
            "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens},
        }
        if tools:
            body["tools"] = [{"functionDeclarations": [
                {"name": t.name, "description": t.description, "parameters": t.parameters}
                for t in tools]}]
        url = f"{BASE}/models/{model}:generateContent"
        try:
            r = requests.post(url, json=body, params={"key": api_key}, timeout=180)
        except requests.RequestException as e:
            raise LLMError("Could not reach the Gemini API (network error). Try again.", "network") from e

        if r.status_code in (400, 401, 403) and "API key" in r.text:
            raise LLMError("Google rejected the API key. Check it in Admin → API Settings.", "auth")
        if r.status_code == 429:
            raise LLMError("Gemini rate limit hit (429). Wait a moment and retry.", "rate_limit")
        if r.status_code >= 500:
            raise LLMError("Gemini returned a server error. Try again in a moment.", "provider")
        if r.status_code != 200:
            raise LLMError(f"Gemini API error (HTTP {r.status_code}). Please try again.", "provider")
        data = r.json()
        cand = (data.get("candidates") or [{}])[0]
        parts = (cand.get("content") or {}).get("parts") or []
        text, tool_calls = "", []
        for p in parts:
            if p.get("text"):
                text += p["text"]
            if p.get("functionCall"):
                fc = p["functionCall"]
                tool_calls.append(ToolCall(id=f"fc{len(tool_calls)}", name=fc.get("name", ""),
                                           arguments=fc.get("args") or {}))
        usage = data.get("usageMetadata") or {}
        return LLMResult(content=text, tool_calls=tool_calls,
                         tokens_in=usage.get("promptTokenCount", 0),
                         tokens_out=usage.get("candidatesTokenCount", 0),
                         model=model)

    def health(self, api_key=None) -> tuple:
        if not api_key:
            return False, "No API key configured"
        try:
            r = requests.get(f"{BASE}/models", params={"key": api_key, "pageSize": 1}, timeout=15)
            return (True, "Connected") if r.status_code == 200 else (False, f"HTTP {r.status_code}")
        except requests.RequestException as e:
            return False, f"Network error: {e.__class__.__name__}"
