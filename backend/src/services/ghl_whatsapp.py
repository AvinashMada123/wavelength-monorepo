"""
GoHighLevel (GHL) Integration
- Triggers GHL workflow via webhook for WhatsApp messages
- Looks up contacts by phone/email and adds tags via GHL API
"""

import httpx
from loguru import logger
from typing import Dict, Any, Optional

GHL_API_BASE = "https://services.leadconnectorhq.com"


async def trigger_ghl_workflow(phone: str, contact_name: str = "Customer", webhook_url: str = "", email: str = "", extra_context: Dict[str, Any] = None) -> Dict[str, Any]:
    """
    Trigger a GoHighLevel workflow via inbound webhook.
    Passes phone, email and contact name so GHL can find contact and send WhatsApp.

    Args:
        phone: Recipient phone number
        contact_name: Recipient name
        webhook_url: GHL inbound webhook URL (passed per-call from frontend)
        email: Recipient email (for GHL contact lookup fallback)
        extra_context: Additional data to include in the webhook payload (e.g. trigger reason)
    """
    if not webhook_url:
        logger.warning("No GHL webhook URL provided - skipping workflow trigger")
        return {"success": False, "error": "No GHL webhook URL"}

    # Normalize phone
    clean_phone = phone.replace(" ", "")
    if not clean_phone.startswith("+"):
        clean_phone = "+" + clean_phone

    payload = {
        "phone": clean_phone,
        "contact_name": contact_name,
        "email": email,
        "source": "ai_voice_call",
        **(extra_context or {}),
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(webhook_url, json=payload)
            if resp.status_code in (200, 201):
                logger.info(f"GHL workflow triggered for {clean_phone} ({contact_name})")
                return {"success": True, "phone": clean_phone}
            else:
                logger.error(f"GHL webhook failed ({resp.status_code}): {resp.text[:300]}")
                return {"success": False, "error": f"HTTP {resp.status_code}"}
    except Exception as e:
        logger.error(f"GHL webhook error: {e}")
        return {"success": False, "error": str(e)}


async def _find_ghl_contact(phone: str, email: str, api_key: str, location_id: str, client: Optional[httpx.AsyncClient] = None) -> str | None:
    """
    Search for a GHL contact by phone number, falling back to email.
    Returns contact ID or None.
    """
    clean_phone = phone.replace(" ", "")
    if not clean_phone.startswith("+"):
        clean_phone = "+" + clean_phone

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Version": "2021-07-28",
    }

    async def _search(c: httpx.AsyncClient):
        # Search by phone first
        resp = await c.get(
            f"{GHL_API_BASE}/contacts/",
            headers=headers,
            params={"locationId": location_id, "query": clean_phone},
        )
        if resp.status_code == 200:
            contacts = resp.json().get("contacts", [])
            if contacts:
                contact_id = contacts[0].get("id")
                logger.info(f"GHL contact found by phone {clean_phone}: {contact_id}")
                return contact_id

        # Fallback: search by email
        if email:
            resp = await c.get(
                f"{GHL_API_BASE}/contacts/",
                headers=headers,
                params={"locationId": location_id, "query": email},
            )
            if resp.status_code == 200:
                contacts = resp.json().get("contacts", [])
                if contacts:
                    contact_id = contacts[0].get("id")
                    logger.info(f"GHL contact found by email {email}: {contact_id}")
                    return contact_id

        logger.warning(f"GHL contact not found for phone={clean_phone} email={email}")
        return None

    if client:
        return await _search(client)
    else:
        async with httpx.AsyncClient(timeout=10.0) as c:
            return await _search(c)


async def tag_ghl_contact(
    phone: str,
    email: str,
    api_key: str,
    location_id: str,
    tag: str = "ai-onboardcall-goldmember",
) -> Dict[str, Any]:
    """
    Look up a GHL contact by phone/email and add a tag.
    Uses a single HTTP client for all requests (find + tag).

    Args:
        phone: Contact phone number
        email: Contact email (fallback for lookup)
        api_key: GHL API key (from UI settings)
        location_id: GHL location/sub-account ID (from UI settings)
        tag: Tag name to add
    """
    if not api_key or not location_id:
        return {"success": False, "error": "GHL API key or location ID not configured"}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            contact_id = await _find_ghl_contact(phone, email, api_key, location_id, client)
            if not contact_id:
                return {"success": False, "error": "Contact not found in GHL"}

            # Add tag to contact (POST adds without overwriting existing tags)
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Version": "2021-07-28",
                "Content-Type": "application/json",
            }

            resp = await client.post(
                f"{GHL_API_BASE}/contacts/{contact_id}/tags",
                headers=headers,
                json={"tags": [tag]},
            )
            if resp.status_code in (200, 201):
                logger.info(f"GHL tag '{tag}' added to contact {contact_id}")
                return {"success": True, "contact_id": contact_id, "tag": tag}
            else:
                logger.error(f"GHL tag failed ({resp.status_code}): {resp.text[:300]}")
                return {"success": False, "error": f"HTTP {resp.status_code}: {resp.text[:200]}"}

    except Exception as e:
        logger.error(f"GHL tag error: {e}")
        return {"success": False, "error": str(e)}
