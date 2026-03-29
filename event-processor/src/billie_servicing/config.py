"""Configuration settings for the event processor."""

from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Redis configuration
    redis_url: str = "redis://localhost:6383"
    inbox_stream: str = "inbox:billie-servicing"
    internal_stream: str = "inbox:billie-servicing:internal"
    consumer_group: str = "billie-servicing-processor"
    dlq_stream: str = "dlq:billie-servicing"

    # MongoDB configuration
    database_uri: str = Field(
        default="mongodb://localhost:27017/billie-servicing",
        validation_alias="DATABASE_URI",
    )
    db_name: str = "billie-servicing"

    # Processing configuration
    max_retries: int = 3
    dedup_ttl_seconds: int = 86400  # 24 hours
    batch_size: int = 10
    block_timeout_ms: int = 1000
    max_payload_bytes: int = 262144  # 256 KB per event
    max_utterances: int = 2000  # Cap utterances array per conversation
    max_noticeboard_entries: int = 500  # Cap noticeboard array per conversation

    # Logging
    log_level: str = "INFO"

    class Config:
        env_prefix = ""
        case_sensitive = False


settings = Settings()

