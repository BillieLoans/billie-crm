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

    # Postgres configuration (asyncpg pool). The default is a credential-less
    # localhost URI so a misconfigured deployment fails at connect time
    # rather than silently using a baked-in dev password. Set DATABASE_URI
    # explicitly in every environment (see .env.example). Production
    # additionally enforces sslmode=require in processor._check_tls_urls.
    database_uri: str = Field(
        default="postgresql://localhost:5432/billie_crm",
        validation_alias="DATABASE_URI",
    )
    # Kept for the startup banner only — the Postgres URI carries its own
    # database name so this is informational.
    db_name: str = "billie_crm"

    # Processing configuration
    max_retries: int = 3
    dedup_ttl_seconds: int = 86400  # 24 hours
    batch_size: int = 10
    block_timeout_ms: int = 1000
    max_payload_bytes: int = 262144  # 256 KB per event
    max_utterances: int = 2000  # Cap utterances array per conversation
    max_noticeboard_entries: int = 500  # Cap noticeboard array per conversation

    # help@ mailbox connector (Decision J) — polls an IMAP inbox and logs
    # each email as an inbound interaction on the matching contact's
    # timeline. Enabled only when a host is configured.
    help_mailbox_imap_host: str = ""
    help_mailbox_imap_port: int = 993
    help_mailbox_user: str = ""
    help_mailbox_password: str = ""
    help_mailbox_folder: str = "INBOX"
    help_mailbox_poll_seconds: int = 300

    # Logging
    log_level: str = "INFO"

    class Config:
        env_prefix = ""
        case_sensitive = False


settings = Settings()

