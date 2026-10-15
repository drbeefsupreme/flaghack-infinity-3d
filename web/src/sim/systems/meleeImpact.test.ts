import { describe, expect, it } from 'vitest';
import { AVATAR, HIPPIE, LEVEL_HEIGHT, SIM_DT } from '../constants';
import { createMatch } from '../setup';
import { normalizeMatch } from '../matchSettings';
import { spawnBuilding, spawnHippie, spawnPile, spawnPiece } from '../factory';
import { bossFixture } from '../../../tests/bossFixture';
import { cmdSwing, updateAvatars } from './avatars';
import { damageMelee, meleeContact } from './meleeImpact';
import { damageEntity } from './combat';
import { updateHippies } from './hippies';
import { pieceGroundHeight } from './econ/pieceGeometry';
import { BOSS_RADIUS } from '../boss';
const setup = () => createMatch({ seed: 'melee-impact', difficulty: 'normal', mode: 'standard', humans: [0, 1], match: normalizeMatch({ maxSignifiers: 0 }) });
function swing(w: ReturnType<typeof setup>) {
  cmdSwing(w, { t: 'swing', faction: 0 });
  w.time += AVATAR.swingTime * AVATAR.swingHitAt + .01;
  updateAvatars(w, SIM_DT);
}
const impacts = (w: ReturnType<typeof setup>) => w.drainEvents().filter(e => e.t === 'meleeImpact');
describe('authoritative melee contact fireworks', () => {
  it('grounds pile, airborne NPC, building and raised-piece contacts exactly once', () => {
    const w = setup(), a = w.avatarOf(0);
    const ground = (x: number, z: number) => w.collision.groundHeight(x, z);
    a.pos = { x: 0, y: ground(0, 60), z: 60 };
    const pile = spawnPile(w, 'lumber', { x: 0, z: 62 }, 20);
    expect(meleeContact(w, pile.id, a.id)?.y).toBe(ground(0, 62) + .6);
    const h = spawnHippie(w, 0, { x: 2, z: 60 }); h.airborne = { y: 1, vy: 0 };
    const target = w.avatarOf(1); target.pos = { x: 3, y: ground(3, 60), z: 60 };
    expect(meleeContact(w, target.id, h.id)?.y).toBeCloseTo(ground(2, 60) + 2.1, 10);
    const building = spawnBuilding(w, 'workshop', 1, 0, 1);
    a.pos.y = 0;
    expect(meleeContact(w, building.id, a.id)!.y).toBeGreaterThanOrEqual(ground(building.pos.x, building.pos.z));
    const piece = spawnPiece(w, 'wall', 1, 0, -1, 1, 0);
    expect(meleeContact(w, piece.id, a.id)?.y).toBe(pieceGroundHeight(w, piece) + LEVEL_HEIGHT);
  });
  it('emits one contact per actual unit and harvested pile, and never repeats per frame', () => {
    const w = setup(), a = w.avatarOf(0), rival = w.avatarOf(1);
    a.pos = { x: 0, y: 0, z: 60 }; a.yaw = a.input.yaw = 0;
    rival.pos = { x: 0, y: 0, z: 62 };
    const h = spawnHippie(w, 1, { x: 1, z: 62 }), pile = spawnPile(w, 'lumber', { x: 0, z: 62 }, 20);
    w.drainEvents(); swing(w);
    const e = impacts(w);
    expect(e.map(e => e.target).sort()).toEqual([rival.id, h.id, pile.id].sort());
    expect(new Set(e.map(e => e.impactId)).size).toBe(3);
    expect(e.find(e => e.target === rival.id)?.pos.z).toBeLessThan(62);
    expect(rival.hp).toBe(AVATAR.maxHp - AVATAR.swingDamage);
    updateAvatars(w, SIM_DT); expect(impacts(w)).toEqual([]);
  });
  it('misses and protected allied hits emit nothing; ordinary damage never masquerades as melee', () => {
    const w = setup(), a = w.avatarOf(0), rival = w.avatarOf(1);
    a.pos = { x: 0, y: 0, z: 60 }; a.yaw = a.input.yaw = 0;
    w.drainEvents(); swing(w); expect(impacts(w)).toEqual([]);
    rival.pos = { x: 0, y: 0, z: 62 };
    w.boss = bossFixture(); w.effigyRevealedAt = w.time; w.boss.pos = { x: 80, z: 80 };
    expect(damageMelee(w, rival.id, 20, a.id)).toBe(false); expect(impacts(w)).toEqual([]);
    w.effigyRevealedAt = null;
    damageEntity(w, rival.id, 1, a.id); expect(impacts(w)).toEqual([]);
  });
  it('building impacts use the reached face and skip disabled structures', () => {
    const w = setup(), a = w.avatarOf(0), b = spawnBuilding(w, 'workshop', 1, 0, 1);
    a.pos = { x: b.pos.x + 8, y: 0, z: b.pos.z };
    const hp = b.hp; w.drainEvents();
    expect(damageMelee(w, b.id, 10, a.id)).toBe(true); expect(b.hp).toBe(hp - 10);
    const e = impacts(w); expect(e).toHaveLength(1); expect(e[0].pos.x).toBeGreaterThan(b.pos.x);
    b.disabled = true; expect(damageMelee(w, b.id, 10, a.id)).toBe(false); expect(impacts(w)).toEqual([]);
  });
  it('real player/NPC staff and ordered hippie boss hits produce one small impact', () => {
    const w = setup(), a = w.avatarOf(0); w.time = 245; w.effigyRevealedAt = 230; w.boss = bossFixture();
    w.boss.pos = { x: 0, z: 60 };
    a.pos = { x: 0, y: 0, z: 60 - BOSS_RADIUS - 1 }; a.yaw = a.input.yaw = 0;
    w.drainEvents(); swing(w);
    expect(impacts(w).filter(e => e.target === w.boss!.id && e.by === a.id)).toHaveLength(1);
    const h = spawnHippie(w, 0, { x: BOSS_RADIUS + .5, z: 60 });
    h.order = { kind: 'attack', target: w.boss.id };
    w.drainEvents(); const hp = w.boss.hp; updateHippies(w, SIM_DT);
    expect(w.boss.hp).toBe(hp - HIPPIE.shoveDamage);
    expect(impacts(w).filter(e => e.by === h.id)).toHaveLength(1);
    updateHippies(w, SIM_DT); expect(impacts(w)).toEqual([]);
  });
  it('boss contact and lethal structure contact survive target removal without duplicate damage', () => {
    const w = setup(), a = w.avatarOf(0); w.boss = bossFixture();
    a.pos = { x: w.boss.pos.x, y: 0, z: w.boss.pos.z - 15 };
    const hp = w.boss.hp, contact = meleeContact(w, w.boss.id, a.id);
    expect(damageMelee(w, w.boss.id, AVATAR.swingDamage, a.id)).toBe(true);
    expect(w.boss.hp).toBe(hp - AVATAR.swingDamage);
    expect(impacts(w)[0]?.pos).toEqual(contact);
    const p = spawnPiece(w, 'wall', 1, 0, -1, 0, 0); p.hp = 1;
    const at = meleeContact(w, p.id, a.id);
    expect(damageMelee(w, p.id, 10, a.id)).toBe(true);
    expect(w.pieces.has(p.id)).toBe(false); expect(impacts(w)[0]?.pos).toEqual(at);
    expect(damageMelee(w, p.id, 10, a.id)).toBe(false); expect(impacts(w)).toEqual([]);
  });
});
