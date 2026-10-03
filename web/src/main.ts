import '@fontsource/cinzel/400.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/cinzel-decorative/700.css';
import '@fontsource/rubik/400.css';
import '@fontsource/rubik/500.css';
import '@fontsource/rubik/700.css';
import '@fontsource/stardos-stencil/700.css';
import '@fontsource/bungee/400.css';
import './styles/main.css';
import { App } from './game/app';
import { installDebug } from './game/debug';
import { parseHostInfo } from './net/client';
import { INFO_PATH, PROTOCOL_VERSION } from './net/protocol';
import type { HostInfo } from './net/protocol';

declare global {
  interface Window {
    /** Debug handle for the browser console and automated smoke tests. */
    flaghack?: App;
  }
}

/** A host answers at once; anything slower is not a FLAGHACK host worth waiting for. */
const PROBE_TIMEOUT_MS = 1500;

/** Was this page served by a FLAGHACK host speaking our protocol? (static/dev hosting: no) */
async function probeHost(): Promise<HostInfo | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(INFO_PATH, { signal: abort.signal, cache: 'no-store' });
    if (!res.ok) return null;
    const info = parseHostInfo(await res.json());
    return info && info.protocol === PROTOCOL_VERSION ? info : null;
  } catch {
    // Not JSON / unreachable / timed out: single-player only.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** `#pw=<password>` from an invite link, removed from the address bar so it is not shared on. */
function takeInvitePassword(): string | null {
  const hash = location.hash;
  if (!hash.startsWith('#pw=')) return null;
  history.replaceState(history.state, '', location.pathname + location.search);
  const raw = hash.slice('#pw='.length);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

async function boot(): Promise<void> {
  const invitePassword = takeInvitePassword();
  // Canvas-lettered textures (GCC banner, signage) need the fonts before first draw.
  const fonts = Promise.all(
    ['700 32px "Stardos Stencil"', '700 32px "Cinzel"', '400 32px "Bungee"', '500 16px "Rubik"'].map((f) =>
      document.fonts.load(f),
    ),
  );
  const [hostInfo] = await Promise.all([probeHost(), fonts]);
  const root = document.getElementById('app')!;
  const app = new App(root, { hostInfo, invitePassword });
  window.flaghack = app;
  installDebug(app);
}

void boot();
