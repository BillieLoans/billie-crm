"""Main entry point for the Billie Servicing Event Processor."""

import asyncio
import logging
import signal
import sys

import structlog

from .config import settings
from .handlers import (
    # Account handlers
    handle_account_created,
    handle_account_status_changed,
    handle_account_updated,
    handle_schedule_created,
    handle_schedule_updated,
    # Customer handlers
    handle_customer_changed,
    handle_customer_verified,
    # Conversation handlers
    handle_conversation_started,
    handle_utterance,
    handle_final_decision,
    handle_conversation_summary,
    handle_application_detail_changed,
    handle_assessment,
    handle_noticeboard_updated,
    # Write-off handlers (CRM-originated events)
    handle_writeoff_requested,
    handle_writeoff_approved,
    handle_writeoff_rejected,
    handle_writeoff_cancelled,
)
from .processor import EventProcessor

# Configure standard logging first
logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO,
    stream=sys.stdout,
)

# Configure structured logging
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.dev.ConsoleRenderer(),  # Human-readable output
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()


def setup_handlers(processor: EventProcessor) -> None:
    """Register all event handlers with the processor."""

    # =========================================================================
    # Account events (using billie_accounts_events SDK)
    # =========================================================================
    processor.register_handler("account.created.v1", handle_account_created)
    processor.register_handler("account.updated.v1", handle_account_updated)
    processor.register_handler("account.status_changed.v1", handle_account_status_changed)
    processor.register_handler("account.schedule.created.v1", handle_schedule_created)
    processor.register_handler("account.schedule.updated.v1", handle_schedule_updated)

    # =========================================================================
    # Customer events (using billie_customers_events SDK)
    # =========================================================================
    processor.register_handler("customer.changed.v1", handle_customer_changed)
    processor.register_handler("customer.created.v1", handle_customer_changed)
    processor.register_handler("customer.updated.v1", handle_customer_changed)
    processor.register_handler("customer.verified.v1", handle_customer_verified)

    # =========================================================================
    # Conversation/Chat events (manual parsing - from worker.ts)
    # =========================================================================
    processor.register_handler("conversation_started", handle_conversation_started)

    # Utterances
    processor.register_handler("user_input", handle_utterance)
    processor.register_handler("assistant_response", handle_utterance)

    # Application changes
    processor.register_handler("applicationDetail_changed", handle_application_detail_changed)

    # Assessments
    processor.register_handler("identityRisk_assessment", handle_assessment)
    processor.register_handler("serviceability_assessment_results", handle_assessment)
    processor.register_handler("fraudCheck_assessment", handle_assessment)

    # Noticeboard
    processor.register_handler("noticeboard_updated", handle_noticeboard_updated)

    # Final decision
    processor.register_handler("final_decision", handle_final_decision)

    # Summary
    processor.register_handler("conversation_summary", handle_conversation_summary)

    # =========================================================================
    # Write-off events (CRM-originated, manual parsing)
    # =========================================================================
    processor.register_handler("writeoff.requested.v1", handle_writeoff_requested)
    processor.register_handler("writeoff.approved.v1", handle_writeoff_approved)
    processor.register_handler("writeoff.rejected.v1", handle_writeoff_rejected)
    processor.register_handler("writeoff.cancelled.v1", handle_writeoff_cancelled)


async def run() -> None:
    """Run the event processor."""
    processor = EventProcessor()
    setup_handlers(processor)

    # Setup shutdown handlers
    loop = asyncio.get_event_loop()
    shutdown_event = asyncio.Event()

    def shutdown_handler(sig: signal.Signals) -> None:
        logger.info("Received shutdown signal", signal=sig.name)
        shutdown_event.set()

    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, shutdown_handler, sig)

    # Start processor in background
    processor_task = asyncio.create_task(processor.start())

    # Wait for shutdown signal
    await shutdown_event.wait()

    # Stop processor gracefully
    logger.info("Shutting down processor...")
    await processor.stop()

    # Cancel processor task
    processor_task.cancel()
    try:
        await processor_task
    except asyncio.CancelledError:
        pass

    logger.info("Processor shutdown complete")


def main() -> None:
    """Main entry point."""
    print("=" * 60)
    print("BILLIE SERVICING EVENT PROCESSOR")
    print("=" * 60)
    def _redact_url(url: str) -> str:
        """Redact credentials from connection URLs."""
        import re
        return re.sub(r"://[^@]*@", "://***@", url) if "@" in url else "[configured]"

    print(f"Redis URL:       {_redact_url(settings.redis_url)}")
    print(f"Database URI:    {_redact_url(settings.database_uri)}")
    print(f"Database:        {settings.db_name}")
    print(f"External Stream: {settings.inbox_stream}")
    print(f"Internal Stream: {settings.internal_stream}")
    print(f"Consumer Group:  {settings.consumer_group}")
    print("=" * 60)
    print("Starting processor... (Ctrl+C to stop)")
    print()

    logger.info(
        "Starting Billie Servicing Event Processor",
        redis_url=_redact_url(settings.redis_url),
        database_uri=_redact_url(settings.database_uri),
        db_name=settings.db_name,
        external_stream=settings.inbox_stream,
        internal_stream=settings.internal_stream,
        consumer_group=settings.consumer_group,
    )

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        print("\nInterrupted by user")
        sys.exit(0)
    except Exception as e:
        print(f"\nFatal error: {e}")
        logger.error("Fatal error", error=str(e), exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
