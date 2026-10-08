"""Chat model providers: Gemini (prod) and an extractive stub (offline demo/tests)."""

from __future__ import annotations

import re
from collections.abc import AsyncIterator
from typing import Any

from langchain_core.callbacks import AsyncCallbackManagerForLLMRun, CallbackManagerForLLMRun
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult

from app.config import Settings


def message_text(content: Any) -> str:
    """Normalise LangChain message content (str or list of parts) to plain text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(p if isinstance(p, str) else p.get("text", "") for p in content if isinstance(p, (str, dict)))
    return str(content or "")


class ExtractiveStubLLM(BaseChatModel):
    """No-API stand-in: returns the top retrieved passage with a citation."""

    @property
    def _llm_type(self) -> str:
        return "extractive-stub"

    @staticmethod
    def _answer(messages: list[BaseMessage]) -> str:
        text = message_text(messages[-1].content)
        m = re.search(r"\[1\][^\n]*\n(.*?)(?=\n\n\[2\]|\n\nQuestion:|\Z)", text, re.S)
        if not m:
            return "I couldn't find that on the University of Cyberjaya website."
        body = m.group(1).strip()
        lines = body.split("\n")
        if len(lines) > 1 and lines[1] == "":  # drop "Title - heading path" prefix line
            body = "\n".join(lines[2:]).strip() or body
        if len(body) > 900:
            cut = body[:900]
            body = cut[: max(cut.rfind(". "), cut.rfind("\n"), 500) + 1]
        return f"*(Demo mode - no LLM connected; showing the most relevant passage.)*\n\n{body}\n\n[1]"

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=self._answer(messages)))])

    async def _astream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: AsyncCallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[ChatGenerationChunk]:
        for tok in re.findall(r"\S+\s*", self._answer(messages)):
            yield ChatGenerationChunk(message=AIMessageChunk(content=tok))


def get_llm(s: Settings) -> BaseChatModel:
    if s.llm_provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI

        if not s.google_api_key:
            raise RuntimeError("GOOGLE_API_KEY is required for LLM_PROVIDER=gemini")
        return ChatGoogleGenerativeAI(
            model=s.gemini_llm_model, google_api_key=s.google_api_key, temperature=0.2, max_retries=2, timeout=60
        )
    if s.llm_provider == "openai_compatible":
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=s.openai_llm_model,
            base_url=s.llm_base_url or None,
            api_key=s.llm_api_key or "not-needed",
            temperature=0.2,
            max_retries=2,
            timeout=60,
        )
    return ExtractiveStubLLM()
