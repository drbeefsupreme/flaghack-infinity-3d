/**
 * Actors: every Flag (planted / loose / thrown / quiver bundles / over-the-shoulder), the four
 * vexillomancer avatars, the instanced hippie crowd, D.E.G.E.N. status badges, dropped
 * beacons and unit rings. Publishes ctx.shared.unitAnchors (head positions by entity id,
 * vectors reused across frames). Flags and hippies draw at two levels of detail, and only
 * actors near the camera cast shadows (see lod.ts): about 20 draws regardless of counts.
 * Owner: RenderActors agent.
 */
import type * as THREE from 'three';
import type { GameEvent } from '../../sim/events';
import type { EntityId } from '../../sim/types';
import type { RenderContext, RenderModule } from '../context';
import { AvatarRenderer } from './avatarRenderer';
import { BeaconRenderer } from './beaconRenderer';
import { FlagRenderer } from './flagRenderer';
import { ActorView } from './lod';
import { HippieRenderer } from './hippieRenderer';
import { StatusIcons, UnitRings } from './overlays';

export class ActorsRenderer implements RenderModule {
  private readonly ctx: RenderContext;
  private readonly anchors = new Map<EntityId, THREE.Vector3>();
  private readonly view: ActorView;
  private readonly flags: FlagRenderer;
  private readonly rings: UnitRings;
  private readonly icons: StatusIcons;
  private readonly avatars: AvatarRenderer;
  private readonly hippies: HippieRenderer;
  private readonly beacons: BeaconRenderer;

  constructor(ctx: RenderContext) {
    this.ctx = ctx;
    ctx.shared.unitAnchors = this.anchors;
    this.view = new ActorView(ctx.quality !== 'low');
    this.flags = new FlagRenderer(ctx, this.view);
    this.rings = new UnitRings(ctx.scene);
    this.icons = new StatusIcons(ctx.scene);
    this.avatars = new AvatarRenderer(ctx, this.view, this.flags, this.rings, this.anchors);
    this.hippies = new HippieRenderer(ctx, this.view, this.flags, this.rings, this.icons, this.anchors);
    this.beacons = new BeaconRenderer(ctx, this.rings, this.icons);
  }

  update(dt: number): void {
    const ctx = this.ctx;
    this.view.update(ctx.camera);
    // Units first: they append carried Flags and pull-shake requests to the Flag batch.
    this.flags.begin();
    this.rings.begin();
    this.icons.begin();
    this.avatars.update(dt);
    this.hippies.update(dt);
    this.beacons.update();
    this.flags.end();
    this.rings.end(ctx.time);
    this.icons.end(ctx.time, ctx.session.viewBlend > 0.5 ? 1 : 0);
  }

  onEvent(e: GameEvent): void {
    this.flags.onEvent(e);
    this.avatars.onEvent(e);
    this.hippies.onEvent(e);
  }

  dispose(): void {
    this.flags.dispose();
    this.rings.dispose();
    this.icons.dispose();
    this.avatars.dispose();
    this.hippies.dispose();
    this.beacons.dispose();
    if (this.ctx.shared.unitAnchors === this.anchors) delete this.ctx.shared.unitAnchors;
    this.anchors.clear();
  }
}
