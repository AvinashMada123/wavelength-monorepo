"""LiveAPIBackend — wraps existing GeminiConnection behind AIBackend interface.

Thin adapter that delegates to existing code. Zero behavior changes.
Used when pipeline_mode == "live_api" (the default).
"""
import asyncio
import json

from loguru import logger


class LiveAPIBackend:
    """Wraps existing GeminiConnection + AudioPipeline behind AIBackend interface."""

    def __init__(self, state, log):
        self.state = state
        self.log = log

    async def start(self, plivo_ws):
        """Start sender worker + Gemini Live session (existing flow)."""
        s = self.state
        s._sender_worker_task = asyncio.create_task(s._audio._plivo_sender_worker())
        s._session_task = asyncio.create_task(s._gemini._run_google_live_session())

    async def handle_audio(self, audio_b64: str):
        """Delegate to existing AudioPipeline (sends to Gemini Live WS)."""
        await self.state._audio.handle_plivo_audio(audio_b64)

    async def inject_text(self, text: str, turn_complete: bool = True):
        """Send client_content to Gemini Live WS (existing pattern).

        Fire-and-forget: Gemini generates response asynchronously in the session.
        """
        s = self.state
        if not s.goog_live_ws:
            return
        msg = {
            "client_content": {
                "turns": [{"role": "user", "parts": [{"text": text}]}],
                "turn_complete": turn_complete,
            }
        }
        try:
            await s.goog_live_ws.send(json.dumps(msg))
        except Exception as e:
            logger.error(f"[{s.call_uuid[:8]}] LiveAPI inject_text error: {e}")

    async def send_tool_response(self, call_id: str, tool_name: str, response: dict):
        """Send tool response to Gemini Live WS."""
        s = self.state
        if not s.goog_live_ws:
            return
        tool_resp = {
            "tool_response": {
                "function_responses": [
                    {"id": call_id, "name": tool_name, "response": response}
                ]
            }
        }
        try:
            await s.goog_live_ws.send(json.dumps(tool_resp))
        except Exception as e:
            logger.error(f"[{s.call_uuid[:8]}] LiveAPI send_tool_response error: {e}")

    async def stop(self):
        """Existing cleanup in call_lifecycle.stop() handles this."""
        pass
