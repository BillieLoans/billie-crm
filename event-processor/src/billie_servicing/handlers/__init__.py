"""Event handlers for Billie Servicing App."""

from .account import (
    handle_account_closed,
    handle_account_created,
    handle_account_status_changed,
    handle_account_updated,
    handle_schedule_created,
    handle_schedule_updated,
)
from .aging import (
    handle_loan_aging_updated,
)
from .block_clear_approval import (
    handle_block_clear_approval_approved,
    handle_block_clear_approval_cancelled,
    handle_block_clear_approval_rejected,
    handle_block_clear_approval_requested,
)
from .clicksend import handle_clicksend_inbound
from .collections import (
    handle_collection_case_cured,
    handle_collection_case_exhausted,
    handle_collection_case_hardship_paused,
    handle_collection_case_opened,
    handle_collection_case_resumed,
    handle_collection_case_step_advanced,
    handle_collection_case_stop_contact_applied,
)
from .conversation import (
    handle_affordability_report_downloaded,
    handle_application_detail_changed,
    handle_assessment,
    handle_basiq_job_created,
    handle_conversation_started,
    handle_conversation_summary,
    handle_conversation_summary_changed,
    handle_credit_assessment_complete,
    handle_final_decision,
    handle_noticeboard_updated,
    handle_post_identity_risk_check,
    handle_statement_checks_complete,
    handle_statement_consent_cancelled,
    handle_statement_consent_complete,
    handle_statement_consent_initiated,
    handle_statement_retrieval_complete,
    handle_utterance,
)
from .customer import (
    handle_customer_changed,
    handle_customer_verified,
)
from .fraud import (
    handle_fraud_risk_assessment,
    handle_fraud_risk_halt,
)
from .identity import (
    handle_customer_identity_linked,
    handle_customer_identity_merged,
)
from .identity_verification import (
    handle_identity_report_archived,
)
from .marketing import (
    handle_batch_created,
    handle_batch_invitations_triggered,
    handle_contact_batch_assigned,
    handle_contact_consent_granted,
    handle_contact_consent_withdrawn,
    handle_contact_erased,
    handle_contact_merged,
    handle_contact_interaction_logged,
    handle_contact_linked,
    handle_contact_observed,
    handle_contact_stage_changed,
    handle_contact_unlinked,
    handle_contact_updated,
    handle_feedback_received,
    handle_feedback_status_changed,
    handle_referral_attributed,
)
from .notification import (
    handle_notification_delivery_failed,
    handle_notification_sent,
    handle_notification_suppression_changed,
    handle_statement_generated,
)
from .reapplication import (
    handle_reapplication_block_auto_cleared,
    handle_reapplication_block_clear_rejected,
    handle_reapplication_block_cleared,
    handle_reapplication_blocked,
)
from .writeoff import (
    handle_writeoff_approved,
    handle_writeoff_cancelled,
    handle_writeoff_rejected,
    handle_writeoff_requested,
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
    # Re-application block (BTB-135) + cleared/rejected projection (Task 6)
    "handle_reapplication_blocked",
    "handle_reapplication_block_cleared",
    "handle_reapplication_block_clear_rejected",
    "handle_reapplication_block_auto_cleared",
    # Identity verification archival (PR #67)
    "handle_identity_report_archived",
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
    "handle_affordability_report_downloaded",
    "handle_statement_checks_complete",
    # Credit assessment & post-identity handlers
    "handle_post_identity_risk_check",
    "handle_credit_assessment_complete",
    # Fraud risk handlers (fraud_risk.* from billieChat FraudRiskAgent)
    "handle_fraud_risk_assessment",
    "handle_fraud_risk_halt",
    # Write-off handlers (CRM-originated events)
    "handle_writeoff_requested",
    "handle_writeoff_approved",
    "handle_writeoff_rejected",
    "handle_writeoff_cancelled",
    # Block-clear approval handlers (CRM-originated events)
    "handle_block_clear_approval_requested",
    "handle_block_clear_approval_approved",
    "handle_block_clear_approval_rejected",
    "handle_block_clear_approval_cancelled",
    # Notification handlers (platform → CRM read-only projections)
    "handle_notification_sent",
    "handle_notification_delivery_failed",
    "handle_notification_suppression_changed",
    "handle_statement_generated",
    # Aging handler (platform → CRM read-only projection of arrears state)
    "handle_loan_aging_updated",
    # Collection case handlers (platform → CRM read-only projection — BTB-199)
    "handle_collection_case_opened",
    "handle_collection_case_exhausted",
    "handle_collection_case_cured",
    "handle_collection_case_hardship_paused",
    "handle_collection_case_resumed",
    "handle_collection_case_stop_contact_applied",
    "handle_collection_case_step_advanced",
    # Marketing (contact.*) handlers — project into contacts/interactions/
    # contact_audit_log (Task C3)
    "handle_contact_observed",
    "handle_contact_updated",
    "handle_contact_linked",
    "handle_contact_unlinked",
    "handle_contact_consent_granted",
    "handle_contact_consent_withdrawn",
    "handle_contact_interaction_logged",
    "handle_contact_stage_changed",
    "handle_contact_erased",
    "handle_contact_merged",
    # Marketing Phase-2 (Stream A) handlers — batches, feedback, referral
    "handle_batch_created",
    "handle_batch_invitations_triggered",
    "handle_contact_batch_assigned",
    "handle_feedback_received",
    "handle_feedback_status_changed",
    "handle_referral_attributed",
    # ClickSend inbound SMS (B1)
    "handle_clicksend_inbound",
]
