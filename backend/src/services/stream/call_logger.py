"""Structured call lifecycle logger with visual indentation."""
from loguru import logger


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
