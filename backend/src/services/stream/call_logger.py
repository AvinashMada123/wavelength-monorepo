"""Structured call lifecycle logger with visual indentation."""
from pathlib import Path
from loguru import logger

CALL_LOGS_DIR = Path(__file__).parent.parent.parent / "logs" / "calls"
CALL_LOGS_DIR.mkdir(parents=True, exist_ok=True)


class CallLogger:
    """Structured call lifecycle logger with visual indentation.
    Also writes a per-call log file under logs/calls/{call_uuid}.log."""

    def __init__(self, call_id: str):
        self.id = call_id[:8]
        self._call_id_full = call_id
        self._log_file = CALL_LOGS_DIR / f"{call_id}.log"
        # Add a loguru sink for this specific call (filter by call_id prefix)
        self._sink_id = logger.add(
            str(self._log_file),
            filter=lambda record, cid=self.id: f"[{cid}]" in record["message"],
            format="{time:HH:mm:ss} | {level:<7} | {message}",
            level="DEBUG",
            rotation=None,
            enqueue=True,
        )

    def remove_sink(self):
        """Remove the per-call log sink (call at end of call)."""
        try:
            logger.remove(self._sink_id)
        except ValueError:
            pass

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
