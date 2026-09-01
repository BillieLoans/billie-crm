import * as migration_20260515_061818 from './20260515_061818';
import * as migration_20260518_232948_drop_loan_account_customer_name from './20260518_232948_drop_loan_account_customer_name';
import * as migration_20260607_132326 from './20260607_132326';
import * as migration_20260610_114936_reapplication_block_identity_verification from './20260610_114936_reapplication_block_identity_verification';
import * as migration_20260618_065013_reapplication_block_recognition from './20260618_065013_reapplication_block_recognition';
import * as migration_20260619_011621 from './20260619_011621';
import * as migration_20260619_061320_payload_385_upgrade from './20260619_061320_payload_385_upgrade';
import * as migration_20260624_094132 from './20260624_094132';
import * as migration_20260628_120000_reapplication_block_clear_requests from './20260628_120000_reapplication_block_clear_requests';
import * as migration_20260702_052932 from './20260702_052932';
import * as migration_20260702_223751_marketing_module from './20260702_223751_marketing_module';
import * as migration_20260704_043533_marketing_phase2 from './20260704_043533_marketing_phase2';
import * as migration_20260707_121002 from './20260707_121002';
import * as migration_20260707_141505 from './20260707_141505';
import * as migration_20260708_020322 from './20260708_020322';
import * as migration_20260708_121539_contact_merged_into from './20260708_121539_contact_merged_into';
import * as migration_20260709_120104_fraud_risk from './20260709_120104_fraud_risk';
import * as migration_20260714_053341_word_of_mouth_source from './20260714_053341_word_of_mouth_source';
import * as migration_20260802_164058_applicant_release from './20260802_164058_applicant_release';
import * as migration_20260804_051712_applicant_release_customer_link from './20260804_051712_applicant_release_customer_link';
import * as migration_20260804_060425_gate_mode_closed from './20260804_060425_gate_mode_closed';
import * as migration_20260818_001906_issues_collection from './20260818_001906_issues_collection';
import * as migration_20260820_063404_statement_account_holders from './20260820_063404_statement_account_holders';
import * as migration_20260822_121203_reapplication_block_state_version from './20260822_121203_reapplication_block_state_version';
import * as migration_20260822_121938_reapplication_block_state_changed_at from './20260822_121938_reapplication_block_state_changed_at';
import * as migration_20260824_112358_conversation_kill_record from './20260824_112358_conversation_kill_record';
import * as migration_20260827_131500_llm_costs from './20260827_131500_llm_costs';
import * as migration_20260827_214500_llm_costs_has_usage from './20260827_214500_llm_costs_has_usage';
import * as migration_20260827_224500_llm_costs_system_rels from './20260827_224500_llm_costs_system_rels';
import * as migration_20260827_230000_llm_costs_uuid_id from './20260827_230000_llm_costs_uuid_id';
import * as migration_20260828_124500_conversations_llm_rollup_columns from './20260828_124500_conversations_llm_rollup_columns';
import * as migration_20260828_150000_loan_accounts_disbursement_account from './20260828_150000_loan_accounts_disbursement_account';
import * as migration_20260901_090000_conversation_cancellation from './20260901_090000_conversation_cancellation';

export const migrations = [
  {
    up: migration_20260515_061818.up,
    down: migration_20260515_061818.down,
    name: '20260515_061818',
  },
  {
    up: migration_20260518_232948_drop_loan_account_customer_name.up,
    down: migration_20260518_232948_drop_loan_account_customer_name.down,
    name: '20260518_232948_drop_loan_account_customer_name',
  },
  {
    up: migration_20260607_132326.up,
    down: migration_20260607_132326.down,
    name: '20260607_132326',
  },
  {
    up: migration_20260610_114936_reapplication_block_identity_verification.up,
    down: migration_20260610_114936_reapplication_block_identity_verification.down,
    name: '20260610_114936_reapplication_block_identity_verification',
  },
  {
    up: migration_20260618_065013_reapplication_block_recognition.up,
    down: migration_20260618_065013_reapplication_block_recognition.down,
    name: '20260618_065013_reapplication_block_recognition',
  },
  {
    up: migration_20260619_011621.up,
    down: migration_20260619_011621.down,
    name: '20260619_011621',
  },
  {
    up: migration_20260619_061320_payload_385_upgrade.up,
    down: migration_20260619_061320_payload_385_upgrade.down,
    name: '20260619_061320_payload_385_upgrade',
  },
  {
    up: migration_20260624_094132.up,
    down: migration_20260624_094132.down,
    name: '20260624_094132',
  },
  {
    up: migration_20260628_120000_reapplication_block_clear_requests.up,
    down: migration_20260628_120000_reapplication_block_clear_requests.down,
    name: '20260628_120000_reapplication_block_clear_requests',
  },
  {
    up: migration_20260702_052932.up,
    down: migration_20260702_052932.down,
    name: '20260702_052932',
  },
  {
    up: migration_20260702_223751_marketing_module.up,
    down: migration_20260702_223751_marketing_module.down,
    name: '20260702_223751_marketing_module',
  },
  {
    up: migration_20260704_043533_marketing_phase2.up,
    down: migration_20260704_043533_marketing_phase2.down,
    name: '20260704_043533_marketing_phase2',
  },
  {
    up: migration_20260707_121002.up,
    down: migration_20260707_121002.down,
    name: '20260707_121002',
  },
  {
    up: migration_20260707_141505.up,
    down: migration_20260707_141505.down,
    name: '20260707_141505',
  },
  {
    up: migration_20260708_020322.up,
    down: migration_20260708_020322.down,
    name: '20260708_020322',
  },
  {
    up: migration_20260708_121539_contact_merged_into.up,
    down: migration_20260708_121539_contact_merged_into.down,
    name: '20260708_121539_contact_merged_into',
  },
  {
    up: migration_20260709_120104_fraud_risk.up,
    down: migration_20260709_120104_fraud_risk.down,
    name: '20260709_120104_fraud_risk',
  },
  {
    up: migration_20260714_053341_word_of_mouth_source.up,
    down: migration_20260714_053341_word_of_mouth_source.down,
    name: '20260714_053341_word_of_mouth_source',
  },
  {
    up: migration_20260802_164058_applicant_release.up,
    down: migration_20260802_164058_applicant_release.down,
    name: '20260802_164058_applicant_release',
  },
  {
    up: migration_20260804_051712_applicant_release_customer_link.up,
    down: migration_20260804_051712_applicant_release_customer_link.down,
    name: '20260804_051712_applicant_release_customer_link',
  },
  {
    up: migration_20260804_060425_gate_mode_closed.up,
    down: migration_20260804_060425_gate_mode_closed.down,
    name: '20260804_060425_gate_mode_closed',
  },
  {
    up: migration_20260818_001906_issues_collection.up,
    down: migration_20260818_001906_issues_collection.down,
    name: '20260818_001906_issues_collection',
  },
  {
    up: migration_20260820_063404_statement_account_holders.up,
    down: migration_20260820_063404_statement_account_holders.down,
    name: '20260820_063404_statement_account_holders',
  },
  {
    up: migration_20260822_121203_reapplication_block_state_version.up,
    down: migration_20260822_121203_reapplication_block_state_version.down,
    name: '20260822_121203_reapplication_block_state_version',
  },
  {
    up: migration_20260822_121938_reapplication_block_state_changed_at.up,
    down: migration_20260822_121938_reapplication_block_state_changed_at.down,
    name: '20260822_121938_reapplication_block_state_changed_at',
  },
  {
    up: migration_20260824_112358_conversation_kill_record.up,
    down: migration_20260824_112358_conversation_kill_record.down,
    name: '20260824_112358_conversation_kill_record'
  },
  {
    up: migration_20260827_131500_llm_costs.up,
    down: migration_20260827_131500_llm_costs.down,
    name: '20260827_131500_llm_costs',
  },
  {
    up: migration_20260827_214500_llm_costs_has_usage.up,
    down: migration_20260827_214500_llm_costs_has_usage.down,
    name: '20260827_214500_llm_costs_has_usage',
  },
  {
    up: migration_20260827_224500_llm_costs_system_rels.up,
    down: migration_20260827_224500_llm_costs_system_rels.down,
    name: '20260827_224500_llm_costs_system_rels',
  },
  {
    up: migration_20260827_230000_llm_costs_uuid_id.up,
    down: migration_20260827_230000_llm_costs_uuid_id.down,
    name: '20260827_230000_llm_costs_uuid_id',
  },
  {
    up: migration_20260828_124500_conversations_llm_rollup_columns.up,
    down: migration_20260828_124500_conversations_llm_rollup_columns.down,
    name: '20260828_124500_conversations_llm_rollup_columns',
  },
  {
    up: migration_20260828_150000_loan_accounts_disbursement_account.up,
    down: migration_20260828_150000_loan_accounts_disbursement_account.down,
    name: '20260828_150000_loan_accounts_disbursement_account',
  },
  {
    up: migration_20260901_090000_conversation_cancellation.up,
    down: migration_20260901_090000_conversation_cancellation.down,
    name: '20260901_090000_conversation_cancellation',
  },
];
