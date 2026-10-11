import type { EntityId } from '../../types';
import type { World } from '../../world';
import { clearBossEyeCharge } from '../../boss';

/** Cooperation begins at the reveal, independent of rendering or model loading. */
export function bossEncounterActive(world: World): boolean { return world.effigyRevealedAt !== null; }

/** Boss HP is never regenerated. Its death clock begins on the authoritative damaging tick. */
export function damageBoss(world: World, amount: number, by: EntityId | -1): boolean {
  const boss = world.boss;
  if (!boss || boss.hp <= 0 || amount <= 0 || world.phase !== 'playing') return false;
  boss.hp = Math.max(0, boss.hp - amount);
  world.emit({ t: 'hit', target: boss.id, by, amount, pos: { x: boss.pos.x, y: 4, z: boss.pos.z } });
  const attacker = world.avatars.get(by);
  if (attacker && world.factions[attacker.faction].alive) {
    const next = typeof world.scratch.bossRetaliateAfter === 'number' ? world.scratch.bossRetaliateAfter : 0;
    if (world.time >= next) {
      boss.retaliateId = by;
      boss.retaliateUntil = world.time + 5;
      world.scratch.bossRetaliateAfter = world.time + 13;
    }
  }
  if (boss.hp === 0) {
    clearBossEyeCharge(boss);
    boss.lightning = [];
    boss.action = 'death';
    boss.actionAt = boss.deathAt = world.time;
    boss.actionSeq++;
    boss.target = null;
    boss.held = null;
    boss.barrier = null;
    world.emit({ t: 'notify', faction: 'all', text: 'The giant falls. Hold on until the last embers fade.', severity: 'epic' });
  }
  return true;
}
