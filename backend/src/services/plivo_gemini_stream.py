# Plivo + Google Live API Stream Handler with Preloading
import asyncio
import json
import base64
import os
import wave
import struct
import threading
import queue
import time
from typing import Dict, Optional
from dataclasses import dataclass
from loguru import logger
from datetime import datetime
from pathlib import Path
import websockets
import numpy as np
from src.core.config import config
from src.tools import execute_tool
from src.conversational_prompts import render_prompt
from src.db.session_db import session_db


def get_vertex_ai_token():
    """Get OAuth2 access token for Vertex AI"""
    try:
        import google.auth
        from google.auth.transport.requests import Request

        scopes = [
            'https://www.googleapis.com/auth/cloud-platform',
            'https://www.googleapis.com/auth/generative-language',
            'https://www.googleapis.com/auth/generative-language.retriever',
        ]
        t0 = time.time()
        credentials, project = google.auth.default(scopes=scopes)
        credentials.refresh(Request())
        token_ms = (time.time() - t0) * 1000
        logger.info(f"Vertex AI token for {project} ({token_ms:.0f}ms)")
        return credentials.token
    except Exception as e:
        logger.error(f"Failed to get Vertex AI token: {e}")
        return None

# Latency threshold - only log if slower than this (ms)
# 250ms silence_duration_ms + ~200ms Gemini inference = ~450ms baseline; warn above 1000ms
LATENCY_THRESHOLD_MS = 1000

# Recording directory
RECORDINGS_DIR = Path(__file__).parent.parent.parent / "recordings"
RECORDINGS_DIR.mkdir(exist_ok=True)


class CallLogger:
    """Structured call lifecycle logger with visual indentation."""

    def __init__(self, call_id: str):
        self.id = call_id[:8]

    def section(self, title: str):
        logger.info(f"[{self.id}] ══════ {title} ══════")

    def phase(self, title: str):
        logger.info(f"[{self.id}] ├─ {title}")

    def detail(self, msg: str):
        logger.info(f"[{self.id}] │  ├─ {msg}")

    def detail_last(self, msg: str):
        logger.info(f"[{self.id}] │  └─ {msg}")

    def turn(self, num: int, extra: str = ""):
        suffix = f" ({extra})" if extra else ""
        logger.info(f"[{self.id}] ├─ TURN #{num}{suffix}")

    def agent(self, text: str):
        logger.info(f"[{self.id}] │  ├─ AGENT: {text}")

    def user(self, text: str):
        logger.info(f"[{self.id}] │  ├─ USER:  {text}")

    def metric(self, text: str):
        logger.info(f"[{self.id}] │  └─ {text}")

    def warn(self, msg: str):
        logger.warning(f"[{self.id}] ⚠ {msg}")

    def error(self, msg: str):
        logger.error(f"[{self.id}] ✗ {msg}")


def detect_voice_from_prompt(prompt: str) -> str:
    """Detect voice based on prompt content. Returns 'Kore' for female, 'Puck' for male (default).

    Only checks the IDENTITY line (first line) for agent name to avoid matching customer names.
    Explicit 'Female Voice'/'Male Voice' directives take highest priority anywhere in prompt.
    """
    if not prompt:
        return "Puck"
    prompt_lower = prompt.lower()

    # HIGHEST PRIORITY: Explicit voice directive in prompt (e.g. "Must use Female Voice")
    if "male voice" in prompt_lower:
        # Check female first since "female voice" also contains "male voice"
        if "female voice" in prompt_lower:
            logger.info("Explicit 'Female Voice' directive in prompt - using Kore")
            return "Kore"
        logger.info("Explicit 'Male Voice' directive in prompt - using Puck")
        return "Puck"

    # Extract only the IDENTITY line (first line or line containing "IDENTITY:")
    # to avoid matching customer names like "Priya" in the rest of the prompt
    identity_line = ""
    for line in prompt_lower.split("\n"):
        line = line.strip()
        if line.startswith("identity:") or line.startswith("identity :"):
            identity_line = line
            break
    if not identity_line:
        # Fallback: use just the first non-empty line
        for line in prompt_lower.split("\n"):
            if line.strip():
                identity_line = line.strip()
                break

    # Check agent name in identity line only
    female_indicators = [
        "mousumi", "priya", "anjali", "divya", "neha", "pooja", "shreya",
        "sunita", "anita", "kavita", "rekha", "meena", "sita", "geeta"
    ]
    for indicator in female_indicators:
        if indicator in identity_line:
            logger.info(f"Detected female agent name '{indicator}' in identity - using Kore voice")
            return "Kore"

    male_names = [
        "rahul", "vishnu", "avinash", "arjun", "raj", "amit", "vijay", "suresh",
        "mahesh", "ramesh", "ganesh", "kiran", "sanjay", "ajay", "ravi", "kumar"
    ]
    for name in male_names:
        if name in identity_line:
            logger.info(f"Detected male agent name '{name}' in identity - using Puck voice")
            return "Puck"

    # Default to male voice
    return "Puck"

# Tool definitions for Gemini Live (minimal for lower latency)
# NOTE: WhatsApp messaging disabled during calls to reduce latency/interruptions
TOOL_DECLARATIONS = [
    {
        "name": "end_call",
        "description": "End the phone call. ONLY call this AFTER you have tried at least 2-3 reframes AND the customer explicitly says stop/no/end. NEVER end just because they said 'not interested' once — that is normal in sales. Try different angles first. Only call this after a firm third rejection or explicit 'please stop'.",
        "parameters": {
            "type": "object",
            "properties": {
                "reason": {"type": "string"}
            },
            "required": ["reason"]
        }
    },
    {
        "name": "save_user_info",
        "description": "Save important information the user shared about themselves. Call this whenever the user tells you their name, company, job role, or other key personal details. This helps remember them for future calls.",
        "parameters": {
            "type": "object",
            "properties": {
                "company": {
                    "type": "string",
                    "description": "The company or organization the user works at, if mentioned"
                },
                "role": {
                    "type": "string",
                    "description": "The user's job title or role, if mentioned"
                },
                "name": {
                    "type": "string",
                    "description": "The user's name, if they introduce themselves"
                },
                "key_detail": {
                    "type": "string",
                    "description": "Any other important detail the user shared (e.g. 'referred by a friend', 'looking to switch careers')"
                }
            }
        }
    },
    {
        "name": "get_social_proof",
        "description": "Get social proof statistics to reference in conversation. Call this when you learn the prospect's company, city, or job role, to get real numbers you can mention naturally.",
        "parameters": {
            "type": "object",
            "properties": {
                "company": {
                    "type": "string",
                    "description": "The company/organization the prospect works at (e.g. 'Wipro', 'TCS', 'Infosys')"
                },
                "city": {
                    "type": "string",
                    "description": "The city the prospect is in (e.g. 'Hyderabad', 'Bangalore', 'Mumbai')"
                },
                "role": {
                    "type": "string",
                    "description": "The prospect's job role (e.g. 'Software Engineer', 'Data Analyst', 'Product Manager')"
                }
            }
        }
    }
]

@dataclass
class AudioChunk:
    """Audio chunk flowing through the queue pipeline"""
    audio_b64: str        # Base64-encoded audio data
    turn_id: int          # Gemini turn counter (for cancellation)
    sample_rate: int = 24000


class PlivoGeminiSession:
    def __init__(self, call_uuid: str, caller_phone: str, prompt: str = None, context: dict = None, webhook_url: str = None, client_name: str = "fwai", max_call_duration: int = 480):
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
        self._resolved_voice = None  # Cached voice — set once, reused on all session splits
        self.preloaded_audio = []  # Store audio generated during preload
        self._preload_complete = asyncio.Event()
        self._silence_keepalive_task = None  # Sends silence to Gemini between greeting and call answer

        # Audio recording - using queue and background thread (non-blocking)
        self.audio_chunks = []  # List of (role, audio_bytes) tuples
        self.recording_enabled = config.enable_transcripts
        self._recording_queue = queue.Queue() if self.recording_enabled else None
        self._recording_thread = None
        if self.recording_enabled:
            self._start_recording_thread()

        # Flag to prevent double greeting
        self.greeting_audio_complete = False

        # Call duration management (configurable, default 8 minutes)
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

        # Audio buffer for reconnection (store audio if Google WS drops briefly)
        self._reconnect_audio_buffer = []
        self._max_reconnect_buffer = 150  # Increased buffer (~3 seconds) for better reconnection

        # Conversation history - saved to file in background thread (no latency impact)
        self._conversation_history = []  # In-memory cache for quick access
        self._max_history_size = 10  # Keep only last 10 messages

        # Transcript file writer - background queue (non-blocking, no latency impact)
        self._transcript_queue = queue.Queue()
        self._transcript_thread = None
        self._start_transcript_thread()
        self._is_first_connection = True  # Track if this is first connect or reconnect
        self._conversation_file = RECORDINGS_DIR / f"{call_uuid}_conversation.json"
        self._conversation_queue = queue.Queue()  # Queue for background file writes
        self._conversation_thread = None
        self._start_conversation_logger()  # Start background thread for file writes

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

        # Greeting playback tracking (for watchdog timer)
        self._preloaded_chunk_count = 0    # Number of preloaded greeting chunks (for watchdog timeout calc)

        # Timing instrumentation
        self._preload_start_time = None    # When preload() started
        self._setup_sent_time = None       # When setup message was sent to Gemini
        self._greeting_trigger_time = None # When greeting trigger was sent
        self._first_audio_time = None      # When first AI audio chunk arrived
        self._call_answered_time = None    # When Plivo WS attached
        self._first_audio_to_caller = None # When first audio sent to caller
        self._turn_first_byte_time = None  # When first audio byte of current turn arrived

        # Structured logger
        self.log = CallLogger(call_uuid)

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
        # Custom persona/situation keyword configs from DB (bypass file-based defaults)
        self._custom_persona_keywords = self.context.pop("_custom_persona_keywords", None)
        self._custom_situation_keywords = self.context.pop("_custom_situation_keywords", None)
        if self._custom_persona_keywords:
            persona_names = list(self._custom_persona_keywords.keys())
            self.log.detail(f"Custom persona keywords from DB: {persona_names}")
        elif self._use_persona_engine:
            self.log.detail("No custom persona keywords — using file-based defaults")
        # Micro-Moment Detector (behavioral buying signal / resistance detection)
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
            self.log.detail(f"Product intelligence: DB sections available {list(self._db_product_sections.keys())}")
        elif self._use_product_intelligence:
            self._active_product_sections = ["overview"]
        else:
            self._active_product_sections = []
        self._previous_product_sections = []
        # Linguistic Mirror state
        self._linguistic_style = {}
        self._previous_linguistic_style = {}
        memory_style = self.context.get("_memory_linguistic_style")
        if memory_style:
            self._linguistic_style = memory_style
            self.log.detail(f"Linguistic style pre-loaded: {memory_style}")

        if self._use_persona_engine:
            self.log.detail("Persona engine: ON")
            # Pre-set persona from cross-call memory (skips NEPQ discovery)
            memory_persona = self.context.get("_memory_persona")
            if memory_persona:
                # Validate memory persona exists in current config (handles transition
                # from old snake_case keys to DB persona names)
                if self._custom_persona_keywords and memory_persona not in self._custom_persona_keywords:
                    self.log.detail(f"Memory persona '{memory_persona}' not in current config, will re-detect")
                else:
                    self._detected_persona = memory_persona
                    self.log.detail(f"Persona pre-loaded from memory: {memory_persona}")

        # Initialize Micro-Moment Detector (runs on ALL calls, independent of persona engine)
        from src.core.config import config as app_config
        mm_config = self.context.pop("_micro_moments_config", None)
        mm_enabled = mm_config.get("enabled", True) if mm_config else True
        if app_config.enable_micro_moments and mm_enabled:
            from src.micro_moment_detector import MicroMomentDetector
            self._micro_moment_detector = MicroMomentDetector(config_override=mm_config)
            disabled = mm_config.get("disabled_moments", []) if mm_config else []
            self.log.detail(f"Micro-moment detector: ON" + (f" (disabled: {disabled})" if disabled else ""))
        elif mm_config and not mm_enabled:
            self.log.detail("Micro-moment detector: OFF (disabled in bot config)")
        self._mm_config_override = mm_config  # Keep reference for session split restoration

    def inject_intelligence(self, brief: str):
        """Store pre-call intelligence brief. Must be called BEFORE preload starts
        so it gets included in the initial system prompt via _send_session_setup_on_ws."""
        if not brief:
            return
        self._intelligence_brief = brief
        self.log.detail(f"Intelligence stored ({len(brief)} chars)")

    def inject_social_proof(self, summary: str):
        """Store pre-call social proof summary. Called BEFORE preload starts."""
        if not summary:
            return
        self._social_proof_summary = summary
        self.log.detail(f"Social proof stored ({len(summary)} chars)")

    async def _inject_situation_hint(self, hint: str):
        """Inject a short situation hint via client_content (no audio pause)."""
        try:
            msg = {
                "client_content": {
                    "turns": [{"role": "user", "parts": [{"text": hint}]}],
                    "turn_complete": False
                }
            }
            await self.goog_live_ws.send(json.dumps(msg))
        except Exception as e:
            self.log.warn(f"Failed to inject situation hint: {e}")

    # Minimum turns before goodbye detection activates (prevents premature call end)
    MIN_TURNS_FOR_GOODBYE = 6

    def _get_tool_declarations(self):
        """Build tool declarations dynamically based on session capabilities."""
        # Only include get_social_proof tool if social proof is enabled
        tools = [t for t in TOOL_DECLARATIONS if t["name"] != "get_social_proof" or self._social_proof_enabled]

        # Add configurable GHL workflow tools (during_call only — pre/post are handled server-side)
        for wf in self._ghl_workflows:
            if wf.get("timing") == "during_call" and wf.get("enabled") and wf.get("tag"):
                tools.append({
                    "name": f"ghl_workflow_{wf['id']}",
                    "description": wf.get("description", f"Trigger the '{wf.get('name', 'workflow')}' workflow"),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "reason": {
                                "type": "string",
                                "description": "Why you're triggering this workflow now"
                            }
                        },
                        "required": ["reason"]
                    }
                })

        # Legacy: keep send_whatsapp if GHL creds are set but no workflows configured
        if self.ghl_api_key and self.ghl_location_id and not self._ghl_workflows:
            tools.append({
                "name": "send_whatsapp",
                "description": "Send a WhatsApp message to the caller via the configured workflow. Use this when your prompt instructs you to send a WhatsApp message. Can only be sent once per call.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "reason": {
                            "type": "string",
                            "description": "Brief reason for sending the message, e.g. 'welcome message after greeting'"
                        }
                    },
                    "required": ["reason"]
                }
            })
        return tools

    def _is_goodbye_message(self, text: str) -> bool:
        """Detect if agent is saying goodbye - triggers auto call end.
        Only activates after MIN_TURNS_FOR_GOODBYE to prevent early cutoff."""
        if self._turn_count < self.MIN_TURNS_FOR_GOODBYE:
            return False

        text_lower = text.lower()
        goodbye_phrases = [
            # Direct goodbyes
            'bye', 'goodbye', 'good bye', 'bye bye', 'buh bye',
            # Take care variants
            'take care', 'take it easy', 'be well', 'stay safe',
            # Talk later variants
            'talk later', 'talk soon', 'talk to you', 'speak soon', 'speak later',
            'catch you later', 'catch up later', 'chat later', 'chat soon',
            # Day wishes
            'have a great', 'have a nice', 'have a good', 'have a wonderful',
            'enjoy your', 'all the best', 'best of luck', 'good luck',
            # Thanks for calling
            'thanks for calling', 'thank you for calling', 'thanks for your time',
            'thank you for your time', 'appreciate your time', 'appreciate you calling',
            # Nice talking
            'nice talking', 'great talking', 'good talking', 'lovely talking',
            'nice chatting', 'great chatting', 'pleasure talking', 'pleasure speaking',
            'enjoyed talking', 'enjoyed our', 'was great speaking',
            # See you
            'see you', 'see ya', 'cya', 'until next time', 'till next time',
            # Ending indicators
            'signing off', 'thats all', "that's all", 'nothing else',
            'we are done', "we're done", 'call ended', 'ending the call'
        ]
        for phrase in goodbye_phrases:
            if phrase in text_lower:
                return True
        return False

    def _check_mutual_goodbye(self):
        """End call when agent says goodbye (don't wait too long for user)"""
        if self.agent_said_goodbye and not self._closing_call:
            if self.user_said_goodbye:
                logger.info(f"[{self.call_uuid[:8]}] Mutual goodbye - ending call")
                self._closing_call = True
                asyncio.create_task(self._hangup_call_delayed(0.5))  # Quick end
            else:
                # Agent said goodbye but user hasn't - start short timeout
                logger.debug(f"[{self.call_uuid[:8]}] Agent goodbye, waiting 3s for user")
                asyncio.create_task(self._quick_goodbye_timeout(3.0))

    async def _quick_goodbye_timeout(self, timeout: float):
        """Quick timeout after agent says goodbye - don't wait too long"""
        try:
            await asyncio.sleep(timeout)
            if not self._closing_call and self.agent_said_goodbye:
                logger.debug(f"[{self.call_uuid[:8]}] Goodbye timeout - ending call")
                self._closing_call = True
                await self._hangup_call_delayed(0.5)
        except asyncio.CancelledError:
            pass

    async def _run_detection_engines(self, full_user: str, accumulated_text: str, full_agent: str, turn_duration_ms: float):
        """Run all detection engines in background task (non-blocking to audio path)"""
        try:
            loop = asyncio.get_event_loop()

            # Persona detection (one-time, locked after first detection)
            if self._use_persona_engine:
                if not self._detected_persona:
                    from src.persona_engine import detect_persona
                    detected = await loop.run_in_executor(
                        None, detect_persona, accumulated_text, self._custom_persona_keywords
                    )
                    if detected:
                        self._detected_persona = detected
                        self._prebuilt_setup_msg = None  # Invalidate — persona changed
                        self.log.detail(f"Persona detected: {detected}")

                # Situation detection (re-evaluated every turn)
                from src.persona_engine import detect_situations, get_situation_hint
                new_situations_list = await loop.run_in_executor(
                    None, detect_situations, full_user, self._custom_situation_keywords
                )
                self._active_situations = new_situations_list
                if self._active_situations:
                    self.log.detail(f"Situations active: {self._active_situations}")
                new_situations = set(self._active_situations) - set(self._previous_situations)
                if new_situations:
                    self._prebuilt_setup_msg = None  # Invalidate — situations changed
                    if self.goog_live_ws:
                        hint = get_situation_hint(list(new_situations)[0], self._custom_situation_keywords)
                        if hint:
                            asyncio.create_task(self._inject_situation_hint(hint))
                            self.log.detail(f"Injected situation hint: {list(new_situations)[0]}")
                self._previous_situations = list(self._active_situations)

            # Product section detection (only when product intelligence is enabled)
            if self._use_product_intelligence:
                if self._db_product_sections and self._db_product_keywords:
                    # DB keyword matching — progressively reveal sections (cap at 2)
                    from src.persona_engine import _normalize_transcription
                    text_lower = _normalize_transcription(full_user).lower()
                    active = []
                    for section_name, kw_list in self._db_product_keywords.items():
                        if section_name not in self._db_product_sections:
                            continue
                        keywords = kw_list if isinstance(kw_list, list) else kw_list.get("keywords", []) if isinstance(kw_list, dict) else []
                        for kw in keywords:
                            if isinstance(kw, str) and kw.lower() in text_lower:
                                active.append(section_name)
                                break
                    self._active_product_sections = active[:2]
                elif self._db_product_sections:
                    pass  # No keywords — stay empty until keywords provided
                else:
                    from src.product_intelligence import detect_product_sections
                    self._active_product_sections = await loop.run_in_executor(
                        None, detect_product_sections, full_user, self._active_situations
                    )
                if self._active_product_sections != self._previous_product_sections:
                    self._prebuilt_setup_msg = None  # Invalidate — product sections changed
                    self.log.detail(f"Product sections: {self._active_product_sections}")
                self._previous_product_sections = list(self._active_product_sections)

            # Linguistic Mirror
            if accumulated_text:
                from src.linguistic_mirror import detect_linguistic_style, style_changed
                new_style = await loop.run_in_executor(None, detect_linguistic_style, accumulated_text)
                if new_style and style_changed(self._linguistic_style, new_style):
                    self._previous_linguistic_style = dict(self._linguistic_style)
                    self._linguistic_style = new_style
                    self._prebuilt_setup_msg = None  # Invalidate — linguistic style changed
                    self.log.detail(f"Linguistic style: {new_style}")

            # Micro-Moment Detection
            if self._micro_moment_detector:
                response_time_ms = 0
                if self._agent_turn_complete_time and self._user_response_start_time:
                    response_time_ms = (self._user_response_start_time - self._agent_turn_complete_time) * 1000
                mm_hint = await loop.run_in_executor(
                    None, self._micro_moment_detector.record_turn,
                    self._turn_count, full_user, full_agent, response_time_ms, turn_duration_ms
                )
                if mm_hint and self.goog_live_ws:
                    asyncio.create_task(self._inject_situation_hint(mm_hint))
                    self.log.detail(f"Micro-moment: {self._micro_moment_detector.current_strategy}")

        except Exception as e:
            self.log.warn(f"Detection engine error: {e}")

    def _start_transcript_thread(self):
        """Start background thread for writing transcript to file (no latency impact)"""
        transcript_dir = Path(__file__).parent.parent.parent / "transcripts"
        transcript_dir.mkdir(exist_ok=True)
        self._transcript_file = transcript_dir / f"{self.call_uuid}.txt"

        def transcript_worker():
            while True:
                try:
                    item = self._transcript_queue.get(timeout=1.0)
                    if item is None:  # Shutdown signal
                        break
                    ts, role, text = item
                    with open(self._transcript_file, "a") as f:
                        f.write(f"[{ts}] {role}: {text}\n")
                except queue.Empty:
                    continue
                except Exception as e:
                    logger.error(f"Transcript writer error: {e}")

        self._transcript_thread = threading.Thread(target=transcript_worker, daemon=True)
        self._transcript_thread.start()

    def _save_transcript(self, role, text):
        """Save transcript to in-memory list, session DB, and queue file write (non-blocking)"""
        timestamp = datetime.now().strftime("%H:%M:%S")

        # Always add to in-memory list (for webhook backup)
        self._full_transcript.append({
            "role": role,
            "text": text,
            "timestamp": timestamp
        })

        # Add to session DB in-memory store (zero latency, batch written post-call)
        try:
            session_db.add_transcript_entry(self.call_uuid, role, text)
        except Exception:
            pass

        # Queue file write to background thread (non-blocking)
        if config.enable_transcripts:
            try:
                self._transcript_queue.put_nowait((timestamp, role, text))
            except queue.Full:
                pass

    def _start_recording_thread(self):
        """Start background thread for recording audio"""
        def recording_worker():
            while True:
                try:
                    item = self._recording_queue.get(timeout=1.0)
                    if item is None:  # Shutdown signal
                        break
                    self.audio_chunks.append(item)
                except queue.Empty:
                    continue
                except Exception as e:
                    logger.error(f"Recording thread error: {e}")

        self._recording_thread = threading.Thread(target=recording_worker, daemon=True)
        self._recording_thread.start()
        logger.debug("Recording thread started")

    def _start_conversation_logger(self):
        """Start background thread for saving conversation to file (no latency impact)"""
        def conversation_worker():
            while True:
                try:
                    item = self._conversation_queue.get(timeout=1.0)
                    if item is None:  # Shutdown signal
                        break
                    # Append to file
                    self._save_conversation_to_file(item)
                except queue.Empty:
                    continue
                except Exception as e:
                    logger.error(f"Conversation logger error: {e}")

        self._conversation_thread = threading.Thread(target=conversation_worker, daemon=True)
        self._conversation_thread.start()
        logger.debug("Conversation logger thread started")

    def _save_conversation_to_file(self, message: dict):
        """Append conversation message as JSONL line (called from background thread)"""
        try:
            with open(self._conversation_file, 'a') as f:
                f.write(json.dumps(message) + "\n")
        except Exception as e:
            logger.error(f"Error saving conversation to file: {e}")

    def _load_conversation_from_file(self) -> list:
        """Load conversation history from JSONL file for reconnection"""
        try:
            if self._conversation_file.exists():
                history = []
                with open(self._conversation_file, 'r') as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            history.append(json.loads(line))
                # Return only last N messages
                return history[-self._max_history_size:]
        except Exception as e:
            logger.error(f"Error loading conversation from file: {e}")
        return []

    def _log_conversation(self, role: str, text: str):
        """Queue conversation message for background file save (non-blocking)"""
        message = {"role": role, "text": text, "timestamp": time.time()}
        # Update in-memory cache
        self._conversation_history.append(message)
        if len(self._conversation_history) > self._max_history_size:
            self._conversation_history = self._conversation_history[-self._max_history_size:]
        # Queue for background file write
        try:
            self._conversation_queue.put_nowait(message)
        except queue.Full:
            pass

    def _record_audio(self, role: str, audio_bytes: bytes, sample_rate: int = 16000):
        """Record audio chunk for post-call transcription (non-blocking)"""
        if not self.recording_enabled or not self._recording_queue:
            return
        # Put in queue with timestamp - non-blocking, doesn't affect call latency
        try:
            timestamp = time.time()  # ~0.001ms, negligible
            self._recording_queue.put_nowait((role, audio_bytes, sample_rate, timestamp))
        except queue.Full:
            pass  # Drop frame if queue is full (shouldn't happen)

    def _resample_24k_to_16k(self, audio_bytes: bytes) -> bytes:
        """Resample 24kHz audio to 16kHz using numpy (fast linear interpolation).
        Used in the LIVE audio path — kept simple for low latency."""
        samples_24k = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32)
        n_in = len(samples_24k)
        n_out = int(n_in * 2 / 3)
        if n_out == 0:
            return b''
        x_new = np.linspace(0, n_in - 1, n_out, dtype=np.float32)
        samples_16k = np.interp(x_new, np.arange(n_in, dtype=np.float32), samples_24k)
        return np.clip(samples_16k, -32768, 32767).astype(np.int16).tobytes()

    @staticmethod
    def _resample_24k_to_16k_hq(audio_bytes: bytes) -> bytes:
        """High-quality 24k→16k resampling with proper anti-aliasing.
        Used ONLY in post-call recording path — never in live audio."""
        samples_24k = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32)
        if len(samples_24k) == 0:
            return b''
        try:
            from scipy.signal import resample_poly
            # Downsample by factor 2/3: up=2, down=3
            samples_16k = resample_poly(samples_24k, up=2, down=3)
        except ImportError:
            # Fallback to numpy linear interpolation
            n_in = len(samples_24k)
            n_out = int(n_in * 2 / 3)
            if n_out == 0:
                return b''
            x_new = np.linspace(0, n_in - 1, n_out, dtype=np.float32)
            samples_16k = np.interp(x_new, np.arange(n_in, dtype=np.float32), samples_24k)
        return np.clip(samples_16k, -32768, 32767).astype(np.int16).tobytes()

    def _save_recording(self):
        """Save stereo MP3: AI on left channel, USER on right channel.
        Uses a unified compressed timeline so both channels stay in sync."""
        logger.info(f"Saving recording: enabled={self.recording_enabled}, chunks={len(self.audio_chunks)}")
        if not self.recording_enabled or not self.audio_chunks:
            logger.warning(f"Skipping recording: enabled={self.recording_enabled}, chunks={len(self.audio_chunks)}")
            return None
        try:
            SAMPLE_RATE = 16000
            BYTES_PER_SAMPLE = 2  # 16-bit PCM
            MAX_GAP = 1.5  # Cap silence to 1.5s (natural pause)
            JITTER_THRESHOLD = 0.3  # Ignore gaps < 300ms (streaming jitter)

            # Sort ALL chunks by timestamp, resample AI 24k→16k
            sorted_chunks = []
            for role, audio_bytes, sample_rate, timestamp in self.audio_chunks:
                if sample_rate == 24000:
                    audio_bytes = self._resample_24k_to_16k_hq(audio_bytes)
                sorted_chunks.append((role, audio_bytes, timestamp))
            sorted_chunks.sort(key=lambda x: x[2])

            # --- Build unified compressed timeline ---
            # Walk all chunks in time order, compute a shared compressed position
            # for each chunk. Both AI and USER tracks use the same timeline.
            prev_end = sorted_chunks[0][2]  # Wall-clock end of previous chunk
            compressed_pos = 0.0  # Current position in compressed timeline

            chunk_placements = []  # (role, audio_bytes, compressed_byte_offset)
            for role, audio_bytes, timestamp in sorted_chunks:
                gap = timestamp - prev_end
                if gap > JITTER_THRESHOLD:
                    # Real gap — add compressed silence
                    compressed_pos += min(gap, MAX_GAP)
                # else: jitter — no gap, just concatenate

                byte_offset = int(compressed_pos * SAMPLE_RATE) * BYTES_PER_SAMPLE
                chunk_placements.append((role, audio_bytes, byte_offset))

                chunk_duration = len(audio_bytes) / (SAMPLE_RATE * BYTES_PER_SAMPLE)
                compressed_pos += chunk_duration
                prev_end = timestamp + chunk_duration

            # Allocate tracks and place chunks
            total_bytes = int(compressed_pos * SAMPLE_RATE) * BYTES_PER_SAMPLE
            ai_track = bytearray(total_bytes)
            user_track = bytearray(total_bytes)

            for role, audio_bytes, offset in chunk_placements:
                target = ai_track if role == "AI" else user_track
                end = offset + len(audio_bytes)
                if end <= len(target):
                    target[offset:end] = audio_bytes
                else:
                    # Clip to track length
                    fit = len(target) - offset
                    if fit > 0:
                        target[offset:offset + fit] = audio_bytes[:fit]

            max_len = len(ai_track)  # Both are same length

            # Interleave into stereo: [L_sample, R_sample, L_sample, R_sample, ...]
            ai_samples = np.frombuffer(ai_track, dtype=np.int16)
            user_samples = np.frombuffer(user_track, dtype=np.int16)
            stereo = np.empty(len(ai_samples) + len(user_samples), dtype=np.int16)
            stereo[0::2] = ai_samples   # Left channel = AI
            stereo[1::2] = user_samples  # Right channel = USER
            stereo_bytes = stereo.tobytes()

            duration_s = max_len / (SAMPLE_RATE * BYTES_PER_SAMPLE)
            ai_count = sum(1 for r, _, _ in chunk_placements if r == "AI")
            user_count = len(chunk_placements) - ai_count
            logger.info(f"Recording built: {duration_s:.1f}s stereo, {len(sorted_chunks)} chunks "
                        f"(AI: {ai_count}, USER: {user_count})")

            # Export as MP3 using pydub (10x smaller than WAV)
            mixed_mp3 = RECORDINGS_DIR / f"{self.call_uuid}_mixed.mp3"
            try:
                from pydub import AudioSegment
                audio_segment = AudioSegment(
                    data=stereo_bytes,
                    sample_width=2,
                    frame_rate=SAMPLE_RATE,
                    channels=2
                )
                audio_segment.export(str(mixed_mp3), format="mp3", bitrate="128k")
                logger.info(f"Stereo MP3 saved: {mixed_mp3.stat().st_size} bytes")
            except ImportError:
                logger.warning("pydub not installed, falling back to stereo WAV")
                mixed_mp3 = RECORDINGS_DIR / f"{self.call_uuid}_mixed.wav"
                with wave.open(str(mixed_mp3), 'wb') as wav:
                    wav.setnchannels(2)
                    wav.setsampwidth(2)
                    wav.setframerate(SAMPLE_RATE)
                    wav.writeframes(stereo_bytes)
                logger.info(f"Stereo WAV saved: {len(stereo_bytes)} bytes")

            return {
                "mixed_wav": mixed_mp3,
                "call_start": sorted_chunks[0][2]
            }
        except Exception as e:
            logger.error(f"Error saving recording: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return None

    def _transcribe_recording_sync(self, recording_info: dict, call_uuid: str):
        """Transcribe using Gemini 2.0 Flash with native speaker diarization"""
        try:
            from google import genai
            import time as time_module

            mixed_wav = recording_info.get("mixed_wav")

            if not mixed_wav or not mixed_wav.exists():
                logger.warning(f"No mixed recording found for {call_uuid}")
                return None

            logger.info(f"Starting Gemini transcription for {call_uuid}")

            # Initialize Gemini client
            client = genai.Client(api_key=config.google_api_key)

            # Upload the audio file
            logger.info(f"Uploading audio file for transcription...")
            audio_file = client.files.upload(file=str(mixed_wav))

            # Wait for processing
            while audio_file.state == "PROCESSING":
                time_module.sleep(2)
                audio_file = client.files.get(name=audio_file.name)

            if audio_file.state == "FAILED":
                logger.error(f"Gemini audio processing failed for {call_uuid}")
                return None

            # Generate transcript with speaker diarization
            prompt = """Transcribe this phone call audio accurately.

This is a stereo recording: the LEFT channel is the "Agent" (AI sales counselor) and the RIGHT channel is the "User" (customer).

Rules:
- Label left-channel speech as "Agent" and right-channel speech as "User"
- Format each line as: [MM:SS] Speaker: text
- Use timestamps from the audio
- Keep the transcript natural and accurate
- Do NOT add any commentary, just the transcript"""

            response = client.models.generate_content(
                model="gemini-2.0-flash",
                contents=[audio_file, prompt]
            )

            # Save transcript
            transcript_file = Path(__file__).parent.parent.parent / "transcripts" / f"{call_uuid}_final.txt"
            with open(transcript_file, "w") as f:
                f.write(response.text)

            # Clean up uploaded file
            try:
                client.files.delete(name=audio_file.name)
            except Exception:
                pass

            logger.info(f"Gemini transcription complete for {call_uuid}")
            return transcript_file

        except ImportError:
            logger.warning("google-genai not installed - skipping transcription")
            return None
        except Exception as e:
            logger.error(f"Gemini transcription error: {e}")
            return None

    async def preload(self):
        """Preload the Gemini session while phone is ringing"""
        try:
            self._preload_start_time = time.time()
            self.log.section("CALL INITIATED")
            self.log.phase("PRELOAD")
            self.log.detail(f"Phone: {self.caller_phone} ({self.context.get('customer_name', 'Unknown')})")
            self.log.detail(f"Prompt: {len(self.prompt):,} chars")
            self.is_active = True
            self._session_task = asyncio.create_task(self._run_google_live_session())
            try:
                await asyncio.wait_for(self._preload_complete.wait(), timeout=8.0)
                preload_ms = (time.time() - self._preload_start_time) * 1000
                self.log.detail_last(f"Preloaded: {len(self.preloaded_audio)} chunks in {preload_ms:.0f}ms")
            except asyncio.TimeoutError:
                preload_ms = (time.time() - self._preload_start_time) * 1000
                self.log.warn(f"Preload timeout ({preload_ms:.0f}ms), {len(self.preloaded_audio)} chunks")
            return True
        except Exception as e:
            self.log.error(f"Preload failed: {e}")
            return False

    def attach_plivo_ws(self, plivo_ws):
        """Attach Plivo WebSocket when user answers"""
        self.plivo_ws = plivo_ws
        self.call_start_time = datetime.now()
        self._call_answered_time = time.time()
        # Stop silence keepalive — real user audio will flow now
        if self._silence_keepalive_task:
            self._silence_keepalive_task.cancel()
            self._silence_keepalive_task = None
        # Reset agent turn end time to NOW — the greeting is about to play to the caller.
        # Without this, watchdog measures from preload generation time (seconds/minutes ago)
        # and fires a false "unresponsive" alarm while greeting is still playing.
        self._last_agent_turn_end_time = time.time()
        preload_count = len(self.preloaded_audio)
        self._preloaded_chunk_count = preload_count  # Save for watchdog timeout calc
        self.log.phase("CALL ANSWERED")
        if self._preload_start_time:
            wait_ms = (time.time() - self._preload_start_time) * 1000
            self.log.detail(f"Ring duration: {wait_ms:.0f}ms")
        self.log.detail(f"Plivo WS attached, {preload_count} preloaded chunks")
        # Start sender worker BEFORE sending preloaded audio so consumer is ready
        self._sender_worker_task = asyncio.create_task(self._plivo_sender_worker())
        if self.preloaded_audio:
            asyncio.create_task(self._send_preloaded_audio())
        else:
            self.log.warn("No preloaded audio - re-triggering greeting")
            # Re-trigger greeting so Gemini generates it in real-time
            self.greeting_sent = False
            self._greeting_trigger_time = time.time()
            asyncio.create_task(self._send_initial_greeting())
        # Start call duration timer
        self._timeout_task = asyncio.create_task(self._monitor_call_duration())
        # Start silence monitor (3 second SLA)
        self._silence_monitor_task = asyncio.create_task(self._monitor_silence())
        # Start session watchdog — detects dead Gemini sessions
        asyncio.create_task(self._session_watchdog())

    async def _send_preloaded_audio(self):
        """Send preloaded audio directly to plivo_send_queue"""
        # Minimal delay for Plivo WebSocket buffer to stabilize
        await asyncio.sleep(0.05)
        count = len(self.preloaded_audio)
        for audio in self.preloaded_audio:
            chunk = AudioChunk(audio_b64=audio, turn_id=0, sample_rate=24000)
            try:
                self._plivo_send_queue.put_nowait(chunk)
            except asyncio.QueueFull:
                self.log.warn("plivo_send_queue full during preload send")
        if self._call_answered_time:
            first_audio_ms = (time.time() - self._call_answered_time) * 1000
            self.log.detail_last(f"First audio to caller: {first_audio_ms:.0f}ms ({count} chunks)")
        self.preloaded_audio = []

    async def _send_silence_keepalive(self):
        """Send silence frames to Gemini between greeting completion and call answer.
        Prevents Gemini's VAD from going dormant during the ringing period.
        Without this, the preloaded session becomes unresponsive to user audio."""
        try:
            # 20ms of silence at 16kHz mono (320 bytes of zeros)
            silence_frame = base64.b64encode(bytes(320)).decode()
            silence_msg = json.dumps({
                "realtime_input": {
                    "media_chunks": [{
                        "mime_type": "audio/pcm;rate=16000",
                        "data": silence_frame
                    }]
                }
            })
            while self.is_active and not self.plivo_ws and self.goog_live_ws:
                try:
                    await self.goog_live_ws.send(silence_msg)
                except Exception:
                    break
                await asyncio.sleep(0.1)  # Send 10 silence frames per second
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.debug(f"[{self.call_uuid[:8]}] Silence keepalive ended: {e}")

    async def _monitor_call_duration(self):
        """Monitor call duration with periodic heartbeat and trigger wrap-up at 8 minutes"""
        try:
            logger.debug(f"[{self.call_uuid[:8]}] Call monitor started")

            # Heartbeat every 60 seconds until wrap-up time
            wrap_up_time = self.max_call_duration - 30  # 7:30
            elapsed = 0

            while elapsed < wrap_up_time:
                await asyncio.sleep(60)
                elapsed += 60
                if self.is_active and not self._closing_call:
                    logger.info(f"[{self.call_uuid[:8]}] Call in progress: {elapsed}s")
                else:
                    return  # Call ended, stop monitoring

            if self.is_active and not self._closing_call:
                logger.info(f"Call {self.call_uuid[:8]} reaching {self.max_call_duration}s limit - triggering wrap-up")
                self._closing_call = True
                await self._send_wrap_up_message()

                # Wait another 30 seconds then force end
                await asyncio.sleep(30)
                if self.is_active:
                    logger.info(f"Call {self.call_uuid[:8]} reached max duration - ending call")
                    await self.stop()
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Error in call duration monitor: {e}")

    async def _send_wrap_up_message(self):
        """Send a message to AI to wrap up the call"""
        if not self.goog_live_ws:
            return
        try:
            msg = {
                "client_content": {
                    "turns": [{
                        "role": "user",
                        "parts": [{"text": "[SYSTEM: Call time limit reached. Please politely wrap up the conversation now. Say a warm goodbye and end the call gracefully.]"}]
                    }],
                    "turn_complete": True
                }
            }
            await self.goog_live_ws.send(json.dumps(msg))
            logger.info("Sent wrap-up message to AI")
            self._save_transcript("SYSTEM", "Call time limit - wrapping up")
        except Exception as e:
            logger.error(f"Error sending wrap-up message: {e}")

    async def _monitor_silence(self):
        """Monitor for silence - nudge AI if no response after user speaks.
        IMPORTANT: Do NOT nudge if the AI just finished speaking (it asked a question
        and is waiting for the customer). Only nudge when the customer spoke and the AI
        hasn't responded."""
        try:
            while self.is_active and not self._closing_call:
                await asyncio.sleep(0.3)  # Check every 0.3 seconds for faster response

                if self._last_user_speech_time is None:
                    continue

                # Guard: If the AI finished speaking AFTER the user's last speech,
                # the AI already responded — no nudge needed. The AI is now waiting
                # for the customer to speak next.
                if (self._last_agent_turn_end_time
                        and self._last_agent_turn_end_time > self._last_user_speech_time):
                    self._last_user_speech_time = None  # Reset, AI already responded
                    continue

                silence_duration = time.time() - self._last_user_speech_time

                # Cooldown: skip nudge if a session split just completed (avoids triple-nudge storm)
                if self._last_split_time and (time.time() - self._last_split_time) < 5.0:
                    continue

                # If silence exceeds SLA, nudge the AI to respond
                if silence_duration >= self._silence_sla_seconds:
                    self.log.warn(f"{silence_duration:.1f}s silence - nudging AI")
                    await self._send_silence_nudge()
                    # Reset timer to avoid repeated nudges
                    self._last_user_speech_time = None

        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Error in silence monitor: {e}")

    async def _session_watchdog(self):
        """Detect dead Gemini sessions and force reconnection.
        Only fires when the session is GENUINELY dead — not when the AI is mid-generation.
        Key guard: if _current_turn_audio_chunks > 0, the AI is actively generating — NOT stuck."""
        try:
            # Short initial delay — just enough for greeting audio to start playing
            await asyncio.sleep(5.0)

            while self.is_active and not self._closing_call:
                # Guard: never fire if AI is currently generating audio or swap is in progress
                if self._current_turn_audio_chunks > 0 or self._swap_in_progress or self._agent_speaking:
                    await asyncio.sleep(2.0)
                    continue

                # CRITICAL CHECK: If goog_live_ws is None and we're not already reconnecting,
                # the main session loop died without recovery. Force emergency reconnect.
                if (not self.goog_live_ws
                        and not self._swap_in_progress
                        and self._last_user_audio_time
                        and (time.time() - self._last_user_audio_time) < 5.0):
                    self.log.warn("Session watchdog: WS is None but user audio flowing — forcing reconnect")
                    self._save_transcript("SYSTEM", "Watchdog: WS dead, forcing reconnect")
                    asyncio.create_task(self._emergency_session_split())
                    await asyncio.sleep(10.0)  # Cooldown after reconnect
                    continue

                # Check: user audio has been flowing but AI has generated
                # ZERO audio chunks since the last turn ended. Session is alive but unresponsive.
                # Use time since CALL ANSWERED (not since agent turn end) to handle the
                # preload gap — greeting completes during preload but user may not answer for 10-20s.
                if self._last_user_audio_time:
                    time_since_user = time.time() - self._last_user_audio_time
                    user_audio_flowing = time_since_user < 5.0

                    if user_audio_flowing and self._last_agent_turn_end_time:
                        time_since_agent = time.time() - self._last_agent_turn_end_time

                        # Post-greeting: user needs time to HEAR the greeting + respond.
                        # Greeting playback takes ~40ms per chunk. Add that to the base 15s timeout
                        # so the user gets a full 15s AFTER the greeting finishes playing.
                        # Cap playback estimate at 15s to avoid disabling the watchdog entirely.
                        greeting_playback_s = min(self._preloaded_chunk_count * 0.04, 15.0)
                        post_greeting_timeout = greeting_playback_s + 15.0
                        if self._turn_count <= 1 and time_since_agent > post_greeting_timeout and not getattr(self, '_post_greeting_watchdog_fired', False):
                            self._post_greeting_watchdog_fired = True
                            self.log.warn(f"Session watchdog: AI unresponsive for {time_since_agent:.0f}s after greeting "
                                          f"(timeout={post_greeting_timeout:.0f}s, playback={greeting_playback_s:.1f}s) — forcing reconnect")
                            self._save_transcript("SYSTEM", "Watchdog: AI unresponsive post-greeting, forcing reconnect")
                            asyncio.create_task(self._emergency_session_split())
                            await asyncio.sleep(10.0)  # Cooldown after reconnect
                            continue

                        # General unresponsive check for mid-call (turn > 1)
                        if time_since_agent > 10.0 and self._turn_count > 1:
                            self.log.warn(f"Session watchdog: AI unresponsive for {time_since_agent:.0f}s "
                                          f"— forcing reconnect")
                            self._save_transcript("SYSTEM", "Watchdog: AI unresponsive, forcing reconnect")
                            asyncio.create_task(self._emergency_session_split())
                            await asyncio.sleep(10.0)  # Cooldown after reconnect
                            continue

                await asyncio.sleep(2.0)  # Check every 2 seconds
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Error in session watchdog: {e}")

    async def _send_silence_nudge(self):
        """Send a nudge to AI when silence detected"""
        if not self.goog_live_ws or self._closing_call:
            return

        try:
            msg = {
                "client_content": {
                    "turns": [{
                        "role": "user",
                        "parts": [{"text": "[Respond to the customer]"}]
                    }],
                    "turn_complete": True
                }
            }
            await self.goog_live_ws.send(json.dumps(msg))
            logger.debug(f"[{self.call_uuid[:8]}] Sent nudge to AI")
        except Exception as e:
            logger.error(f"Error sending silence nudge: {e}")

    async def _send_greeting_nudge(self):
        """Send a greeting-specific nudge during preload when Gemini returns empty turns"""
        if not self.goog_live_ws or self._closing_call:
            return

        try:
            msg = {
                "client_content": {
                    "turns": [{
                        "role": "user",
                        "parts": [{"text": "[Start speaking now. Say your greeting out loud.]"}]
                    }],
                    "turn_complete": True
                }
            }
            await self.goog_live_ws.send(json.dumps(msg))
            logger.debug(f"[{self.call_uuid[:8]}] Sent greeting nudge to AI")
        except Exception as e:
            logger.error(f"Error sending greeting nudge: {e}")

    async def _post_swap_reengagement(self, swap_time: float):
        """Detect dead air after session split and proactively re-engage.
        If neither user nor bot speaks within 5s of a swap, nudge the bot
        so it breaks the silence instead of waiting forever."""
        try:
            await asyncio.sleep(5.0)
            if self._closing_call or not self.goog_live_ws:
                return
            # If a turn completed or user spoke since swap, someone is talking — no need
            if self._last_agent_turn_end_time and self._last_agent_turn_end_time > swap_time:
                return
            if self._last_user_speech_time and self._last_user_speech_time > swap_time:
                return
            self.log.warn("Post-swap dead air (5s) — nudging AI to re-engage")
            msg = {
                "client_content": {
                    "turns": [{"role": "user", "parts": [{"text": "[The customer is waiting. Say something brief to check if they are still there.]"}]}],
                    "turn_complete": True
                }
            }
            await self.goog_live_ws.send(json.dumps(msg))
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Post-swap reengagement error: {e}")

    async def _plivo_sender_worker(self):
        """Worker: Reads from plivo_send_queue, sends to Plivo WebSocket"""
        logger.debug(f"[{self.call_uuid[:8]}] Plivo sender worker started")
        try:
            while self.is_active:
                try:
                    chunk: AudioChunk = await asyncio.wait_for(
                        self._plivo_send_queue.get(), timeout=1.0
                    )
                except asyncio.TimeoutError:
                    continue

                if not self.plivo_ws:
                    continue

                try:
                    # Plivo only supports 8kHz or 16kHz — resample 24kHz Gemini output
                    audio_bytes = base64.b64decode(chunk.audio_b64)
                    if chunk.sample_rate == 24000:
                        audio_bytes = self._resample_24k_to_16k(audio_bytes)
                    payload_b64 = base64.b64encode(audio_bytes).decode()
                    await self.plivo_ws.send_text(json.dumps({
                        "event": "playAudio",
                        "media": {
                            "contentType": "audio/x-l16",
                            "sampleRate": 16000,
                            "payload": payload_b64
                        }
                    }))
                except Exception as e:
                    logger.error(f"[{self.call_uuid[:8]}] Plivo sender error: {e}")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"[{self.call_uuid[:8]}] Plivo sender worker error: {e}")
        logger.debug(f"[{self.call_uuid[:8]}] Plivo sender worker stopped")

    async def _send_reconnection_filler(self):
        """Handle silence during reconnection - clear stale audio and send silence frames
        to keep the audio stream alive (prevents 'dead line' feeling for the user)."""
        if not self.plivo_ws or self._closing_call:
            return
        try:
            logger.debug(f"[{self.call_uuid[:8]}] Preparing for reconnection")

            # Clear any pending audio to prevent stale data
            await self.plivo_ws.send_text(json.dumps({
                "event": "clearAudio",
                "stream_id": self.stream_id
            }))

            # Send silence frames to keep audio stream alive (200ms at 16kHz, 16-bit mono)
            silence = b'\x00' * 6400
            silence_b64 = base64.b64encode(silence).decode()
            await self.plivo_ws.send_text(json.dumps({
                "event": "playAudio",
                "media": {
                    "contentType": "audio/x-l16",
                    "sampleRate": 16000,
                    "payload": silence_b64
                }
            }))

        except Exception as e:
            logger.error(f"Error in reconnection filler: {e}")

    async def _connect_and_setup_ws(self, is_standby=False):
        """Create a new Gemini WS connection and send setup message.
        Returns the connected WS (caller must handle receive loop)."""
        label = "standby" if is_standby else "active"
        t0 = time.time()

        if config.use_vertex_ai:
            token = get_vertex_ai_token()
            if not token:
                logger.error("Failed to get Vertex AI token - falling back to Google AI Studio")
                url = f"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key={config.google_api_key}"
                extra_headers = None
            else:
                url = f"wss://{config.vertex_location}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent"
                extra_headers = {"Authorization": f"Bearer {token}"}
                self.log.detail(f"Vertex AI: {config.vertex_location} ({label})")
        else:
            url = f"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key={config.google_api_key}"
            extra_headers = None
            self.log.detail(f"Google AI Studio ({label})")

        ws_kwargs = {"ping_interval": 30, "ping_timeout": 20, "close_timeout": 5}
        if extra_headers:
            ws_kwargs["additional_headers"] = extra_headers

        ws = await websockets.connect(url, **ws_kwargs)
        connect_ms = (time.time() - t0) * 1000
        self.log.detail(f"Gemini {label} WS connected ({connect_ms:.0f}ms)")

        self._setup_sent_time = time.time()
        await self._send_session_setup_on_ws(ws, is_standby=is_standby)
        return ws

    async def _ws_receive_loop(self, ws, is_standby=False):
        """Receive loop for a Gemini WS. For standby, stops after setupComplete."""
        try:
            async for message in ws:
                if not self.is_active:
                    break
                resp = json.loads(message)
                if is_standby:
                    if "setupComplete" in resp:
                        self._standby_ready.set()
                        ready_ms = (time.time() - self._setup_sent_time) * 1000 if self._setup_sent_time else 0
                        self.log.detail(f"Standby session ready ({ready_ms:.0f}ms)")
                        continue
                    elif "goAway" in resp:
                        self.log.warn("Standby GoAway — will re-prewarm")
                        await self._close_ws_quietly(ws)
                        self._standby_ws = None
                        self._standby_ready = asyncio.Event()
                        self._standby_task = None
                        self._prewarm_task = asyncio.create_task(self._prewarm_standby_connection())
                        return
                else:
                    await self._receive_from_google(message)
        except asyncio.CancelledError:
            pass
        except websockets.exceptions.ConnectionClosed as e:
            if not is_standby:
                self.log.warn(f"Active WS closed: {e.code}")
                raise  # Re-raise so _run_google_live_session can reconnect

    async def _prewarm_standby_connection(self):
        """Pre-warm standby: connect WebSocket AND pre-build setup message.
        WS connection saves ~100-400ms, pre-built setup saves ~2-5s at swap time."""
        if self._standby_ws or self._swap_in_progress:
            return
        try:
            t0 = time.time()

            if config.use_vertex_ai:
                token = get_vertex_ai_token()
                if not token:
                    url = f"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key={config.google_api_key}"
                    extra_headers = None
                else:
                    url = f"wss://{config.vertex_location}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent"
                    extra_headers = {"Authorization": f"Bearer {token}"}
            else:
                url = f"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key={config.google_api_key}"
                extra_headers = None

            ws_kwargs = {"ping_interval": 30, "ping_timeout": 20, "close_timeout": 5}
            if extra_headers:
                ws_kwargs["additional_headers"] = extra_headers

            ws = await websockets.connect(url, **ws_kwargs)
            connect_ms = (time.time() - t0) * 1000
            self.log.detail(f"Standby WS connected ({connect_ms:.0f}ms)")

            self._standby_ws = ws

            # Pre-build the setup message now (no time pressure) so hot-swap just sends it
            try:
                self._prebuilt_setup_msg = self._build_setup_message()
                prompt_len = len(self._prebuilt_setup_msg["setup"]["system_instruction"]["parts"][0]["text"])
                self.log.detail(f"Standby setup pre-built ({prompt_len:,} chars)")
            except Exception as e:
                self.log.warn(f"Pre-build setup failed: {e}, will build at swap time")
                self._prebuilt_setup_msg = None
        except Exception as e:
            self.log.error(f"Standby connection failed: {e}")
            self._standby_ws = None

    async def _hot_swap_session(self):
        """Hot-swap: send FRESH setup to pre-connected standby, then swap.
        Setup is ALWAYS sent at swap time (never during prewarm) so system_instruction has current context."""
        if self._swap_in_progress or not self._standby_ws:
            self.log.warn("No standby available, falling back")
            await self._fallback_session_split()
            return

        self._swap_in_progress = True
        self._last_split_time = time.time()  # Set early to block nudges during swap
        swap_start = time.time()
        ws = self._standby_ws
        try:
            # Cancel any existing standby tasks
            if self._standby_task:
                self._standby_task.cancel()
                self._standby_task = None

            # Send setup with FRESH context (always at swap time, never prewarm)
            self._setup_sent_time = time.time()
            try:
                await self._send_session_setup_on_ws(ws, is_standby=False)
            except Exception as e:
                self.log.warn(f"Standby WS dead ({e}), falling back")
                await self._close_ws_quietly(ws)
                self._standby_ws = None
                await self._fallback_session_split()
                return

            # Wait for setupComplete
            setup_ok = False
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
                resp = json.loads(msg)
                if "setupComplete" in resp:
                    setup_ok = True
                    ready_ms = (time.time() - self._setup_sent_time) * 1000
                    self.log.detail(f"Standby setup ready ({ready_ms:.0f}ms, fresh context)")
            except (asyncio.TimeoutError, websockets.exceptions.ConnectionClosed) as e:
                self.log.warn(f"Standby setup failed: {e}")

            if not setup_ok:
                self.log.warn("Standby setup not ready, falling back")
                await self._close_ws_quietly(ws)
                self._standby_ws = None
                await self._fallback_session_split()
                return

            # Send anti-repetition reinforcement via client_content
            await self._send_context_to_ws(ws)

            # Step 4: Atomic swap — cancel old BEFORE starting new to prevent duplicate audio
            old_ws = self.goog_live_ws
            old_receive_task = self._active_receive_task

            # 1. Mute audio output to prevent any in-flight audio during swap
            self._mute_audio = True

            # 2. Cancel old receive task FIRST (stop old session from generating audio)
            if old_receive_task:
                old_receive_task.cancel()
            if self._standby_task:
                self._standby_task.cancel()
                self._standby_task = None

            # 3. Drain any in-flight audio from old session
            while not self._plivo_send_queue.empty():
                try:
                    self._plivo_send_queue.get_nowait()
                except asyncio.QueueEmpty:
                    break

            # 4. Swap to new session
            self.goog_live_ws = ws
            self._standby_ws = None

            # 5. Start new receive loop (only now, after old is cancelled)
            self._active_receive_task = asyncio.create_task(
                self._ws_receive_loop(self.goog_live_ws, is_standby=False)
            )

            # 6. Unmute and set post-swap hold (200ms before forwarding user audio)
            self._mute_audio = False
            self._post_swap_hold_until = time.time() + 0.2

            # 7. Close old WS in background
            asyncio.create_task(self._close_ws_quietly(old_ws))

            self._google_session_start = time.time()
            self._standby_ready = asyncio.Event()
            self._prewarm_task = None
            self._is_reconnecting = False
            self._split_pending = False
            self._split_pending_since = None

            session_age = (time.time() - swap_start)
            swap_ms = session_age * 1000
            self.log.phase(f"SESSION SPLIT (hot-swap at turn #{self._turn_count}) ✓")
            self.log.detail("Cancel old → drain queue → swap → start new (ordered)")
            self.log.detail_last(f"Swap: {swap_ms:.0f}ms")
            self._save_transcript("SYSTEM", f"Hot-swap session split at turn #{self._turn_count} ({swap_ms:.0f}ms)")

            # Launch dead air detector — will nudge bot if nobody speaks for 5s
            if self._post_swap_reengagement_task:
                self._post_swap_reengagement_task.cancel()
            self._post_swap_reengagement_task = asyncio.create_task(
                self._post_swap_reengagement(time.time())
            )
        finally:
            self._swap_in_progress = False
            self._last_split_time = time.time()

    async def _send_context_to_ws(self, ws):
        """Send minimal anti-repetition nudge via client_content.
        Full conversation context is already in the system_instruction — this just
        reinforces 'don't repeat' and 'wait for customer'.
        CRITICAL: turn_complete=False so Gemini does NOT treat this as a completed user
        turn and does NOT generate an immediate response (no more 'Understood...' pattern)."""
        last_user = self._last_user_text[:150] if self._last_user_text else ""
        agent_ref = (self._last_agent_text or self._last_agent_question or "")[:150]

        # Build progress hint for the nudge
        progress_hint = ""
        if self._conversation_milestones:
            progress_hint = f' Already done: {"; ".join(self._conversation_milestones[-3:])}.'

        # Detect if agent's last message was an unanswered question
        agent_ended_with_question = agent_ref and agent_ref.rstrip().endswith("?")

        if agent_ref and last_user:
            # Normal case: turn completed, user already responded
            trigger = (
                f'[Session resumed — there may have been a brief audio gap.{progress_hint} '
                f'Last customer said: "{last_user}". '
                f'Do NOT respond to this context message. Do NOT re-pitch or repeat anything already covered. '
                f'Wait for customer to speak next. If they say "hello" or "are you there", '
                f'briefly confirm "Yes, I am here" then continue the conversation FORWARD.]'
            )
        elif agent_ref and agent_ended_with_question:
            # Agent asked a question but user hasn't responded yet — don't wait silently
            trigger = (
                f'[Session resumed — there may have been a brief audio gap.{progress_hint} '
                f'You just asked a question but the customer may not have heard it due to the audio gap. '
                f'Wait a moment, then if the customer hasn\'t spoken, briefly say '
                f'"Are you still there?" or "Hello?" Do NOT repeat the original question verbatim. '
                f'Do NOT re-pitch or repeat anything already covered.]'
            )
        elif agent_ref:
            trigger = (
                f'[Session resumed — there may have been a brief audio gap.{progress_hint} '
                f'Wait for customer to speak. If they say "hello" or "are you there", '
                f'briefly confirm "Yes, I am here" then continue FORWARD. '
                f'Do NOT re-pitch or repeat anything already covered.]'
            )
        else:
            trigger = "[Session resumed. Wait silently for customer to speak. If they say hello, confirm you are here.]"

        # turn_complete: False — Gemini will NOT generate a response to this.
        # It will only respond when actual user audio triggers speech detection.
        msg = {"client_content": {"turns": [{"role": "user", "parts": [{"text": trigger}]}], "turn_complete": False}}
        await ws.send(json.dumps(msg))
        self.log.detail(f"Context sent (turn_complete=False): last='{agent_ref[:50]}'")

    async def _close_ws_quietly(self, ws):
        """Close a WS without error logging."""
        try:
            await ws.close()
        except Exception:
            pass

    async def _fallback_session_split(self):
        """Fallback when standby not available: close active WS and let main loop reconnect."""
        if not self.goog_live_ws or self._closing_call or self._is_reconnecting:
            return
        self._is_reconnecting = True
        self._standby_ready = asyncio.Event()
        self._split_pending = False
        self._split_pending_since = None
        self.log.phase(f"SESSION SPLIT (fallback at turn #{self._turn_count})")
        self._save_transcript("SYSTEM", f"Fallback session split at turn #{self._turn_count}")

        if self._standby_task:
            self._standby_task.cancel()
            self._standby_task = None
        if self._active_receive_task:
            self._active_receive_task.cancel()
            self._active_receive_task = None

        ws = self.goog_live_ws
        self.goog_live_ws = None
        await self._close_ws_quietly(ws)

        # Restart main session loop if it already exited (Fix 4: prevent permanent silence)
        if self.is_active and not self._closing_call:
            self._session_task = asyncio.create_task(self._run_google_live_session())

    async def _emergency_session_split(self):
        """Emergency split when GoAway fires with no standby: connect + setup + swap in one shot."""
        if self._swap_in_progress or self._closing_call:
            return
        self._swap_in_progress = True
        self._last_split_time = time.time()  # Set early to block nudges during swap
        self.log.phase("SESSION SPLIT (emergency — GoAway)")
        try:
            # Null out goog_live_ws immediately to stop audio send errors
            old_ws = self.goog_live_ws
            self.goog_live_ws = None

            if self._active_receive_task:
                self._active_receive_task.cancel()
                self._active_receive_task = None

            # Connect new WS + send setup with current context
            t0 = time.time()
            ws = await self._connect_and_setup_ws(is_standby=False)

            # Wait for setupComplete
            msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
            resp = json.loads(msg)
            if "setupComplete" not in resp:
                self.log.error("Emergency split: setup failed")
                await self._close_ws_quietly(ws)
                return

            # Send anti-repetition context
            await self._send_context_to_ws(ws)

            # Swap in
            self.goog_live_ws = ws
            self._active_receive_task = asyncio.create_task(
                self._ws_receive_loop(ws, is_standby=False)
            )
            asyncio.create_task(self._close_ws_quietly(old_ws))

            self._google_session_start = time.time()
            self._is_reconnecting = False
            self._split_pending = False
            self._split_pending_since = None
            # NOTE: No _post_swap_hold_until here — emergency splits are already disruptive,
            # adding a hold causes audio loss when the main loop also reconnects.
            swap_ms = (time.time() - t0) * 1000
            self.log.detail(f"Emergency swap complete ({swap_ms:.0f}ms)")
            self._save_transcript("SYSTEM", f"Emergency session split ({swap_ms:.0f}ms)")

            # Launch dead air detector — will nudge bot if nobody speaks for 5s
            if self._post_swap_reengagement_task:
                self._post_swap_reengagement_task.cancel()
            self._post_swap_reengagement_task = asyncio.create_task(
                self._post_swap_reengagement(time.time())
            )
        except Exception as e:
            self.log.error(f"Emergency split failed: {e}")
            self._is_reconnecting = True
            # Restart main session loop to trigger reconnection (Fix 4: prevent permanent silence)
            if self._active_receive_task:
                self._active_receive_task.cancel()
            if self.is_active and not self._closing_call:
                self._session_task = asyncio.create_task(self._run_google_live_session())
        finally:
            self._swap_in_progress = False
            self._last_split_time = time.time()

    def _build_compact_summary(self) -> str:
        """Build compact conversation summary for session split.
        Includes PROGRESS (what's been accomplished) + KEY FACTS + recent turn history."""
        if not self._turn_exchanges and not self._key_facts and not self._conversation_milestones and not self._questions_asked:
            return ""
        lines = []

        # CONVERSATION PROGRESS — critical for preventing repetition after splits
        # This tells the AI exactly where the conversation is, so it doesn't restart the pitch
        if self._conversation_milestones:
            lines.append("CONVERSATION PROGRESS (already accomplished — do NOT repeat these):")
            for milestone in self._conversation_milestones:
                lines.append(f"  ✓ {milestone}")
            lines.append("")

        # QUESTIONS ALREADY ASKED — prevents cross-session repetition
        if self._questions_asked:
            lines.append("QUESTIONS ALREADY ASKED (do NOT ask these again, even rephrased):")
            for q in self._questions_asked:
                lines.append(f"  ✗ {q}")
            lines.append("")

        # OBJECTION TECHNIQUES ALREADY TRIED — forces different approaches
        if self._objection_techniques_used:
            lines.append("OBJECTION TECHNIQUES ALREADY TRIED (use a DIFFERENT approach next time):")
            for t in self._objection_techniques_used:
                lines.append(f"  ✗ {t}")
            lines.append("")

        # KEY FACTS section — cumulative, survives all session splits
        if self._key_facts:
            lines.append("KEY FACTS (confirmed during this call):")
            for fact in self._key_facts:
                lines.append(f"  - {fact}")
            lines.append("")

        # Recent conversation — last 10 turns for context
        if self._turn_exchanges:
            lines.append("RECENT CONVERSATION:")
            exchanges = self._turn_exchanges[-10:]
            for i, ex in enumerate(exchanges):
                turn_num = self._turn_count - len(exchanges) + i + 1
                agent = ex.get("agent", "")[:200]
                user = ex.get("user", "")[:200]
                if agent and user:
                    lines.append(f"T{turn_num}: You: {agent} | Customer: {user}")
                elif agent:
                    lines.append(f"T{turn_num}: You: {agent}")
                elif user:
                    lines.append(f"T{turn_num}: Customer: {user}")

        lines.append("")
        lines.append(
            "ALL ABOVE IS DONE. Continue FORWARD from where you left off. "
            "Do NOT re-pitch, re-explain, or revisit ANY topic from the progress list above. "
            "Do NOT acknowledge this context. Respond naturally to what the customer says next."
        )
        return "\n".join(lines)

    async def _run_google_live_session(self):
        """Main session loop. Hot-swap handles planned transitions; this handles error recovery."""
        reconnect_attempts = 0
        max_reconnects = 5

        while self.is_active and reconnect_attempts < max_reconnects:
            ws = None
            try:
                ws = await self._connect_and_setup_ws(is_standby=False)
                self.goog_live_ws = ws
                reconnect_attempts = 0

                if self._reconnect_audio_buffer:
                    self.log.detail(f"Flushing {len(self._reconnect_audio_buffer)} buffered chunks")
                    for buffered_audio in self._reconnect_audio_buffer:
                        await self.handle_plivo_audio(buffered_audio)
                    self._reconnect_audio_buffer = []

                self._active_receive_task = asyncio.create_task(
                    self._ws_receive_loop(ws, is_standby=False)
                )
                await self._active_receive_task
                self._active_receive_task = None

                # If WS was replaced by hot-swap or emergency split, exit this loop
                if self.goog_live_ws is not None and self.goog_live_ws is not ws:
                    return

                # If an emergency split is in progress, it's handling reconnection —
                # do NOT start a competing reconnect (causes duplicate sessions).
                if self._swap_in_progress:
                    self.log.detail("Receive loop ended — emergency split in progress, waiting")
                    # Wait for emergency split to finish, then check if it succeeded
                    for _ in range(50):  # Up to 5 seconds
                        await asyncio.sleep(0.1)
                        if not self._swap_in_progress:
                            break
                    if self.goog_live_ws is not None and self.goog_live_ws is not ws:
                        return  # Emergency split succeeded, new session is active
                    # Emergency split failed, fall through to reconnect

                # Receive loop ended normally (WS closed cleanly, e.g. async for swallowed close).
                # If the call is still active, this is unexpected — reconnect.
                if self.is_active and not self._closing_call:
                    self.log.warn("WS receive loop ended unexpectedly — reconnecting")
                    self._is_reconnecting = True
                    reconnect_attempts += 1
                    asyncio.create_task(self._send_reconnection_filler())
                    await asyncio.sleep(0.2)
                    continue
                break

            except asyncio.CancelledError:
                if self.goog_live_ws is not None and self.goog_live_ws is not ws:
                    return
                break
            except Exception as e:
                self.log.error(f"Google Live error: {e}")
                if ws:
                    await self._close_ws_quietly(ws)
                if self.is_active and not self._closing_call:
                    self._is_reconnecting = True
                    reconnect_attempts += 1
                    self.log.warn(f"Reconnecting ({reconnect_attempts}/{max_reconnects})")
                    asyncio.create_task(self._send_reconnection_filler())
                    await asyncio.sleep(0.2)
                    continue
                break

        # Only null goog_live_ws if we still own it
        if self.goog_live_ws is ws:
            self.goog_live_ws = None

    def _pcm_to_wav(self, pcm_bytes: bytes, sample_rate: int = 16000, channels: int = 1, bits_per_sample: int = 16) -> bytes:
        """Convert raw PCM bytes to WAV format"""
        import io
        wav_buffer = io.BytesIO()

        with wave.open(wav_buffer, 'wb') as wav_file:
            wav_file.setnchannels(channels)
            wav_file.setsampwidth(bits_per_sample // 8)
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(pcm_bytes)

        return wav_buffer.getvalue()

    def _build_setup_message(self) -> dict:
        """Build the complete setup message dict (prompt + config).
        Expensive but safe to run ahead of time during prewarm."""
        # On session splits (not first connection), strip greeting instructions from memory
        # to prevent the AI from re-greeting mid-call
        if not self._is_first_connection and self.context.get("_memory_context"):
            # Use the original memory context (before any stripping) as source
            if not hasattr(self, "_original_memory_context"):
                self._original_memory_context = self.context["_memory_context"]
            raw = self._original_memory_context
            # Strip GREETING, AFTER GREETING, and FLOW lines to prevent re-greeting on session splits
            cleaned = "\n".join(
                line for line in raw.split("\n")
                if not line.strip().startswith(("GREETING:", "AFTER GREETING:", "FLOW:"))
            )
            cleaned += "\n[You are CONTINUING a mid-call conversation. Do NOT greet or re-introduce yourself.]"
            self.context["_memory_context"] = cleaned

        # Linguistic Mirror: build style instruction
        from src.linguistic_mirror import compose_mirror_instruction
        mirror_inst = compose_mirror_instruction(self._linguistic_style)

        if self._use_persona_engine:
            # UI prompt is ALWAYS the base — persona engine adds DB-configured prompts
            full_prompt = self.prompt

            # Add detected persona prompt
            if self._detected_persona:
                if self._custom_persona_keywords:
                    persona_label = self._detected_persona
                    persona_config = self._custom_persona_keywords.get(self._detected_persona, {})
                    persona_prompt = persona_config.get("prompt", "") if isinstance(persona_config, dict) else ""
                else:
                    persona_label = self._detected_persona.replace("_", " ").title()
                    persona_prompt = ""

                if persona_prompt:
                    full_prompt += f"\n\n[PERSONA: {persona_label}]\n{persona_prompt}"
                else:
                    # Fallback: generic hint if no custom prompt configured
                    full_prompt += (
                        f"\n\n[PERSONA DETECTED: {persona_label}. "
                        f"Tailor your pitch to resonate with their specific needs, priorities, and pain points.]"
                    )
                self.log.detail(f"Persona prompt injected: {persona_label} ({len(persona_prompt)} chars)")
            else:
                self.log.detail("No persona detected yet — prompt has no persona hint")

            # Add situation prompts — use DB prompts if available, fall back to hardcoded
            _FALLBACK_SITUATION_HINTS = {
                "price_objection": "Price Concern — Focus on value and ROI rather than price. Don't discount.",
                "high_interest": "High Interest — Customer is showing strong interest. Guide toward next steps and closing.",
                "skepticism": "Skepticism — Build credibility with facts, real results, and social proof.",
                "time_objection": "Time Concern — Emphasize flexibility, self-paced options, and minimal time commitment.",
                "competitor_comparison": "Competitor Comparison — Differentiate your offering, highlight unique strengths.",
            }
            for situation in self._active_situations[:2]:
                sit_prompt = ""
                if self._custom_situation_keywords:
                    sit_config = self._custom_situation_keywords.get(situation, {})
                    sit_prompt = sit_config.get("prompt", "") if isinstance(sit_config, dict) else ""
                if sit_prompt:
                    full_prompt += f"\n\n[SITUATION: {situation}]\n{sit_prompt}"
                else:
                    fallback = _FALLBACK_SITUATION_HINTS.get(situation, situation.replace("_", " ").title())
                    full_prompt += f"\n[SITUATION: {fallback}]"

            if mirror_inst:
                full_prompt += "\n\n" + mirror_inst
        else:
            full_prompt = self.prompt
            if mirror_inst:
                full_prompt += "\n\n" + mirror_inst

        # Product knowledge sections (loaded for both persona engine and direct prompt mode)
        if self._active_product_sections:
            if self._db_product_sections:
                # Use per-bot-config DB sections (not global file-based ones)
                parts = [self._db_product_sections[k] for k in self._active_product_sections if k in self._db_product_sections]
                product_content = "\n\n".join(parts) if parts else ""
            else:
                from src.product_intelligence import load_product_sections
                product_content = load_product_sections(self._active_product_sections)
            if product_content:
                full_prompt += "\n\n" + product_content

        # Speech style guidance removed — Gemini native audio handles this naturally,
        # and per-bot-config prompts can include tone instructions if needed.

        # Inject pre-call intelligence into system prompt (not as user message)
        if self._intelligence_brief:
            full_prompt += (
                "\n\n[BACKGROUND INTEL ON PROSPECT'S COMPANY/INDUSTRY — optional reference only. "
                "NEVER use this in your opening or greeting. Only reference IF the customer brings up "
                "their company or industry first. NEVER mention you looked anything up. "
                "IMPORTANT: This is about the COMPANY/INDUSTRY only — not the person. "
                "If the prospect's memory (above) contains their role, background, or interests, "
                "ALWAYS trust the memory over this intel. Never contradict memory data. "
                "Do NOT weave intel into conversation unprompted — wait for the customer to mention it.]\n"
                f"{self._intelligence_brief}"
            )

        # Pre-call social proof summary (generic aggregate stats)
        if self._social_proof_summary:
            if self._social_proof_min_turn and self._social_proof_min_turn > 0:
                full_prompt += (
                    f"\n\n[SOCIAL PROOF STATS - enrollment data you can reference ONLY after turn {self._social_proof_min_turn}. "
                    f"Do NOT call get_social_proof or reference enrollment numbers until you have completed at least {self._social_proof_min_turn} turns of discovery. "
                    "Focus on understanding the prospect first. Here are aggregate stats for later use:]\n"
                    f"{self._social_proof_summary}"
                )
            else:
                full_prompt += (
                    "\n\n[SOCIAL PROOF STATS - enrollment data you can reference naturally. "
                    "When the prospect mentions their company, city, or role, call get_social_proof "
                    "to get specific numbers. For now, here are aggregate stats:]\n"
                    f"{self._social_proof_summary}"
                )

        # Cross-call memory: injected inside compose_prompt() for persona engine,
        # but must be appended manually in direct prompt mode
        if self.context.get("_memory_context"):
            if not self._use_persona_engine:
                full_prompt += "\n\n" + self.context["_memory_context"]
            self.log.detail(f"Memory context injected ({len(self.context['_memory_context'])} chars)")

        # Real-time search usage instructions (only if live search is enabled)
        if config.enable_live_search:
            full_prompt += (
                "\n\nREAL-TIME KNOWLEDGE: You have access to Google Search. "
                "When the customer mentions their company, role, industry, or any specific entity, "
                "you may naturally reference relevant recent information. "
                "CRITICAL RULES: "
                "1) NEVER say 'I searched' or 'according to my research' or 'I found that' "
                "2) Weave information naturally: 'Oh [company], I heard they just...' "
                "3) Only use search when it genuinely helps the conversation "
                "4) Keep responses SHORT (1-2 sentences max) even when using search results"
            )

        # Inject current date/time so the AI knows "today" for all calls
        from datetime import datetime as _dt
        _now = _dt.now()
        full_prompt += f"\n\n[CURRENT DATE/TIME: {_now.strftime('%A, %B %d, %Y at %I:%M %p')}]"

        # Minimal universal rules — safety net for prompts that lack their own.
        # Kept short (~250 chars) to minimize latency impact.
        full_prompt += (
            "\n\n[CORE RULES] "
            "1) Max 1-2 sentences, then STOP and WAIT for the customer to respond. "
            "NEVER answer your own questions. NEVER continue talking after asking a question. "
            "2) If you receive context about a previous conversation, do NOT acknowledge it. "
            "Just wait for the customer to speak, then respond naturally."
        )

        # On reconnect or hot-swap, append conversation context + anti-repetition
        # to system_instruction so AI knows where the conversation is.
        if not self._is_first_connection:
            summary = self._build_compact_summary()
            if summary:
                full_prompt += f"\n\n[CONVERSATION SO FAR — you are mid-call, do NOT greet again:]\n{summary}"
                # Anti-repetition — compact, includes both sides + milestones
                agent_ref = self._last_agent_text or self._last_agent_question
                if agent_ref:
                    last_user = self._last_user_text or "(customer is about to respond)"
                    milestone_hint = ""
                    if self._conversation_milestones:
                        milestone_hint = (
                            f' ALREADY ACCOMPLISHED: {"; ".join(self._conversation_milestones)}. '
                            'These topics are DONE — never revisit them.'
                        )
                    full_prompt += (
                        f'\n\n[ANTI-REPETITION — Last exchange: You said: "{agent_ref[:400]}" '
                        f'Customer replied: "{last_user[:400]}".{milestone_hint} '
                        'Pick up EXACTLY from here. Respond directly to what the customer '
                        'just said and move the conversation FORWARD to a NEW topic. '
                        'Do NOT rephrase, re-pitch, or revisit anything from the conversation above. '
                        'Do NOT ask a question similar to anything already asked above.]'
                    )
                # Explicit questions blacklist for the new session
                if self._questions_asked:
                    questions_list = "; ".join(f'"{q[:80]}"' for q in self._questions_asked[-6:])
                    full_prompt += (
                        f'\n\n[QUESTIONS ALREADY ASKED — DO NOT ask these or anything similar: {questions_list}. '
                        'Ask something COMPLETELY NEW.]'
                    )
                # Explicit techniques blacklist for the new session
                if self._objection_techniques_used:
                    techniques_list = "; ".join(self._objection_techniques_used)
                    full_prompt += (
                        f'\n\n[OBJECTION TECHNIQUES ALREADY TRIED: {techniques_list}. '
                        'You MUST use a DIFFERENT technique next time.]'
                    )
                # Extra guard for post-greeting reconnects: the AI already greeted,
                # so NEVER repeat the greeting even if the summary includes it
                if self.greeting_sent and self._turn_count <= 1:
                    full_prompt += (
                        "\n\n[CRITICAL: You already greeted the customer with your opening line. "
                        "Do NOT say your greeting again. Do NOT introduce yourself again. "
                        "Do NOT say your name or company name again. "
                        "Simply respond to whatever the customer says next — like 'Hello' or 'Hi'.]"
                    )
                self.log.detail(f"Setup with summary ({len(summary)} chars)")
            else:
                file_history = self._load_conversation_from_file()
                if file_history:
                    history_text = "\n\n[Recent conversation - continue from here:]\n"
                    for msg_item in file_history[-self._max_history_size:]:
                        role = "Customer" if msg_item["role"] == "user" else "You"
                        history_text += f"{role}: {msg_item['text']}\n"
                    history_text += "\n[Continue naturally. Do NOT greet again.]"
                    full_prompt += history_text
                    self._is_reconnecting = False
                else:
                    # Emergency split with no turns recorded yet — greeting was already played
                    # but no conversation history exists. Prevent re-greeting.
                    if self.greeting_sent:
                        full_prompt += (
                            "\n\n[SESSION RESUMED — you already greeted the customer. "
                            "Do NOT greet again. Do NOT introduce yourself again. "
                            "Wait silently for the customer to speak first, then respond naturally.]"
                        )
                        self.log.detail("Setup with no-regreet guard (no turns yet)")

        # Render variables in the full composed prompt so {agent_name}, {company_name}
        # etc. work inside persona content, situation content, and product sections too
        full_prompt = render_prompt(full_prompt, self.context)

        # Use cached voice (set once on first connection, reused on all splits)
        if self._resolved_voice is None:
            self._resolved_voice = self.context.get("_voice") or detect_voice_from_prompt(self.prompt)
        voice_name = self._resolved_voice

        if config.use_vertex_ai:
            model_name = f"projects/{config.vertex_project_id}/locations/{config.vertex_location}/publishers/google/models/gemini-live-2.5-flash-native-audio"
        else:
            model_name = "models/gemini-2.5-flash-native-audio-preview-09-2025"

        msg = {
            "setup": {
                "model": model_name,
                "generation_config": {
                    "response_modalities": ["AUDIO"],
                    "speech_config": {
                        "voice_config": {
                            "prebuilt_voice_config": {
                                "voice_name": voice_name
                            }
                        }
                    },
                    "thinking_config": {
                        "thinking_budget": 0  # Disable reasoning for fastest responses
                    }
                },
                "realtime_input_config": {
                    "automatic_activity_detection": {
                        "disabled": False,
                        "start_of_speech_sensitivity": "START_SENSITIVITY_HIGH",
                        "end_of_speech_sensitivity": "END_SENSITIVITY_HIGH",
                        "prefix_padding_ms": 100,
                        "silence_duration_ms": 100,
                    }
                },
                "input_audio_transcription": {},
                "output_audio_transcription": {},
                "system_instruction": {"parts": [{"text": full_prompt}]},
                "tools": [
                    {"function_declarations": self._get_tool_declarations()},
                    *([] if not config.enable_live_search else [{"google_search": {}}])
                ]
            }
        }
        return msg

    async def _send_session_setup_on_ws(self, ws, is_standby=False):
        """Send setup message on a specific WS. Uses pre-built message if available (hot-swap path)."""
        # Use pre-built message if available (hot-swap path), otherwise build now (first connection / fallback)
        if self._prebuilt_setup_msg and not self._is_first_connection:
            msg = self._prebuilt_setup_msg
            self._prebuilt_setup_msg = None  # Consume it (one-time use)
            self.log.detail("Using pre-built setup message")
        else:
            msg = self._build_setup_message()

        full_prompt = msg["setup"]["system_instruction"]["parts"][0]["text"]
        voice_name = msg["setup"]["generation_config"]["speech_config"]["voice_config"]["prebuilt_voice_config"]["voice_name"]
        self.log.detail(f"System instruction: {len(full_prompt):,} chars")
        await ws.send(json.dumps(msg))
        label = "standby" if is_standby else ("first" if self._is_first_connection else "reconnect")
        self.log.detail(f"Setup sent ({label}), voice: {voice_name}")

    async def _send_initial_greeting(self):
        """Send initial trigger to make AI start the conversation"""
        if self.greeting_sent or not self.goog_live_ws:
            return
        self.greeting_sent = True

        # Auto-generate greeting trigger from context
        trigger_text = self.context.get("greeting_trigger", "")
        if not trigger_text:
            customer_name = self.context.get("customer_name", "")
            has_memory = bool(self.context.get("_memory_context"))
            if has_memory and customer_name:
                # Repeat caller: short greeting referencing last time, then ask ONE question
                trigger_text = (
                    f"[Start the conversation now. This is a REPEAT CALLER. "
                    f"Say ONE short sentence greeting {customer_name} — mention your name and reference last time. "
                    f"Then ask ONE short follow-up question. Keep the ENTIRE greeting under 15 words total. "
                    f"OVERRIDE: Ignore any longer greeting scripted in your instructions. Be brief.]"
                )
            elif customer_name:
                trigger_text = (
                    f"[Start the conversation now. OVERRIDE any greeting script in your instructions. "
                    f"Say ONLY this: 'Hey {customer_name}, {{agent_name}} from {{company_name}}. Is this a bad time?' "
                    f"Nothing else. Do NOT add context about any event or masterclass. STOP after asking 'Is this a bad time?']"
                )
            else:
                trigger_text = (
                    "[Start the conversation now. OVERRIDE any greeting script in your instructions. "
                    "Say ONLY: your name, company, then 'Is this a bad time?' Nothing else. STOP after the question.]"
                )

        msg = {
            "client_content": {
                "turns": [{"role": "user", "parts": [{"text": trigger_text}]}],
                "turn_complete": True
            }
        }
        await self.goog_live_ws.send(json.dumps(msg))
        self.log.detail("Greeting trigger sent")

    async def _send_reconnection_trigger(self):
        """Send context after fallback reconnection.
        CRITICAL: turn_complete=False so Gemini does NOT generate an immediate response.
        Same fix as _send_context_to_ws — prevents 'Understood...' pattern."""
        if not self.goog_live_ws:
            return

        # Use the same context-sending logic as hot-swap
        await self._send_context_to_ws(self.goog_live_ws)
        logger.debug(f"[{self.call_uuid[:8]}] Reconnect context sent (turn_complete=False)")

    async def _handle_tool_call(self, tool_call):
        """Execute tool and send response back to Gemini - gracefully handles errors"""
        func_calls = tool_call.get("functionCalls", [])
        for fc in func_calls:
            tool_name = fc.get("name")
            tool_args = fc.get("args", {})
            call_id = fc.get("id")

            self.log.detail(f"Tool: {tool_name}")
            self._save_transcript("TOOL", f"{tool_name}: {tool_args}")

            # Handle end_call tool
            if tool_name == "end_call":
                reason = tool_args.get("reason", "conversation ended")
                self.log.detail(f"End call: {reason}")

                # PERSEVERANCE GUARD: Block premature end_call before turn 8
                # This ensures the AI tries multiple reframes before giving up
                if self._turn_count < 8:
                    self.log.warn(f"end_call BLOCKED at turn {self._turn_count} (min 8) — telling AI to persist")
                    self._save_transcript("SYSTEM", f"end_call blocked at turn {self._turn_count}: {reason}")
                    try:
                        tool_response = {
                            "tool_response": {
                                "function_responses": [{
                                    "id": call_id,
                                    "name": tool_name,
                                    "response": {
                                        "success": False,
                                        "message": (
                                            "REJECTED: Too early to end. You have NOT tried enough reframes. "
                                            "The customer saying 'don't know' or 'not interested' is NORMAL. "
                                            "Try a different angle: share a story, use social proof, or flip the frame. "
                                            "Keep going — do NOT end the call yet."
                                        )
                                    }
                                }]
                            }
                        }
                        await self.goog_live_ws.send(json.dumps(tool_response))
                    except Exception:
                        pass
                    return

                self._save_transcript("SYSTEM", f"Agent requested call end: {reason}")

                # Mark agent as having said goodbye
                self.agent_said_goodbye = True

                # Send success response
                try:
                    tool_response = {
                        "tool_response": {
                            "function_responses": [{
                                "id": call_id,
                                "name": tool_name,
                                "response": {"success": True, "message": "Waiting for mutual goodbye before ending"}
                            }]
                        }
                    }
                    await self.goog_live_ws.send(json.dumps(tool_response))
                except Exception:
                    pass

                # Check if user already said goodbye
                self._check_mutual_goodbye()

                # Fallback: if user doesn't respond within 5 seconds, end anyway
                if not self._closing_call:
                    asyncio.create_task(self._fallback_hangup(5.0))
                return

            # Handle save_user_info tool — saves user details via Gemini's audio understanding
            if tool_name == "save_user_info":
                try:
                    from src.cross_call_memory import save_from_tool_call
                    t_company = tool_args.get("company")
                    t_role = tool_args.get("role")
                    t_name = tool_args.get("name")
                    t_key_detail = tool_args.get("key_detail")

                    save_from_tool_call(
                        phone=self.caller_phone,
                        company=t_company,
                        role=t_role,
                        name=t_name,
                        key_detail=t_key_detail,
                        org_id=self.context.get("_org_id", ""),
                    )
                    self.log.detail(f"User info saved: company={t_company}, role={t_role}, name={t_name}")

                    # Track key facts for session split context (survives all splits)
                    if t_role:
                        fact = f"Customer role: {t_role}"
                        if t_company:
                            fact += f" at {t_company}"
                        if fact not in self._key_facts:
                            self._key_facts.append(fact)
                    elif t_company:
                        fact = f"Customer company: {t_company}"
                        if fact not in self._key_facts:
                            self._key_facts.append(fact)
                    if t_key_detail:
                        fact = f"Key detail: {t_key_detail}"
                        if fact not in self._key_facts:
                            self._key_facts.append(fact)

                    # Update session state for persona detection
                    # NOTE: Do NOT inject fabricated text into _accumulated_user_text —
                    # it must stay user-speech-only for memory extraction accuracy.
                    # Build a separate string for persona detection only.
                    if t_role and not self._detected_persona:
                        from src.persona_engine import detect_persona
                        role_text = f"I work as a {t_role}" + (f" at {t_company}" if t_company else "")
                        detection_text = self._accumulated_user_text + " " + role_text
                        detected = detect_persona(detection_text, self._custom_persona_keywords)
                        if detected:
                            self._detected_persona = detected
                            self._prebuilt_setup_msg = None  # Invalidate — persona changed
                            self.log.detail(f"Persona detected from tool call: {detected}")
                except Exception as e:
                    logger.error(f"save_user_info error: {e}")

                # Send success response so conversation continues
                try:
                    tool_response = {
                        "tool_response": {
                            "function_responses": [{
                                "id": call_id,
                                "name": tool_name,
                                "response": {"success": True, "message": "Information saved"}
                            }]
                        }
                    }
                    await self.goog_live_ws.send(json.dumps(tool_response))
                except Exception:
                    pass
                return

            # Handle get_social_proof tool — returns enrollment stats for conversation
            if tool_name == "get_social_proof":
                # Gate: if min turn threshold not reached, tell AI to continue discovery instead
                if self._social_proof_min_turn and self._turn_count < self._social_proof_min_turn:
                    self.log.detail(f"Social proof BLOCKED at turn {self._turn_count} (min {self._social_proof_min_turn}) — telling AI to continue discovery")
                    sp_result = {
                        "instruction": "Social proof data is not available yet. Continue with discovery questions — build more rapport before referencing stats. Do NOT mention enrollment numbers or company stats yet."
                    }
                else:
                    try:
                        from src.social_proof import get_social_proof as _get_social_proof
                        sp_result = _get_social_proof(
                            company=tool_args.get("company"),
                            city=tool_args.get("city"),
                            role=tool_args.get("role"),
                        )
                        self.log.detail(f"Social proof: company={tool_args.get('company')}, city={tool_args.get('city')}, role={tool_args.get('role')}")
                    except Exception as e:
                        logger.error(f"get_social_proof error: {e}")
                        sp_result = {"general_phrase": "We have thousands of enrollees across India.", "instruction": "Use this general stat naturally."}

                # Send tool response back to Gemini
                try:
                    tool_response = {
                        "tool_response": {
                            "function_responses": [{
                                "id": call_id,
                                "name": tool_name,
                                "response": sp_result
                            }]
                        }
                    }
                    await self.goog_live_ws.send(json.dumps(tool_response))
                except Exception:
                    pass
                return

            # Handle configurable GHL workflow tools (tag-based) — fire-and-forget
            if tool_name.startswith("ghl_workflow_"):
                wf_id = tool_name.replace("ghl_workflow_", "")
                reason = tool_args.get("reason", "")
                wf = next((w for w in self._ghl_workflows if w.get("id") == wf_id), None)
                wf_name = wf.get("name", wf_id) if wf else wf_id
                self.log.detail(f"GHL workflow '{wf_name}': {reason}")
                self._save_transcript("TOOL", f"{tool_name}: {reason}")

                if wf_id in self._triggered_workflows:
                    msg = f"Workflow '{wf_name}' already triggered this call"
                elif not wf or not wf.get("tag"):
                    msg = "Workflow not found or missing tag"
                elif not self.ghl_api_key or not self.ghl_location_id:
                    msg = "GHL API key or Location ID not configured in org settings"
                else:
                    # Mark as triggered and send immediate response to unblock Gemini
                    self._triggered_workflows.add(wf_id)
                    msg = f"Workflow '{wf_name}' triggered"
                    # Execute GHL HTTP calls in background (fire-and-forget)
                    asyncio.create_task(self._bg_ghl_tag(
                        tag=wf["tag"], wf_name=wf_name, wf_id=wf_id,
                    ))

                # Send immediate response to Gemini — don't wait for HTTP
                try:
                    tool_response = {
                        "tool_response": {
                            "function_responses": [{
                                "id": call_id,
                                "name": tool_name,
                                "response": {"success": wf_id in self._triggered_workflows, "message": msg}
                            }]
                        }
                    }
                    await self.goog_live_ws.send(json.dumps(tool_response))
                except Exception:
                    pass
                return

            # Handle send_whatsapp tool - trigger GHL workflow (legacy) — fire-and-forget
            if tool_name == "send_whatsapp":
                reason = tool_args.get("reason", "")
                self.log.detail(f"Send WhatsApp: {reason}")
                self._save_transcript("TOOL", f"send_whatsapp: {reason}")

                if self._whatsapp_sent:
                    msg = "WhatsApp already sent this call"
                    self.log.detail(msg)
                elif not self.ghl_api_key or not self.ghl_location_id:
                    msg = "WhatsApp not configured - GHL API key or location ID missing"
                    self.log.warn(msg)
                else:
                    self._whatsapp_sent = True
                    milestone = f"WhatsApp/details sent to customer (turn {self._turn_count})"
                    if milestone not in self._conversation_milestones:
                        self._conversation_milestones.append(milestone)
                    msg = "WhatsApp triggered via GHL contact tag"
                    # Execute GHL HTTP calls in background (fire-and-forget)
                    asyncio.create_task(self._bg_ghl_tag(
                        tag="ai-onboardcall-goldmember", wf_name="send_whatsapp",
                    ))

                # Send immediate response to Gemini — don't wait for HTTP
                try:
                    tool_response = {
                        "tool_response": {
                            "function_responses": [{
                                "id": call_id,
                                "name": tool_name,
                                "response": {"success": self._whatsapp_sent, "message": msg}
                            }]
                        }
                    }
                    await self.goog_live_ws.send(json.dumps(tool_response))
                except Exception:
                    pass
                return

            # Execute the tool with context for templates - graceful error handling
            try:
                tool_start = time.time()
                result = await execute_tool(tool_name, self.caller_phone, context=self.context, **tool_args)
                tool_ms = (time.time() - tool_start) * 1000
                success = result.get("success", False)
                message = result.get("message", "Tool executed")
                self.log.detail(f"Tool result: {'OK' if success else 'FAIL'} ({tool_ms:.0f}ms)")
            except Exception as e:
                logger.error(f"Tool execution error for {tool_name}: {e}")
                success = False
                message = f"Tool temporarily unavailable, but conversation can continue"

            logger.debug(f"TOOL RESULT: success={success}, message={message}")
            self._save_transcript("TOOL_RESULT", f"{tool_name}: {'success' if success else 'failed'}")

            # Always send tool response back to Gemini so conversation continues
            try:
                tool_response = {
                    "tool_response": {
                        "function_responses": [{
                            "id": call_id,
                            "name": tool_name,
                            "response": {
                                "success": success,
                                "message": message
                            }
                        }]
                    }
                }
                await self.goog_live_ws.send(json.dumps(tool_response))
                logger.debug(f"Sent tool response for {tool_name}")
            except Exception as e:
                logger.error(f"Error sending tool response: {e} - continuing conversation")

    async def _bg_ghl_tag(self, tag: str, wf_name: str, wf_id: str = ""):
        """Execute GHL tagging in background — fire-and-forget, never blocks audio."""
        try:
            from src.services.ghl_whatsapp import tag_ghl_contact
            result = await tag_ghl_contact(
                phone=self.caller_phone,
                email=self.context.get("email", ""),
                api_key=self.ghl_api_key,
                location_id=self.ghl_location_id,
                tag=tag,
            )
            if result.get("success"):
                self.log.detail(f"GHL bg tag '{tag}' OK")
                milestone = f"Workflow '{wf_name}' triggered (turn {self._turn_count})"
                if milestone not in self._conversation_milestones:
                    self._conversation_milestones.append(milestone)
            else:
                self.log.warn(f"GHL bg tag '{tag}' failed: {result.get('error', 'unknown')}")
        except Exception as e:
            self.log.warn(f"GHL bg tag '{tag}' error: {e}")

    async def _fallback_hangup(self, timeout: float):
        """Fallback hangup if user doesn't respond after agent says goodbye"""
        try:
            await asyncio.sleep(timeout)
            if not self._closing_call and self.agent_said_goodbye:
                logger.info(f"Fallback hangup - user didn't respond within {timeout}s after agent goodbye")
                self._closing_call = True
                await self._hangup_call_delayed(1.0)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Fallback hangup error: {e}")

    async def _hangup_call_delayed(self, delay: float):
        """Hang up the call after a short delay (audio is queued in Plivo buffer)"""
        try:
            await asyncio.sleep(delay)

            hangup_uuid = self.plivo_call_uuid or self.call_uuid
            self.log.detail(f"Plivo hangup API: {hangup_uuid}")

            import httpx
            import base64

            # Use per-org Plivo credentials if available, otherwise fall back to defaults
            auth_id = self.plivo_auth_id or config.plivo_auth_id
            auth_token = self.plivo_auth_token or config.plivo_auth_token
            auth_string = f"{auth_id}:{auth_token}"
            auth_b64 = base64.b64encode(auth_string.encode()).decode()

            url = f"https://api.plivo.com/v1/Account/{auth_id}/Call/{hangup_uuid}/"

            t0 = time.time()
            async with httpx.AsyncClient() as client:
                response = await client.delete(
                    url,
                    headers={"Authorization": f"Basic {auth_b64}"}
                )
                api_ms = (time.time() - t0) * 1000

                if response.status_code in [204, 200]:
                    self.log.detail(f"Plivo hangup OK ({api_ms:.0f}ms)")
                else:
                    self.log.error(f"Plivo hangup failed: {response.status_code} ({api_ms:.0f}ms)")

        except Exception as e:
            logger.error(f"Error hanging up call {self.call_uuid}: {type(e).__name__}: {e}")
            import traceback
            traceback.print_exc()
        finally:
            # Always stop the session
            if self.is_active:
                await self.stop()

    async def _receive_from_google(self, message):
        try:
            resp = json.loads(message)

            # Log all Gemini responses for debugging
            resp_keys = list(resp.keys())
            if resp_keys != ['serverContent']:  # Don't log every content message
                logger.debug(f"Gemini response keys: {resp_keys}")

            if "setupComplete" in resp:
                setup_ms = (time.time() - self._setup_sent_time) * 1000 if self._setup_sent_time else 0
                self.log.detail(f"AI ready ({setup_ms:.0f}ms)")
                self.start_streaming = True
                self.setup_complete = True
                self._google_session_start = time.time()
                self._save_transcript("SYSTEM", f"AI ready ({setup_ms:.0f}ms)")
                if self._is_first_connection:
                    self._is_first_connection = False
                    self._greeting_trigger_time = time.time()
                    await self._send_initial_greeting()
                elif self._is_reconnecting:
                    self._is_reconnecting = False
                    await self._send_reconnection_trigger()

            # Handle GoAway message - 9-minute warning before 10-minute session limit
            if "goAway" in resp:
                self.log.warn("GoAway — triggering session split")
                self._save_transcript("SYSTEM", "Session GoAway (10-min limit)")
                if self._standby_ws:
                    asyncio.create_task(self._hot_swap_session())
                else:
                    # No standby — prewarm + swap immediately
                    asyncio.create_task(self._emergency_session_split())
                return

            # Handle tool calls
            if "toolCall" in resp:
                await self._handle_tool_call(resp["toolCall"])
                return

            if "serverContent" in resp:
                sc = resp["serverContent"]

                # Check if turn is complete (greeting done)
                if sc.get("turnComplete"):
                    # Only mark preload complete if greeting audio was actually generated.
                    # Empty turnComplete (0 chunks) = Gemini returned no audio; the nudge
                    # handler will retry, and the NEXT turnComplete with audio will fire this.
                    if self.preloaded_audio or self.plivo_ws or self._preload_complete.is_set():
                        self._preload_complete.set()
                    self.greeting_audio_complete = True
                    self._turn_count += 1
                    self._current_turn_id += 1

                    # Start silence keepalive if call hasn't been answered yet.
                    # This prevents Gemini's VAD from going dormant during ringing.
                    if not self.plivo_ws and self._turn_count == 1:
                        self._silence_keepalive_task = asyncio.create_task(
                            self._send_silence_keepalive()
                        )

                    if self._turn_start_time and self._current_turn_audio_chunks > 0:
                        turn_duration_ms = (time.time() - self._turn_start_time) * 1000
                        full_agent = ""
                        full_user = ""
                        if self._current_turn_agent_text:
                            full_agent = " ".join(self._current_turn_agent_text)
                            self._last_agent_text = full_agent
                            if "?" in full_agent:
                                self._last_agent_question = full_agent
                                # Track question sentences for anti-repetition across splits
                                q_sentences = [s.strip() for s in full_agent.replace("!", ".").replace("?", "?.").split(".") if "?" in s]
                                for q in q_sentences[-2:]:
                                    q = q.strip()
                                    if len(q) > 10 and q not in self._questions_asked:
                                        self._questions_asked.append(q)
                                if len(self._questions_asked) > 12:
                                    self._questions_asked = self._questions_asked[-12:]
                            self._current_turn_agent_text = []
                        if self._current_turn_user_text:
                            full_user = " ".join(self._current_turn_user_text)
                            self._last_user_text = full_user
                            self._current_turn_user_text = []
                        # Track turn exchanges for compact summary
                        if full_agent or full_user:
                            self._turn_exchanges.append({"agent": full_agent, "user": full_user})
                            if len(self._turn_exchanges) > 16:
                                self._turn_exchanges = self._turn_exchanges[-16:]

                        # Auto-extract key facts from conversation for session split context
                        if full_user and len(full_user) > 10:
                            user_lower = full_user.lower()
                            # Track pain points mentioned by user
                            pain_keywords = ["challenge", "difficult", "hard", "struggle", "frustrat",
                                             "problem", "issue", "worry", "fear", "concern", "losing",
                                             "behind", "keeping up", "overwhelm"]
                            for kw in pain_keywords:
                                if kw in user_lower and len(self._key_facts) < 8:
                                    fact = f"Pain point (turn {self._turn_count}): {full_user[:120]}"
                                    # Don't add duplicate pain points
                                    if not any("Pain point" in f and full_user[:40] in f for f in self._key_facts):
                                        self._key_facts.append(fact)
                                    break
                            # Track objections
                            objection_keywords = ["expensive", "too much", "can't afford", "not interested",
                                                  "don't need", "no thanks", "not sure", "think about it"]
                            for kw in objection_keywords:
                                if kw in user_lower and len(self._key_facts) < 8:
                                    fact = f"Objection (turn {self._turn_count}): {full_user[:120]}"
                                    if not any("Objection" in f and full_user[:40] in f for f in self._key_facts):
                                        self._key_facts.append(fact)
                                    break
                        if full_agent:
                            # Track what was pitched
                            agent_lower = full_agent.lower()
                            if "gold membership" in agent_lower and not any("Product mentioned" in f for f in self._key_facts):
                                self._key_facts.append("Product mentioned: Gold Membership pitched to customer")

                            # Track objection-handling techniques for anti-repetition across splits
                            technique_patterns = [
                                (["costing you", "cost of", "what if nothing changes", "where does that leave"], "Cost-of-inaction / future projection"),
                                (["the money or", "specifically what's holding"], "Isolate-the-objection (money vs value)"),
                                (["what changes", "different three months", "different six months"], "Future-state challenge"),
                                (["emi", "installment", "per month"], "EMI/payment plan offered"),
                            ]
                            for keywords, technique_name in technique_patterns:
                                if any(kw in agent_lower for kw in keywords):
                                    if technique_name not in self._objection_techniques_used:
                                        self._objection_techniques_used.append(technique_name)

                        # Auto-detect conversation milestones for session split context
                        if full_agent and full_user:
                            agent_lower = (full_agent or "").lower()
                            user_lower = (full_user or "").lower()
                            # Detect when agent pitches/presents the offer
                            pitch_signals = ["program", "membership", "course", "mentorship", "offer",
                                             "designed for", "specifically for", "here's what you get"]
                            if any(s in agent_lower for s in pitch_signals):
                                m = "Product/program pitched to customer"
                                if m not in self._conversation_milestones:
                                    self._conversation_milestones.append(m)
                            # Detect when customer shows agreement/interest to proceed
                            agreement_signals = ["sounds good", "that's great", "interested", "tell me more",
                                                 "send me", "share me", "go ahead", "sign me up", "i'm in",
                                                 "let's do it", "of course", "definitely"]
                            if any(s in user_lower for s in agreement_signals):
                                m = f"Customer showed interest/agreed (turn {self._turn_count})"
                                # Keep only the latest agreement milestone
                                self._conversation_milestones = [
                                    x for x in self._conversation_milestones
                                    if not x.startswith("Customer showed interest")
                                ]
                                self._conversation_milestones.append(m)
                            # Detect when pricing/payment is discussed
                            price_signals = ["price", "cost", "payment", "rupees", "₹", "invest",
                                             "fee", "discount", "emi"]
                            if any(s in agent_lower for s in price_signals):
                                m = "Pricing/payment discussed"
                                if m not in self._conversation_milestones:
                                    self._conversation_milestones.append(m)
                            # Detect when scheduling/next steps discussed
                            schedule_signals = ["schedule", "book", "calendar", "appointment", "demo",
                                                "next step", "follow up", "call back"]
                            if any(s in agent_lower for s in schedule_signals):
                                m = "Next steps/scheduling discussed"
                                if m not in self._conversation_milestones:
                                    self._conversation_milestones.append(m)

                        # Accumulate user text for detection engines (product, linguistic mirror, persona)
                        if full_user:
                            self._accumulated_user_text += " " + full_user

                        # Run detection engines in background (non-blocking)
                        if full_user:
                            asyncio.create_task(self._run_detection_engines(
                                full_user, self._accumulated_user_text, full_agent, turn_duration_ms
                            ))

                        # Update timing markers for next turn's response time measurement
                        self._agent_turn_complete_time = time.time()
                        self._user_response_start_time = None

                        extra = ""
                        if self._split_pending:
                            extra = "split pending"
                        elif (self._google_session_start
                              and (time.time() - self._google_session_start) >= (self._session_split_after_seconds - 60)):
                            extra = "prewarm standby"
                        self.log.turn(self._turn_count, extra)
                        if full_agent:
                            self.log.agent(full_agent)
                        if full_user:
                            self.log.user(full_user)
                        # Compute TTFB for this turn (user speech end → first AI audio)
                        ttfb_str = ""
                        if self._turn_first_byte_time and self._last_user_speech_time is None:
                            # _last_user_speech_time was reset when first audio arrived
                            pass
                        self.log.metric(f"{turn_duration_ms:.0f}ms | {self._current_turn_audio_chunks} chunks")
                        self._turn_first_byte_time = None
                        self._turn_start_time = None

                    # Detect empty turn (AI didn't generate audio) - nudge to respond
                    # Skip nudge during post-split cooldown to avoid triple-nudge storm
                    is_empty_turn = self._current_turn_audio_chunks == 0
                    post_split_cooldown = self._last_split_time and (time.time() - self._last_split_time) < 5.0
                    if is_empty_turn and self.greeting_audio_complete and not self._closing_call and not post_split_cooldown:
                        self._empty_turn_nudge_count += 1
                        if self._empty_turn_nudge_count <= 3:
                            # During preload (no caller yet), use greeting-specific nudge
                            if not self.plivo_ws:
                                self.log.warn(f"Empty turn, nudging AI with greeting prompt ({self._empty_turn_nudge_count}/3)")
                                asyncio.create_task(self._send_greeting_nudge())
                            else:
                                self.log.warn(f"Empty turn, nudging AI ({self._empty_turn_nudge_count}/3)")
                                asyncio.create_task(self._send_silence_nudge())
                    else:
                        self._empty_turn_nudge_count = 0

                    # Time-based session split — check session age
                    session_age = (time.time() - self._google_session_start) if self._google_session_start else 0

                    # Pre-warm standby 1 minute before split threshold
                    if (session_age >= (self._session_split_after_seconds - 60)
                            and not self._standby_ws
                            and not self._prewarm_task
                            and not self._closing_call
                            and not self.agent_said_goodbye
                            and self.greeting_audio_complete):
                        self._prewarm_task = asyncio.create_task(self._prewarm_standby_connection())

                    # Set split pending at threshold (defer to silence gap)
                    if (session_age >= self._session_split_after_seconds
                            and not is_empty_turn
                            and not self._closing_call
                            and not self._goodbye_pending
                            and not self.agent_said_goodbye
                            and self.greeting_audio_complete
                            and not self._split_pending):
                        self._split_pending = True
                        self._split_pending_since = time.time()
                        self.log.detail(f"Split pending (session age: {session_age:.0f}s)")

                    # Reset turn audio counter
                    self._current_turn_audio_chunks = 0
                    self._last_agent_turn_end_time = time.time()

                    # Process deferred goodbye detection (agent finished speaking)
                    if self._goodbye_pending and not self._closing_call:
                        self._goodbye_pending = False
                        self.log.detail("Agent goodbye detected")
                        self.agent_said_goodbye = True
                        self._check_mutual_goodbye()

                if sc.get("interrupted"):
                    # Only clear audio if significant audio has already been sent for this turn.
                    # This prevents residual user noise from wiping out the AI's response
                    # before the user has heard anything.
                    chunks_sent = self._current_turn_audio_chunks
                    has_real_user_speech = self._last_user_transcript_time > 0

                    if not has_real_user_speech:
                        # No user has spoken yet (just background noise from phone pickup).
                        # NEVER clear audio here — the greeting is still playing.
                        self.log.warn(f"AI interrupt IGNORED (no user speech yet — protecting greeting)")
                    elif chunks_sent > 10:
                        # Genuine interruption — user spoke while AI was talking
                        self.log.warn(f"AI interrupted (after {chunks_sent} chunks sent) — clearing audio")
                        while not self._plivo_send_queue.empty():
                            try:
                                self._plivo_send_queue.get_nowait()
                            except asyncio.QueueEmpty:
                                break
                        if self.plivo_ws:
                            await self.plivo_ws.send_text(json.dumps({"event": "clearAudio", "stream_id": self.stream_id}))
                    else:
                        # Likely residual noise — don't clear, let the audio play
                        self.log.warn(f"AI interrupt IGNORED (only {chunks_sent} chunks sent — likely noise)")

                # Capture user speech transcription from Gemini
                # Handle both field names: inputTranscription (current API) and inputTranscript (legacy)
                transcription_data = sc.get("inputTranscription") or sc.get("inputTranscript")
                if transcription_data:
                    # Can be a dict {"text": "..."} or a plain string
                    if isinstance(transcription_data, dict):
                        user_text = transcription_data.get("text", "")
                    else:
                        user_text = str(transcription_data)
                    logger.debug(f"[{self.call_uuid[:8]}] Input transcript: {user_text}")
                    if user_text and user_text.strip():
                        user_text = user_text.strip()

                        # Filter out noise/silence markers - NOT real speech
                        is_noise = user_text.startswith('<') and user_text.endswith('>')
                        if not is_noise:
                            self._last_user_speech_time = time.time()  # Track for latency
                            self._last_user_transcript_time = time.time()
                            # Micro-moment: capture when user FIRST speaks this turn
                            if self._user_response_start_time is None:
                                self._user_response_start_time = time.time()
                            logger.debug(f"[{self.call_uuid[:8]}] USER fragment: {user_text}")
                            self._current_turn_user_text.append(user_text)
                            self._save_transcript("USER", user_text)
                            self._log_conversation("user", user_text)
                            # Track if user said goodbye
                            if self._is_goodbye_message(user_text):
                                logger.debug(f"[{self.call_uuid[:8]}] User goodbye detected")
                                self.user_said_goodbye = True
                                self._check_mutual_goodbye()

                # Handle AI speech transcription (outputTranscription)
                output_transcription = sc.get("outputTranscription")
                if output_transcription:
                    if isinstance(output_transcription, dict):
                        ai_text = output_transcription.get("text", "")
                    else:
                        ai_text = str(output_transcription)
                    if ai_text and ai_text.strip():
                        ai_text = ai_text.strip()
                        logger.debug(f"[{self.call_uuid[:8]}] AGENT fragment: {ai_text}")
                        self._has_output_transcription = True
                        self._current_turn_agent_text.append(ai_text)
                        self._save_transcript("AGENT", ai_text)
                        self._log_conversation("model", ai_text)
                        # Defer goodbye detection to turnComplete (avoid cutting call mid-sentence)
                        if not self._closing_call and self._is_goodbye_message(ai_text):
                            self._goodbye_pending = True

                if "modelTurn" in sc:
                    parts = sc.get("modelTurn", {}).get("parts", [])
                    for p in parts:
                        if p.get("inlineData", {}).get("data"):
                            audio = p["inlineData"]["data"]
                            audio_bytes = base64.b64decode(audio)
                            # Track audio chunks for empty turn detection
                            self._current_turn_audio_chunks += 1
                            # Track turn start time and TTFB
                            if self._current_turn_audio_chunks == 1:
                                self._turn_start_time = time.time()
                                self._turn_first_byte_time = time.time()
                                self._agent_speaking = True
                                self._user_speaking = False
                                # Log greeting TTFB (trigger → first audio)
                                if self._greeting_trigger_time and not self._first_audio_time:
                                    self._first_audio_time = time.time()
                                    ttfb_ms = (self._first_audio_time - self._greeting_trigger_time) * 1000
                                    self.log.detail(f"Greeting TTFB: {ttfb_ms:.0f}ms")
                            # Record AI audio (24kHz)
                            self._record_audio("AI", audio_bytes, 24000)

                            # Latency check - only log if slow (> threshold)
                            if self._last_user_speech_time:
                                latency_ms = (time.time() - self._last_user_speech_time) * 1000
                                if latency_ms > LATENCY_THRESHOLD_MS:
                                    self.log.warn(f"Slow response: {latency_ms:.0f}ms")
                                self._last_user_speech_time = None  # Reset after first response

                            # During preload (no plivo_ws yet), always store audio
                            if not self.plivo_ws:
                                self.preloaded_audio.append(audio)
                            elif self._mute_audio:
                                # Swap in progress — suppress audio to prevent duplicates
                                pass
                            elif self.plivo_ws:
                                # Send directly to plivo_send_queue
                                chunk = AudioChunk(
                                    audio_b64=audio,
                                    turn_id=self._current_turn_id,
                                    sample_rate=24000
                                )
                                try:
                                    self._plivo_send_queue.put_nowait(chunk)
                                except asyncio.QueueFull:
                                    logger.warning(f"[{self.call_uuid[:8]}] plivo_send_queue full, dropping chunk")
                                # Log first chunk for this turn
                                if self._current_turn_audio_chunks == 1:
                                    logger.debug(f"[{self.call_uuid[:8]}] Audio -> Plivo send queue")
                        if p.get("text"):
                            ai_text = p["text"].strip()
                            logger.debug(f"AI TEXT: {ai_text[:100]}...")
                            # Only save actual speech, not thinking/planning text
                            is_thinking = (
                                ai_text.startswith("**") or
                                ai_text.startswith("I've registered") or
                                ai_text.startswith("I'll ") or
                                "My first step" in ai_text or
                                "I'll be keeping" in ai_text or
                                "maintaining the" in ai_text or
                                "waiting for their response" in ai_text
                            )
                            if ai_text and not is_thinking and len(ai_text) > 3:
                                # Skip entirely if outputTranscription already captured this speech
                                # (prevents duplicate "Got it... Got it..." in transcript and buffer)
                                if not self._has_output_transcription:
                                    self._current_turn_agent_text.append(ai_text)
                                    self._save_transcript("AGENT", ai_text)
                                    self._log_conversation("model", ai_text)
                                    # Defer goodbye detection to turnComplete (avoid cutting call mid-sentence)
                                    if not self._closing_call and self._is_goodbye_message(ai_text):
                                        self._goodbye_pending = True

                # Reset per-turn dedup flag AFTER processing all content in this message
                # (moved from turnComplete to avoid resetting before content is processed)
                if sc.get("turnComplete"):
                    self._has_output_transcription = False
        except Exception as e:
            logger.error(f"Error processing Google message: {e} - continuing session")

    async def handle_plivo_audio(self, audio_b64):
        """Handle incoming audio from Plivo - graceful error handling"""
        try:
            if not self.is_active or not self.start_streaming:
                return  # Skip silently to reduce log noise
            # After agent said goodbye, stop forwarding audio to Gemini
            # This prevents Gemini from responding again (repeating goodbye)
            if self.agent_said_goodbye or self._closing_call:
                return
            if not self.goog_live_ws:
                # Track user audio time even when buffering — watchdog needs this
                # to detect dead sessions and trigger reconnection
                self._last_user_audio_time = time.time()
                # Buffer audio during reconnection (don't lose user speech)
                if len(self._reconnect_audio_buffer) < self._max_reconnect_buffer:
                    self._reconnect_audio_buffer.append(audio_b64)
                    if len(self._reconnect_audio_buffer) == 1:
                        logger.warning("Google WS disconnected - buffering audio for reconnection")
                return

            # Post-swap hold: buffer audio briefly after swap so Gemini processes context first
            now = time.time()
            if now < self._post_swap_hold_until:
                if len(self._reconnect_audio_buffer) < self._max_reconnect_buffer:
                    self._reconnect_audio_buffer.append(audio_b64)
                return
            elif self._post_swap_hold_until > 0 and self._reconnect_audio_buffer:
                # Hold expired — flush buffered audio. Copy + clear first to avoid
                # re-append feedback loop if handle_plivo_audio re-buffers.
                self._post_swap_hold_until = 0
                to_flush = list(self._reconnect_audio_buffer)
                self._reconnect_audio_buffer = []
                for buffered in to_flush:
                    await self.handle_plivo_audio(buffered)

            chunk = base64.b64decode(audio_b64)

            # Detect when user starts speaking (after agent finished)
            if self._last_user_audio_time is None or (now - self._last_user_audio_time) > 1.0:
                # Gap > 1 second means new user speech segment
                if self._agent_speaking or not self._user_speaking:
                    self._user_speaking = True
                    self._agent_speaking = False
                    self._user_speech_start_time = now
                    logger.debug(f"[{self.call_uuid[:8]}] User speaking")

                # Silence gap detected — trigger deferred split if pending
                if self._split_pending and not self._swap_in_progress:
                    self._split_pending = False
                    self._split_pending_since = None
                    self.log.detail("Silence gap detected — triggering deferred split")
                    asyncio.create_task(self._hot_swap_session())
            elif self._split_pending and self._split_pending_since:
                # Safety timeout: force split after 20s even without silence gap.
                # 10s was too aggressive — after a long model response, user needs time
                # to process before speaking, and background phone noise prevents gap detection.
                if (now - self._split_pending_since) > 20.0 and not self._swap_in_progress:
                    self._split_pending = False
                    self._split_pending_since = None
                    self.log.warn("Split pending >20s without silence gap — forcing split")
                    asyncio.create_task(self._hot_swap_session())

            self._last_user_audio_time = now

            # Record user audio (16kHz)
            self._record_audio("USER", chunk, 16000)
            self.inbuffer.extend(chunk)
            chunks_sent = 0
            while len(self.inbuffer) >= self.BUFFER_SIZE:
                ac = self.inbuffer[:self.BUFFER_SIZE]
                msg = {"realtime_input": {"media_chunks": [{"mime_type": "audio/pcm;rate=16000", "data": base64.b64encode(bytes(ac)).decode()}]}}
                try:
                    # Send to main voice model (native audio)
                    await self.goog_live_ws.send(json.dumps(msg))
                    chunks_sent += 1
                    # Log first chunk sent to Gemini for this user speech
                    if chunks_sent == 1 and self._user_speaking:
                        logger.debug(f"[{self.call_uuid[:8]}] Sending user audio to Gemini")
                except Exception as send_err:
                    logger.error(f"Error sending audio to Google: {send_err} - triggering reconnect")
                    # Null out dead WS so subsequent audio gets buffered (line 1659)
                    self.goog_live_ws = None
                    self.inbuffer.clear()
                    # Buffer current audio for replay after reconnect
                    if len(self._reconnect_audio_buffer) < self._max_reconnect_buffer:
                        self._reconnect_audio_buffer.append(audio_b64)
                    # Trigger emergency session split (same as GoAway handling)
                    if not self._swap_in_progress and not self._closing_call:
                        asyncio.create_task(self._emergency_session_split())
                    return
                self.inbuffer = self.inbuffer[self.BUFFER_SIZE:]
        except Exception as e:
            logger.error(f"Audio processing error: {e} - continuing session")

    async def handle_plivo_message(self, message):
        event = message.get("event")
        if event == "media":
            payload = message.get("media", {}).get("payload", "")
            if payload:
                await self.handle_plivo_audio(payload)
        elif event == "start":
            self.stream_id = message.get("start", {}).get("streamId", "")
            logger.info(f"Stream started: {self.stream_id}")
        elif event == "stop":
            await self.stop()

    async def stop(self):
        if not self.is_active:
            return

        self.is_active = False
        self.log.section("CALL ENDED")

        # Cancel all tasks
        for task in [self._timeout_task, self._silence_monitor_task,
                     self._sender_worker_task, self._standby_task,
                     self._prewarm_task, self._active_receive_task,
                     self._post_swap_reengagement_task]:
            if task:
                task.cancel()

        # Close standby WS
        if self._standby_ws:
            await self._close_ws_quietly(self._standby_ws)
            self._standby_ws = None

        # Calculate call duration and log summary
        duration = 0
        if self.call_start_time:
            duration = (datetime.now() - self.call_start_time).total_seconds()
            mins = int(duration // 60)
            secs = duration % 60
            self.log.detail(f"Duration: {mins}m {secs:.0f}s | Turns: {self._turn_count}")
            if self._first_audio_time and self._greeting_trigger_time:
                ttfb = (self._first_audio_time - self._greeting_trigger_time) * 1000
                self.log.detail(f"Greeting TTFB: {ttfb:.0f}ms")
            if self._call_answered_time and self._preload_start_time:
                preload_total = (self._call_answered_time - self._preload_start_time) * 1000
                self.log.detail_last(f"Preload→Answer: {preload_total:.0f}ms")
            self._save_transcript("SYSTEM", f"Call duration: {duration:.1f}s, turns: {self._turn_count}")

        if self.goog_live_ws:
            try:
                await self.goog_live_ws.close()
            except Exception:
                pass
        if self._session_task:
            self._session_task.cancel()

        self._save_transcript("SYSTEM", "Call ended")

        # Trigger post-call GHL workflows (tag-based)
        for wf in self._ghl_workflows:
            if wf.get("timing") == "post_call" and wf.get("enabled") and wf.get("tag"):
                if not self.ghl_api_key or not self.ghl_location_id:
                    logger.warning(f"Post-call GHL workflow '{wf.get('name', wf.get('id', '?'))}' skipped — GHL API key or Location ID not configured")
                    continue
                try:
                    from src.services.ghl_whatsapp import tag_ghl_contact
                    result = await tag_ghl_contact(
                        phone=self.caller_phone,
                        email=self.context.get("email", ""),
                        api_key=self.ghl_api_key,
                        location_id=self.ghl_location_id,
                        tag=wf["tag"],
                    )
                    self.log.detail(f"Post-call GHL workflow '{wf.get('name', wf['id'])}' tag '{wf['tag']}': {result}")
                except Exception as e:
                    logger.warning(f"Post-call GHL workflow '{wf.get('name', wf.get('id', '?'))}' failed: {e}")

        # Stop recording thread
        if self._recording_queue:
            self._recording_queue.put(None)  # Shutdown signal
        if self._recording_thread:
            self._recording_thread.join(timeout=2.0)

        # Stop transcript writer thread
        if self._transcript_queue:
            self._transcript_queue.put(None)  # Shutdown signal
        if self._transcript_thread:
            self._transcript_thread.join(timeout=2.0)

        # Stop conversation logger thread
        if self._conversation_queue:
            self._conversation_queue.put(None)  # Shutdown signal
        if self._conversation_thread:
            self._conversation_thread.join(timeout=2.0)

        self._start_post_call_processing(duration)

    def _start_post_call_processing(self, duration: float):
        """Run all post-call processing (save, transcribe, DB update, webhook) in background thread"""
        def process_in_background():
            try:
                # Step 1: Save recording
                recording_info = self._save_recording()

                # Step 2: Finalize call immediately — do NOT wait for transcription
                # This ensures /calls/{uuid}/status returns "completed" right away
                # so the frontend stops polling and the webhook can be sent.
                session_db.finalize_call(
                    self.call_uuid,
                    status="completed",
                    ended_at=datetime.now(),
                    duration_seconds=round(duration, 1),
                    persona=self._detected_persona,
                )

                # Step 3: Transcribe (Gemini 2.0 Flash or Whisper) — runs after status update
                if recording_info and config.enable_whisper:
                    self._transcribe_recording_sync(recording_info, self.call_uuid)

                # Step 4: Build transcript text
                transcript = ""
                try:
                    transcript_dir = Path(__file__).parent.parent.parent / "transcripts"
                    final_transcript = transcript_dir / f"{self.call_uuid}_final.txt"
                    realtime_transcript = transcript_dir / f"{self.call_uuid}.txt"
                    if final_transcript.exists():
                        transcript = final_transcript.read_text()
                    elif realtime_transcript.exists():
                        transcript = realtime_transcript.read_text()
                except Exception:
                    pass
                # Fallback to in-memory transcript
                if not transcript.strip() and self._full_transcript:
                    transcript = "\n".join([
                        f"[{t['timestamp']}] {t['role']}: {t['text']}"
                        for t in self._full_transcript
                    ])

                # Step 4.5: Generate AI call summary from transcript
                ai_summary = ""
                if transcript.strip():
                    try:
                        ai_summary = self._generate_call_summary_sync(transcript)
                        logger.info(f"[{self.call_uuid[:8]}] AI summary generated ({len(ai_summary)} chars)")
                    except Exception as e:
                        logger.warning(f"Summary generation error: {e}")

                # Step 5: Save cross-call memory (per phone number)
                try:
                    from src.cross_call_memory import extract_and_save_memory
                    # Derive interest level
                    completion_rate = self._turn_count / max(self._turn_count, 1)
                    if completion_rate > 0.7:
                        interest_level = "High"
                    elif completion_rate > 0.4:
                        interest_level = "Medium"
                    else:
                        interest_level = "Low"
                    # Gather all situations that were active during the call
                    all_situations = list(set(
                        self._previous_situations + self._active_situations
                    ))
                    extract_and_save_memory(
                        phone=self.caller_phone,
                        contact_name=self.context.get("customer_name", ""),
                        call_uuid=self.call_uuid,
                        detected_persona=self._detected_persona,
                        active_situations=all_situations,
                        turn_exchanges=list(self._turn_exchanges),
                        accumulated_user_text=self._accumulated_user_text,
                        duration=duration,
                        interest_level=interest_level,
                        linguistic_style=self._linguistic_style,
                        org_id=self.context.get("_org_id", ""),
                    )
                except Exception as e:
                    logger.error(f"Cross-call memory save error: {e}")

                # Step 5.5: Update DB with transcript, summary, and detected data
                try:
                    update_fields = {}
                    if transcript.strip():
                        update_fields["transcript"] = transcript
                    if ai_summary:
                        update_fields["call_summary"] = ai_summary
                    if self._active_product_sections:
                        update_fields["collected_responses"] = json.dumps({
                            "product_sections": list(set(self._active_product_sections)),
                            "situations": list(set(self._previous_situations + self._active_situations)),
                        })
                    if update_fields:
                        session_db.update_call(self.call_uuid, **update_fields)
                except Exception as e:
                    logger.error(f"Post-call DB update error: {e}")

                # Step 6: Call webhook AFTER everything is saved
                if self.webhook_url:
                    import asyncio as _asyncio
                    loop = _asyncio.new_event_loop()
                    _asyncio.set_event_loop(loop)
                    try:
                        loop.run_until_complete(self._call_webhook(duration, transcript, ai_summary))
                    finally:
                        loop.close()

                logger.info(f"[{self.call_uuid[:8]}] Post-call processing complete")
            except Exception as e:
                logger.error(f"Post-call processing error: {e}")

        # Start background thread - call ends immediately, this runs separately
        processing_thread = threading.Thread(target=process_in_background, daemon=True)
        processing_thread.start()

    def _generate_call_summary_sync(self, transcript: str) -> str:
        """Generate a concise AI summary from the call transcript using Gemini."""
        if not transcript or not transcript.strip():
            return ""
        try:
            from google import genai as _genai
            client = _genai.Client(api_key=config.google_api_key)
            contact = self.context.get("customer_name", "the contact")
            prompt = (
                f"You are a sales call analyst. Summarize this call transcript in 2-3 sentences.\n"
                f"Focus on: what the contact said about their situation, interest level, "
                f"any objections or concerns raised, and the outcome.\n"
                f"Contact name: {contact}\n\n"
                f"TRANSCRIPT:\n{transcript[:4000]}\n\n"
                f"Respond with ONLY the summary text, no headers or labels."
            )
            response = client.models.generate_content(
                model="gemini-2.0-flash",
                contents=prompt,
            )
            return response.text.strip()
        except Exception as e:
            logger.warning(f"Call summary generation failed: {e}")
            return transcript[:300] if transcript else ""

    async def _call_webhook(self, duration: float, transcript: str = "", call_summary: str = ""):
        """Call webhook URL with call data (transcript + basic info)"""
        try:
            import httpx

            # Derive interest level from conversation engagement (duration + turns)
            turn_count = self._turn_count
            if duration >= 240 or turn_count >= 6:
                interest_level = "High"
            elif duration >= 120 or turn_count >= 3:
                interest_level = "Medium"
            else:
                interest_level = "Low"

            # Use AI-generated summary if provided, otherwise fall back to truncated transcript
            if not call_summary:
                call_summary = transcript[:300] if transcript else ""

            # Normalize transcript entries for the UI:
            # - Filter out SYSTEM / TOOL / TOOL_RESULT lines
            # - Lowercase role names (agent/user)
            # - Accumulate consecutive AGENT chunks into a single bubble
            normalized_entries = []
            buf_role: str | None = None
            buf_text: str = ""
            buf_ts: str = ""
            for entry in self._full_transcript:
                role = entry.get("role", "")
                text = entry.get("text", "").strip()
                if role in ("SYSTEM", "TOOL", "TOOL_RESULT") or not text:
                    continue
                norm_role = "agent" if role == "AGENT" else "user"
                if norm_role == buf_role:
                    buf_text += " " + text
                else:
                    if buf_text.strip():
                        normalized_entries.append({"role": buf_role, "text": buf_text.strip(), "timestamp": buf_ts})
                    buf_role = norm_role
                    buf_text = text
                    buf_ts = entry.get("timestamp", "")
            if buf_text.strip():
                normalized_entries.append({"role": buf_role, "text": buf_text.strip(), "timestamp": buf_ts})

            persona_label = ""
            if self._detected_persona:
                if self._custom_persona_keywords:
                    persona_label = self._detected_persona
                else:
                    persona_label = self._detected_persona.replace("_", " ").title()

            # Extract objections and pain points from key_facts collected during the call
            objections = []
            pain_points = []
            for fact in self._key_facts:
                if fact.startswith("Objection"):
                    # Extract the user's text after the prefix "Objection (turn N): "
                    obj_text = fact.split(": ", 1)[1] if ": " in fact else fact
                    objections.append(obj_text)
                elif fact.startswith("Pain point"):
                    pp_text = fact.split(": ", 1)[1] if ": " in fact else fact
                    pain_points.append(pp_text)

            # Build collected_responses from intelligence gathered during the call
            collected_responses = {}
            if self._detected_persona:
                collected_responses["detected_persona"] = persona_label
            if self._active_situations:
                collected_responses["situations"] = ", ".join(self._active_situations)
            if self._active_product_sections and self._active_product_sections != ["overview"]:
                collected_responses["product_sections"] = ", ".join(set(self._active_product_sections))
            if pain_points:
                collected_responses["pain_points"] = "; ".join(pain_points)

            # Completion rate: proportion of conversation stages reached
            # Stage 1 = opener, Stage 2 = discovery, Stage 3 = cost/pain, Stage 4 = pitch
            stages_reached = 1  # Always reach stage 1 (opener)
            if pain_points or any("Pain point" in f for f in self._key_facts):
                stages_reached = 2  # Reached discovery
            if any("Product mentioned" in f for f in self._key_facts):
                stages_reached = 4  # Reached pitch (implies cost stage passed)
            elif stages_reached >= 2 and turn_count >= 4:
                stages_reached = 3  # Likely reached cost stage
            completion_rate = round(stages_reached / 4, 2)

            payload = {
                "event": "call_ended",
                "call_uuid": self.call_uuid,
                "caller_phone": self.caller_phone,
                "contact_name": self.context.get("customer_name", ""),
                "client_name": self.client_name,
                "duration_seconds": round(duration, 1),
                "timestamp": datetime.now().isoformat(),
                # Transcript
                "transcript": transcript,
                "transcript_entries": normalized_entries,
                # Persona
                "persona": persona_label,
                "triggered_persona": self._detected_persona,
                # Call engagement stats
                "questions_completed": turn_count,
                "total_questions": max(turn_count, 8),
                "completion_rate": completion_rate,
                "interest_level": interest_level,
                "call_summary": call_summary,
                "objections_raised": objections,
                "collected_responses": collected_responses,
                "question_pairs": [],
                "call_metrics": {
                    "total_duration_s": round(duration, 1),
                    "turn_count": turn_count,
                    "avg_latency_ms": 0,
                    "p90_latency_ms": 0,
                    "min_latency_ms": 0,
                    "max_latency_ms": 0,
                    "total_nudges": 0,
                },
                "recording_url": f"/calls/{self.call_uuid}/recording",
                "triggered_situations": list(self._active_situations or []),
                "triggered_product_sections": list(set(self._active_product_sections or [])),
                "social_proof_used": bool(self._social_proof_summary),
                "micro_moments": {
                    "final_strategy": self._micro_moment_detector.current_strategy if self._micro_moment_detector else "discovery",
                    "moments_detected": self._micro_moment_detector.get_moments_log() if self._micro_moment_detector else [],
                },
            }

            self.log.detail(f"Webhook: {self.webhook_url}")
            t0 = time.time()
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(self.webhook_url, json=payload)
                wh_ms = (time.time() - t0) * 1000
                self.log.detail(f"Webhook response: {resp.status_code} ({wh_ms:.0f}ms)")
        except Exception as e:
            logger.error(f"Error calling webhook: {e}")


# Session storage with concurrency protection
MAX_CONCURRENT_SESSIONS = int(os.environ.get("MAX_CONCURRENT_SESSIONS", 50))
_sessions: Dict[str, PlivoGeminiSession] = {}
_preloading_sessions: Dict[str, PlivoGeminiSession] = {}
_sessions_lock = asyncio.Lock()

def get_active_session_count() -> int:
    """Return total active + preloading sessions (no lock, approximate)"""
    return len(_sessions) + len(_preloading_sessions)

def set_plivo_uuid(internal_uuid: str, plivo_uuid: str):
    """Set the Plivo UUID on a preloaded session for proper hangup"""
    # No lock needed: single-threaded asyncio, called from async context
    session = _preloading_sessions.get(internal_uuid) or _sessions.get(internal_uuid)
    if session:
        session.plivo_call_uuid = plivo_uuid
        logger.info(f"Set Plivo UUID {plivo_uuid} on session {internal_uuid}")
    else:
        logger.error(f"CRITICAL: Could not find session {internal_uuid} to set Plivo UUID {plivo_uuid}. Call hangup will fail!")
        logger.error(f"  _preloading_sessions keys: {list(_preloading_sessions.keys())}")
        logger.error(f"  _sessions keys: {list(_sessions.keys())}")

async def preload_session(call_uuid: str, caller_phone: str, prompt: str = None, context: dict = None, webhook_url: str = None, intelligence_brief: str = "", social_proof_summary: str = "", max_call_duration: int = 480) -> bool:
    """Preload a session while phone is ringing"""
    async with _sessions_lock:
        total = len(_sessions) + len(_preloading_sessions)
        if total >= MAX_CONCURRENT_SESSIONS:
            logger.warning(f"Max concurrent sessions ({MAX_CONCURRENT_SESSIONS}) reached. Rejecting {call_uuid}")
            raise Exception(f"Max concurrent sessions ({MAX_CONCURRENT_SESSIONS}) reached")
        session = PlivoGeminiSession(call_uuid, caller_phone, prompt=prompt, context=context, webhook_url=webhook_url, max_call_duration=max_call_duration)
        if intelligence_brief:
            session.inject_intelligence(intelligence_brief)
        if social_proof_summary:
            session.inject_social_proof(social_proof_summary)
        _preloading_sessions[call_uuid] = session
    success = await session.preload()
    return success

async def create_session(call_uuid: str, caller_phone: str, plivo_ws, prompt: str = None, context: dict = None, webhook_url: str = None) -> Optional[PlivoGeminiSession]:
    """Create or retrieve preloaded session"""
    async with _sessions_lock:
        # Check for preloaded session
        if call_uuid in _preloading_sessions:
            session = _preloading_sessions.pop(call_uuid)
            session.caller_phone = caller_phone
            session.attach_plivo_ws(plivo_ws)
            _sessions[call_uuid] = session
            logger.info(f"Using PRELOADED session for {call_uuid}")
            session._save_transcript("SYSTEM", "Call connected (preloaded)")
            return session

        # Fallback: create new session (check limit)
        total = len(_sessions) + len(_preloading_sessions)
        if total >= MAX_CONCURRENT_SESSIONS:
            logger.warning(f"Max concurrent sessions ({MAX_CONCURRENT_SESSIONS}) reached. Rejecting {call_uuid}")
            return None

    # Create outside lock (preload does network I/O)
    logger.info(f"No preloaded session, creating new for {call_uuid}")
    session = PlivoGeminiSession(call_uuid, caller_phone, prompt=prompt, context=context, webhook_url=webhook_url)
    session.plivo_ws = plivo_ws
    session._save_transcript("SYSTEM", "Call started")
    if await session.preload():
        async with _sessions_lock:
            _sessions[call_uuid] = session
        return session
    return None

async def get_session(call_uuid: str) -> Optional[PlivoGeminiSession]:
    async with _sessions_lock:
        return _sessions.get(call_uuid)

def get_preloading_session(call_uuid: str) -> Optional[PlivoGeminiSession]:
    """Get a preloading session (non-async, for intelligence injection)."""
    return _preloading_sessions.get(call_uuid)

async def remove_session(call_uuid: str):
    """Remove and stop session atomically"""
    async with _sessions_lock:
        session = _sessions.pop(call_uuid, None)
        preload_session_obj = _preloading_sessions.pop(call_uuid, None)
    # Stop outside lock (stop() does async I/O)
    if session:
        await session.stop()
    if preload_session_obj:
        await preload_session_obj.stop()
