import * as migration_20260515_061818 from './20260515_061818';
import * as migration_20260518_232948_drop_loan_account_customer_name from './20260518_232948_drop_loan_account_customer_name';
import * as migration_20260607_132326 from './20260607_132326';
import * as migration_20260610_114936_reapplication_block_identity_verification from './20260610_114936_reapplication_block_identity_verification';

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
    name: '20260610_114936_reapplication_block_identity_verification'
  },
];
