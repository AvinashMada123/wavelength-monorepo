"""
Pre-call intelligence gathering using Gemini Flash + Google Search grounding.

Runs BEFORE the phone rings (during preload phase) to research the prospect's
company, role, and industry. Results are injected into the Gemini Live session
so the AI can reference them naturally during conversation.

Zero new dependencies - uses existing google-genai SDK and GOOGLE_API_KEY.
"""

import asyncio
import time
from loguru import logger
from google import genai
from google.genai import types
from src.core.config import config

# Pre-warm client at import time (avoids cold-start on first call)
_client = genai.Client(api_key=config.google_api_key) if config.google_api_key else None


async def gather_intelligence(contact_name: str, context: dict, timeout: float = None) -> str:
    """
    Research contact/company before call starts. Returns intelligence brief or empty string.
    Guaranteed to return within `timeout` seconds (default from config).
    """
    if not config.enable_intelligence or not _client:
        return ""

    if timeout is None:
        timeout = config.intelligence_timeout

    # Build search query from available context
    company = context.get("company_name", "") or context.get("company", "")
    role = context.get("role", "") or context.get("job_title", "") or context.get("designation", "")
    industry = context.get("industry", "") or context.get("sector", "")

    # Need at least a company or industry to search meaningfully
    if not company and not industry:
        logger.debug("No company/industry in context - skipping pre-call intelligence")
        return ""

    # Build search query from available context — ONLY about the company/industry,
    # never about the individual person (too vague, causes hallucinations)
    search_parts = []
    if company:
        search_parts.append(f"{company} company overview, employee count, recent news 2025 2026")
    elif industry:
        search_parts.append(f"{industry} industry trends 2025 2026")
    if role and (company or industry):
        search_parts.append(f"key challenges for {role} in {company or industry}")
    search_query = ". ".join(search_parts)

    # System instruction constrains the model to ONLY return search-grounded facts
    system_instruction = (
        "You are a factual research assistant. Your job is to return ONLY verifiable facts "
        "found via Google Search. Rules:\n"
        "1. ONLY include information that came from search results. NEVER infer, assume, or fabricate.\n"
        "2. If search returns no relevant results, respond with exactly: NO_RESULTS\n"
        "3. NEVER guess the prospect's role, background, interests, or personal details.\n"
        "4. Focus ONLY on the COMPANY or INDUSTRY — not the individual person.\n"
        "5. Return 3-4 bullet points, one sentence each, factual only.\n"
        f"6. The prospect's name is {contact_name} — do NOT search for them personally."
    )

    query = f"Research the following and return only verified facts:\n{search_query}"

    try:
        start = time.time()

        response = await asyncio.wait_for(
            _client.aio.models.generate_content(
                model="gemini-2.5-flash",
                contents=query,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    tools=[types.Tool(google_search=types.GoogleSearch())]
                )
            ),
            timeout=timeout
        )

        elapsed_ms = (time.time() - start) * 1000
        brief = response.text.strip() if response.text else ""

        # Filter out empty or no-result responses
        if not brief or "NO_RESULTS" in brief:
            logger.debug(f"Intelligence search returned no useful results in {elapsed_ms:.0f}ms")
            return ""

        logger.info(f"Intelligence gathered in {elapsed_ms:.0f}ms ({len(brief)} chars)")
        return brief

    except asyncio.TimeoutError:
        elapsed_ms = (time.time() - start) * 1000
        logger.warning(f"Intelligence gathering timed out after {elapsed_ms:.0f}ms - proceeding without")
        return ""
    except Exception as e:
        logger.warning(f"Intelligence gathering failed: {e} - proceeding without")
        return ""
