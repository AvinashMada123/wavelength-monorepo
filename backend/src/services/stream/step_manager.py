"""Step-based conversation flow manager.

Breaks a conversation script into discrete steps, enabling:
- Compact per-step system instructions on session splits (lower latency)
- Precise session-split recovery (no repetition by design)
- Deterministic step tracking

The FIRST connection uses the full prompt (for maximum AI flexibility).
Session splits use compact step-based prompts (for speed + precision).
"""

import re
import logging
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)


class Step:
    __slots__ = ("id", "phase", "goal", "script", "wait", "next_step", "branches")

    def __init__(self, id: int, phase: str, goal: str, script: str,
                 wait: bool = True, next_step: Optional[int] = None,
                 branches: Optional[dict] = None):
        self.id = id
        self.phase = phase
        self.goal = goal
        self.script = script
        self.wait = wait
        self.next_step = next_step
        self.branches = branches or {}


class StepManager:
    """Tracks conversation steps and builds compact prompts for session splits."""

    def __init__(self, state):
        self.state = state
        self.steps: list[Step] = []
        self.persona_block: str = ""
        self.objection_block: str = ""
        self.rules_block: str = ""
        self.current_step_index: int = 0
        self.collected_info: dict = {}
        self._enabled = False

    @property
    def enabled(self) -> bool:
        return self._enabled and len(self.steps) > 0

    @property
    def current_step(self) -> Optional[Step]:
        if 0 <= self.current_step_index < len(self.steps):
            return self.steps[self.current_step_index]
        return None

    @property
    def total_steps(self) -> int:
        return len(self.steps)

    def parse_from_prompt(self, prompt: str, context: dict) -> bool:
        """Extract steps from a prompt with NEPQ-style flow sections.
        Returns True if steps were successfully extracted (>= 3 steps)."""

        # Look for NEPQ section — supports multiple formats:
        # "# NEPQ Flow", "NEPQ FRAMEWORK:", "NEPQ Flow (one question...)"
        nepq_match = re.search(
            r'(?:#\s*NEPQ\s+Flow|NEPQ\s+FRAMEWORK\s*:|NEPQ\s+Flow)',
            prompt, re.IGNORECASE
        )
        if not nepq_match:
            return False

        # Extract persona block (everything before NEPQ section)
        self.persona_block = prompt[:nepq_match.start()].strip()

        # Extract objection block — supports "# Objections", "OBJECTIONS (Brief):", etc.
        obj_match = re.search(
            r'(?:#\s*)?OBJECTIONS?\s*[^\n]*[:\n](.*?)(?=\n(?:#|[A-Z]{3,}\s+CALL|END\s+CALL)|\Z)',
            prompt, re.DOTALL | re.IGNORECASE
        )
        if obj_match:
            self.objection_block = obj_match.group(1).strip()

        # Extract rules block
        rules_match = re.search(
            r'#\s*Rules\s*\n(.*?)(?=\n#|\Z)',
            prompt, re.DOTALL | re.IGNORECASE
        )
        if rules_match:
            self.rules_block = rules_match.group(1).strip()

        # Extract NEPQ section content — stop at Objections, Qualify, Rules, END CALL, etc.
        nepq_section = re.search(
            r'(?:#\s*NEPQ\s+Flow|NEPQ\s+FRAMEWORK\s*:|NEPQ\s+Flow)[^\n]*\n(.*?)(?=\n(?:#\s*)?(?:OBJECTION|Qualify|Rules|END\s+CALL)|\Z)',
            prompt, re.DOTALL | re.IGNORECASE
        )
        if not nepq_section:
            return False

        nepq_text = nepq_section.group(1).strip()
        self.steps = []
        step_id = 1

        for line in nepq_text.split('\n'):
            line = line.strip()
            if not line:
                continue

            # Match "PHASE: content" or "PHASE (qualifier): content"
            # Supports both UPPERCASE and Title Case phase names
            phase_match = re.match(r'^([A-Za-z][A-Za-z_ &]+)(?:\s*\([^)]*\))?\s*:\s*(.+)', line)
            if not phase_match:
                continue

            phase = phase_match.group(1).strip()
            content = phase_match.group(2).strip()

            # Split on <wait> or → to create sub-steps
            parts = re.split(r'\s*(?:<wait>|→)\s*', content)

            for part in parts:
                part = part.strip()
                if not part:
                    continue

                # Conditional branches (If yes/no/busy) attach to previous step
                branch_match = re.match(r'^If\s+(\w+):\s*(.+)', part, re.IGNORECASE)
                if branch_match and self.steps:
                    self.steps[-1].branches[branch_match.group(1).lower()] = branch_match.group(2).strip()
                    continue

                # Skip meta-instructions that aren't actual script lines
                # e.g. "Listen and validate.", "Adapt: already tried...", "Mirror their pain back."
                meta_starts = ("listen", "adapt", "mirror", "tailor", "validate", "tag ")
                if part.lower().startswith(meta_starts):
                    continue
                # HOT=/WARM=/COLD= lines are closing strategies, keep them as a single CLOSE step
                hot_match = re.match(r'^HOT\s*=\s*(.+)', part, re.IGNORECASE)
                if hot_match:
                    close_script = hot_match.group(1).strip()
                    step = Step(
                        id=len(self.steps) + 1,
                        phase=phase,
                        goal="Close based on interest level",
                        script=close_script,
                        wait=True,
                    )
                    self.steps.append(step)
                    continue
                if re.match(r'^(?:WARM|COLD)\s*=', part, re.IGNORECASE):
                    continue  # Already captured via HOT line

                # Handle "script1" OR "script2" — common in Close phases
                or_parts = re.split(r'\s+OR\s+', part)
                if len(or_parts) > 1:
                    # Use first variant as main script, others as branches
                    part = or_parts[0].strip()
                # Skip short text without quotes or question marks (likely instructions)
                if not any(c in part for c in ['"', "'", '?', '!']):
                    if len(part) < 60:
                        continue

                step = Step(
                    id=step_id,
                    phase=phase,
                    goal=self._infer_goal(phase, part),
                    script=self._clean_script(part),
                    wait=True,
                    next_step=step_id + 1,
                )
                self.steps.append(step)
                step_id += 1

        # Fix last step
        if self.steps:
            self.steps[-1].next_step = None

        self._enabled = len(self.steps) >= 3
        if self._enabled:
            s = self.state
            logger.info(f"[{s.call_uuid[:8]}] Step manager: {len(self.steps)} steps parsed")
            for step in self.steps:
                logger.info(f"[{s.call_uuid[:8]}]   Step {step.id}: [{step.phase}] {step.goal}")

        return self._enabled

    def _infer_goal(self, phase: str, script: str) -> str:
        """Infer a specific goal from the script content."""
        script_lower = script.lower()
        # Try to extract a meaningful goal from the script itself
        if "convenient time" in script_lower or "good time" in script_lower:
            return "Greet and check availability"
        if "registered" in script_lower or "confirm" in script_lower:
            return "Confirm registration"
        if "motivated" in script_lower or "what made you" in script_lower:
            return "Ask what motivated them"
        if "looking to improve" in script_lower or "health concern" in script_lower:
            return "Understand health goal"
        if "how long" in script_lower:
            return "Ask duration of issue"
        if "affecting" in script_lower or "daily" in script_lower:
            return "Ask about daily impact"
        if "nothing changes" in script_lower or "six months" in script_lower:
            return "Future consequence projection"
        if "workshop" in script_lower and ("help" in script_lower or "cover" in script_lower):
            return "Present workshop value"
        if "joining link" in script_lower or "details" in script_lower:
            return "Confirm logistics"
        if "close" in phase.lower() or "silver" in script_lower or "gold" in script_lower:
            return "Close based on interest level"
        # Fallback to phase name
        return f"{phase.title()} phase"

    def _clean_script(self, text: str) -> str:
        """Remove meta-instructions, keep the script portion."""
        # Remove trailing meta like "Listen and validate." or "Adapt: ..."
        text = re.sub(r'\s+(?:Listen|Adapt|Tailor|Mirror)[^"]*$', '', text)
        # Remove quotes around the whole string if present
        text = text.strip('"').strip("'")
        return text.strip()

    def advance_step(self) -> Optional[Step]:
        """Move to next step. Returns the new current step or None if done."""
        if self.current_step_index < len(self.steps) - 1:
            self.current_step_index += 1
            return self.current_step
        return None

    def add_info(self, key: str, value: str):
        """Store a fact collected during conversation."""
        if key and value:
            self.collected_info[key] = value

    def build_reconnect_prompt(self) -> str:
        """Build a compact system instruction for session split reconnect.
        This is the key advantage: ~2-3K chars instead of ~14K."""
        s = self.state
        step = self.current_step
        if not step:
            return ""

        parts = []

        # 1. Persona (identity + voice)
        parts.append(self.persona_block)

        # 2. Voice language
        if s._tts_language:
            parts.append(f"\n[VOICE LANGUAGE: Speak in {s._tts_language} accent/language.]")

        # 3. Core rules (compact)
        parts.append(
            "\n\n[CORE RULES] "
            "1) 1-2 sentences max, then STOP and WAIT. Never answer your own questions. "
            "2) Max 2 attempts per offer. After 2, move on. "
            "3) Say goodbye ONCE. If customer says bye, call end_call immediately. "
            "4) Garbled speech = assume positive intent. "
            "5) Always move forward, never restart."
        )

        # 4. Current step (the key part)
        total = len(self.steps)
        parts.append(
            f"\n\n[CURRENT STEP: {step.id} of {total} — {step.goal}]\n"
            f"SAY (in your own words): {step.script}\n"
            f"{'WAIT for their response.' if step.wait else 'Continue immediately to next step.'}"
        )

        # 5. Branches
        for condition, action in step.branches.items():
            parts.append(f"[IF {condition.upper()}] {action}")

        # 6. Upcoming steps (brief preview so AI knows what's next)
        upcoming = []
        for i in range(self.current_step_index + 1, min(self.current_step_index + 3, len(self.steps))):
            upcoming.append(f"  Step {self.steps[i].id}: {self.steps[i].goal}")
        if upcoming:
            parts.append("\n[NEXT STEPS]\n" + "\n".join(upcoming))

        # 7. Objection handlers
        if self.objection_block:
            parts.append(f"\n[OBJECTIONS — acknowledge, never argue, 1-2 sentences]\n{self.objection_block}")

        # 8. Collected info
        if self.collected_info:
            info_lines = "\n".join(f"- {k}: {v}" for k, v in self.collected_info.items())
            parts.append(f"\n[COLLECTED INFO]\n{info_lines}")

        # 9. Key facts from conversation
        if s._key_facts:
            parts.append("\n[KEY FACTS]\n" + "\n".join(f"- {f}" for f in s._key_facts[-4:]))

        # 10. Context variables
        ctx_pairs = []
        for k, v in s.context.items():
            if v and not k.startswith('_') and isinstance(v, str) and len(v) < 200:
                ctx_pairs.append(f"{k}={v}")
        if ctx_pairs:
            parts.append(f"\n[CONTEXT] {' | '.join(ctx_pairs)}")

        # 11. Date/time
        parts.append(f"\n[DATE: {datetime.now().strftime('%A, %B %d, %Y %I:%M %p')}]")

        # 12. Session resume guard
        parts.append(
            "\n\n[SESSION RESUMED — you already greeted the customer. "
            "Do NOT greet again. Do NOT introduce yourself again. "
            "Continue from current step.]"
        )

        # 13. Last exchange for continuity
        if s._turn_exchanges:
            last = s._turn_exchanges[-1]
            agent = last.get("agent", "")[:200]
            user = last.get("user", "")[:200]
            if agent or user:
                parts.append(
                    f'\n[LAST EXCHANGE — You: "{agent}" Customer: "{user}". '
                    'Continue FORWARD from here. Do NOT repeat anything above.]'
                )

        return "\n".join(parts)

    def build_step_advance_message(self) -> Optional[str]:
        """Build a client_content injection to guide AI to the next step mid-session."""
        step = self.current_step
        if not step:
            return None

        total = len(self.steps)
        msg = (
            f"[ADVANCE TO STEP {step.id} of {total}: {step.goal}]\n"
            f"SAY (in your own words): {step.script}\n"
            f"{'WAIT for their response.' if step.wait else 'Continue immediately.'}"
        )

        for condition, action in step.branches.items():
            msg += f"\n[IF {condition.upper()}] {action}"

        return msg
