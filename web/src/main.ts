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

declare global {
  interface Window {
    /** Debug handle for the browser console and automated smoke tests. */
    flaghack?: App;
  }
}

async function boot(): Promise<void> {
  // Canvas-lettered textures (GCC banner, signage) need the fonts before first draw.
  await Promise.all(
    ['700 32px "Stardos Stencil"', '700 32px "Cinzel"', '400 32px "Bungee"', '500 16px "Rubik"'].map((f) =>
      document.fonts.load(f),
    ),
  );
  const root = document.getElementById('app')!;
  const app = new App(root);
  window.flaghack = app;
  installDebug(app);
}

void boot();
