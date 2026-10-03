/**
 * The Vexillosaint, transmitting from the Geomantic Command Center: an inline SVG portrait
 * showing the golden vexillosaint's robe with a saffron stole, a silver beard, and the tall
 * Moebius Hat with its gold/saffron infinity band (the pole and the fabric). Brainwaves rise
 * from the hat like a cannon, and a halo of tiny yellow Flags turns behind the head. CSS in
 * tutorial.css animates the parts by class: halo spin, breathing, blink, the glint on the band,
 * rising waves, and the mouth while `.speaking`.
 */

let nextUid = 0;

const HALO_FLAGS = 10;

export function vexillosaintSvg(cls: string): string {
  // Gradient ids must be unique per instance: a second copy referencing the first copy's defs
  // breaks when the first sits in a display:none subtree.
  const u = `vx${nextUid++}`;
  let halo = '';
  for (let i = 0; i < HALO_FLAGS; i++) {
    halo +=
      `<g transform="rotate(${(i * 360) / HALO_FLAGS} 60 56)">` +
      `<path class="vx-hpole" d="M60 25V15.6"/>` +
      `<path class="vx-hcloth" d="M60.4 15.8c1.8-1 3.4.9 5.6 0v3.4c-2.2.9-3.8-1-5.6 0z"/></g>`;
  }
  const inf = 'M49.5 28C49.5 23.6 54.8 23.6 60 28C65.2 32.4 70.5 32.4 70.5 28C70.5 23.6 65.2 23.6 60 28C54.8 32.4 49.5 32.4 49.5 28Z';
  return (
    `<svg class="${cls}" viewBox="0 0 120 130" aria-hidden="true">` +
    '<defs>' +
    `<radialGradient id="${u}-bg" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#3d2b12"/><stop offset="1" stop-color="#0e0803"/></radialGradient>` +
    `<radialGradient id="${u}-glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffd400" stop-opacity=".42"/><stop offset=".6" stop-color="#ffb000" stop-opacity=".12"/><stop offset="1" stop-color="#ffb000" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="${u}-robe" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0a8"/><stop offset=".45" stop-color="#e9b43c"/><stop offset="1" stop-color="#94600f"/></linearGradient>` +
    `<linearGradient id="${u}-stole" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb347"/><stop offset="1" stop-color="#b85400"/></linearGradient>` +
    `<radialGradient id="${u}-skin" cx="45%" cy="40%" r="65%"><stop offset="0" stop-color="#f6d6ae"/><stop offset="1" stop-color="#d29f6c"/></radialGradient>` +
    `<linearGradient id="${u}-beard" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fdf9ee"/><stop offset="1" stop-color="#cbc1a8"/></linearGradient>` +
    `<linearGradient id="${u}-hat" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0d0904"/><stop offset=".32" stop-color="#3e2c14"/><stop offset=".55" stop-color="#1b1309"/><stop offset="1" stop-color="#0a0703"/></linearGradient>` +
    `<linearGradient id="${u}-mob" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffe27a"/><stop offset=".5" stop-color="#ff9a1a"/><stop offset="1" stop-color="#ffe27a"/></linearGradient>` +
    '</defs>' +
    `<rect width="120" height="130" fill="url(#${u}-bg)"/>` +
    `<circle cx="60" cy="56" r="50" fill="url(#${u}-glow)"/>` +
    `<g class="vx-halo"><circle class="vx-ring" cx="60" cy="56" r="30"/><circle class="vx-ring2" cx="60" cy="56" r="44"/>${halo}</g>` +
    // Robe: bell of gold with folds, the saffron stole embroidered with Flags, shoulder brooches.
    '<g class="vx-body">' +
    `<path d="M12 130C14 111 23 97 40 91C48 88 54 87 60 87C66 87 72 88 80 91C97 97 106 111 108 130Z" fill="url(#${u}-robe)" stroke="#5a3a0a" stroke-width="1"/>` +
    '<path class="vx-fold" d="M34 130C36 115 41 103 48 96M86 130C84 115 79 103 72 96M24 130C26 119 30 110 36 103M96 130C94 119 90 110 84 103"/>' +
    `<path d="M53.5 90L66.5 90L71 130L49 130Z" fill="url(#${u}-stole)" stroke="#6b3a06" stroke-width=".8"/>` +
    '<g class="vx-emb"><path d="M57.6 100v7M58 100h4.2v2.8H58z"/><path d="M57.4 113v7M57.8 113h4.4v2.8h-4.4z"/></g>' +
    '<path d="M41 92C47 96 53 99 60 104C67 99 73 96 79 92" fill="none" stroke="#7a4d0c" stroke-width="1.6"/>' +
    '<circle cx="45" cy="94" r="2.6" fill="#ffd400" stroke="#5a3a0a" stroke-width=".8"/>' +
    '<circle cx="75" cy="94" r="2.6" fill="#ffd400" stroke="#5a3a0a" stroke-width=".8"/>' +
    '</g>' +
    // Head: neck, ears, face, beard, eyes, mouth, then the Moebius Hat and its brainwaves.
    '<g class="vx-head">' +
    '<path d="M54 70H66V86H54Z" fill="#c8915c"/>' +
    `<ellipse cx="47.6" cy="60" rx="2.3" ry="3.8" fill="url(#${u}-skin)"/>` +
    `<ellipse cx="72.4" cy="60" rx="2.3" ry="3.8" fill="url(#${u}-skin)"/>` +
    `<ellipse cx="60" cy="59" rx="12.6" ry="14.6" fill="url(#${u}-skin)"/>` +
    '<path d="M47.4 50C46.4 56 47 62 48.4 67L50.4 64.6C49.6 59.6 49.6 55 50.6 50.6ZM72.6 50C73.6 56 73 62 71.6 67L69.6 64.6C70.4 59.6 70.4 55 69.4 50.6Z" fill="#e6e0cf"/>' +
    '<circle cx="52.4" cy="64" r="2.4" fill="#e8907a" opacity=".35"/><circle cx="67.6" cy="64" r="2.4" fill="#e8907a" opacity=".35"/>' +
    `<path d="M47.6 63C48 75 53 85.5 60 88C67 85.5 72 75 72.4 63C70 69 66 71.6 60 71.6C54 71.6 50 69 47.6 63Z" fill="url(#${u}-beard)" stroke="#a59a80" stroke-width=".6"/>` +
    '<path class="vx-brow" d="M51.6 54.4Q55 52.6 58 54.2M62 54.2Q65 52.6 68.4 54.4"/>' +
    '<g class="vx-eyes"><ellipse cx="55" cy="58.4" rx="1.6" ry="1.9" fill="#2a1606"/><ellipse cx="65" cy="58.4" rx="1.6" ry="1.9" fill="#2a1606"/>' +
    '<circle cx="55.5" cy="57.8" r=".5" fill="#fff"/><circle cx="65.5" cy="57.8" r=".5" fill="#fff"/></g>' +
    '<path d="M60 59.4Q61.7 63.8 59.4 64.9" fill="none" stroke="#b98656" stroke-width="1"/>' +
    '<ellipse class="vx-mouth" cx="60" cy="69.6" rx="2.4" ry="1" fill="#5a2a14"/>' +
    '<path d="M53 67.6Q56.5 65.4 60 67.4Q63.5 65.4 67 67.6Q63.5 69.4 60 68.4Q56.5 69.4 53 67.6Z" fill="#efe8d6"/>' +
    '<g class="vx-hat">' +
    '<ellipse cx="60" cy="46.4" rx="16.4" ry="3.6" fill="#140e06" stroke="#c8973f" stroke-width=".8"/>' +
    `<path d="M47 46.4L48.6 14Q60 11 71.4 14L73 46.4Q60 50 47 46.4Z" fill="url(#${u}-hat)" stroke="#c8973f" stroke-width=".7"/>` +
    '<path d="M47.3 40.4Q60 43.8 72.7 40.4L72.9 44.6Q60 48 47.1 44.6Z" fill="#c8973f"/>' +
    '<ellipse cx="60" cy="14" rx="11.4" ry="2.6" fill="#2a1d0d" stroke="#e2b45a" stroke-width=".7"/>' +
    `<path d="${inf}" fill="none" stroke="url(#${u}-mob)" stroke-width="2.4" stroke-linejoin="round"/>` +
    `<path class="vx-glint" d="${inf}"/>` +
    '</g>' +
    '<g class="vx-waves"><ellipse cx="60" cy="9" rx="8" ry="1.8"/><ellipse cx="60" cy="9" rx="8" ry="1.8"/><ellipse cx="60" cy="9" rx="8" ry="1.8"/></g>' +
    '</g>' +
    '</svg>'
  );
}
