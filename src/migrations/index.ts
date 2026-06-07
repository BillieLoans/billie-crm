import * as migration_20260515_061818 from './20260515_061818';
import * as migration_20260607_132326 from './20260607_132326';

export const migrations = [
  {
    up: migration_20260515_061818.up,
    down: migration_20260515_061818.down,
    name: '20260515_061818',
  },
  {
    up: migration_20260607_132326.up,
    down: migration_20260607_132326.down,
    name: '20260607_132326'
  },
];
