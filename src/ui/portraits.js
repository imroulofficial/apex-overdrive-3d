import { CAST } from '../data/story.js';

// Comic-book character portraits drawn as inline SVG (no image assets): flat colours, heavy
// ink outlines and a halftone backdrop. `mood` 'shout' opens the mouth and angles the brows.

const INK = '#0b0b10';
const ink = `stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;

function face(p, mood, { eyes = true, head = true } = {}) {
  const shout = mood === 'shout';
  const brows = shout
    ? `<path d="M76 104l18 5M124 104l-18 5" ${ink} fill="none" stroke-width="4" />`
    : `<path d="M76 106q9-5 18 0M106 106q9-5 18 0" ${ink} fill="none" stroke-width="3.5" />`;
  const eyeMarks = eyes ? `<ellipse cx="86" cy="118" rx="4" ry="5" fill="${INK}" /><ellipse cx="114" cy="118" rx="4" ry="5" fill="${INK}" />` : '';
  const mouth = shout
    ? `<path d="M88 146q12 14 24 0z" fill="#5a1414" ${ink} />`
    : mood === 'whisper'
      ? `<path d="M93 148q7 3 14 0" ${ink} fill="none" />`
      : `<path d="M90 145q10 7 20 0" ${ink} fill="none" />`;
  const skull = head
    ? `<path d="M100 72c-24 0-36 18-36 44 0 28 16 48 36 48s36-20 36-48c0-26-12-44-36-44z" fill="${p.skin}" ${ink} />
    <path d="M70 128q30 26 60 0v6q-30 26-60 0z" fill="${INK}" opacity=".12" />`
    : '';
  return `${skull}
    ${brows}${eyeMarks}
    <path d="M99 122l-4 14h7" ${ink} fill="none" stroke-width="2.5" />${mouth}`;
}

const shoulders = (p, collar = '') =>
  `<path d="M30 240c4-42 30-62 70-62s66 20 70 62z" fill="${p.suit}" ${ink} />
   <path d="M86 160h28v26c-4 6-24 6-28 0z" fill="${p.skin}" ${ink} />${collar}`;

const DRAW = {
  elena(p, mood) {
    return `${shoulders(p, `<path d="M70 186l30 30 30-30" fill="none" stroke="${p.accent}" stroke-width="6" />`)}
      <path d="M128 92c18 6 26 30 18 62-4-14-10-22-18-26z" fill="${p.hair}" ${ink} />
      ${face(p, mood)}
      <path d="M64 112c-4-34 16-50 38-50 24 0 40 16 36 46-10-16-26-24-44-22-12 2-22 12-30 26z" fill="${p.hair}" ${ink} />
      <path d="M60 114c0-32 18-52 40-52s40 20 40 52" fill="none" stroke="${INK}" stroke-width="7" />
      <path d="M60 114c0-32 18-52 40-52s40 20 40 52" fill="none" stroke="#2a3040" stroke-width="3" />
      <rect x="50" y="106" width="16" height="26" rx="6" fill="${p.accent}" ${ink} />
      <path d="M58 132q4 22 26 22" fill="none" ${ink} stroke-width="3" /><circle cx="86" cy="154" r="4" fill="${INK}" />`;
  },
  rookie(p, mood) {
    return `${shoulders(p, `<path d="M64 196h72" stroke="#fff" stroke-width="6" />`)}
      <path d="M100 56c-34 0-50 24-50 56 0 30 8 50 14 58h72c6-8 14-28 14-58 0-32-16-56-50-56z" fill="${p.accent}" ${ink} />
      <path d="M94 56h12v40H94z" fill="#fff" />
      <path d="M68 104h64c4 0 6 4 6 8v28c0 14-16 26-38 26s-38-12-38-26v-28c0-4 2-8 6-8z" fill="${p.skin}" ${ink} />
      <g transform="translate(0 -4)">${face(p, mood, { head: false })}</g>
      <path d="M62 100h76" ${ink} stroke-width="5" /><path d="M64 98q36-16 72 0" fill="#141922" opacity=".85" ${ink} />`;
  },
  riptide(p, mood) {
    return `${shoulders(p, `<path d="M58 200q42 20 84 0" fill="none" stroke="${p.accent}" stroke-width="5" />`)}
      ${face(p, mood, { eyes: false })}
      <path d="M62 108c-6-30 10-52 40-52 22 0 38 10 46 30-18-8-30-2-40 6 6-10 0-14-6-14-14 0-20 18-40 30z" fill="${p.hair}" ${ink} />
      <path d="M118 66q22-6 34 10-12-2-20 4" fill="${p.accent}" ${ink} />
      <path d="M70 112h60l-4 14c-2 6-8 8-14 8h-6l-6-8-6 8h-6c-6 0-12-2-14-8z" fill="${p.accent}" ${ink} />
      <path d="M78 116l8 12M110 116l8 12" stroke="#fff" stroke-width="3" opacity=".8" />`;
  },
  avalanche(p, mood) {
    return `${shoulders(p)}
      <path d="M40 210c10-30 30-36 60-36s50 6 60 36c-14-10-24-8-30 0-8-8-22-10-30-2-8-8-22-6-30 2-6-8-16-10-30 0z" fill="#f2f4f8" ${ink} />
      ${face(p, mood)}
      <path d="M62 112l-6-30 16 10 4-26 14 18 10-24 10 24 14-18 4 26 16-10-6 30c-14-14-30-18-38-18s-24 4-38 18z" fill="${p.hair}" ${ink} />
      <path d="M64 88h72c4 0 6 3 6 6v8c0 4-2 6-6 6H64c-4 0-6-2-6-6v-8c0-3 2-6 6-6z" fill="${p.accent}" ${ink} />
      <path d="M72 92h20M108 92h20" stroke="#fff" stroke-width="3" opacity=".7" />`;
  },
  kage(p, mood) {
    return `${shoulders(p)}
      <path d="M100 48c-40 0-58 30-58 66 0 34 10 54 16 62h84c6-8 16-28 16-62 0-36-18-66-58-66z" fill="${p.hair}" ${ink} />
      <path d="M68 104c0-22 14-36 32-36s32 14 32 36v40H68z" fill="${p.skin}" ${ink} />
      <path d="M78 110l18 6M122 110l-18 6" ${ink} stroke-width="4" />
      <path d="M80 118h14M106 118h14" stroke="${p.accent}" stroke-width="5" stroke-linecap="round" />
      <path d="M66 128h68v26c0 10-14 18-34 18s-34-8-34-18z" fill="#15151c" ${ink} />
      <path d="M72 138h56M76 148h48" stroke="${p.accent}" stroke-width="3" opacity="${mood === 'shout' ? 1 : 0.7}" />`;
  },
};

// `id` is a CAST key. Returns an <svg> string.
export function portrait(id, mood) {
  const c = CAST[id];
  const p = c.palette;
  const uid = `${id}-${mood ?? 'calm'}`;
  return `<svg class="portrait" viewBox="0 0 200 240" role="img" aria-label="${c.name}">
    <defs>
      <pattern id="dots-${uid}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
        <circle cx="4" cy="4" r="1.8" fill="${p.accent}" opacity=".45" />
      </pattern>
    </defs>
    <rect width="200" height="240" fill="${p.suit}" opacity=".35" />
    <rect width="200" height="240" fill="url(#dots-${uid})" />
    <path d="M100 120 0 30V0h40zM100 120 200 40V0h-50zM100 120 0 200v40h30zM100 120l100 70v50h-40z" fill="#fff" opacity=".06" />
    ${DRAW[id](p, mood)}
  </svg>`;
}
