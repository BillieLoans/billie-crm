"""Event handlers for Billie Servicing App."""

from .account import (
    handle_account_closed,
    handle_account_created,
    handle_account_status_changed,
    handle_account_updated,
    handle_schedule_created,
    handle_schedule_updated,
)
from .customer import (
    handle_customer_changed,
    handle_customer_verified,
)
from .identity import (
    handle_customer_identity_linked,
    handle_customer_identity_merged,
)
from .conversation import (
    handle_conversation_started,
    handle_utterance,
    handle_final_decision,
    handle_conversation_summary,
    handle_conversation_summary_changed,
    handle_application_detail_changed,
    handle_assessment,
    handle_noticeboard_updated,
    handle_statement_consent_initiated,
    handle_statement_consent_complete,
    handle_statement_consent_cancelled,
    handle_basiq_job_created,
    handle_statement_retrieval_complete,
    handle_affordability_report_complete,
    handle_statement_checks_complete,
    handle_post_identity_risk_check,
    handle_credit_assessment_complete,
)
from .writeoff import (
    handle_writeoff_requested,
    handle_writeoff_approved,
    handle_writeoff_rejected,
    handle_writeoff_cancelled,
)
from .notification import (
    handle_notification_sent,
    handle_notification_delivery_failed,
    handle_notification_suppression_changed,
    handle_statement_generated,
)
from .aging import (
    handle_loan_aging_updated,
)

__all__ = [
    # Account handlers
    "handle_account_created",
    "handle_account_updated",
    "handle_account_status_changed",
    "handle_account_closed",
    "handle_schedule_created",
    "handle_schedule_updated",
    # Customer handlers
    "handle_customer_changed",
    "handle_customer_verified",
    "handle_customer_identity_linked",
    "handle_customer_identity_merged",
    # Conversation handlers
    "handle_conversation_started",
    "handle_utterance",
    "handle_final_decision",
    "handle_conversation_summary",
    "handle_conversation_summary_changed",
    "handle_application_detail_changed",
    "handle_assessment",
    "handle_noticeboard_updated",
    # Statement capture handlers
    "handle_statement_consent_initiated",
    "handle_statement_consent_complete",
    "handle_statement_consent_cancelled",
    "handle_basiq_job_created",
    "handle_statement_retrieval_complete",
    "handle_affordability_report_complete",
    "handle_statement_checks_complete",
    # Credit assessment & post-identity handlers
    "handle_post_identity_risk_check",
    "handle_credit_assessment_complete",
    # Write-off handlers (CRM-originated events)
    "handle_writeoff_requested",
    "handle_writeoff_approved",
    "handle_writeoff_rejected",
    "handle_writeoff_cancelled",
    # Notification handlers (platform → CRM read-only projections)
    "handle_notification_sent",
    "handle_notification_delivery_failed",
    "handle_notification_suppression_changed",
    "handle_statement_generated",
    # Aging handler (platform → CRM read-only projection of arrears state)
    "handle_loan_aging_updated",
]
