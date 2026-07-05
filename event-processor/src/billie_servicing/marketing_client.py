"""Thin async gRPC client for marketingService — used by the ClickSend inbound
handler to issue a LogInteraction command (the processor's one command-issuing
path). grpc + the vendored stubs are imported lazily so this module (and any
handler importing it) still loads where grpcio isn't installed; the import only
fires on the first real call.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

import structlog

if TYPE_CHECKING:
    from .marketing_grpc.marketing_service_pb2_grpc import MarketingServiceStub

logger = structlog.get_logger()

_stub = None


def _marketing_address() -> str:
    return os.environ.get("MARKETING_GRPC_ADDRESS", "localhost:50054")


def _is_internal_or_local(addr: str) -> bool:
    host = addr.split(":", 1)[0]
    return host.endswith(".internal") or host in ("localhost", "127.0.0.1")


def _get_stub() -> MarketingServiceStub:
    """Lazily build (and cache) the MarketingService stub + channel."""
    global _stub
    if _stub is None:
        import grpc

        from .marketing_grpc import marketing_service_pb2_grpc as pb2_grpc

        addr = _marketing_address()
        # Insecure for Fly 6PN .internal / localhost (already encrypted / local);
        # TLS otherwise — same posture as the CRM Node client + accounting ledger.
        channel = (
            grpc.aio.insecure_channel(addr)
            if _is_internal_or_local(addr)
            else grpc.aio.secure_channel(addr, grpc.ssl_channel_credentials())
        )
        _stub = pb2_grpc.MarketingServiceStub(channel)
    return _stub


async def log_interaction(
    *,
    idempotency_key: str,
    contact_id: str,
    kind: str,
    channel: str = "",
    direction: str = "",
    subject: str = "",
    body: str = "",
    source_system: str = "",
    occurred_at: str = "",
    metadata_json: str = "",
    actor: str = "",
) -> str:
    """Issue MarketingService.LogInteraction; returns the emitted event_id."""
    from .marketing_grpc import marketing_service_pb2 as pb2

    request = pb2.LogInteractionRequest(
        idempotency_key=idempotency_key,
        contact_id=contact_id,
        kind=kind,
        channel=channel,
        direction=direction,
        subject=subject,
        body=body,
        source_system=source_system,
        occurred_at=occurred_at,
        metadata_json=metadata_json,
        actor=actor,
    )
    response = await _get_stub().LogInteraction(request, timeout=5.0)
    return response.event_id
