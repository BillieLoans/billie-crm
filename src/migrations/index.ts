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
];
