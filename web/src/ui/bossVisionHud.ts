/** Active-only Acid intelligence. Hidden content is cleared, including accessible text. */
import { bossVision } from '../game/bossVision';
import type { BossVisionTarget } from '../game/bossVision';
import type { Session } from '../game/session';
import type { FactionId } from '../sim/types';
import type { World } from '../sim/world';
import { factionName } from './core';
import { el, setAttr, setText, show } from './dom';
import './bossVisionHud.css';

export class BossVisionHud {
  readonly element: HTMLElement;
  private readonly title: HTMLElement;
  private readonly targets: HTMLElement;
  private readonly eye: HTMLElement;

  constructor(parent: HTMLElement) {
    this.element = el('section', 'boss-vision plaque is-off', parent);
    this.element.setAttribute('aria-hidden', 'true');
    this.title = el('div', 'boss-vision-title', this.element);
    this.targets = el('div', 'boss-vision-targets', this.element);
    this.eye = el('div', 'boss-vision-eye', this.element);
  }

  update(world: World | null, session: Session): void {
    const vision = bossVision(world, session);
    show(this.element, !!vision);
    setAttr(this.element, 'aria-hidden', String(!vision));
    setAttr(this.element, 'aria-label', vision ? 'Acid Cop Vision encounter intelligence' : '');
    if (!vision || !world) {
      setText(this.title, ''); setText(this.targets, ''); setText(this.eye, ''); return;
    }
    const describe = (target: BossVisionTarget | null): string => target ? `${target.faction >= 0 ? `${factionName(world, target.faction as FactionId, session.playerNames)} · ` : ''}${target.name}` : 'none committed';
    setText(this.title, `ACID COP VISION · ${Math.ceil(vision.seconds)}s`);
    setText(this.targets, `Chosen altar: ${describe(vision.objective)} | Tactical target: ${describe(vision.tactical)}`);
    setText(this.eye, vision.eye
      ? `Eye ${vision.eye.phase} · Pink dashes: committed aim plan · White: actual ray / impact`
      : 'Eye: no committed sweep');
  }

  dispose(): void { this.element.remove(); }
}
