"""AIBackend — abstract interface for voice AI pipelines.

Both Live API and Traditional (STT + LLM + TTS) pipelines implement this protocol.
This enables monitors, tool handlers, and lifecycle code to be shared across pipelines.
"""
from typing import Protocol, runtime_checkable


@runtime_checkable
class AIBackend(Protocol):
    """Interface that both Live API and Traditional pipeline implement."""

    async def start(self, plivo_ws):
        """Start the AI pipeline after call connects."""
        ...

    async def handle_audio(self, audio_b64: str):
        """Handle an inbound audio chunk from Plivo/Twilio."""
        ...

    async def inject_text(self, text: str, turn_complete: bool = True):
        """Inject a system message into the conversation.

        Fire-and-forget for callers. Both backends handle the async
        response generation internally:
        - Live API: sends client_content, Gemini generates asynchronously
        - Traditional: queues the message for processing via _inject_queue

        Args:
            text: The system message to inject.
            turn_complete: True = expects AI to generate a response.
                           False = context injection only (no response expected).
        """
        ...

    async def send_tool_response(self, call_id: str, tool_name: str, response: dict):
        """Send a tool execution result back to the AI."""
        ...

    async def stop(self):
        """Clean up resources (close WebSockets, cancel tasks)."""
        ...
