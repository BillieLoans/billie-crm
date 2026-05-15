import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_users_role" AS ENUM('admin', 'supervisor', 'operations', 'readonly', 'service');
  CREATE TYPE "public"."enum_customers_identity_documents_document_type" AS ENUM('DRIVERS_LICENCE', 'PASSPORT', 'MEDICARE');
  CREATE TYPE "public"."enum_customers_ekyc_status" AS ENUM('successful', 'failed', 'pending');
  CREATE TYPE "public"."enum_customers_individual_status" AS ENUM('LIVING', 'DECEASED', 'MISSING');
  CREATE TYPE "public"."enum_conversations_status" AS ENUM('active', 'paused', 'soft_end', 'hard_end', 'approved', 'declined');
  CREATE TYPE "public"."enum_conversations_decision_status" AS ENUM('approved', 'declined', 'referred', 'no_decision');
  CREATE TYPE "public"."enum_app_proc_state_steps_type" AS ENUM('llm', 'business_logic', 'user_input');
  CREATE TYPE "public"."enum_applications_application_process_conversation_role" AS ENUM('user', 'assistant', 'system');
  CREATE TYPE "public"."enum_applications_application_outcome" AS ENUM('pending', 'approved', 'declined', 'withdrawn');
  CREATE TYPE "public"."enum_loan_accounts_repayment_schedule_payments_status" AS ENUM('scheduled', 'paid', 'missed', 'partial');
  CREATE TYPE "public"."enum_loan_accounts_aging_bucket" AS ENUM('current', 'early_arrears', 'late_arrears', 'default', 'closed');
  CREATE TYPE "public"."enum_loan_accounts_account_status" AS ENUM('pending_disbursement', 'active', 'paid_off', 'in_arrears', 'written_off');
  CREATE TYPE "public"."enum_loan_accounts_closure_reason" AS ENUM('PAID_OFF', 'WRITTEN_OFF', 'ADMIN_CLOSED');
  CREATE TYPE "public"."enum_loan_accounts_repayment_schedule_payment_frequency" AS ENUM('weekly', 'fortnightly', 'monthly');
  CREATE TYPE "public"."enum_write_off_requests_reason" AS ENUM('hardship', 'bankruptcy', 'deceased', 'unable_to_locate', 'fraud_victim', 'disputed', 'aged_debt', 'other');
  CREATE TYPE "public"."enum_write_off_requests_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');
  CREATE TYPE "public"."enum_write_off_requests_priority" AS ENUM('normal', 'high', 'urgent');
  CREATE TYPE "public"."enum_contact_notes_channel" AS ENUM('phone', 'email', 'sms', 'internal', 'system');
  CREATE TYPE "public"."enum_contact_notes_topic" AS ENUM('general_enquiry', 'complaint', 'escalation', 'internal_note', 'account_update', 'collections');
  CREATE TYPE "public"."enum_contact_notes_contact_direction" AS ENUM('inbound', 'outbound');
  CREATE TYPE "public"."enum_contact_notes_priority" AS ENUM('low', 'normal', 'high', 'urgent');
  CREATE TYPE "public"."enum_contact_notes_sentiment" AS ENUM('positive', 'neutral', 'negative', 'escalation');
  CREATE TYPE "public"."enum_contact_notes_status" AS ENUM('active', 'amended');
  CREATE TYPE "public"."enum_notifications_status" AS ENUM('sent', 'failed', 'blocked', 'statement', 'suppression_change');
  CREATE TYPE "public"."enum_notifications_channel" AS ENUM('email', 'sms');
  CREATE TYPE "public"."enum_notifications_failure_error_type" AS ENUM('transient', 'permanent', 'auth', 'template', 'contact_missing', 'opt_out', 'suppressed');
  CREATE TYPE "public"."enum_notifications_suppression_mode" AS ENUM('all', 'non_essential', 'marketing_only', 'panic_button', 'off');
  CREATE TABLE "users_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"created_at" timestamp(3) with time zone,
  	"expires_at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "users" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"role" "enum_users_role" DEFAULT 'readonly' NOT NULL,
  	"first_name" varchar NOT NULL,
  	"last_name" varchar NOT NULL,
  	"avatar_id" uuid,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"enable_a_p_i_key" boolean,
  	"api_key" varchar,
  	"api_key_index" varchar,
  	"email" varchar NOT NULL,
  	"reset_password_token" varchar,
  	"reset_password_expiration" timestamp(3) with time zone,
  	"salt" varchar,
  	"hash" varchar,
  	"login_attempts" numeric DEFAULT 0,
  	"lock_until" timestamp(3) with time zone
  );
  
  CREATE TABLE "media" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"alt" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric,
  	"focal_x" numeric,
  	"focal_y" numeric
  );
  
  CREATE TABLE "customers_identity_documents" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"document_type" "enum_customers_identity_documents_document_type" NOT NULL,
  	"document_subtype" varchar,
  	"document_number" varchar NOT NULL,
  	"expiry_date" timestamp(3) with time zone,
  	"state_of_issue" varchar,
  	"country_of_issue" varchar DEFAULT 'Australia',
  	"additional_info" jsonb
  );
  
  CREATE TABLE "customers" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"customer_id" varchar NOT NULL,
  	"title" varchar,
  	"preferred_name" varchar,
  	"first_name" varchar,
  	"middle_name" varchar,
  	"last_name" varchar,
  	"full_name" varchar,
  	"email_address" varchar,
  	"mobile_phone_number" varchar,
  	"date_of_birth" timestamp(3) with time zone,
  	"identity_verified" boolean,
  	"residential_address_street_number" varchar,
  	"residential_address_street_name" varchar,
  	"residential_address_street_type" varchar,
  	"residential_address_unit_number" varchar,
  	"residential_address_street" varchar,
  	"residential_address_suburb" varchar,
  	"residential_address_city" varchar,
  	"residential_address_state" varchar,
  	"residential_address_postcode" varchar,
  	"residential_address_country" varchar DEFAULT 'Australia',
  	"residential_address_full_address" varchar,
  	"mailing_address_street" varchar,
  	"mailing_address_city" varchar,
  	"mailing_address_state" varchar,
  	"mailing_address_postcode" varchar,
  	"mailing_address_country" varchar DEFAULT 'Australia',
  	"staff_flag" boolean,
  	"investor_flag" boolean,
  	"founder_flag" boolean,
  	"vulnerable_flag" boolean,
  	"ekyc_entity_id" varchar,
  	"ekyc_status" "enum_customers_ekyc_status",
  	"individual_status" "enum_customers_individual_status",
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "customers_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"applications_id" uuid,
  	"conversations_id" uuid,
  	"loan_accounts_id" uuid
  );
  
  CREATE TABLE "conversations_utterances" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"username" varchar,
  	"utterance" varchar NOT NULL,
  	"rationale" varchar,
  	"created_at" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone,
  	"answer_input_type" varchar,
  	"prev_seq" numeric,
  	"end_conversation" boolean DEFAULT false,
  	"additional_data" jsonb
  );
  
  CREATE TABLE "conversations_facts" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"fact" varchar
  );
  
  CREATE TABLE "conversations_noticeboard" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"agent_name" varchar,
  	"topic" varchar,
  	"content" varchar,
  	"timestamp" timestamp(3) with time zone
  );
  
  CREATE TABLE "conversations" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"conversation_id" varchar NOT NULL,
  	"application_number" varchar NOT NULL,
  	"customer_id_id" uuid,
  	"customer_id_string" varchar,
  	"application_id_id" uuid,
  	"status" "enum_conversations_status" DEFAULT 'active',
  	"started_at" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"purpose" varchar,
  	"version" numeric DEFAULT 1,
  	"last_utterance_time" timestamp(3) with time zone,
  	"final_decision" varchar,
  	"assessments_identity_risk" jsonb,
  	"assessments_serviceability" jsonb,
  	"assessments_fraud_check" jsonb,
  	"assessments_account_conduct" jsonb,
  	"assessments_post_identity_risk" jsonb,
  	"assessments_credit_assessment_complete" jsonb,
  	"statement_capture" jsonb,
  	"decision_status" "enum_conversations_decision_status",
  	"application_data" jsonb,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "app_proc_state_steps" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"step_name" varchar NOT NULL,
  	"description" varchar,
  	"complete" boolean DEFAULT false,
  	"type" "enum_app_proc_state_steps_type" DEFAULT 'llm',
  	"completion_event_name" varchar,
  	"answer_input_type" varchar,
  	"prompts_main" varchar,
  	"prompts_completeness_check" varchar,
  	"prompts_confirmation" varchar,
  	"prompts_output_json" varchar,
  	"prompts_mapping_out" jsonb,
  	"business_logic_module_name" varchar,
  	"business_logic_method_name" varchar,
  	"business_logic_mapping_in" jsonb,
  	"business_logic_mapping_out" jsonb
  );
  
  CREATE TABLE "app_proc_state" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"stage_name" varchar NOT NULL,
  	"complete" boolean DEFAULT false,
  	"prompt" varchar
  );
  
  CREATE TABLE "applications_application_process_conversation" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"role" "enum_applications_application_process_conversation_role",
  	"content" varchar,
  	"timestamp" timestamp(3) with time zone
  );
  
  CREATE TABLE "applications_noticeboard_versions" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"content" varchar,
  	"timestamp" timestamp(3) with time zone
  );
  
  CREATE TABLE "applications_noticeboard" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"agent_name" varchar NOT NULL,
  	"content" varchar NOT NULL,
  	"timestamp" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "applications" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"application_number" varchar NOT NULL,
  	"customer_id_id" uuid,
  	"loan_purpose" varchar,
  	"loan_amount" numeric,
  	"loan_fee" numeric,
  	"loan_total_payable" numeric,
  	"loan_term" numeric,
  	"customer_attestation_acceptance" boolean,
  	"statement_capture_consent_provided" boolean,
  	"statement_capture_completed" boolean,
  	"product_offer_acceptance" boolean,
  	"application_outcome" "enum_applications_application_outcome",
  	"application_process_current_process_stage" varchar,
  	"application_process_current_process_step" varchar,
  	"application_process_started_at" timestamp(3) with time zone,
  	"application_process_updated_at" timestamp(3) with time zone,
  	"assessments_identity_risk" jsonb,
  	"assessments_serviceability" jsonb,
  	"assessments_fraud_check" jsonb,
  	"version" numeric DEFAULT 1,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "applications_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"conversations_id" uuid
  );
  
  CREATE TABLE "loan_accounts_repayment_schedule_payments" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"payment_number" numeric NOT NULL,
  	"due_date" timestamp(3) with time zone,
  	"amount" numeric,
  	"status" "enum_loan_accounts_repayment_schedule_payments_status" DEFAULT 'scheduled',
  	"amount_paid" numeric,
  	"amount_remaining" numeric,
  	"paid_date" timestamp(3) with time zone,
  	"linked_transaction_ids" jsonb,
  	"last_updated" timestamp(3) with time zone
  );
  
  CREATE TABLE "loan_accounts" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"loan_account_id" varchar NOT NULL,
  	"account_number" varchar NOT NULL,
  	"customer_id_id" uuid,
  	"customer_id_string" varchar,
  	"customer_name" varchar,
  	"loan_terms_loan_amount" numeric,
  	"loan_terms_loan_fee" numeric,
  	"loan_terms_total_payable" numeric,
  	"loan_terms_opened_date" timestamp(3) with time zone,
  	"loan_terms_disbursed_date" timestamp(3) with time zone,
  	"balances_current_balance" numeric,
  	"balances_total_outstanding" numeric,
  	"balances_total_paid" numeric,
  	"last_payment_date" timestamp(3) with time zone,
  	"last_payment_amount" numeric,
  	"aging_is_in_arrears" boolean DEFAULT false,
  	"aging_bucket" "enum_loan_accounts_aging_bucket",
  	"aging_current_d_p_d" numeric,
  	"aging_last_updated" timestamp(3) with time zone,
  	"account_status" "enum_loan_accounts_account_status" DEFAULT 'active' NOT NULL,
  	"sdk_status" varchar,
  	"signed_loan_agreement_url" varchar,
  	"closure_reason" "enum_loan_accounts_closure_reason",
  	"closure_previous_status" varchar,
  	"closure_closed_date" timestamp(3) with time zone,
  	"closure_final_balance" numeric,
  	"closure_total_paid" numeric,
  	"closure_loan_total_payable" numeric,
  	"closure_triggered_by_transaction_id" varchar,
  	"repayment_schedule_schedule_id" varchar,
  	"repayment_schedule_number_of_payments" numeric,
  	"repayment_schedule_payment_frequency" "enum_loan_accounts_repayment_schedule_payment_frequency",
  	"repayment_schedule_created_date" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "write_off_requests_supporting_documents" (
  	"_order" integer NOT NULL,
  	"_parent_id" uuid NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"document_id" uuid,
  	"description" varchar
  );
  
  CREATE TABLE "write_off_requests" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"request_id" varchar NOT NULL,
  	"event_id" varchar,
  	"request_number" varchar,
  	"loan_account_id" varchar NOT NULL,
  	"customer_id" varchar NOT NULL,
  	"customer_name" varchar,
  	"account_number" varchar,
  	"amount" numeric NOT NULL,
  	"original_balance" numeric,
  	"reason" "enum_write_off_requests_reason" NOT NULL,
  	"notes" varchar,
  	"status" "enum_write_off_requests_status" DEFAULT 'pending' NOT NULL,
  	"priority" "enum_write_off_requests_priority" DEFAULT 'normal',
  	"requires_senior_approval" boolean DEFAULT false,
  	"requested_by_id" uuid,
  	"requested_by_name" varchar,
  	"approval_details_decided_by_id" uuid,
  	"approval_details_decided_by_name" varchar,
  	"approval_details_decided_at" timestamp(3) with time zone,
  	"approval_details_comment" varchar,
  	"approval_details_approved_by" varchar,
  	"approval_details_approved_by_name" varchar,
  	"approval_details_approved_at" timestamp(3) with time zone,
  	"approval_details_rejected_by" varchar,
  	"approval_details_rejected_by_name" varchar,
  	"approval_details_rejected_at" timestamp(3) with time zone,
  	"approval_details_reason" varchar,
  	"cancellation_details_cancelled_by" varchar,
  	"cancellation_details_cancelled_by_name" varchar,
  	"cancellation_details_cancelled_at" timestamp(3) with time zone,
  	"requested_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "contact_notes" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"customer_id" uuid NOT NULL,
  	"loan_account_id" uuid,
  	"application_id" uuid,
  	"conversation_id" uuid,
  	"channel" "enum_contact_notes_channel" NOT NULL,
  	"topic" "enum_contact_notes_topic" NOT NULL,
  	"contact_direction" "enum_contact_notes_contact_direction",
  	"subject" varchar NOT NULL,
  	"content" jsonb NOT NULL,
  	"priority" "enum_contact_notes_priority" DEFAULT 'normal',
  	"sentiment" "enum_contact_notes_sentiment" DEFAULT 'neutral',
  	"created_by_id" uuid NOT NULL,
  	"amends_note_id" uuid,
  	"status" "enum_contact_notes_status" DEFAULT 'active' NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "notifications" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"notification_id" varchar NOT NULL,
  	"idempotency_key" varchar,
  	"request_id" varchar,
  	"customer_ref_id" uuid,
  	"customer_id" varchar,
  	"status" "enum_notifications_status" NOT NULL,
  	"channel" "enum_notifications_channel",
  	"template_name" varchar,
  	"template_content_hash" varchar,
  	"template_git_sha" varchar,
  	"provider" varchar,
  	"provider_message_id" varchar,
  	"recipient_hash" varchar,
  	"correlation_id" varchar,
  	"event_at" timestamp(3) with time zone NOT NULL,
  	"sent_at" timestamp(3) with time zone,
  	"tags_category" varchar,
  	"tags_reason" varchar,
  	"tags_step" numeric,
  	"failure_failed_at" timestamp(3) with time zone,
  	"failure_error_type" "enum_notifications_failure_error_type",
  	"failure_error_message" varchar,
  	"failure_attempt" numeric,
  	"failure_fallback_suggested" varchar,
  	"statement_account_id" varchar,
  	"statement_period_start" timestamp(3) with time zone,
  	"statement_period_end" timestamp(3) with time zone,
  	"statement_dispatched_at" timestamp(3) with time zone,
  	"suppression_mode" "enum_notifications_suppression_mode",
  	"suppression_reason" varchar,
  	"suppression_set_by" varchar,
  	"suppression_set_at" timestamp(3) with time zone,
  	"suppression_expires_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"global_slug" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" uuid,
  	"media_id" uuid,
  	"customers_id" uuid,
  	"conversations_id" uuid,
  	"applications_id" uuid,
  	"loan_accounts_id" uuid,
  	"write_off_requests_id" uuid,
  	"contact_notes_id" uuid,
  	"notifications_id" uuid
  );
  
  CREATE TABLE "payload_preferences" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"key" varchar,
  	"value" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_preferences_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" uuid NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" uuid
  );
  
  CREATE TABLE "payload_migrations" (
  	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  	"name" varchar,
  	"batch" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "users_sessions" ADD CONSTRAINT "users_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "users" ADD CONSTRAINT "users_avatar_id_media_id_fk" FOREIGN KEY ("avatar_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "customers_identity_documents" ADD CONSTRAINT "customers_identity_documents_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "customers_rels" ADD CONSTRAINT "customers_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "customers_rels" ADD CONSTRAINT "customers_rels_applications_fk" FOREIGN KEY ("applications_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "customers_rels" ADD CONSTRAINT "customers_rels_conversations_fk" FOREIGN KEY ("conversations_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "customers_rels" ADD CONSTRAINT "customers_rels_loan_accounts_fk" FOREIGN KEY ("loan_accounts_id") REFERENCES "public"."loan_accounts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "conversations_utterances" ADD CONSTRAINT "conversations_utterances_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "conversations_facts" ADD CONSTRAINT "conversations_facts_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "conversations_noticeboard" ADD CONSTRAINT "conversations_noticeboard_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_id_customers_id_fk" FOREIGN KEY ("customer_id_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_application_id_id_applications_id_fk" FOREIGN KEY ("application_id_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "app_proc_state_steps" ADD CONSTRAINT "app_proc_state_steps_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."app_proc_state"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "app_proc_state" ADD CONSTRAINT "app_proc_state_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "applications_application_process_conversation" ADD CONSTRAINT "applications_application_process_conversation_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "applications_noticeboard_versions" ADD CONSTRAINT "applications_noticeboard_versions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."applications_noticeboard"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "applications_noticeboard" ADD CONSTRAINT "applications_noticeboard_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "applications" ADD CONSTRAINT "applications_customer_id_id_customers_id_fk" FOREIGN KEY ("customer_id_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "applications_rels" ADD CONSTRAINT "applications_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "applications_rels" ADD CONSTRAINT "applications_rels_conversations_fk" FOREIGN KEY ("conversations_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "loan_accounts_repayment_schedule_payments" ADD CONSTRAINT "loan_accounts_repayment_schedule_payments_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."loan_accounts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "loan_accounts" ADD CONSTRAINT "loan_accounts_customer_id_id_customers_id_fk" FOREIGN KEY ("customer_id_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "write_off_requests_supporting_documents" ADD CONSTRAINT "write_off_requests_supporting_documents_document_id_media_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "write_off_requests_supporting_documents" ADD CONSTRAINT "write_off_requests_supporting_documents_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."write_off_requests"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "write_off_requests" ADD CONSTRAINT "write_off_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "write_off_requests" ADD CONSTRAINT "write_off_requests_approval_details_decided_by_id_users_id_fk" FOREIGN KEY ("approval_details_decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_loan_account_id_loan_accounts_id_fk" FOREIGN KEY ("loan_account_id") REFERENCES "public"."loan_accounts"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_amends_note_id_contact_notes_id_fk" FOREIGN KEY ("amends_note_id") REFERENCES "public"."contact_notes"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "notifications" ADD CONSTRAINT "notifications_customer_ref_id_customers_id_fk" FOREIGN KEY ("customer_ref_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_customers_fk" FOREIGN KEY ("customers_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_conversations_fk" FOREIGN KEY ("conversations_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_applications_fk" FOREIGN KEY ("applications_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_loan_accounts_fk" FOREIGN KEY ("loan_accounts_id") REFERENCES "public"."loan_accounts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_write_off_requests_fk" FOREIGN KEY ("write_off_requests_id") REFERENCES "public"."write_off_requests"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_contact_notes_fk" FOREIGN KEY ("contact_notes_id") REFERENCES "public"."contact_notes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_notifications_fk" FOREIGN KEY ("notifications_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "users_sessions_order_idx" ON "users_sessions" USING btree ("_order");
  CREATE INDEX "users_sessions_parent_id_idx" ON "users_sessions" USING btree ("_parent_id");
  CREATE INDEX "users_avatar_idx" ON "users" USING btree ("avatar_id");
  CREATE INDEX "users_updated_at_idx" ON "users" USING btree ("updated_at");
  CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");
  CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");
  CREATE INDEX "media_updated_at_idx" ON "media" USING btree ("updated_at");
  CREATE INDEX "media_created_at_idx" ON "media" USING btree ("created_at");
  CREATE UNIQUE INDEX "media_filename_idx" ON "media" USING btree ("filename");
  CREATE INDEX "customers_identity_documents_order_idx" ON "customers_identity_documents" USING btree ("_order");
  CREATE INDEX "customers_identity_documents_parent_id_idx" ON "customers_identity_documents" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "customers_customer_id_idx" ON "customers" USING btree ("customer_id");
  CREATE INDEX "customers_updated_at_idx" ON "customers" USING btree ("updated_at");
  CREATE INDEX "customers_created_at_idx" ON "customers" USING btree ("created_at");
  CREATE INDEX "customers_rels_order_idx" ON "customers_rels" USING btree ("order");
  CREATE INDEX "customers_rels_parent_idx" ON "customers_rels" USING btree ("parent_id");
  CREATE INDEX "customers_rels_path_idx" ON "customers_rels" USING btree ("path");
  CREATE INDEX "customers_rels_applications_id_idx" ON "customers_rels" USING btree ("applications_id");
  CREATE INDEX "customers_rels_conversations_id_idx" ON "customers_rels" USING btree ("conversations_id");
  CREATE INDEX "customers_rels_loan_accounts_id_idx" ON "customers_rels" USING btree ("loan_accounts_id");
  CREATE INDEX "conversations_utterances_order_idx" ON "conversations_utterances" USING btree ("_order");
  CREATE INDEX "conversations_utterances_parent_id_idx" ON "conversations_utterances" USING btree ("_parent_id");
  CREATE INDEX "conversations_facts_order_idx" ON "conversations_facts" USING btree ("_order");
  CREATE INDEX "conversations_facts_parent_id_idx" ON "conversations_facts" USING btree ("_parent_id");
  CREATE INDEX "conversations_noticeboard_order_idx" ON "conversations_noticeboard" USING btree ("_order");
  CREATE INDEX "conversations_noticeboard_parent_id_idx" ON "conversations_noticeboard" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "conversations_conversation_id_idx" ON "conversations" USING btree ("conversation_id");
  CREATE INDEX "conversations_application_number_idx" ON "conversations" USING btree ("application_number");
  CREATE INDEX "conversations_customer_id_idx" ON "conversations" USING btree ("customer_id_id");
  CREATE INDEX "conversations_customer_id_string_idx" ON "conversations" USING btree ("customer_id_string");
  CREATE INDEX "conversations_application_id_idx" ON "conversations" USING btree ("application_id_id");
  CREATE INDEX "conversations_status_idx" ON "conversations" USING btree ("status");
  CREATE INDEX "conversations_decision_status_idx" ON "conversations" USING btree ("decision_status");
  CREATE INDEX "conversations_created_at_idx" ON "conversations" USING btree ("created_at");
  CREATE INDEX "conversations_monitor_grid_idx" ON "conversations" USING btree ("status","decision_status","updated_at" desc);
  CREATE INDEX "conversations_by_customer_idx" ON "conversations" USING btree ("customer_id_string","updated_at" desc);
  CREATE INDEX "app_proc_state_steps_order_idx" ON "app_proc_state_steps" USING btree ("_order");
  CREATE INDEX "app_proc_state_steps_parent_id_idx" ON "app_proc_state_steps" USING btree ("_parent_id");
  CREATE INDEX "app_proc_state_order_idx" ON "app_proc_state" USING btree ("_order");
  CREATE INDEX "app_proc_state_parent_id_idx" ON "app_proc_state" USING btree ("_parent_id");
  CREATE INDEX "applications_application_process_conversation_order_idx" ON "applications_application_process_conversation" USING btree ("_order");
  CREATE INDEX "applications_application_process_conversation_parent_id_idx" ON "applications_application_process_conversation" USING btree ("_parent_id");
  CREATE INDEX "applications_noticeboard_versions_order_idx" ON "applications_noticeboard_versions" USING btree ("_order");
  CREATE INDEX "applications_noticeboard_versions_parent_id_idx" ON "applications_noticeboard_versions" USING btree ("_parent_id");
  CREATE INDEX "applications_noticeboard_order_idx" ON "applications_noticeboard" USING btree ("_order");
  CREATE INDEX "applications_noticeboard_parent_id_idx" ON "applications_noticeboard" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "applications_application_number_idx" ON "applications" USING btree ("application_number");
  CREATE INDEX "applications_customer_id_idx" ON "applications" USING btree ("customer_id_id");
  CREATE INDEX "applications_application_outcome_idx" ON "applications" USING btree ("application_outcome");
  CREATE INDEX "applications_updated_at_idx" ON "applications" USING btree ("updated_at");
  CREATE INDEX "applications_created_at_idx" ON "applications" USING btree ("created_at");
  CREATE INDEX "applications_rels_order_idx" ON "applications_rels" USING btree ("order");
  CREATE INDEX "applications_rels_parent_idx" ON "applications_rels" USING btree ("parent_id");
  CREATE INDEX "applications_rels_path_idx" ON "applications_rels" USING btree ("path");
  CREATE INDEX "applications_rels_conversations_id_idx" ON "applications_rels" USING btree ("conversations_id");
  CREATE INDEX "loan_accounts_repayment_schedule_payments_order_idx" ON "loan_accounts_repayment_schedule_payments" USING btree ("_order");
  CREATE INDEX "loan_accounts_repayment_schedule_payments_parent_id_idx" ON "loan_accounts_repayment_schedule_payments" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "loan_accts_repay_sched_payments_natural_key_idx" ON "loan_accounts_repayment_schedule_payments" USING btree ("_parent_id","payment_number");
  CREATE UNIQUE INDEX "loan_accounts_loan_account_id_idx" ON "loan_accounts" USING btree ("loan_account_id");
  CREATE INDEX "loan_accounts_account_number_idx" ON "loan_accounts" USING btree ("account_number");
  CREATE INDEX "loan_accounts_customer_id_idx" ON "loan_accounts" USING btree ("customer_id_id");
  CREATE INDEX "loan_accounts_customer_id_string_idx" ON "loan_accounts" USING btree ("customer_id_string");
  CREATE INDEX "loan_accounts_loan_terms_loan_terms_disbursed_date_idx" ON "loan_accounts" USING btree ("loan_terms_disbursed_date");
  CREATE INDEX "loan_accounts_aging_aging_is_in_arrears_idx" ON "loan_accounts" USING btree ("aging_is_in_arrears");
  CREATE INDEX "loan_accounts_aging_aging_bucket_idx" ON "loan_accounts" USING btree ("aging_bucket");
  CREATE INDEX "loan_accounts_account_status_idx" ON "loan_accounts" USING btree ("account_status");
  CREATE INDEX "loan_accounts_updated_at_idx" ON "loan_accounts" USING btree ("updated_at");
  CREATE INDEX "loan_accounts_created_at_idx" ON "loan_accounts" USING btree ("created_at");
  CREATE INDEX "write_off_requests_supporting_documents_order_idx" ON "write_off_requests_supporting_documents" USING btree ("_order");
  CREATE INDEX "write_off_requests_supporting_documents_parent_id_idx" ON "write_off_requests_supporting_documents" USING btree ("_parent_id");
  CREATE INDEX "write_off_requests_supporting_documents_document_idx" ON "write_off_requests_supporting_documents" USING btree ("document_id");
  CREATE UNIQUE INDEX "write_off_requests_request_id_idx" ON "write_off_requests" USING btree ("request_id");
  CREATE INDEX "write_off_requests_event_id_idx" ON "write_off_requests" USING btree ("event_id");
  CREATE INDEX "write_off_requests_request_number_idx" ON "write_off_requests" USING btree ("request_number");
  CREATE INDEX "write_off_requests_loan_account_id_idx" ON "write_off_requests" USING btree ("loan_account_id");
  CREATE INDEX "write_off_requests_customer_id_idx" ON "write_off_requests" USING btree ("customer_id");
  CREATE INDEX "write_off_requests_status_idx" ON "write_off_requests" USING btree ("status");
  CREATE INDEX "write_off_requests_requested_by_idx" ON "write_off_requests" USING btree ("requested_by_id");
  CREATE INDEX "write_off_requests_approval_details_approval_details_decided_by_idx" ON "write_off_requests" USING btree ("approval_details_decided_by_id");
  CREATE INDEX "write_off_requests_updated_at_idx" ON "write_off_requests" USING btree ("updated_at");
  CREATE INDEX "write_off_requests_created_at_idx" ON "write_off_requests" USING btree ("created_at");
  CREATE INDEX "contact_notes_customer_idx" ON "contact_notes" USING btree ("customer_id");
  CREATE INDEX "contact_notes_loan_account_idx" ON "contact_notes" USING btree ("loan_account_id");
  CREATE INDEX "contact_notes_application_idx" ON "contact_notes" USING btree ("application_id");
  CREATE INDEX "contact_notes_conversation_idx" ON "contact_notes" USING btree ("conversation_id");
  CREATE INDEX "contact_notes_created_by_idx" ON "contact_notes" USING btree ("created_by_id");
  CREATE INDEX "contact_notes_amends_note_idx" ON "contact_notes" USING btree ("amends_note_id");
  CREATE INDEX "contact_notes_status_idx" ON "contact_notes" USING btree ("status");
  CREATE INDEX "contact_notes_created_at_idx" ON "contact_notes" USING btree ("created_at");
  CREATE INDEX "contact_notes_updated_at_idx" ON "contact_notes" USING btree ("updated_at");
  CREATE UNIQUE INDEX "notifications_notification_id_idx" ON "notifications" USING btree ("notification_id");
  CREATE INDEX "notifications_idempotency_key_idx" ON "notifications" USING btree ("idempotency_key");
  CREATE INDEX "notifications_customer_ref_idx" ON "notifications" USING btree ("customer_ref_id");
  CREATE INDEX "notifications_customer_id_idx" ON "notifications" USING btree ("customer_id");
  CREATE INDEX "notifications_status_idx" ON "notifications" USING btree ("status");
  CREATE INDEX "notifications_event_at_idx" ON "notifications" USING btree ("event_at");
  CREATE INDEX "payload_locked_documents_global_slug_idx" ON "payload_locked_documents" USING btree ("global_slug");
  CREATE INDEX "payload_locked_documents_updated_at_idx" ON "payload_locked_documents" USING btree ("updated_at");
  CREATE INDEX "payload_locked_documents_created_at_idx" ON "payload_locked_documents" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_order_idx" ON "payload_locked_documents_rels" USING btree ("order");
  CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "payload_locked_documents_rels" USING btree ("parent_id");
  CREATE INDEX "payload_locked_documents_rels_path_idx" ON "payload_locked_documents_rels" USING btree ("path");
  CREATE INDEX "payload_locked_documents_rels_users_id_idx" ON "payload_locked_documents_rels" USING btree ("users_id");
  CREATE INDEX "payload_locked_documents_rels_media_id_idx" ON "payload_locked_documents_rels" USING btree ("media_id");
  CREATE INDEX "payload_locked_documents_rels_customers_id_idx" ON "payload_locked_documents_rels" USING btree ("customers_id");
  CREATE INDEX "payload_locked_documents_rels_conversations_id_idx" ON "payload_locked_documents_rels" USING btree ("conversations_id");
  CREATE INDEX "payload_locked_documents_rels_applications_id_idx" ON "payload_locked_documents_rels" USING btree ("applications_id");
  CREATE INDEX "payload_locked_documents_rels_loan_accounts_id_idx" ON "payload_locked_documents_rels" USING btree ("loan_accounts_id");
  CREATE INDEX "payload_locked_documents_rels_write_off_requests_id_idx" ON "payload_locked_documents_rels" USING btree ("write_off_requests_id");
  CREATE INDEX "payload_locked_documents_rels_contact_notes_id_idx" ON "payload_locked_documents_rels" USING btree ("contact_notes_id");
  CREATE INDEX "payload_locked_documents_rels_notifications_id_idx" ON "payload_locked_documents_rels" USING btree ("notifications_id");
  CREATE INDEX "payload_preferences_key_idx" ON "payload_preferences" USING btree ("key");
  CREATE INDEX "payload_preferences_updated_at_idx" ON "payload_preferences" USING btree ("updated_at");
  CREATE INDEX "payload_preferences_created_at_idx" ON "payload_preferences" USING btree ("created_at");
  CREATE INDEX "payload_preferences_rels_order_idx" ON "payload_preferences_rels" USING btree ("order");
  CREATE INDEX "payload_preferences_rels_parent_idx" ON "payload_preferences_rels" USING btree ("parent_id");
  CREATE INDEX "payload_preferences_rels_path_idx" ON "payload_preferences_rels" USING btree ("path");
  CREATE INDEX "payload_preferences_rels_users_id_idx" ON "payload_preferences_rels" USING btree ("users_id");
  CREATE INDEX "payload_migrations_updated_at_idx" ON "payload_migrations" USING btree ("updated_at");
  CREATE INDEX "payload_migrations_created_at_idx" ON "payload_migrations" USING btree ("created_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "users_sessions" CASCADE;
  DROP TABLE "users" CASCADE;
  DROP TABLE "media" CASCADE;
  DROP TABLE "customers_identity_documents" CASCADE;
  DROP TABLE "customers" CASCADE;
  DROP TABLE "customers_rels" CASCADE;
  DROP TABLE "conversations_utterances" CASCADE;
  DROP TABLE "conversations_facts" CASCADE;
  DROP TABLE "conversations_noticeboard" CASCADE;
  DROP TABLE "conversations" CASCADE;
  DROP TABLE "app_proc_state_steps" CASCADE;
  DROP TABLE "app_proc_state" CASCADE;
  DROP TABLE "applications_application_process_conversation" CASCADE;
  DROP TABLE "applications_noticeboard_versions" CASCADE;
  DROP TABLE "applications_noticeboard" CASCADE;
  DROP TABLE "applications" CASCADE;
  DROP TABLE "applications_rels" CASCADE;
  DROP TABLE "loan_accounts_repayment_schedule_payments" CASCADE;
  DROP TABLE "loan_accounts" CASCADE;
  DROP TABLE "write_off_requests_supporting_documents" CASCADE;
  DROP TABLE "write_off_requests" CASCADE;
  DROP TABLE "contact_notes" CASCADE;
  DROP TABLE "notifications" CASCADE;
  DROP TABLE "payload_locked_documents" CASCADE;
  DROP TABLE "payload_locked_documents_rels" CASCADE;
  DROP TABLE "payload_preferences" CASCADE;
  DROP TABLE "payload_preferences_rels" CASCADE;
  DROP TABLE "payload_migrations" CASCADE;
  DROP TYPE "public"."enum_users_role";
  DROP TYPE "public"."enum_customers_identity_documents_document_type";
  DROP TYPE "public"."enum_customers_ekyc_status";
  DROP TYPE "public"."enum_customers_individual_status";
  DROP TYPE "public"."enum_conversations_status";
  DROP TYPE "public"."enum_conversations_decision_status";
  DROP TYPE "public"."enum_app_proc_state_steps_type";
  DROP TYPE "public"."enum_applications_application_process_conversation_role";
  DROP TYPE "public"."enum_applications_application_outcome";
  DROP TYPE "public"."enum_loan_accounts_repayment_schedule_payments_status";
  DROP TYPE "public"."enum_loan_accounts_aging_bucket";
  DROP TYPE "public"."enum_loan_accounts_account_status";
  DROP TYPE "public"."enum_loan_accounts_closure_reason";
  DROP TYPE "public"."enum_loan_accounts_repayment_schedule_payment_frequency";
  DROP TYPE "public"."enum_write_off_requests_reason";
  DROP TYPE "public"."enum_write_off_requests_status";
  DROP TYPE "public"."enum_write_off_requests_priority";
  DROP TYPE "public"."enum_contact_notes_channel";
  DROP TYPE "public"."enum_contact_notes_topic";
  DROP TYPE "public"."enum_contact_notes_contact_direction";
  DROP TYPE "public"."enum_contact_notes_priority";
  DROP TYPE "public"."enum_contact_notes_sentiment";
  DROP TYPE "public"."enum_contact_notes_status";
  DROP TYPE "public"."enum_notifications_status";
  DROP TYPE "public"."enum_notifications_channel";
  DROP TYPE "public"."enum_notifications_failure_error_type";
  DROP TYPE "public"."enum_notifications_suppression_mode";`)
}
