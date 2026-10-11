import { afterEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../game/session';
import { normalizeMatch } from '../sim/matchSettings';
import type { World } from '../sim/world';
import type { UiHost } from './core';
import { FeedPart } from './feed';

afterEach(() => vi.unstubAllGlobals());

describe('pre-reveal Burn announcements', () => {
  it.each([true, false])('keeps the encounter surprise with explicit mode %s', bossMode => {
    const element = { className: '', dataset: {} };
    vi.stubGlobal('document', { createElement: () => element });
    const session = new Session(); session.screen = 'playing';
    const post = vi.fn(), banner = vi.fn();
    const feed = new FeedPart({ app: { session }, post, banner } as unknown as UiHost,
      { appendChild() {} } as unknown as HTMLElement);
    const world = { options: { match: normalizeMatch({ bossMode, dayLength: 600 }) } } as World;
    feed.onEvent({ t: 'burn' }, world);
    expect(post).toHaveBeenCalledWith(bossMode
      ? 'The effigy burns. Sudden death has begun!'
      : 'The effigy burns. Sudden death until dawn at 10:00!', 'epic');
    expect(JSON.stringify([post.mock.calls, banner.mock.calls])).not.toMatch(/boss|giant|encounter|stirs|awaken|reveal|90 seconds/i);
    expect(banner).toHaveBeenCalledWith(expect.objectContaining({ title: 'THE BURN BEGINS' }));
  });
});
