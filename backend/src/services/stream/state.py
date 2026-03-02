"""SessionState — all instance variables from PlivoGeminiSession.__init__."""
import asyncio
import queue
import time
from pathlib import Path
from loguru import logger

from src.core.config import config, gemini_key_pool
from src.conversational_prompts import render_prompt


# Recording directory
RECORDINGS_DIR = Path(__file__).parent.parent.parent / "recordings"
RECORDINGS_DIR.mkdir(exist_ok=True)


class SessionState:
    """Holds every piece of mutable state for a single call session.
    Extracted verbatim from PlivoGeminiSession.__init__.
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
        self.call_uuid = call_uuid  # Internal UUID
        self.plivo_call_uuid = None  # Plivo's actual call UUID (set later)
        self.caller_phone = caller_phone
        self.context = context or {}  # Context for templates (customer_name, course_name, etc.)
        self.client_name = client_name or "fwai"

        # Prompt: API-provided prompt is the single source of truth
        self.prompt = render_prompt(prompt or "", self.context)
        logger.info(f"[{call_uuid[:8]}] Direct prompt mode for client: {client_name or 'default'}")

        self.webhook_url = webhook_url  # URL to call when call ends (for n8n integration)
        self.ghl_webhook_url = self.context.pop("ghl_webhook_url", "")  # GHL WhatsApp workflow (per-call from API)
        self.ghl_api_key = self.context.pop("ghl_api_key", "")  # GHL API key for contact lookup
        self.ghl_location_id = self.context.pop("ghl_location_id", "")  # GHL location ID
        self.plivo_auth_id = self.context.pop("plivo_auth_id", "")  # Per-org Plivo Auth ID
        self.plivo_auth_token = self.context.pop("plivo_auth_token", "")  # Per-org Plivo Auth Token
        # Twilio provider support
        self.provider = self.context.pop("_call_provider", "plivo")  # "plivo" or "twilio"
        self.twilio_stream_sid = None  # Set when Twilio stream connects
        self.twilio_account_sid = self.context.pop("twilio_account_sid", "")
        self.twilio_auth_token = self.context.pop("twilio_auth_token", "")
        self._social_proof_enabled = self.context.pop("_social_proof_enabled", False)  # Feature flag
        self._social_proof_min_turn = self.context.pop("_social_proof_min_turn", 0)  # Min turns before social proof fires
        self._ghl_workflows = self.context.pop("_ghl_workflows", [])  # Configurable GHL workflow triggers
        self._triggered_workflows = set()  # Track which workflows have been triggered (prevent duplicates)
        self._whatsapp_sent = False  # Track if WhatsApp was already sent this call
        self.plivo_ws = None  # Will be set when WebSocket connects
        self.goog_live_ws = None
        self.is_active = False
        self.start_streaming = False
        self.stream_id = ""
        self._session_task = None
        self._audio_buffer_task = None
        self.BUFFER_SIZE = 320  # Ultra-low latency (20ms chunks)
        self.inbuffer = bytearray(b"")
        self.greeting_sent = False
        self.setup_complete = False
        self._greeting_in_progress = True  # Mute user audio to Gemini until greeting finishes
        self._resolved_voice = None  # Cached voice — set once, reused on all session splits
        # (preloaded_audio removed — greeting now generated in real-time after connect)

        # Audio recording — sample-counter based (no timestamps)
        self._rec_user_chunks: list[bytes] = []         # USER audio in order (16kHz)
        self._rec_ai_events: list[tuple[int, bytes]] = []  # (user_sample_pos, ai_audio_24k)
        self._rec_user_sample_count: int = 0            # Running count of USER samples received
        self._rec_started: bool = False                  # Gate: only record after call answered
        self.recording_enabled = config.enable_transcripts
        self._recording_queue = queue.Queue() if self.recording_enabled else None
        self._recording_thread = None
        # NOTE: _start_recording_thread() is called by the TranscriptLogger component

        # (greeting_audio_complete removed — no preloaded greeting to track)

        # Call duration management (configurable, default 5 minutes)
        self.call_start_time = None
        self.max_call_duration = max_call_duration
        self._timeout_task = None
        self._closing_call = False  # Flag to indicate we're closing the call

        # Goodbye tracking - call ends only when both parties say goodbye
        self.user_said_goodbye = False
        self.agent_said_goodbye = False
        self._goodbye_pending = False  # Defer goodbye detection to turnComplete (avoid cutting mid-sentence)

        # Latency tracking - only logs if > threshold
        self._last_user_speech_time = None

        # Silence monitoring - 5 second SLA (gives customer time to think after AI asks a question)
        self._silence_monitor_task = None
        self._silence_sla_seconds = 5.0  # Safety net: nudge AI if no response 5s after user speaks
        self._last_split_time = 0  # Track when last session split completed (for nudge cooldown)
        self._last_ai_audio_time = None  # Track when AI last sent audio
        self._last_agent_turn_end_time = None  # Track when AI finished speaking (for nudge guard)
        self._current_turn_audio_chunks = 0  # Track audio chunks in current turn
        self._empty_turn_nudge_count = 0  # Track consecutive empty turns

        # API key for this session (round-robin from pool)
        self._api_key = gemini_key_pool.get_key()
        self._turn_start_time = None  # Track when current turn started (for latency logging)
        self._turn_count = 0  # Count turns for latency tracking
        self._current_turn_agent_text = []  # Accumulate agent speech fragments per turn
        self._has_output_transcription = False  # Track if outputTranscription arrived this turn
        self._current_turn_user_text = []  # Accumulate user speech fragments per turn

        # Audio send queue and worker
        self._plivo_send_queue = asyncio.Queue(maxsize=500)
        self._current_turn_id = 0
        self._sender_worker_task = None

        # Speech detection logging
        self._user_speaking = False  # Track if user is currently speaking
        self._agent_speaking = False  # Track if agent is currently speaking
        self._last_user_audio_time = None  # Last time user audio received
        self._user_speech_start_time = None  # When user started speaking

        # (speech energy gate removed — greeting now streams after connect, no need to detect speech first)

        # Audio buffer for reconnection (store audio if Google WS drops briefly)
        self._reconnect_audio_buffer = []
        self._max_reconnect_buffer = 150  # Increased buffer (~3 seconds) for better reconnection

        # Conversation history - saved to file in background thread (no latency impact)
        self._conversation_history = []  # In-memory cache for quick access
        self._max_history_size = 10  # Keep only last 10 messages

        # Transcript file writer - background queue (non-blocking, no latency impact)
        self._transcript_queue = queue.Queue()
        self._transcript_thread = None
        # NOTE: _start_transcript_thread() is called by the TranscriptLogger component
        self._is_first_connection = True  # Track if this is first connect or reconnect
        self._conversation_file = RECORDINGS_DIR / f"{call_uuid}_conversation.json"
        self._conversation_queue = queue.Queue()  # Queue for background file writes
        self._conversation_thread = None
        # NOTE: _start_conversation_logger() is called by the TranscriptLogger component

        # Reconnection state
        self._is_reconnecting = False  # Flag to handle reconnection gracefully

        # Google session refresh timer (10-min limit, refresh at 9 min)
        self._google_session_start = None
        self._session_refresh_task = None
        self.GOOGLE_SESSION_LIMIT = 9 * 60  # Refresh at 9 minutes (before 10-min disconnect)

        # REST API transcription: Buffer user audio, transcribe when turn completes
        self._user_audio_buffer = bytearray(b"")  # Buffer for user audio (16kHz PCM)
        self._max_audio_buffer_size = 16000 * 2 * 30  # Max 30 seconds of audio (16kHz, 16-bit)
        self._last_user_transcript_time = 0  # Track when we last got a transcript

        # Full transcript collection (in-memory backup for webhook)
        self._full_transcript = []  # List of {"role": "USER/AGENT", "text": "...", "timestamp": "..."}

        # Session split - time-based (flush KV cache regularly + stay under Gemini's 10-min limit)
        self._session_split_after_seconds = 4 * 60  # Split at 4 minutes
        self._split_pending = False      # Defer swap to next user silence gap
        self._split_pending_since = None # When split was first requested (safety timeout)
        self._last_agent_text = ""  # Last thing AI said (for split context)
        self._last_user_text = ""   # Last thing user said (for split context)
        self._last_agent_question = ""  # Last question AI asked (for anti-repetition)
        self._turn_exchanges = []   # Complete turn texts for clean summaries
        self._key_facts = []        # Cumulative key facts that survive all session splits
        self._conversation_milestones = []  # Tracks conversation stage for session splits
        self._questions_asked = []            # Agent questions asked (anti-repetition across splits)
        self._objection_techniques_used = []  # Objection techniques used (anti-repetition across splits)

        # Hot-swap session management
        self._standby_ws = None
        self._standby_ready = asyncio.Event()
        self._standby_task = None
        self._prewarm_task = None
        self._swap_in_progress = False
        self._active_receive_task = None
        self._mute_audio = False         # Suppress audio output during swap (Fix 1)
        self._post_swap_hold_until = 0   # Hold user audio briefly after swap (Fix 3)
        self._post_swap_reengagement_task = None  # Dead air detector after session splits
        self._prebuilt_setup_msg = None  # Pre-built setup JSON for hot-swap (avoids rebuild at swap time)

        # (preloaded_chunk_count removed — greeting streams in real-time now)

        # Timing instrumentation
        self._preload_start_time = None    # When preload() started
        self._setup_sent_time = None       # When setup message was sent to Gemini
        self._greeting_trigger_time = None # When greeting trigger was sent
        self._first_audio_time = None      # When first AI audio chunk arrived
        self._call_answered_time = None    # When Plivo WS attached
        self._greeting_completed_time = None  # When greeting turn finishes streaming (for ghost monitor)
        self._first_audio_to_caller = None # When first audio sent to caller
        self._turn_first_byte_time = None  # When first audio byte of current turn arrived

        # Pre-call intelligence brief (injected after preload)
        self._intelligence_brief = ""

        # Social proof summary (pre-fetched aggregate stats for system prompt)
        self._social_proof_summary = ""

        # Dynamic Persona Engine state
        self._use_persona_engine = bool(self.context.get("_persona_engine"))
        self._detected_persona = None
        self._active_situations = []
        self._previous_situations = []
        self._accumulated_user_text = ""
        self._garbled_turn_count = 0  # Consecutive garbled STT turns (circuit breaker)
        # Custom persona/situation keyword configs from DB (bypass file-based defaults)
        self._custom_persona_keywords = self.context.pop("_custom_persona_keywords", None)
        self._custom_situation_keywords = self.context.pop("_custom_situation_keywords", None)
        if self._custom_persona_keywords:
            persona_names = list(self._custom_persona_keywords.keys())
            logger.info(f"[{call_uuid[:8]}] │  ├─ Custom persona keywords from DB: {persona_names}")
        elif self._use_persona_engine:
            logger.info(f"[{call_uuid[:8]}] │  ├─ No custom persona keywords — using file-based defaults")
        # Micro-Moment Detector (runs on ALL calls, independent of persona engine)
        self._micro_moment_detector = None
        self._agent_turn_complete_time = None   # Set at turnComplete
        self._user_response_start_time = None   # Set at first user transcript of next turn
        # Product Intelligence state
        self._use_product_intelligence = bool(self.context.get("_product_intelligence_enabled"))
        self._db_product_sections = self.context.pop("_db_product_sections", None)  # {name: content} from DB
        self._db_product_keywords = self.context.pop("_db_product_keywords", None)
        # Start with NO product sections — progressively reveal based on conversation
        if self._use_product_intelligence and self._db_product_sections:
            self._active_product_sections = []  # Start empty, reveal via keyword matching
            logger.info(f"[{call_uuid[:8]}] │  ├─ Product intelligence: DB sections available {list(self._db_product_sections.keys())}")
        elif self._use_product_intelligence:
            self._active_product_sections = ["overview"]
        else:
            self._active_product_sections = []
        self._previous_product_sections = []
        # Non-English language detection (graceful exit after consecutive non-English messages)
        self._consecutive_non_english = 0

        # Linguistic Mirror state
        self._linguistic_style = {}
        self._previous_linguistic_style = {}
        memory_style = self.context.get("_memory_linguistic_style")
        if memory_style:
            self._linguistic_style = memory_style
            logger.info(f"[{call_uuid[:8]}] │  ├─ Linguistic style pre-loaded: {memory_style}")

        if self._use_persona_engine:
            logger.info(f"[{call_uuid[:8]}] │  ├─ Persona engine: ON")
            # Pre-set persona from cross-call memory (skips NEPQ discovery)
            memory_persona = self.context.get("_memory_persona")
            if memory_persona:
                # Validate memory persona exists in current config (handles transition
                # from old snake_case keys to DB persona names)
                if self._custom_persona_keywords and memory_persona not in self._custom_persona_keywords:
                    logger.info(f"[{call_uuid[:8]}] │  ├─ Memory persona '{memory_persona}' not in current config, will re-detect")
                else:
                    self._detected_persona = memory_persona
                    logger.info(f"[{call_uuid[:8]}] │  ├─ Persona pre-loaded from memory: {memory_persona}")

        # Initialize Micro-Moment Detector (runs on ALL calls, independent of persona engine)
        from src.core.config import config as app_config
        mm_config = self.context.pop("_micro_moments_config", None)
        mm_enabled = mm_config.get("enabled", True) if mm_config else True
        if app_config.enable_micro_moments and mm_enabled:
            from src.micro_moment_detector import MicroMomentDetector
            self._micro_moment_detector = MicroMomentDetector(config_override=mm_config)
            disabled = mm_config.get("disabled_moments", []) if mm_config else []
            logger.info(f"[{call_uuid[:8]}] │  ├─ Micro-moment detector: ON" + (f" (disabled: {disabled})" if disabled else ""))
        elif mm_config and not mm_enabled:
            logger.info(f"[{call_uuid[:8]}] │  ├─ Micro-moment detector: OFF (disabled in bot config)")
        self._mm_config_override = mm_config  # Keep reference for session split restoration

        # Watchdog nudge & emergency split tracking (D3b)
        self._watchdog_nudge_sent = False
        self._emergency_split_count = 0

        # Accumulated agent text for phase detection (D3c)
        self._accumulated_agent_text = ""

        # ---- Pipeline mode (feature flag for traditional STT+LLM+TTS pipeline) ----
        self._pipeline_mode = self.context.pop("_pipeline_mode", None) \
            or config.voice_pipeline_mode  # "live_api" | "traditional"

        # TTS configuration (for traditional pipeline)
        self._tts_voice = self.context.pop("_tts_voice", None)  # Override voice name
        self._tts_language = self.context.pop("_tts_language", "en-IN")  # Language/accent

        # AI backend reference (set by session.py after construction)
        self._ai_backend = None

        # ---- Component references (set by session.py after construction) ----
        self._audio = None
        self._gemini = None
        self._prompt_builder = None
        self._lifecycle = None
        self._tool_handler = None
        self._transcript = None
        self._detection = None
        self._post_call = None
