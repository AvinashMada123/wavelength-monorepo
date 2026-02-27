"""
Twilio API Adapter for Voice Calls
"""

import httpx
from loguru import logger
from typing import Optional, Dict, Any

from src.core.config import config
from .base import BaseCallAdapter


class TwilioAdapter(BaseCallAdapter):
    """Adapter for Twilio Voice API"""

    def __init__(self):
        self.account_sid = config.twilio_account_sid
        self.auth_token = config.twilio_auth_token
        self.base_url = f"https://api.twilio.com/2010-04-01/Accounts/{self.account_sid}"
        self.auth = (self.account_sid, self.auth_token)

    @property
    def provider_name(self) -> str:
        return "twilio"

    async def make_call(
        self,
        phone_number: str,
        answer_url: Optional[str] = None,
        status_callback_url: Optional[str] = None,
        caller_name: Optional[str] = None,
        twilio_account_sid: Optional[str] = None,
        twilio_auth_token: Optional[str] = None,
        twilio_phone_number: Optional[str] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Initiate an outbound call via Twilio

        Args:
            phone_number: The phone number to call (E.164 format)
            answer_url: TwiML URL when call is answered
            status_callback_url: URL to notify on call status changes
            caller_name: Optional caller name for caller ID
            twilio_account_sid: Per-org Twilio Account SID (overrides default)
            twilio_auth_token: Per-org Twilio Auth Token (overrides default)
            twilio_phone_number: Per-org Twilio phone number (overrides default)

        Returns:
            API response with call_uuid (mapped from Twilio's SID)
        """
        # Use per-org credentials if provided, otherwise fall back to defaults
        account_sid = twilio_account_sid or self.account_sid
        auth_token = twilio_auth_token or self.auth_token
        from_number = twilio_phone_number or config.twilio_phone_number
        api_base_url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}"
        auth = (account_sid, auth_token)

        callback_url = config.twilio_callback_url or config.plivo_callback_url
        if not answer_url:
            answer_url = f"{callback_url}/twilio/answer"
        if not status_callback_url:
            status_callback_url = f"{callback_url}/twilio/hangup"

        # Twilio uses form-encoded data, not JSON
        payload = {
            "To": phone_number,
            "From": from_number,
            "Url": answer_url,
            "StatusCallback": status_callback_url,
            "StatusCallbackMethod": "POST",
            "StatusCallbackEvent": "initiated ringing answered completed",
        }

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{api_base_url}/Calls.json",
                    auth=auth,
                    data=payload,
                    timeout=30.0
                )
                response.raise_for_status()
                result = response.json()
                call_sid = result.get("sid", "")
                logger.info(f"Twilio call initiated: {call_sid}")
                return {
                    "success": True,
                    "call_id": call_sid,
                    "call_uuid": call_sid,
                    **result
                }
        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error making Twilio call: {e.response.text}")
            return {"success": False, "error": str(e), "details": e.response.text}
        except Exception as e:
            logger.error(f"Error making Twilio call: {e}")
            return {"success": False, "error": str(e)}

    async def get_call_details(self, call_id: str) -> Dict[str, Any]:
        """Get details of a specific call by SID"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/Calls/{call_id}.json",
                    auth=self.auth,
                    timeout=30.0
                )
                response.raise_for_status()
                result = response.json()
                return {"success": True, **result}
        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error getting Twilio call details: {e.response.text}")
            return {"success": False, "error": str(e), "details": e.response.text}
        except Exception as e:
            logger.error(f"Error getting Twilio call details: {e}")
            return {"success": False, "error": str(e)}

    async def terminate_call(
        self,
        call_id: str,
        twilio_account_sid: Optional[str] = None,
        twilio_auth_token: Optional[str] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """Terminate/hangup an active call by SID"""
        account_sid = twilio_account_sid or self.account_sid
        auth_token = twilio_auth_token or self.auth_token
        api_base_url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}"
        auth = (account_sid, auth_token)

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{api_base_url}/Calls/{call_id}.json",
                    auth=auth,
                    data={"Status": "completed"},
                    timeout=30.0
                )
                logger.info(f"Twilio call terminated: {call_id} (status {response.status_code})")
                return {"success": True}
        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error terminating Twilio call: {e.response.text}")
            return {"success": False, "error": str(e), "details": e.response.text}
        except Exception as e:
            logger.error(f"Error terminating Twilio call: {e}")
            return {"success": False, "error": str(e)}

    async def transfer_call(
        self,
        call_id: str,
        transfer_to: str,
        **kwargs
    ) -> Dict[str, Any]:
        """Transfer an active call to a new TwiML URL"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/Calls/{call_id}.json",
                    auth=self.auth,
                    data={"Url": transfer_to, "Method": "POST"},
                    timeout=30.0
                )
                response.raise_for_status()
                result = response.json()
                logger.info(f"Twilio call transferred: {call_id}")
                return {"success": True, **result}
        except Exception as e:
            logger.error(f"Error transferring Twilio call: {e}")
            return {"success": False, "error": str(e)}


# Global adapter instance
twilio_adapter = TwilioAdapter()
