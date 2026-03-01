"""PlivoGeminiSession — thin coordinator that composes all components."""
from .state import SessionState
from .call_logger import CallLogger
from .audio_pipeline import AudioPipeline
from .gemini_ws import GeminiConnection
from .prompt_builder import PromptBuilder
from .call_lifecycle import CallLifecycle
from .tool_handler import ToolHandler
from .transcript_logger import TranscriptLogger
from .detection_engines import DetectionEngines
from .post_call import PostCallProcessor


class PlivoGeminiSession:
    """Thin coordinator that wires all components together and delegates public methods.

    All state lives in SessionState; each component gets a reference to it.
    Methods called by app.py are delegated to the appropriate component.
    """

    def __init__(
        self,
        call_uuid: str,
        caller_phone: str,
        prompt: str = None,
        context: dict = None,
        webhook_url: str = None,
        client_name: str = "fwai",
        max_call_duration: int = 300,
    ):
        # Shared state
        self.state = SessionState(
            call_uuid=call_uuid,
            caller_phone=caller_phone,
            prompt=prompt,
            context=context,
            webhook_url=webhook_url,
            client_name=client_name,
            max_call_duration=max_call_duration,
        )

        # Structured logger
        self.log = CallLogger(call_uuid)
        self.state.log = self.log  # Make log accessible from state if needed

        # Components — order matters: transcript_logger starts threads in __init__
        self.transcript = TranscriptLogger(self.state, self.log)
        self.audio = AudioPipeline(self.state, self.log)
        self.prompt_builder = PromptBuilder(self.state, self.log)
        self.gemini = GeminiConnection(self.state, self.log)
        self.lifecycle = CallLifecycle(self.state, self.log)
        self.tool_handler = ToolHandler(self.state, self.log)
        self.detection = DetectionEngines(self.state, self.log)
        self.post_call = PostCallProcessor(self.state, self.log)

        # Wire cross-component references on state
        self.state._audio = self.audio
        self.state._gemini = self.gemini
        self.state._prompt_builder = self.prompt_builder
        self.state._lifecycle = self.lifecycle
        self.state._tool_handler = self.tool_handler
        self.state._transcript = self.transcript
        self.state._detection = self.detection
        self.state._post_call = self.post_call

    # ---- Properties delegated to state (for backward compat with app.py / session_manager) ----

    @property
    def call_uuid(self):
        return self.state.call_uuid

    @property
    def caller_phone(self):
        return self.state.caller_phone

    @caller_phone.setter
    def caller_phone(self, value):
        self.state.caller_phone = value

    @property
    def plivo_call_uuid(self):
        return self.state.plivo_call_uuid

    @plivo_call_uuid.setter
    def plivo_call_uuid(self, value):
        self.state.plivo_call_uuid = value

    @property
    def plivo_ws(self):
        return self.state.plivo_ws

    @plivo_ws.setter
    def plivo_ws(self, value):
        self.state.plivo_ws = value

    @property
    def is_active(self):
        return self.state.is_active

    @is_active.setter
    def is_active(self, value):
        self.state.is_active = value

    @property
    def context(self):
        return self.state.context

    @property
    def provider(self):
        return self.state.provider

    @provider.setter
    def provider(self, value):
        self.state.provider = value

    @property
    def twilio_stream_sid(self):
        return self.state.twilio_stream_sid

    @twilio_stream_sid.setter
    def twilio_stream_sid(self, value):
        self.state.twilio_stream_sid = value

    @property
    def twilio_account_sid(self):
        return self.state.twilio_account_sid

    @twilio_account_sid.setter
    def twilio_account_sid(self, value):
        self.state.twilio_account_sid = value

    @property
    def twilio_auth_token(self):
        return self.state.twilio_auth_token

    @twilio_auth_token.setter
    def twilio_auth_token(self, value):
        self.state.twilio_auth_token = value

    @property
    def _preload_start_time(self):
        return self.state._preload_start_time

    @property
    def _call_answered_time(self):
        return self.state._call_answered_time

    # ---- Delegated methods (public API used by app.py and session_manager.py) ----

    def inject_intelligence(self, brief: str):
        return self.detection.inject_intelligence(brief)

    def inject_social_proof(self, summary: str):
        return self.detection.inject_social_proof(summary)

    async def preload(self):
        return await self.lifecycle.preload()

    def attach_plivo_ws(self, ws):
        return self.lifecycle.attach_plivo_ws(ws)

    async def handle_plivo_audio(self, data):
        return await self.audio.handle_plivo_audio(data)

    async def handle_plivo_message(self, data):
        return await self.audio.handle_plivo_message(data)

    async def handle_twilio_media(self, data):
        return await self.audio.handle_twilio_media(data)

    async def stop(self):
        return await self.lifecycle.stop()

    def _save_transcript(self, role, text):
        return self.transcript._save_transcript(role, text)
