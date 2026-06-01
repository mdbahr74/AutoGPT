from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return float(value)


def env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return int(value)


@dataclass(slots=True)
class ScannerConfig:
    db_path: Path = Path("data/bitunix_scanner.sqlite3")
    alerts_jsonl: Path = Path("data/alerts.jsonl")
    scan_interval_seconds: int = 60
    request_timeout_seconds: int = 15
    alert_on_first_run: bool = False
    alert_cooldown_seconds: int = 3600
    price_change_pct_threshold: float = 12.0
    funding_rate_abs_threshold: float = 0.01
    quote_volume_threshold: float = 50_000_000.0
    low_volume_threshold: float = 25_000.0
    webhook_urls: tuple[str, ...] = ()
    ai_provider: str = "rules"
    openai_model: str = ""
    bitunix_api_key: str = ""
    bitunix_secret_key: str = ""
    trading_enabled: bool = False
    trading_dry_run: bool = True
    coinglass_api_key: str = ""

    @classmethod
    def from_env(cls) -> "ScannerConfig":
        urls = tuple(
            item.strip()
            for item in os.getenv("WEBHOOK_URLS", "").split(",")
            if item.strip()
        )
        return cls(
            db_path=Path(os.getenv("BITUNIX_DB", "data/bitunix_scanner.sqlite3")),
            alerts_jsonl=Path(os.getenv("ALERTS_JSONL", "data/alerts.jsonl")),
            scan_interval_seconds=env_int("SCAN_INTERVAL_SECONDS", 60),
            request_timeout_seconds=env_int("REQUEST_TIMEOUT_SECONDS", 15),
            alert_on_first_run=env_bool("ALERT_ON_FIRST_RUN", False),
            alert_cooldown_seconds=env_int("ALERT_COOLDOWN_SECONDS", 3600),
            price_change_pct_threshold=env_float("PRICE_CHANGE_PCT_THRESHOLD", 12.0),
            funding_rate_abs_threshold=env_float("FUNDING_RATE_ABS_THRESHOLD", 0.01),
            quote_volume_threshold=env_float("QUOTE_VOLUME_THRESHOLD", 50_000_000.0),
            low_volume_threshold=env_float("LOW_VOLUME_THRESHOLD", 25_000.0),
            webhook_urls=urls,
            ai_provider=os.getenv("AI_PROVIDER", "rules").strip().lower(),
            openai_model=os.getenv("OPENAI_MODEL", "").strip(),
            bitunix_api_key=os.getenv("BITUNIX_API_KEY", "").strip(),
            bitunix_secret_key=os.getenv("BITUNIX_SECRET_KEY", "").strip(),
            trading_enabled=env_bool("TRADING_ENABLED", False),
            trading_dry_run=env_bool("TRADING_DRY_RUN", True),
            coinglass_api_key=os.getenv("COINGLASS_API_KEY", "").strip(),
        )
