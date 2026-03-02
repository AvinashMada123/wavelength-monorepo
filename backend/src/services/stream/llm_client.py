"""GeminiTextClient — streaming text completion via Gemini 2.5 Flash.

Handles conversation history management, tool call loops, and
background history summarization.
"""
import asyncio
import time
from dataclasses import dataclass
from typing import AsyncIterator, Optional

from google import genai
from google.genai import types
from loguru import logger

from src.core.config import gemini_key_pool


# --- Event types yielded by generate() ---

@dataclass
class TextChunk:
    """Partial response text from LLM."""
    text: str


@dataclass
class ToolCall:
    """Function call from LLM — stream stops after this."""
    name: str
    args: dict
    id: str


@dataclass
class TurnComplete:
    """Generation finished for this turn."""
    pass


@dataclass
class ErrorEvent:
    """LLM generation failed — caller should play canned audio."""
    message: str


class GeminiTextClient:
    """Streaming text completion via Gemini 2.5 Flash.

    Handles conversation history management and tool call loops.
    """

    def __init__(self, state, log):
        self.state = state
        self.log = log

        self._messages: list[types.Content] = []  # Conversation history
        self._system_prompt: str = ""
        self._tools: list[dict] = []  # Tool declarations (raw dicts)
        self._api_key = gemini_key_pool.get_key()
        self._client = genai.Client(api_key=self._api_key)
        self._model = "gemini-2.5-flash"

        # Summarization state
        self._summarize_after_turns = 8  # 16 messages
        self._keep_recent_messages = 12  # 6 turns verbatim

    def set_system_prompt(self, prompt: str):
        """Set system prompt (called once at start, updated on detection changes)."""
        self._system_prompt = prompt

    def set_tools(self, tools: list[dict]):
        """Set tool declarations (raw dict format from prompt_builder)."""
        self._tools = tools

    def update_system_prompt(self, new_prompt: str):
        """Update system prompt (for persona/situation/product detection changes)."""
        self._system_prompt = new_prompt

    def append_context(self, text: str):
        """Append context-only text to history (for inject_text with turn_complete=False).

        No LLM call, just adds to _messages so the LLM sees it on the next turn.
        """
        self._messages.append(types.Content(
            role="user",
            parts=[types.Part.from_text(text)],
        ))

    async def generate(self, user_text: str = None, tool_result: dict = None) -> AsyncIterator:
        """Send user message (or tool result) and stream response.

        Args:
            user_text: User's message text. Set to None when continuing after a tool call.
            tool_result: If provided, appends tool result to history and continues.

        Yields:
            TextChunk(text) — partial response text
            ToolCall(name, args, id) — function call to execute (stream stops here)
            TurnComplete() — generation finished
            ErrorEvent(message) — on failure after retries
        """
        # Build message to append
        if tool_result is not None:
            # Append tool result and continue generation
            self._messages.append(types.Content(
                role="user",
                parts=[types.Part.from_function_response(
                    name=tool_result["name"],
                    response=tool_result["response"],
                )],
            ))
        elif user_text is not None:
            self._messages.append(types.Content(
                role="user",
                parts=[types.Part.from_text(user_text)],
            ))

        # Build config
        tool_declarations = None
        if self._tools:
            tool_declarations = [types.Tool(function_declarations=[
                types.FunctionDeclaration(
                    name=t["name"],
                    description=t.get("description", ""),
                    parameters=t.get("parameters"),
                )
                for t in self._tools
            ])]

        config = types.GenerateContentConfig(
            system_instruction=self._system_prompt,
            temperature=0.7,
            max_output_tokens=256,  # Short responses for voice
            tools=tool_declarations,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        )

        # Retry logic
        max_retries = 2
        accumulated_model_text = ""
        accumulated_model_parts = []

        for attempt in range(max_retries + 1):
            try:
                t0 = time.time()
                first_chunk = True

                async for chunk in self._client.aio.models.generate_content_stream(
                    model=self._model,
                    contents=self._messages,
                    config=config,
                ):
                    if first_chunk:
                        ttfb_ms = (time.time() - t0) * 1000
                        if ttfb_ms > 1000:
                            self.log.warn(f"LLM TTFB: {ttfb_ms:.0f}ms")
                        first_chunk = False

                    if not chunk.candidates:
                        continue

                    for part in chunk.candidates[0].content.parts:
                        # Text chunk
                        if part.text:
                            accumulated_model_text += part.text
                            accumulated_model_parts.append(types.Part.from_text(part.text))
                            yield TextChunk(text=part.text)

                        # Function call — stream stops here
                        elif part.function_call:
                            fc = part.function_call
                            fc_part = types.Part.from_function_call(
                                name=fc.name, args=dict(fc.args) if fc.args else {}
                            )
                            accumulated_model_parts.append(fc_part)

                            # Save model response (text + function call) to history
                            self._messages.append(types.Content(
                                role="model",
                                parts=list(accumulated_model_parts),
                            ))

                            yield ToolCall(
                                name=fc.name,
                                args=dict(fc.args) if fc.args else {},
                                id=fc.name,  # Gemini text API doesn't have separate IDs
                            )
                            return  # Stream stops at tool call

                # No tool call — turn complete
                if accumulated_model_parts:
                    self._messages.append(types.Content(
                        role="model",
                        parts=list(accumulated_model_parts),
                    ))
                yield TurnComplete()
                return  # Success

            except Exception as e:
                logger.error(f"LLM generation error (attempt {attempt + 1}): {e}")
                if attempt < max_retries:
                    await asyncio.sleep(1.0)
                else:
                    yield ErrorEvent(message=str(e))
                    yield TurnComplete()
                    return

    def truncate_last_model_message(self, spoken_text: str):
        """Truncate the last model message to what was actually spoken (for barge-in).

        When the user interrupts, only keep the text that was actually
        spoken to the caller, not the full generated response.
        """
        if not self._messages:
            return

        # Find last model message
        for i in range(len(self._messages) - 1, -1, -1):
            if self._messages[i].role == "model":
                if spoken_text.strip():
                    self._messages[i] = types.Content(
                        role="model",
                        parts=[types.Part.from_text(spoken_text)],
                    )
                else:
                    # Nothing was spoken — remove the model message entirely
                    self._messages.pop(i)
                break

    async def _maybe_summarize_history_bg(self):
        """Background task: compress old conversation history.

        Race-safe replacement strategy:
        1. Snapshot len(_messages) before summarizing
        2. Summarize _messages[:snapshot_len - 12] via fast Gemini call
        3. Replace using snapshot index (preserves messages appended during summary)
        """
        if len(self._messages) < self._summarize_after_turns * 2:
            return

        snapshot_len = len(self._messages)
        to_summarize = self._messages[:snapshot_len - self._keep_recent_messages]

        if len(to_summarize) < 4:
            return

        # Build summary text from old messages
        summary_input = []
        for msg in to_summarize:
            role = "Agent" if msg.role == "model" else "Customer"
            text_parts = [p.text for p in msg.parts if hasattr(p, 'text') and p.text]
            if text_parts:
                summary_input.append(f"{role}: {' '.join(text_parts)}")

        if not summary_input:
            return

        try:
            summary_prompt = (
                "Summarize this conversation in 3 sentences. Focus on: "
                "what was discussed, any agreements made, and the customer's stance.\n\n"
                + "\n".join(summary_input)
            )

            response = await self._client.aio.models.generate_content(
                model=self._model,
                contents=summary_prompt,
                config=types.GenerateContentConfig(
                    max_output_tokens=150,
                    temperature=0.3,
                ),
            )

            summary_text = response.text if response.text else ""
            if summary_text:
                summary_msg = types.Content(
                    role="user",
                    parts=[types.Part.from_text(
                        f"[Conversation summary so far: {summary_text}]"
                    )],
                )
                # Race-safe replacement: use snapshot index
                self._messages = [summary_msg] + self._messages[snapshot_len - self._keep_recent_messages:]
                self.log.detail(f"History summarized: {len(to_summarize)} msgs → 1 summary")
        except Exception as e:
            logger.error(f"History summarization failed: {e}")
            # Non-fatal — continue with full history
