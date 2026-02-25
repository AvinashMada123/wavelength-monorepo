"""
Cross-Call Memory — remembers key facts about each phone number across calls.

Post-call: extracts persona, objections, key facts from session data and saves to DB.
Pre-call: loads previous interaction context and formats it for prompt injection.

Zero latency impact: loading is pre-call (before phone rings), saving is post-call (background).
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Optional
from loguru import logger
from src.db.session_db import session_db


# =============================================================================
# Post-Call: Extract & Save Memory
# =============================================================================

# Keywords that hint at company/org mentions in user speech
_COMPANY_INDICATORS = [
    "work at", "working at", "working in", "work in", "work for", "working for",
    "employed at", "employed by", "joined", "joining", "company", "firm", "startup",
]

# Keywords that hint at role/profession mentions
_ROLE_INDICATORS = [
    "i am a", "i'm a", "i am an", "i'm an", "my role", "my designation",
    "i do", "i work as", "working as", "position",
]

# Objection type mapping from situation keys
_SITUATION_TO_OBJECTION = {
    "price_objection": "price",
    "time_objection": "time/busy",
    "skepticism": "skepticism/doubt",
    "competitor_comparison": "comparing alternatives",
}

# Interest signals from situation keys
_SITUATION_TO_INTEREST = {
    "high_interest": "ready to enroll",
}


def extract_and_save_memory(
    phone: str,
    contact_name: str,
    call_uuid: str,
    detected_persona: Optional[str],
    active_situations: list,
    turn_exchanges: list,
    accumulated_user_text: str,
    duration: float,
    interest_level: str = "",
    linguistic_style: dict = None,
    org_id: str = "",
):
    """
    Extract key facts from a completed call and save/update contact memory.
    Called from post-call processing (background thread) — zero latency impact.
    """
    if not phone:
        logger.debug("No phone number — skipping memory save")
        return

    # Normalize phone (ensure +country code format)
    phone = _normalize_phone(phone)

    # Load existing memory (if repeat caller) — scoped to org
    existing = session_db.get_contact_memory(phone, org_id)

    # Extract facts from this call
    company = _extract_company(accumulated_user_text)
    role = _extract_role(accumulated_user_text)
    objections = _extract_objections(active_situations)
    interest_areas = _extract_interest_areas(accumulated_user_text, turn_exchanges)
    key_facts = _extract_key_facts(turn_exchanges, accumulated_user_text)
    call_summary = _build_call_summary(turn_exchanges, detected_persona, objections)

    # Merge with existing memory
    if existing:
        call_count = (existing.get("call_count") or 0) + 1
        all_uuids = existing.get("all_call_uuids") or []
        if isinstance(all_uuids, str):
            import json
            try:
                all_uuids = json.loads(all_uuids)
            except Exception:
                all_uuids = []
        all_uuids.append(call_uuid)
        # Merge objections (deduplicate)
        prev_objections = existing.get("objections") or []
        if isinstance(prev_objections, str):
            import json
            try:
                prev_objections = json.loads(prev_objections)
            except Exception:
                prev_objections = []
        merged_objections = list(set(prev_objections + objections))
        # Merge key facts (deduplicate, keep last 10)
        prev_facts = existing.get("key_facts") or []
        if isinstance(prev_facts, str):
            import json
            try:
                prev_facts = json.loads(prev_facts)
            except Exception:
                prev_facts = []
        merged_facts = list(dict.fromkeys(prev_facts + key_facts))[-10:]
        # Merge interest areas (deduplicate)
        prev_interests = existing.get("interest_areas") or []
        if isinstance(prev_interests, str):
            import json
            try:
                prev_interests = json.loads(prev_interests)
            except Exception:
                prev_interests = []
        merged_interests = list(dict.fromkeys(prev_interests + interest_areas))[-10:]
        # Keep best detected values (don't overwrite with None)
        final_persona = detected_persona or existing.get("persona")
        final_company = company or existing.get("company")
        final_role = role or existing.get("role")
        final_name = contact_name if contact_name and contact_name != "Customer" else existing.get("name")
    else:
        call_count = 1
        all_uuids = [call_uuid]
        merged_objections = objections
        merged_facts = key_facts[-10:]
        merged_interests = interest_areas
        final_persona = detected_persona
        final_company = company
        final_role = role
        final_name = contact_name if contact_name and contact_name != "Customer" else None

    # Merge linguistic style (latest call wins)
    final_style = linguistic_style or {}
    if existing and not final_style:
        raw = existing.get("linguistic_style")
        if raw:
            import json as _json
            try:
                final_style = _json.loads(raw) if isinstance(raw, str) else raw
            except Exception:
                final_style = {}

    # Save to DB — scoped to org
    session_db.save_contact_memory(
        phone, org_id,
        name=final_name,
        persona=final_persona,
        company=final_company,
        role=final_role,
        objections=merged_objections,
        interest_areas=merged_interests,
        key_facts=merged_facts,
        call_count=call_count,
        last_call_date=datetime.now().isoformat(),
        last_call_summary=call_summary,
        last_call_outcome=interest_level or "Unknown",
        all_call_uuids=all_uuids,
        linguistic_style=final_style,
    )

    logger.info(
        f"Memory saved for {phone}: call #{call_count}, "
        f"persona={final_persona}, objections={merged_objections}, "
        f"facts={len(merged_facts)}, style={final_style}"
    )


# =============================================================================
# Mid-Call: Save via Gemini Function Calling (most reliable)
# =============================================================================

def save_from_tool_call(
    phone: str,
    company: Optional[str] = None,
    role: Optional[str] = None,
    name: Optional[str] = None,
    key_detail: Optional[str] = None,
    org_id: str = "",
):
    """Save user info extracted by Gemini via function calling.
    MORE RELIABLE than transcription parsing — Gemini's audio model
    hears 'TCS' correctly even when transcription garbles it to 't._v.'."""
    if not phone:
        return
    phone = _normalize_phone(phone)
    existing = session_db.get_contact_memory(phone, org_id)

    if existing:
        # Merge — tool call data takes priority (more accurate than transcription)
        final_company = company or existing.get("company")
        final_role = role or existing.get("role")
        final_name = name if name else existing.get("name")
        key_facts = existing.get("key_facts") or []
        if isinstance(key_facts, str):
            import json
            try:
                key_facts = json.loads(key_facts)
            except Exception:
                key_facts = []
        if key_detail and key_detail not in key_facts:
            key_facts.append(key_detail)
            key_facts = key_facts[-10:]

        session_db.save_contact_memory(
            phone, org_id,
            name=final_name,
            company=final_company,
            role=final_role,
            key_facts=key_facts,
            persona=existing.get("persona"),
            objections=existing.get("objections") or [],
            interest_areas=existing.get("interest_areas") or [],
            call_count=existing.get("call_count") or 1,
            last_call_date=existing.get("last_call_date"),
            last_call_summary=existing.get("last_call_summary"),
            last_call_outcome=existing.get("last_call_outcome"),
            all_call_uuids=existing.get("all_call_uuids") or [],
        )
    else:
        # First contact — create minimal record, full save happens post-call
        session_db.save_contact_memory(
            phone, org_id,
            name=name,
            company=company,
            role=role,
            key_facts=[key_detail] if key_detail else [],
            call_count=0,  # Will be set to 1 by post-call extract_and_save_memory
        )

    logger.info(f"Tool call saved for {phone} (org={org_id}): company={company}, role={role}, name={name}")


# =============================================================================
# Pre-Call: Load & Format Memory for Prompt Injection
# =============================================================================

def load_memory_context(phone: str, org_id: str = "") -> dict:
    """
    Load contact memory and return a dict with prompt text + metadata.
    Returns {"prompt": str, "persona": str|None} or empty dict if no memory.
    """
    if not phone:
        return {}

    phone = _normalize_phone(phone)
    memory = session_db.get_contact_memory(phone, org_id)

    if not memory or not memory.get("call_count"):
        return {}

    # Parse linguistic style from DB
    raw_style = memory.get("linguistic_style")
    style = {}
    if raw_style:
        import json as _json
        try:
            style = _json.loads(raw_style) if isinstance(raw_style, str) else raw_style
        except Exception:
            style = {}

    return {
        "prompt": _format_memory_for_prompt(memory),
        "persona": memory.get("persona"),
        "linguistic_style": style,
    }


def _format_memory_for_prompt(memory: dict) -> str:
    """Build a natural-language context string from stored memory."""
    parts = []
    name = memory.get("name") or "this customer"
    call_count = memory.get("call_count", 0)

    # Header
    parts.append(f"[PREVIOUS INTERACTION — you have spoken with {name} {call_count} time(s) before]")

    # Current date/time so the AI knows what "today" is
    now = datetime.now()
    parts.append(f"Today's date: {now.strftime('%A, %B %d, %Y at %I:%M %p')}")

    # Last call info — include both actual date and relative time
    last_date = memory.get("last_call_date")
    if last_date:
        try:
            dt = datetime.fromisoformat(last_date)
            days_ago = (now - dt).days
            if days_ago == 0:
                time_str = "earlier today"
            elif days_ago == 1:
                time_str = "yesterday"
            elif days_ago < 7:
                time_str = f"{days_ago} days ago"
            elif days_ago < 30:
                weeks = days_ago // 7
                time_str = f"{weeks} week{'s' if weeks > 1 else ''} ago"
            else:
                months = days_ago // 30
                time_str = f"{months} month{'s' if months > 1 else ''} ago"
            # Include both actual date and relative for accuracy
            last_date_formatted = dt.strftime("%B %d, %Y at %I:%M %p")
            parts.append(f"Last call: {last_date_formatted} ({time_str})")
        except Exception:
            pass

    # Persona
    persona = memory.get("persona")
    if persona:
        parts.append(f"Profile: {persona.replace('_', ' ')}")

    # Company/Role — use soft language, never assert as fact
    company = memory.get("company")
    role = memory.get("role")
    if company and role:
        parts.append(f"May have mentioned working as {role} at {company} — confirm before referencing")
    elif company:
        parts.append(f"May have mentioned {company} — confirm before referencing")
    elif role:
        parts.append(f"May have mentioned being a {role} — confirm before referencing")

    # Last call outcome
    outcome = memory.get("last_call_outcome")
    if outcome:
        parts.append(f"Last call outcome: {outcome} interest")

    # Objections raised previously
    objections = memory.get("objections") or []
    if isinstance(objections, list) and objections:
        parts.append(f"Previous objections: {', '.join(objections)}")

    # NOTE: We intentionally do NOT include raw key_facts in the prompt.
    # Gemini's audio transcription is too fragmented/garbled to inject as-is.
    # Only structured fields (name, persona, role, company, objections) are reliable.
    key_facts = []  # Not used in prompt — only stored for dashboard reference

    # Build explicit skip list
    skip_questions = []
    if persona or role or company:
        skip_questions.append('"What do you do?" / "Tell me about yourself"')
    if company:
        skip_questions.append(f'"Where do you work?" — they previously mentioned {company}, verify naturally if relevant')
    if objections:
        skip_questions.append("Don't wait for them to raise the same objections — address proactively")

    # Figure out time_ago for greeting
    time_ago = "before"
    for p in parts:
        if p.startswith("Last call:"):
            time_ago = p.replace("Last call: ", "")
            break

    # Instructions for AI — SHORT greeting (1 sentence) so user can interrupt
    instruction = "CRITICAL INSTRUCTIONS FOR THIS REPEAT CALLER:\n"

    # Short greeting — keep it to ONE sentence so it's interruptible
    # Use {agent_name} and {company_name} placeholders — filled by render_prompt() from API context
    if objections and "price" in objections:
        instruction += f"GREETING: \"Hey {name}! {{{{agent_name}}}} here. I had some thoughts about the pricing since we last spoke.\"\n"
    else:
        instruction += f"GREETING: \"Hey {name}! {{{{agent_name}}}} from {{{{company_name}}}}, good to talk again!\"\n"

    # Context referencing comes AFTER greeting, as a natural follow-up
    instruction += "AFTER GREETING: "
    if role and company:
        instruction += f"They may have mentioned being a {role} at {company} — verify casually (e.g. 'You mentioned you were at {company}, right?') before building on it. "
    elif role:
        instruction += f"They may have mentioned being a {role} — verify casually before building on it. "
    elif company:
        instruction += f"They may have mentioned {company} — verify casually (e.g. 'You mentioned {company} last time, right?') before building on it. "
    instruction += (
        "Then go straight into VALUE — skip discovery questions. "
        "Use PAIN POINTS and VALUE FRAMING from the persona module to build urgency, "
        "then move to Solution and Close.\n"
    )

    instruction += "FLOW: Greet → Reference what you know → Pain points → Urgency → Solution → Close\n"

    if skip_questions:
        instruction += "DO NOT ask (you already know):\n"
        for sq in skip_questions:
            instruction += f"  - {sq}\n"
    if objections:
        obj_str = ", ".join(objections)
        instruction += f"ADDRESS PROACTIVELY: They had concerns about {obj_str} last time. Bring it up yourself and resolve it early.\n"

    instruction += "IMPORTANT: Keep talking naturally. After your greeting, ask a follow-up question to keep the conversation going. Never go silent."

    parts.append(instruction)

    return "\n".join(parts)


# =============================================================================
# Extraction Helpers
# =============================================================================

def _normalize_phone(phone: str) -> str:
    """Normalize phone to consistent format for DB lookup."""
    phone = phone.strip()
    # Remove all non-digit chars except leading +
    if phone.startswith("+"):
        phone = "+" + re.sub(r'\D', '', phone[1:])
    else:
        phone = re.sub(r'\D', '', phone)
        if phone and not phone.startswith("+"):
            phone = "+" + phone
    return phone


def _normalize_transcription(text: str) -> str:
    """Normalize Gemini's fragmented audio transcription for extraction.
    Same approach as persona_engine: append spaceless versions per sentence."""
    parts = re.split(r'[.,!?;]+', text)
    spaceless_parts = []
    for part in parts:
        stripped = part.strip()
        if stripped:
            spaceless_parts.append(stripped.replace(" ", ""))
    return text + " " + " ".join(spaceless_parts)


def _is_valid_text(text: str) -> bool:
    """Check if text is valid English content (not garbage/non-English/questions-to-AI).
    STRICT: only passes genuine self-disclosure statements from the user."""
    if not text or len(text.strip()) < 5:
        return False
    # Reject non-ASCII heavy text (Hindi, etc.)
    ascii_chars = sum(1 for c in text if ord(c) < 128)
    if ascii_chars / max(len(text), 1) < 0.7:
        return False
    lower = text.strip().lower()
    # Remove spaces for spaceless matching (catches fragmented transcription)
    spaceless = lower.replace(" ", "")
    # Reject generic/filler responses
    filler = {
        "yes", "no", "yeah", "okay", "ok", "hmm", "sure", "right", "hello",
        "hi", "hey", "not really", "no not really", "nothing", "i don't know",
        "i'm not sure", "maybe", "thanks", "thank you", "bye", "goodbye",
    }
    if lower in filler or spaceless in filler:
        return False
    # Reject anything addressing the AI (user talking TO the AI, not about themselves)
    ai_address_patterns = [
        "what do you", "do you know", "do you remember", "can you",
        "what company do i", "what is", "tell me", "where do i",
        "who are you", "what are you", "how do you",
        "you don't remember", "you don't know", "you forgot",
        "you remember", "you know what", "you know wha",
        "don't you remember", "don't you know",
        "do you recall", "you recall",
        "did you forget", "have you forgotten",
        "what did i", "what do i",
        "you said", "you told", "you mentioned",
        "are you", "aren't you", "were you",
    ]
    for pattern in ai_address_patterns:
        if pattern in lower or pattern.replace(" ", "") in spaceless:
            return False
    # Reject very short word content (after stripping punctuation)
    words = re.findall(r'[a-z]+', lower)
    if len(words) < 2:
        return False
    # Reject text with too many fragmented single-letter words (garbled transcription)
    single_letter_words = sum(1 for w in lower.split() if len(w) == 1 and w.isalpha())
    if single_letter_words > len(lower.split()) * 0.4:
        return False
    return True


def _extract_company(user_text: str) -> Optional[str]:
    """Extract company name using 3 strategies:
    1. Exact match against known companies list
    2. Phonetic/spoken variants for abbreviations
    3. Contextual extraction: 'work at X' → fuzzy match X against known companies
    Handles Gemini garbling abbreviations (e.g. TCS → 'T C', 't._v.')."""
    if not user_text:
        return None
    text_lower = _normalize_transcription(user_text).lower()
    # Version stripped of ALL non-alphanumeric (catches garbled punctuation)
    text_alpha = re.sub(r'[^a-z0-9\s]', '', text_lower)

    # Known companies — check both text_lower and text_alpha
    known_companies = {
        "tcs": "TCS", "infosys": "Infosys", "wipro": "Wipro",
        "cognizant": "Cognizant", "accenture": "Accenture", "hcl": "HCL",
        "tech mahindra": "Tech Mahindra", "techm": "Tech Mahindra",
        "capgemini": "Capgemini", "deloitte": "Deloitte", "kpmg": "KPMG",
        "ey": "EY", "pwc": "PwC", "ibm": "IBM", "google": "Google",
        "microsoft": "Microsoft", "amazon": "Amazon", "flipkart": "Flipkart",
        "swiggy": "Swiggy", "zomato": "Zomato", "paytm": "Paytm",
        "razorpay": "Razorpay", "byju": "Byju's", "unacademy": "Unacademy",
        "zoho": "Zoho", "freshworks": "Freshworks", "reliance": "Reliance",
        "tata": "Tata", "mahindra": "Mahindra", "oracle": "Oracle",
        "salesforce": "Salesforce", "meta": "Meta", "apple": "Apple",
        "netflix": "Netflix", "uber": "Uber", "ola": "Ola",
        "jio": "Jio", "airtel": "Airtel", "hdfc": "HDFC", "icici": "ICICI",
        "sbi": "SBI", "axis": "Axis Bank", "myntra": "Myntra",
        "phonepe": "PhonePe", "cred": "CRED", "meesho": "Meesho",
    }

    # Strategy 1: Exact substring match
    # Short keys (≤3 chars) use word-boundary AND require nearby work context to
    # avoid false positives — "ey" / "hcl" / "sbi" appear as fillers in Indian English
    # e.g. "ey" must NOT match "hey", "they", "money", "okay ey", casual speech
    _work_ctx = re.compile(
        r'\b(?:work|job|employ|compan|office|join(?:ed)?|resign|quit|hired|'
        r'colleague|team|corporate|firm|consultanc|consulting)\w*\b'
    )
    for key, display in known_companies.items():
        key_clean = key.replace(" ", "")
        if len(key_clean) <= 3:
            key_pattern = r'\b' + re.escape(key) + r'\b'
            m = re.search(key_pattern, text_lower) or re.search(key_pattern, text_alpha)
            if m:
                # Require at least one work-related word within 60 chars of the match
                start = max(0, m.start() - 60)
                end = min(len(text_lower), m.end() + 60)
                if _work_ctx.search(text_lower[start:end]):
                    return display
        else:
            if key in text_lower or key in text_alpha:
                return display

    # Strategy 2: Phonetic/spoken variants for abbreviations
    phonetic_variants = {
        "TCS": ["tee see es", "tee c s", "t c s", "teeces", "teesees",
                "tata consultancy", "tata consulting"],
        "HCL": ["aitch see el", "h c l", "hcl tech", "hcltech"],
        "IBM": ["eye bee em", "i b m", "ibeem"],
        "SBI": ["es bee eye", "s b i", "state bank"],
        "HDFC": ["aitch dee eff see", "h d f c", "hdfc bank"],
        "ICICI": ["eye see eye see eye", "i c i c i", "icici bank"],
        "EY": ["ee why", "e y", "ernst young", "ernst and young"],
        "PwC": ["pee double you see", "p w c", "price waterhouse",
                "pricewaterhouse"],
        "KPMG": ["kay pee em jee", "k p m g"],
    }
    for display, variants in phonetic_variants.items():
        for variant in variants:
            spaceless = variant.replace(" ", "")
            # Short variants (≤3 chars) need word-boundary + work context (same as Strategy 1)
            if len(spaceless) <= 3:
                pat = r'\b' + re.escape(variant) + r'\b'
                m = re.search(pat, text_lower)
                if not m:
                    pat_s = r'\b' + re.escape(spaceless) + r'\b'
                    m = re.search(pat_s, text_alpha)
                if m:
                    start = max(0, m.start() - 60)
                    end = min(len(text_lower), m.end() + 60)
                    if _work_ctx.search(text_lower[start:end]):
                        return display
            else:
                if variant in text_lower or spaceless in text_alpha:
                    return display

    # Strategy 3: Contextual extraction — "work at/for/in X" → fuzzy match
    # Handles Gemini dropping letters: "work at T C" → "tc" ≈ "tcs"
    work_pattern = r'work(?:ing|s|ed)?\s+(?:at|for|in|with)\s+([a-z0-9\s]{1,25}?)(?:\s+(?:as|and|since|for|from|i|my|the|a|but|so|like|it)\b|[.,!?;]|$)'
    for match in re.finditer(work_pattern, text_alpha):
        candidate = match.group(1).strip()
        candidate_alpha = re.sub(r'[^a-z0-9]', '', candidate)
        if len(candidate_alpha) < 2:
            continue
        # Try prefix match: "tc" matches "tcs" (Gemini dropped a letter)
        for key, display in known_companies.items():
            key_clean = key.replace(" ", "")
            # Very short keys (≤2 chars like "ey") require exact match to avoid false positives
            if len(key_clean) <= 2:
                if candidate_alpha != key_clean:
                    continue
            # Candidate starts with key or key starts with candidate
            # Allow 1 missing char: len(candidate) >= len(key) - 1
            elif not (key_clean.startswith(candidate_alpha) or candidate_alpha.startswith(key_clean)):
                continue
            elif len(candidate_alpha) < len(key_clean) - 1:
                continue
            logger.info(f"Company fuzzy match: '{candidate}' → {display}")
            return display

    return None


def _extract_role(user_text: str) -> Optional[str]:
    """Extract role — ONLY from known roles list (no pattern guessing)."""
    if not user_text:
        return None
    text_lower = _normalize_transcription(user_text).lower()

    # Known roles — check both normal and spaceless for fragmented transcription
    known_roles = [
        "software engineer", "developer", "data scientist", "data analyst",
        "product manager", "project manager", "designer", "architect",
        "consultant", "analyst", "marketing manager", "hr manager",
        "finance manager", "team lead", "tech lead", "manager", "director",
        "student", "fresher", "intern", "freelancer", "entrepreneur",
        "founder", "co-founder", "ceo", "cto", "cfo",
        "teacher", "professor", "doctor", "lawyer", "accountant",
    ]
    for role in known_roles:
        if role in text_lower or role.replace(" ", "") in text_lower:
            return role.title()

    # No pattern-based guessing — too error-prone
    return None


def _extract_objections(active_situations: list) -> list:
    """Map detected situations to objection labels."""
    objections = []
    for sit in active_situations:
        if sit in _SITUATION_TO_OBJECTION:
            objections.append(_SITUATION_TO_OBJECTION[sit])
    return objections


def _extract_interest_areas(user_text: str, turn_exchanges: list) -> list:
    """Extract interest areas/topics from user speech.
    Looks for things the user expressed interest in, asked about, or mentioned wanting."""
    if not user_text:
        return []

    text_lower = user_text.lower()
    interests = []

    # Pattern 1: Explicit interest signals
    interest_patterns = [
        r'(?:interested in|want to learn|looking for|curious about|thinking about|considering)\s+(.{5,40?})(?:\.|,|$|\?)',
        r'(?:i want|i need|i\'m looking for|i\'d like)\s+(.{5,40?})(?:\.|,|$|\?)',
        r'(?:tell me (?:more )?about|how does|what about)\s+(.{5,40?})(?:\.|,|$|\?)',
    ]
    for pattern in interest_patterns:
        for match in re.finditer(pattern, text_lower):
            topic = match.group(1).strip().rstrip(".")
            if len(topic) > 4 and _is_valid_text(topic + " extra words"):
                interests.append(_clean_for_storage(topic))

    # Pattern 2: Known topic/domain keywords
    topic_keywords = {
        "AI": ["artificial intelligence", "ai ", " ai,", "machine learning", "deep learning", "chatgpt", "generative ai", "gen ai"],
        "data science": ["data science", "data analytics", "data analysis", "data engineering"],
        "cloud computing": ["cloud", "aws", "azure", "gcp", "devops"],
        "web development": ["web development", "frontend", "backend", "full stack", "fullstack", "react", "node"],
        "mobile development": ["mobile app", "android", "ios", "flutter", "react native"],
        "cybersecurity": ["cybersecurity", "cyber security", "security", "ethical hacking"],
        "digital marketing": ["digital marketing", "seo", "social media marketing"],
        "product management": ["product management", "product manager", "product design"],
        "business": ["business", "entrepreneurship", "startup", "mba"],
        "finance": ["finance", "investment", "trading", "stock market", "fintech"],
        "automation": ["automation", "rpa", "workflow", "no code", "low code"],
        "prompt engineering": ["prompt engineering", "prompt", "prompting"],
    }
    for topic, keywords in topic_keywords.items():
        for kw in keywords:
            if kw in text_lower:
                if topic not in interests:
                    interests.append(topic)
                break

    # Pattern 3: Extract from user's questions to the AI (what they asked about)
    for exchange in turn_exchanges:
        user_said = (exchange.get("user") or "").strip().lower()
        if not user_said:
            continue
        # Questions about specific topics indicate interest
        q_patterns = [
            r'(?:what|how|can you|does|is there).*(?:about|with|for)\s+(.{5,30}?)(?:\?|$)',
        ]
        for pattern in q_patterns:
            for match in re.finditer(pattern, user_said):
                topic = match.group(1).strip().rstrip("?.")
                if len(topic) > 4 and topic not in interests:
                    interests.append(_clean_for_storage(topic))

    return list(dict.fromkeys(interests))[:8]


def _extract_key_facts(turn_exchanges: list, user_text: str) -> list:
    """Extract key facts from user's speech.
    Stores meaningful statements — not questions, filler, or garbage."""
    facts = []
    if not turn_exchanges:
        return facts

    for exchange in turn_exchanges:
        user_said = exchange.get("user", "").strip()
        if not _is_valid_text(user_said):
            continue
        # Must be a statement (user telling us about themselves), not a question
        if user_said.rstrip().endswith("?"):
            continue
        # Clean up fragmented transcription for storage
        cleaned = _clean_for_storage(user_said)
        if cleaned and len(cleaned) > 8:
            facts.append(cleaned[:200])

    return facts[-8:]


def _clean_for_storage(text: str) -> str:
    """Clean fragmented transcription for human-readable storage.
    Removes excessive spaces within words where possible."""
    # Remove multiple spaces
    cleaned = re.sub(r'\s+', ' ', text).strip()
    # Remove trailing fragments (single letters at end)
    cleaned = re.sub(r'\s+[a-z]\s*$', '', cleaned)
    return cleaned


def _build_call_summary(
    turn_exchanges: list,
    persona: Optional[str],
    objections: list,
) -> str:
    """Build a clean summary from validated data only."""
    parts = []

    if persona:
        parts.append(f"Customer is a {persona.replace('_', ' ')}.")

    # Collect validated user statements for summary
    valid_statements = []
    for exchange in turn_exchanges:
        user_said = exchange.get("user", "").strip()
        if _is_valid_text(user_said) and not user_said.rstrip().endswith("?"):
            valid_statements.append(_clean_for_storage(user_said))

    # Include up to 3 most relevant statements (last ones tend to be most specific)
    if valid_statements:
        recent = valid_statements[-3:]
        for stmt in recent:
            parts.append(stmt[:150])

    if objections:
        parts.append(f"Objections raised: {', '.join(objections)}.")

    summary = " ".join(parts)
    return summary[:600] if summary else "Brief call, limited conversation."
