import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture, mulberry32 } from './noise.js';
import { createVertexPbrMaterial, paintVertices } from '../render/vertexPbr.js';
import { installHeightFog } from '../render/heightFog.js';
import { cloudTexture, oceanMaterial, skyMaterial, skyUniforms, sunDirection, waterNormalMap } from './scenery.js';
import { wettable } from './trackMeshes.js';
import {
  NEON,
  DECK_DEPTH,
  PORTAL_GAP,
  PORTAL_HALF,
  Headlights,
  LightTrail,
  Traffic,
  boxUV,
  buildFreeway,
  buildHarbourBridge,
  buildLightPools,
  buildOverpasses,
  overpassLanes,
  planOverpasses,
} from './neonPieces.js';

// Neon City biome (Chapter 3): a night city on a harbour. Wet streets on a block grid with
// sodium street-light glows, a few thousand towers with lit windows (textured facades, LED
// crowns, red aviation lights), neon billboards that buzz and flicker, a skyline ring on the
// horizon, the harbour and its inlet, and the freeway furniture from race/neonPieces.js.
// Moonlight is the one directional light; the colour comes from emissive surfaces, the bloom
// pass and an environment cubemap baked from the city, so wet asphalt and car paint reflect
// the neon. Same interface as race/scenery.js buildScenery, chosen by the track's biome.

const WATER_Y = -1.2;
const KAGE = 'boss-voltage'; // data/rivals.js BOSSES
const BLOCK = 96; // street grid pitch (m); streets are centred on multiples of BLOCK
const STREET = 10; // half-width of a street incl. pavement edge
const CELL_W = 4; // facade window bay (m)
const CELL_H = 3.5; // storey height (m)
const CELLS = 8; // bays per facade texture repeat
const CITY = { x0: -1300, x1: 1300, z0: -1150 };
const NEON_LIST = [NEON.cyan, NEON.magenta, NEON.amber, NEON.violet, NEON.lime, NEON.cyan, NEON.magenta];

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

// Facade: CELLS x CELLS window bays. Albedo (tinted per tower by vertex colour) and an
// emissive map with the lit windows: mostly warm interiors, some cool office light and the
// odd neon-tinted room. Floors tend to be lit together.
function facadeTextures(rand) {
  const size = 512;
  const c = size / CELLS;
  const lit = [];
  for (let r = 0; r < CELLS; r++) {
    const floorOn = rand() < 0.45;
    for (let k = 0; k < CELLS * 2; k++) lit.push(rand() < (floorOn ? 0.55 : 0.12));
  }
  const tints = ['#ffcf8a', '#ffd9a6', '#ffe8c8', '#cfe2ff', '#bcd4ff', '#ff9ad8', '#8ff4ff'];
  const pick = () => {
    const x = rand();
    return x < 0.62 ? tints[Math.floor(rand() * 3)] : x < 0.9 ? tints[3 + Math.floor(rand() * 2)] : tints[5 + Math.floor(rand() * 2)];
  };
  const colors = lit.map((on) => (on ? pick() : null));
  const blinds = lit.map(() => rand());
  const map = canvasTexture(THREE, size, size, (g) => {
    g.fillStyle = '#7e848e';
    g.fillRect(0, 0, size, size);
    for (let r = 0; r < CELLS; r++) {
      for (let k = 0; k < CELLS; k++) {
        const x = k * c;
        const y = r * c;
        const grd = g.createLinearGradient(0, y, 0, y + c);
        grd.addColorStop(0, '#2a3340');
        grd.addColorStop(1, '#151a22');
        g.fillStyle = grd;
        // Two panes per bay.
        for (const px of [x + 5, x + c / 2 + 2]) {
          g.fillRect(px, y + 10, c / 2 - 7, c - 20);
        }
        g.fillStyle = 'rgba(255,255,255,0.05)';
        g.fillRect(x + 5, y + 10, c - 10, 3);
      }
    }
    // Mullions and slab edges (the texel at 0,0 stays dark: roofs sample it).
    g.fillStyle = '#23262c';
    for (let k = 0; k <= CELLS; k++) {
      g.fillRect(k * c - 2, 0, 4, size);
      g.fillRect(0, k * c - 3, size, 6);
    }
  });
  const emissive = canvasTexture(THREE, size, size, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, size, size);
    const pw = c / 2 - 7;
    const ph = c - 20;
    for (let r = 0; r < CELLS; r++) {
      for (let k = 0; k < CELLS * 2; k++) {
        const i = r * CELLS * 2 + k;
        const col = colors[i];
        if (!col) continue;
        const x = Math.floor(k / 2) * c + (k % 2 ? c / 2 + 2 : 5);
        const y = r * c + 10;
        g.fillStyle = col;
        g.globalAlpha = 0.45 + blinds[i] * 0.5;
        g.fillRect(x, y, pw, ph);
        // Blinds half drawn in some rooms.
        if (blinds[i] > 0.6) {
          g.globalAlpha = 0.7;
          g.fillStyle = '#000';
          g.fillRect(x, y, pw, ph * (blinds[i] - 0.5));
        }
        g.globalAlpha = 1;
      }
    }
  });
  for (const t of [map, emissive]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
  }
  emissive.colorSpace = THREE.SRGBColorSpace;
  return { map, emissive };
}

// One street block (BLOCK m): asphalt streets on the tile edges with lane paint, pavements,
// crossings, and the dark plaza the towers stand on. The emissive twin holds the pools of
// sodium light along the pavements.
function groundTextures() {
  const size = 512;
  const px = size / BLOCK;
  const st = STREET * px;
  const walk = 4 * px;
  const map = canvasTexture(THREE, size, size, (g) => {
    g.fillStyle = '#26272c';
    g.fillRect(0, 0, size, size);
    // Streets along all four edges (they continue into the neighbouring tiles).
    g.fillStyle = '#141519';
    g.fillRect(0, 0, size, st);
    g.fillRect(0, size - st, size, st);
    g.fillRect(0, 0, st, size);
    g.fillRect(size - st, 0, st, size);
    // Pavements.
    g.fillStyle = '#3d3f46';
    g.fillRect(st, st, size - 2 * st, walk);
    g.fillRect(st, size - st - walk, size - 2 * st, walk);
    g.fillRect(st, st, walk, size - 2 * st);
    g.fillRect(size - st - walk, st, walk, size - 2 * st);
    // Lane paint: dashed centre lines on the tile edges and lane dividers.
    g.fillStyle = '#c9b46a';
    for (let y = st * 2; y < size - st * 2; y += 28) {
      g.fillRect(0, y, 2, 14);
      g.fillRect(size - 2, y, 2, 14);
      g.fillRect(y, 0, 14, 2);
      g.fillRect(y, size - 2, 14, 2);
    }
    // Zebra crossings at the corners.
    g.fillStyle = '#9a9ca2';
    for (let k = 0; k < 6; k++) {
      const o = st + walk + 4 + k * 9;
      g.fillRect(o, 0, 5, st - 4);
      g.fillRect(o, size - st + 4, 5, st - 4);
      g.fillRect(0, o, st - 4, 5);
      g.fillRect(size - st + 4, o, st - 4, 5);
    }
  });
  const emissive = canvasTexture(THREE, size, size, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, size, size);
    const glow = (x, y, r, col) => {
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, col);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    };
    const step = 24 * px;
    for (let t = step / 2; t < size; t += step) {
      for (const e of [st + walk * 0.5, size - st - walk * 0.5]) {
        glow(t, e, 7 * px, 'rgba(255,170,90,0.85)');
        glow(e, t, 7 * px, 'rgba(255,170,90,0.85)');
      }
    }
  });
  for (const t of [map, emissive]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  return { map, emissive };
}

// Billboard atlas, 1024 x 1024: six adverts (512 x 256, rows 0-2) for fictional brands, then
// eight 256 x 128 tiles: five overpass name boards and three blade signs.
const AD_TILES = 6;
export const SIGN_TILE = 6; // first overpass board
const BLADE_TILE = 11;
const tileUV = (i) => {
  if (i < AD_TILES) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    return [col * 0.5, 1 - (row + 1) * 0.25, (col + 1) * 0.5, 1 - row * 0.25];
  }
  const j = i - AD_TILES;
  const col = j % 4;
  const row = Math.floor(j / 4);
  const y0 = 768 + row * 128;
  return [col * 0.25, 1 - (y0 + 128) / 1024, (col + 1) * 0.25, 1 - y0 / 1024];
};
// Dominant colour of each advert, for the light it spills onto the road.
const AD_GLOW = [NEON.magenta, NEON.cyan, NEON.violet, NEON.amber, 0xff3344, NEON.lime];

function billboardAtlas(overpassNames) {
  return canvasTexture(THREE, 1024, 1024, (g) => {
    g.fillStyle = '#05060a';
    g.fillRect(0, 0, 1024, 1024);
    const neonText = (text, x, y, size, color, { font = 'italic 900', blur = 22, stroke = 0 } = {}) => {
      g.font = `${font} ${size}px system-ui, "Segoe UI", Roboto, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = color;
      g.shadowBlur = blur;
      g.fillStyle = color;
      if (stroke) {
        g.lineWidth = stroke;
        g.strokeStyle = color;
        g.strokeText(text, x, y);
      }
      g.fillText(text, x, y);
      g.shadowBlur = blur * 0.4;
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.font = `${font} ${Math.round(size * 0.96)}px system-ui, "Segoe UI", Roboto, sans-serif`;
      g.fillText(text, x, y);
      g.shadowBlur = 0;
    };
    const frame = (x, y, w, h, color) => {
      g.shadowColor = color;
      g.shadowBlur = 16;
      g.strokeStyle = color;
      g.lineWidth = 5;
      g.strokeRect(x + 10, y + 10, w - 20, h - 20);
      g.shadowBlur = 0;
    };
    const tile = (i, draw) => {
      const [u0, v0, u1, v1] = tileUV(i);
      const x = u0 * 1024;
      const y = (1 - v1) * 1024;
      const w = (u1 - u0) * 1024;
      const h = (v1 - v0) * 1024;
      g.save();
      g.beginPath();
      g.rect(x, y, w, h);
      g.clip();
      draw(x, y, w, h);
      g.restore();
    };
    // 0 OVERDRIVE energy drink.
    tile(0, (x, y, w, h) => {
      const grd = g.createLinearGradient(x, y, x + w, y + h);
      grd.addColorStop(0, '#2a0430');
      grd.addColorStop(1, '#07020c');
      g.fillStyle = grd;
      g.fillRect(x, y, w, h);
      g.strokeStyle = 'rgba(255,43,214,0.5)';
      g.lineWidth = 3;
      for (let k = 0; k < 9; k++) {
        g.beginPath();
        g.moveTo(x + 20, y + 150 + k * 10);
        g.lineTo(x + 140 - k * 9, y + 150 + k * 10);
        g.stroke();
      }
      neonText('OVERDRIVE', x + w / 2 + 20, y + 110, 92, '#ff2bd6');
      neonText('ENERGY  ·  ZERO SLEEP', x + w / 2 + 20, y + 190, 30, '#ffd1f4', { font: '700', blur: 10 });
      frame(x, y, w, h, '#ff2bd6');
    });
    // 1 SYNTH FM.
    tile(1, (x, y, w, h) => {
      g.fillStyle = '#020a12';
      g.fillRect(x, y, w, h);
      g.strokeStyle = '#22e8ff';
      g.shadowColor = '#22e8ff';
      g.shadowBlur = 14;
      g.lineWidth = 5;
      g.beginPath();
      for (let k = 0; k <= 60; k++) {
        const px = x + 30 + (k / 60) * (w - 60);
        const py = y + 196 + Math.sin(k * 0.55) * 22 * Math.sin(k * 0.09 + 0.4);
        if (k) g.lineTo(px, py);
        else g.moveTo(px, py);
      }
      g.stroke();
      g.shadowBlur = 0;
      neonText('SYNTH FM', x + w / 2, y + 92, 96, '#22e8ff');
      neonText('88.8  NIGHT DRIVE RADIO', x + w / 2, y + 152, 28, '#c9fbff', { font: '700', blur: 8 });
      frame(x, y, w, h, '#22e8ff');
    });
    // 2 KAGE IS WATCHING (the Chapter 3 boss).
    tile(2, (x, y, w, h) => {
      g.fillStyle = '#07040f';
      g.fillRect(x, y, w, h);
      g.fillStyle = '#8a5bff';
      g.shadowColor = '#8a5bff';
      g.shadowBlur = 30;
      g.beginPath();
      g.ellipse(x + 112, y + 128, 60, 28, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#05030a';
      g.beginPath();
      g.arc(x + 112, y + 128, 20, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
      neonText('KAGE', x + 330, y + 104, 104, '#b48cff');
      neonText('IS WATCHING', x + 330, y + 178, 34, '#e6dbff', { font: '800', blur: 10 });
      frame(x, y, w, h, '#8a5bff');
    });
    // 3 Neon Noodle Bar.
    tile(3, (x, y, w, h) => {
      g.fillStyle = '#120802';
      g.fillRect(x, y, w, h);
      g.strokeStyle = '#ffb020';
      g.shadowColor = '#ffb020';
      g.shadowBlur = 18;
      g.lineWidth = 7;
      g.beginPath();
      g.arc(x + 100, y + 120, 56, 0, Math.PI);
      g.closePath();
      g.stroke();
      for (const dx of [-14, 8]) {
        g.beginPath();
        g.moveTo(x + 100 + dx, y + 40);
        g.lineTo(x + 112 + dx, y + 110);
        g.stroke();
      }
      g.shadowBlur = 0;
      neonText('NOODLE', x + 330, y + 96, 88, '#ffb020');
      neonText('BAR  ·  OPEN ALL NIGHT', x + 330, y + 168, 30, '#ffe3b0', { font: '700', blur: 8 });
      frame(x, y, w, h, '#ffb020');
    });
    // 4 Red Pen Racing.
    tile(4, (x, y, w, h) => {
      g.fillStyle = '#100204';
      g.fillRect(x, y, w, h);
      g.fillStyle = '#ff3344';
      g.shadowColor = '#ff3344';
      g.shadowBlur = 20;
      g.beginPath();
      g.moveTo(x + 40, y + 200);
      g.lineTo(x + 140, y + 56);
      g.lineTo(x + 168, y + 76);
      g.lineTo(x + 68, y + 220);
      g.closePath();
      g.fill();
      g.shadowBlur = 0;
      neonText('RED PEN', x + 320, y + 100, 92, '#ff3344');
      neonText('RACING  ·  APEX EXPEDITION', x + 320, y + 172, 28, '#ffd3d8', { font: '700', blur: 8 });
      frame(x, y, w, h, '#ff3344');
    });
    // 5 Volt City Arcade.
    tile(5, (x, y, w, h) => {
      g.fillStyle = '#041004';
      g.fillRect(x, y, w, h);
      g.fillStyle = '#b6ff3a';
      g.shadowColor = '#b6ff3a';
      g.shadowBlur = 12;
      const pix = [
        '..XX..XX..',
        '...XXXX...',
        '..XXXXXX..',
        '.XX.XX.XX.',
        'XXXXXXXXXX',
        'X.XXXXXX.X',
        'X.X....X.X',
        '...XX.XX..',
      ];
      pix.forEach((row, r) => [...row].forEach((ch, k) => ch === 'X' && g.fillRect(x + 40 + k * 14, y + 70 + r * 14, 12, 12)));
      g.shadowBlur = 0;
      neonText('VOLT', x + 340, y + 92, 100, '#b6ff3a');
      neonText('CITY ARCADE  ·  1UP', x + 340, y + 170, 30, '#eaffcc', { font: '700', blur: 8 });
      frame(x, y, w, h, '#b6ff3a');
    });
    // 6-10 overpass name boards: highway green, white lettering.
    overpassNames.slice(0, 5).forEach((name, k) =>
      tile(SIGN_TILE + k, (x, y, w, h) => {
        g.fillStyle = '#0d5c35';
        g.fillRect(x, y, w, h);
        g.strokeStyle = '#e8f2ea';
        g.lineWidth = 4;
        g.strokeRect(x + 6, y + 6, w - 12, h - 12);
        g.fillStyle = '#f2f6f2';
        g.font = '700 30px system-ui, "Segoe UI", Roboto, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(name.toUpperCase(), x + w / 2, y + 50, w - 30);
        g.font = '700 24px system-ui, sans-serif';
        g.fillText(`EXIT ${41 + k * 4}  →`, x + w / 2, y + 92);
      })
    );
    // 11-13 blade signs, drawn sideways (mapped onto tall panels).
    [
      ['HOTEL', '#ff2bd6'],
      ['OPEN 24H', '#22e8ff'],
      ['KARAOKE', '#ffb020'],
    ].forEach(([text, color], k) =>
      tile(BLADE_TILE + k, (x, y, w, h) => {
        g.fillStyle = '#05060a';
        g.fillRect(x, y, w, h);
        neonText(text, x + w / 2, y + h / 2 + 2, 44, color, { blur: 14 });
        g.strokeStyle = color;
        g.lineWidth = 3;
        g.strokeRect(x + 6, y + 6, w - 12, h - 12);
      })
    );
  });
}

// ---------------------------------------------------------------------------
// Land, water and the ground mesh
// ---------------------------------------------------------------------------

function landOf(def) {
  const hz = def.harbourZ;
  const inlet = def.inlet;
  const water = (x, z) => z > hz(x) || (Math.abs(x) < inlet.halfWidth && z > inlet.headZ);
  return { water, ground: (x, z) => (water(x, z) ? WATER_Y - 3 : 0) };
}

// Land as three grids that end exactly on the shore: west and east of the inlet (up to the
// harbour line) and the strip between its banks (up to the inlet head). UVs in blocks.
function buildGround(def) {
  const inlet = def.inlet;
  const patches = [
    [CITY.x0, -inlet.halfWidth, def.harbourZ],
    [-inlet.halfWidth, inlet.halfWidth, () => inlet.headZ],
    [inlet.halfWidth, CITY.x1, def.harbourZ],
  ];
  const pos = [];
  const uv = [];
  const quay = [];
  for (const [x0, x1, shore] of patches) {
    const cols = Math.max(2, Math.ceil((x1 - x0) / 24));
    const rows = 48;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const q = [
          [i, j],
          [i + 1, j],
          [i, j + 1],
          [i + 1, j + 1],
        ].map(([a, b]) => {
          const x = x0 + ((x1 - x0) * a) / cols;
          const z = CITY.z0 + (shore(x) - CITY.z0) * (b / rows);
          return [x, 0, z];
        });
        // Wound so the faces point up (+y).
        for (const v of [q[0], q[2], q[1], q[1], q[2], q[3]]) {
          pos.push(...v);
          uv.push(v[0] / BLOCK, v[2] / BLOCK);
        }
      }
      // Quay wall along the shore of this column.
      const xa = x0 + ((x1 - x0) * i) / cols;
      const xb = x0 + ((x1 - x0) * (i + 1)) / cols;
      quay.push([new THREE.Vector3(xa, 0, shore(xa)), new THREE.Vector3(xb, 0, shore(xb))]);
    }
  }
  // The inlet's side walls.
  for (const side of [-1, 1]) {
    const x = side * inlet.halfWidth;
    quay.push([new THREE.Vector3(x, 0, inlet.headZ), new THREE.Vector3(x, 0, def.harbourZ(x))]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  // Quay walls: vertical strips from the promenade down below the water line.
  const walls = [];
  const wallPos = [];
  for (const [a, b] of quay) {
    const A = [a.x, 0, a.z];
    const B = [b.x, 0, b.z];
    const C = [a.x, WATER_Y - 2, a.z];
    const D = [b.x, WATER_Y - 2, b.z];
    wallPos.push(...A, ...C, ...B, ...B, ...C, ...D, ...A, ...B, ...C, ...B, ...D, ...C);
  }
  const wall = new THREE.BufferGeometry();
  wall.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
  walls.push(boxUV(wall));
  return { geometry: geo, quay, walls };
}

// ---------------------------------------------------------------------------
// Towers
// ---------------------------------------------------------------------------

const TOWER_TINTS = [0x8fa6c8, 0x7f8fa6, 0xb0a08a, 0x5c616c, 0x6fa0a6, 0x9b8fb4, 0xa8aeb8];

// Four walls and a roof with facade UVs (metres in window bays, offset per tower), plus a
// vertex colour tint. Appends to `out` arrays.
function towerBox(out, x0, z0, x1, z1, y0, y1, tint, uo, vo, litLevel = 1) {
  const corners = [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
  let u = uo;
  const push = (p, t) => {
    out.pos.push(...p);
    out.uv.push(...t);
    out.col.push(tint.r, tint.g, tint.b);
    out.lit.push(litLevel);
  };
  for (let k = 0; k < 4; k++) {
    const [ax, az] = corners[k];
    const [bx, bz] = corners[(k + 1) % 4];
    const len = Math.hypot(bx - ax, bz - az);
    const ua = u;
    const ub = u + len / (CELL_W * CELLS);
    const va = vo + y0 / (CELL_H * CELLS);
    const vb = vo + y1 / (CELL_H * CELLS);
    // Corners run anticlockwise seen from above (x right, z down): outward faces wind CCW.
    const A = [ax, y0, az];
    const B = [bx, y0, bz];
    const C = [ax, y1, az];
    const D = [bx, y1, bz];
    push(A, [ua, va]);
    push(C, [ua, vb]);
    push(B, [ub, va]);
    push(B, [ub, va]);
    push(C, [ua, vb]);
    push(D, [ub, vb]);
    u = ub;
  }
  const r = [0.5 / 512, 0.5 / 512];
  const top = [
    [x0, y1, z0],
    [x1, y1, z0],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  for (const i of [0, 3, 1, 1, 3, 2]) push(top[i], r);
}

function planCity(track, def, land, plans, rand) {
  const pr = {};
  const near = track.fenceOffset + 9;
  const segDist = (o, x, z) => {
    const dx = x - o.center.x;
    const dz = z - o.center.z;
    const u = dx * o.dir.x + dz * o.dir.z;
    const cu = Math.max(o.from - 30, Math.min(o.to + 30, u));
    return Math.hypot(dx - o.dir.x * cu, dz - o.dir.z * cu);
  };
  const portals = [];
  for (const o of plans) {
    for (const u of [o.from - PORTAL_GAP, o.to + PORTAL_GAP]) {
      portals.push({ x: o.center.x + o.dir.x * u, z: o.center.z + o.dir.z * u, o, u });
    }
  }
  const blocked = (x, z) => {
    if (land.water(x, z)) return true;
    track.project(x, z, -1, pr);
    if (Math.abs(pr.d) < near) return true;
    for (const o of plans) if (segDist(o, x, z) < o.half + 6 && Math.abs(x - o.center.x) + Math.abs(z - o.center.z) > 0) return true;
    return false;
  };
  const heightAt = (x, z) => {
    let h = 16 + rand() * 26;
    for (const [cx, cz, r, peak] of def.downtown) h += peak * Math.exp(-(((x - cx) / r) ** 2 + ((z - cz) / r) ** 2)) * (0.35 + 0.65 * rand());
    // The far city falls away so the skyline ring reads above it.
    const d = Math.hypot(x, z + 100);
    return h * (d > 800 ? 0.55 : 1);
  };
  const towers = [];
  const lot = BLOCK / 2 - STREET - 4;
  for (let bx = Math.ceil(CITY.x0 / BLOCK); bx < CITY.x1 / BLOCK; bx++) {
    for (let bz = Math.ceil(CITY.z0 / BLOCK); bz < 5; bz++) {
      const cx = bx * BLOCK + BLOCK / 2;
      const cz = bz * BLOCK + BLOCK / 2;
      // Split the lot into 1-4 towers.
      const sx = rand() < 0.55 ? 2 : 1;
      const sz = rand() < 0.55 ? 2 : 1;
      for (let i = 0; i < sx; i++) {
        for (let j = 0; j < sz; j++) {
          const w = (lot * 2 - (sx - 1) * 6) / sx;
          const d = (lot * 2 - (sz - 1) * 6) / sz;
          const x0 = cx - lot + i * (w + 6) + rand() * 3;
          const z0 = cz - lot + j * (d + 6) + rand() * 3;
          const x1 = x0 + w - rand() * 5;
          const z1 = z0 + d - rand() * 5;
          const pts = [
            [x0, z0],
            [x1, z0],
            [x0, z1],
            [x1, z1],
            [(x0 + x1) / 2, (z0 + z1) / 2],
            [(x0 + x1) / 2, z0],
            [(x0 + x1) / 2, z1],
            [x0, (z0 + z1) / 2],
            [x1, (z0 + z1) / 2],
          ];
          if (pts.some(([x, z]) => blocked(x, z))) continue;
          if (portals.some((p) => Math.abs(p.x - (x0 + x1) / 2) < 50 && Math.abs(p.z - (z0 + z1) / 2) < 50)) continue;
          track.project((x0 + x1) / 2, (z0 + z1) / 2, -1, pr);
          towers.push({ x0, z0, x1, z1, h: heightAt((x0 + x1) / 2, (z0 + z1) / 2), trackD: Math.abs(pr.d), s: pr.s });
        }
      }
    }
  }
  return { towers, portals };
}

function buildTowers(track, city, rand) {
  const chunks = new Map();
  const trims = [];
  const ads = [];
  const blades = [];
  const tint = new THREE.Color();
  const f = {};
  const chunkOf = (x) => Math.max(0, Math.min(5, Math.floor(((x - CITY.x0) / (CITY.x1 - CITY.x0)) * 6)));
  const add = (t, x0, z0, x1, z1, y0, y1) => {
    const key = chunkOf((x0 + x1) / 2);
    if (!chunks.has(key)) chunks.set(key, { pos: [], uv: [], col: [], lit: [] });
    towerBox(chunks.get(key), x0, z0, x1, z1, y0, y1, tint, t.uo, t.vo, t.lit);
  };
  const lit = (geo, color, emissive) => trims.push(paintVertices(geo.toNonIndexed(), { color, roughness: 0.4, emissive }));
  for (const t of city.towers) {
    tint.setHex(TOWER_TINTS[Math.floor(rand() * TOWER_TINTS.length)]).multiplyScalar(0.8 + rand() * 0.35);
    t.uo = Math.floor(rand() * CELLS) / CELLS;
    t.vo = Math.floor(rand() * CELLS) / CELLS;
    // How busy the tower is tonight: offices half dark, hotels ablaze.
    t.lit = rand() < 0.2 ? 0.15 + rand() * 0.2 : 0.45 + rand() * 0.75;
    let { x0, z0, x1, z1, h } = t;
    if (h > 70 && rand() < 0.55) {
      const base = h * (0.45 + rand() * 0.2);
      add(t, x0, z0, x1, z1, 0, base);
      const ix = (x1 - x0) * (0.12 + rand() * 0.12);
      const iz = (z1 - z0) * (0.12 + rand() * 0.12);
      x0 += ix;
      x1 -= ix;
      z0 += iz;
      z1 -= iz;
      add(t, x0, z0, x1, z1, base, h);
    } else {
      add(t, x0, z0, x1, z1, 0, h);
    }
    const close = t.trackD < 520;
    const color = NEON_LIST[Math.floor(rand() * NEON_LIST.length)];
    // LED crown around the roof line.
    if (close && rand() < 0.42) {
      const y = h - 0.4;
      const th = 0.45;
      lit(new THREE.BoxGeometry(x1 - x0 + 0.4, th, 0.35).translate((x0 + x1) / 2, y, z0 - 0.1), color, 3);
      lit(new THREE.BoxGeometry(x1 - x0 + 0.4, th, 0.35).translate((x0 + x1) / 2, y, z1 + 0.1), color, 3);
      lit(new THREE.BoxGeometry(0.35, th, z1 - z0 + 0.4).translate(x0 - 0.1, y, (z0 + z1) / 2), color, 3);
      lit(new THREE.BoxGeometry(0.35, th, z1 - z0 + 0.4).translate(x1 + 0.1, y, (z0 + z1) / 2), color, 3);
    }
    // Vertical neon on two corners.
    if (close && rand() < 0.16) {
      for (const [cx, cz] of [
        [x0, z0],
        [x1, z1],
      ]) {
        lit(new THREE.BoxGeometry(0.4, h * 0.8, 0.4).translate(cx, h * 0.5, cz), color, 3.2);
      }
    }
    // Aviation light on the tall ones.
    if (h > 110) lit(new THREE.BoxGeometry(0.9, 0.9, 0.9).translate((x0 + x1) / 2, h + 2.5, (z0 + z1) / 2), NEON.red, 7);
    if (h > 110) trims.push(paintVertices(new THREE.CylinderGeometry(0.15, 0.25, 5, 6).translate((x0 + x1) / 2, h + 2.5, (z0 + z1) / 2).toNonIndexed(), { color: 0x30343a, roughness: 0.5, metalness: 0.8 }));

    // A billboard on the face looking at the circuit; blade signs on street-level blocks.
    if (t.trackD < 170 && rand() < 0.55) {
      track.frame(t.s, f);
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const tx = f.x - cx;
      const tz = f.z - cz;
      const faces = [
        { n: [0, -1], c: [cx, z0], len: x1 - x0 },
        { n: [0, 1], c: [cx, z1], len: x1 - x0 },
        { n: [-1, 0], c: [x0, cz], len: z1 - z0 },
        { n: [1, 0], c: [x1, cz], len: z1 - z0 },
      ];
      const best = faces.reduce((a, b) => (b.n[0] * tx + b.n[1] * tz > a.n[0] * tx + a.n[1] * tz ? b : a));
      const w = Math.min(26, best.len * 0.75);
      const roadY = track.roadY(t.s);
      const y = Math.min(h - w / 4 - 2, roadY + 8 + w / 4 + rand() * 18);
      if (w > 10 && y > w / 4 + 3) {
        ads.push({ x: best.c[0] + best.n[0] * 0.4, z: best.c[1] + best.n[1] * 0.4, y, nx: best.n[0], nz: best.n[1], w, h: w / 2, tile: Math.floor(rand() * AD_TILES), flick: rand() < 0.25 });
      }
      if (roadY < 6 && h > 14 && rand() < 0.7) {
        const corner = rand() < 0.5 ? -1 : 1;
        const along = [best.n[1], -best.n[0]];
        blades.push({
          x: best.c[0] + along[0] * corner * (best.len / 2 - 1.5) + best.n[0] * 1.6,
          z: best.c[1] + along[1] * corner * (best.len / 2 - 1.5) + best.n[1] * 1.6,
          y: Math.min(h - 6, 9 + rand() * 6),
          ax: along[0],
          az: along[1],
          tile: BLADE_TILE + Math.floor(rand() * 3),
          flick: rand() < 0.3,
        });
      }
    }
  }
  const geos = [...chunks.values()].map((c) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(c.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(c.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(c.col, 3));
    g.setAttribute('aLit', new THREE.Float32BufferAttribute(c.lit, 1));
    g.computeVertexNormals();
    return g;
  });
  return { geos, trims, ads, blades };
}

// Portal towers: the overpasses run into a massive block at each end.
function portalTowers(city, rand, out) {
  const tint = new THREE.Color(0x5c616c);
  for (const p of city.portals) {
    const o = p.o;
    const half = PORTAL_HALF;
    const pos = { pos: [], uv: [], col: [], lit: [] };
    const h = o.deckTop + 30 + rand() * 60;
    towerBox(pos, p.x - half, p.z - half, p.x + half, p.z + half, 0, h, tint, rand(), rand(), 0.8);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(pos.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(pos.col, 3));
    g.setAttribute('aLit', new THREE.Float32BufferAttribute(pos.lit, 1));
    g.computeVertexNormals();
    out.push(g);
  }
}

// ---------------------------------------------------------------------------
// Billboards (one mesh, atlas texture, flicker per sign)
// ---------------------------------------------------------------------------

function buildBillboards(track, def, ads, blades, plans, frames, pools, timeU) {
  const pos = [];
  const uv = [];
  const flick = [];
  const L = track.length;
  const quad = (c, right, up, w, h, tile, fl, rotate = false) => {
    const [u0, v0, u1, v1] = tileUV(tile);
    const P = (a, b) => [c.x + right.x * a + up.x * b, c.y + right.y * a + up.y * b, c.z + right.z * a + up.z * b];
    const A = P(-w / 2, -h / 2);
    const B = P(w / 2, -h / 2);
    const C = P(-w / 2, h / 2);
    const D = P(w / 2, h / 2);
    // Blade signs show a sideways tile, read top to bottom.
    const tA = rotate ? [u0, v1] : [u0, v0];
    const tB = rotate ? [u0, v0] : [u1, v0];
    const tC = rotate ? [u1, v1] : [u0, v1];
    const tD = rotate ? [u1, v0] : [u1, v1];
    pos.push(...A, ...B, ...C, ...C, ...B, ...D);
    uv.push(...tA, ...tB, ...tC, ...tC, ...tB, ...tD);
    const seed = fl ? 0.05 + Math.random() * 0.95 : 0;
    for (let k = 0; k < 6; k++) flick.push(seed);
  };
  const upV = new THREE.Vector3(0, 1, 0);
  const steel = { color: 0x22252b, roughness: 0.5, metalness: 0.7 };
  for (const a of ads) {
    const n = new THREE.Vector3(a.nx, 0, a.nz);
    const right = new THREE.Vector3(-a.nz, 0, a.nx).negate();
    quad(new THREE.Vector3(a.x, a.y, a.z).addScaledVector(n, 0.1), right, upV, a.w, a.h, a.tile, a.flick);
    frames.push(paintVertices(new THREE.BoxGeometry(a.w + 1, a.h + 1, 0.3).rotateY(Math.atan2(a.nx, a.nz)).translate(a.x - a.nx * 0.05, a.y, a.z - a.nz * 0.05).toNonIndexed(), steel));
  }
  for (const b of blades) {
    // Panel perpendicular to the wall, readable from both faces.
    const along = new THREE.Vector3(b.ax, 0, b.az);
    const m = new THREE.Vector3(b.az, 0, -b.ax);
    const c = new THREE.Vector3(b.x, b.y, b.z);
    quad(c.clone().addScaledVector(m, 0.16), along.clone().negate(), upV, 2.4, 4.8, b.tile, b.flick, true);
    quad(c.clone().addScaledVector(m, -0.16), along, upV, 2.4, 4.8, b.tile, b.flick, true);
    frames.push(paintVertices(new THREE.BoxGeometry(2.6, 5, 0.28).rotateY(Math.atan2(b.az, -b.ax)).translate(b.x, b.y, b.z).toNonIndexed(), steel));
  }
  // Roadside billboards on twin poles beside the freeway, angled toward oncoming cars.
  const f = {};
  const busy = (s) =>
    (def.harbourBridge && s > def.harbourBridge.from * L - 30 && s < def.harbourBridge.to * L + 30) ||
    plans.some((o) => Math.abs(track.delta(o.s0, s)) < 45) ||
    (def.neonSigns ?? []).some((x) => Math.abs(track.delta(x * L, s)) < 12);
  let k = 0;
  for (let s = 60; s < L - 40; s += 115, k++) {
    if (busy(s)) continue;
    const side = k % 2 ? 1 : -1;
    track.frame(s, f);
    const y = track.roadY(s);
    const d = side * (track.fenceOffset + 7.5);
    const base = new THREE.Vector3(f.x + f.rx * d, y, f.z + f.rz * d);
    // Face back down the road, turned 28 degrees toward it.
    const back = new THREE.Vector3(-f.tx, 0, -f.tz);
    const toward = new THREE.Vector3(-f.rx * side, 0, -f.rz * side);
    const n = back.multiplyScalar(Math.cos(0.5)).addScaledVector(toward, Math.sin(0.5)).normalize();
    const right = new THREE.Vector3(n.z, 0, -n.x);
    const w = 13;
    const h = 6.5;
    const c = base.clone().add(new THREE.Vector3(0, 7.5 + h / 2, 0));
    const tile = k % AD_TILES;
    quad(c.clone().addScaledVector(n, 0.2), right, upV, w, h, tile, k % 5 === 2);
    frames.push(paintVertices(new THREE.BoxGeometry(w + 0.8, h + 0.8, 0.35).rotateY(Math.atan2(n.x, n.z)).translate(c.x, c.y, c.z).toNonIndexed(), steel));
    for (const o of [-w * 0.3, w * 0.3]) {
      const px = c.x + right.x * o;
      const pz = c.z + right.z * o;
      const groundY = y > 6 ? 0 : y - 1;
      frames.push(paintVertices(new THREE.CylinderGeometry(0.28, 0.32, c.y - groundY, 8).translate(px, (c.y + groundY) / 2, pz).toNonIndexed(), steel));
    }
    // Its glow on the lanes beside it.
    pools.push({ s, d: side * (track.halfWidth - 3), r: 11, color: AD_GLOW[tile], k: 0.55 });
  }
  // Overpass name boards over the circuit, on both deck faces.
  for (const o of plans) {
    const rightO = new THREE.Vector3(-o.dir.z, 0, o.dir.x);
    for (const side of [1, -1]) {
      const n = rightO.clone().multiplyScalar(side);
      const c = o.center.clone().addScaledVector(n, o.half + 0.75 + 0.18);
      c.y = o.deckTop - DECK_DEPTH - 1.2;
      quad(c, new THREE.Vector3(n.z, 0, -n.x), upV, 8, 4, SIGN_TILE + (o.index % 5), false);
      // Backing plate, so the far board never shows through mirrored.
      const back = c.clone().addScaledVector(n, -0.2);
      frames.push(paintVertices(new THREE.BoxGeometry(8.3, 4.3, 0.25).rotateY(Math.atan2(n.x, n.z)).translate(back.x, back.y, back.z).toNonIndexed(), steel));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aFlick', new THREE.Float32BufferAttribute(flick, 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({ map: billboardAtlas(plans.map((o) => o.name)), color: new THREE.Color(1.9, 1.9, 1.9), side: THREE.DoubleSide });
  mat.map.anisotropy = 4;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeU;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFlick;\nvarying float vFlick;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlick = aFlick;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vFlick;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        if (vFlick > 0.0) {
          // A failing tube: brief dropouts at random, a little hum the rest of the time.
          float tick = floor(uTime * 11.0 + vFlick * 37.0);
          float r = fract(sin(tick * 12.9898 + vFlick * 78.233) * 43758.5453);
          diffuseColor.rgb *= (r > 0.84 ? 0.18 : 1.0) * (0.94 + 0.06 * sin(uTime * 60.0 + vFlick * 9.0));
        }`
      );
  };
  mat.customProgramCacheKey = () => 'neon-billboard';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'billboards';
  return mesh;
}

// ---------------------------------------------------------------------------
// The skyline ring on the horizon
// ---------------------------------------------------------------------------

function buildSkyline(windows, rand) {
  const pos = [];
  const uv = [];
  const segs = 220;
  const R = 2300;
  let u = 0;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const h = rand() < 0.15 ? 260 + rand() * 260 : 70 + rand() * 170;
    const p0 = [Math.cos(a0) * R, Math.sin(a0) * R];
    const p1 = [Math.cos(a1) * R, Math.sin(a1) * R];
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const ub = u + len / (CELL_W * CELLS * 2.2);
    const vb = h / (CELL_H * CELLS * 2.2);
    const A = [p0[0], -40, p0[1]];
    const B = [p1[0], -40, p1[1]];
    const C = [p0[0], h, p0[1]];
    const D = [p1[0], h, p1[1]];
    pos.push(...A, ...B, ...C, ...C, ...B, ...D);
    uv.push(u, 0, ub, 0, u, vb, u, vb, ub, 0, ub, vb);
    u = ub;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const map = windows.clone();
  map.needsUpdate = true;
  const mat = new THREE.MeshBasicMaterial({ map, color: new THREE.Color(0.75, 0.7, 0.85), fog: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'skyline';
  mesh.frustumCulled = false;
  mesh.renderOrder = -0.5;
  return mesh;
}

// ---------------------------------------------------------------------------

export function buildNeonScenery(scene, renderer, track, def, quality, env = null) {
  installHeightFog();
  const rand = mulberry32(3303);
  const land = landOf(def);
  const sunDir = sunDirection(def.sun);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), skyMaterial(skyUniforms(sunDir, cloudTexture())));
  const skyU = sky.material.uniforms;
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);
  scene.fog = new THREE.FogExp2(new THREE.Color(0x1a1530), 0.0011);

  // Moonlight and a dim city-glow ambient; one shadow-casting light as on every track.
  const hemi = new THREE.HemisphereLight(0x3a3060, 0x140f1c, 0.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xa9b8ff, 0.6);
  sun.position.copy(sunDir).multiplyScalar(120);
  const SHADOW_EXTENT = 22;
  Object.assign(sun.shadow.camera, { left: -SHADOW_EXTENT, right: SHADOW_EXTENT, top: SHADOW_EXTENT, bottom: -SHADOW_EXTENT, near: 40, far: 200 });
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.04;
  sun.shadow.mapSize.set(512, 512);
  sun.castShadow = quality !== 'low';
  scene.add(sun, sun.target);

  const wet = { value: 0 };
  const timeU = { value: 0 };

  // Harbour water.
  const waterNormals = waterNormalMap();
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2).translate(0, WATER_Y, 0), oceanMaterial(waterNormals, sunDir));
  const oceanU = ocean.material.uniforms;
  oceanU.normalMap.value = waterNormals;
  oceanU.sunDir.value.copy(sunDir);
  ocean.frustumCulled = false;
  scene.add(ocean);

  // Ground: wet streets and pavements on the block grid.
  const groundTex = groundTextures();
  const groundMat = wettable(
    new THREE.MeshStandardMaterial({ map: groundTex.map, emissiveMap: groundTex.emissive, emissive: 0xffffff, emissiveIntensity: 0.85, roughness: 0.78, metalness: 0, envMapIntensity: 0.8 }),
    wet,
    { darken: 0.35, key: 'neon-ground' }
  );
  const groundData = buildGround(def);
  const groundMesh = new THREE.Mesh(groundData.geometry, groundMat);
  groundMesh.receiveShadow = true;
  groundMesh.name = 'ground';
  scene.add(groundMesh);

  // Concrete (freeway, overpasses, pylons, quays) and glow/metal atlas meshes.
  const concreteMat = new THREE.MeshStandardMaterial({ map: env?.tex.concrete?.clone() ?? null, color: env?.tex.concrete ? 0x8d9098 : 0x5d6068, roughness: 0.88, metalness: 0, envMapIntensity: 0.7 });
  if (concreteMat.map) concreteMat.map.needsUpdate = true;
  wettable(concreteMat, wet, { darken: 0.25, key: 'neon-concrete' });
  const neonMat = createVertexPbrMaterial({ envMapIntensity: 0.8 });

  const ground = land.ground;
  const plans = planOverpasses(track, def);
  const freeway = buildFreeway(track, def, ground);
  const concreteParts = [freeway.concrete, ...groundData.walls];
  const neonParts = [...freeway.neon];
  const pools = [...freeway.pools];
  buildOverpasses(track, plans, ground, { neon: neonParts, concrete: concreteParts, pools });
  buildHarbourBridge(track, def, { concrete: concreteParts, neon: neonParts });
  // Promenade LEDs along the waterfront.
  for (const [a, b] of groundData.quay) {
    const geo = new THREE.BoxGeometry(a.distanceTo(b), 0.12, 0.2).toNonIndexed();
    geo.rotateY(-Math.atan2(b.z - a.z, b.x - a.x)).translate((a.x + b.x) / 2, 0.15, (a.z + b.z) / 2);
    neonParts.push(paintVertices(geo, { color: NEON.cyan, emissive: 2.2 }));
  }

  const concrete = new THREE.Mesh(
    mergeGeometries(concreteParts.map((g) => {
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      if (!g.attributes.uv) boxUV(g);
      return g;
    })),
    concreteMat
  );
  concrete.name = 'concrete';
  concrete.receiveShadow = true;
  scene.add(concrete);

  // City.
  const facade = facadeTextures(rand);
  const city = planCity(track, def, land, plans, rand);
  const towers = buildTowers(track, city, rand);
  portalTowers(city, rand, towers.geos);
  const towerMat = new THREE.MeshStandardMaterial({
    map: facade.map,
    emissiveMap: facade.emissive,
    emissive: 0xffffff,
    emissiveIntensity: 1.15,
    vertexColors: true,
    roughness: 0.5,
    metalness: 0.25,
    envMapIntensity: 0.6,
  });
  towerMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLit;\nvarying float vLit;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLit = aLit;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLit;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vLit;');
  };
  towerMat.customProgramCacheKey = () => 'neon-towers';
  const towerMeshes = towers.geos.map((g) => {
    const m = new THREE.Mesh(g, towerMat);
    m.name = 'towers';
    return m;
  });
  scene.add(...towerMeshes);

  const frames = [];
  const billboards = buildBillboards(track, def, towers.ads, towers.blades, plans, frames, pools, timeU);
  scene.add(billboards);
  neonParts.push(...towers.trims, ...frames);
  const neon = new THREE.Mesh(
    mergeGeometries(neonParts.map((g) => {
      const out = g.index ? g.toNonIndexed() : g;
      for (const name of Object.keys(out.attributes)) if (!['position', 'normal', 'color', 'pbr'].includes(name)) out.deleteAttribute(name);
      if (!out.attributes.normal) out.computeVertexNormals();
      return out;
    })),
    neonMat
  );
  neon.name = 'neon';
  scene.add(neon);

  const poolMesh = buildLightPools(track, pools);
  scene.add(poolMesh);
  const skyline = buildSkyline(facade.emissive, rand);
  scene.add(skyline);
  const traffic = new Traffic(overpassLanes(plans), neonMat);
  scene.add(traffic.mesh);
  const headlights = new Headlights();
  scene.add(headlights.mesh);
  // The Grand Finale boss, Kage, streams a magenta light trail.
  const kageTrail = new LightTrail(NEON.magenta);
  scene.add(kageTrail.mesh);
  let lastT = 0;

  // Shadow-map texel snapping (as on the coast).
  const texel = (SHADOW_EXTENT * 2) / 512;
  const lightRot = new THREE.Matrix4();
  const lightInv = new THREE.Matrix4();
  const aimLight = () => {
    lightRot.lookAt(new THREE.Vector3(), sunDir.clone().negate(), new THREE.Vector3(0, 1, 0));
    lightInv.copy(lightRot).invert();
  };
  aimLight();
  const snapped = new THREE.Vector3();
  const base = { hemi: 0.7, sky: new THREE.Color(), flash: 0 };
  let envTarget = null;
  let glow = 1;

  return {
    sun,
    sunDir,
    sky,
    hemi,
    terrain: { meshes: [groundMesh], sample: (x, z) => ({ h: ground(x, z) }), gorge: null },
    waterNormals,
    groundMaterial: groundMat,
    applyWeather(w) {
      sunDirection(w.sun, sunDir);
      aimLight();
      sun.color.setHex(w.sun.color);
      sun.intensity = w.sun.intensity;
      hemi.color.setHex(w.hemi.sky);
      hemi.groundColor.setHex(w.hemi.ground);
      hemi.intensity = base.hemi = w.hemi.intensity;
      skyU.top.value.setHex(w.sky.top);
      skyU.horizon.value.setHex(w.sky.horizon);
      skyU.sunColor.value.setHex(w.sky.sun);
      skyU.glow.value = w.sky.glow;
      skyU.cover.value = w.clouds.cover;
      skyU.cloudLit.value.setHex(w.clouds.lit);
      skyU.cloudShade.value.setHex(w.clouds.shade);
      scene.fog.color.setHex(w.fog.color);
      scene.fog.density = w.fog.density;
      base.sky.setHex(w.fog.color);
      oceanU.sunDir.value.copy(sunDir);
      oceanU.sunColor.value.setHex(w.sky.sun).multiplyScalar(0.5);
      oceanU.deep.value.setHex(w.ocean.deep);
      oceanU.shallow.value.setHex(w.ocean.shallow);
      oceanU.skyTop.value.setHex(w.sky.top);
      oceanU.skyHorizon.value.setHex(w.sky.horizon);
      wet.value = w.wet;
      // A wet road mirrors the lamps: the pools of light spread and brighten.
      poolMesh.material.opacity = 0.42 + 0.5 * w.wet;
      glow = w.neon ?? 1;
      billboards.material.color.setScalar(1.9 * glow);
      skyline.material.color.setRGB(0.75, 0.7, 0.85).multiplyScalar(Math.min(1, 0.55 + 0.45 * (1 - w.fog.density * 300)));
    },
    setFlash(k) {
      if (k === base.flash) return;
      base.flash = k;
      skyU.flash.value = k * 0.9;
      hemi.intensity = base.hemi + k * 2.6;
      scene.fog.color.copy(base.sky).lerp(new THREE.Color(0xdfe6ff), k * 0.45);
    },
    update(t, camera, car, racers = []) {
      sky.position.copy(camera.position);
      skyline.position.set(camera.position.x, 0, camera.position.z);
      skyU.time.value = t;
      oceanU.time.value = t;
      timeU.value = t;
      traffic.update(t);
      headlights.update(car);
      const kage = racers.find((r) => r.id === KAGE && !r.out);
      kageTrail.update(Math.max(0, t - lastT), kage?.vehicle ?? null);
      lastT = t;
    },
    follow(target) {
      snapped.copy(target).applyMatrix4(lightInv);
      snapped.x = Math.round(snapped.x / texel) * texel;
      snapped.y = Math.round(snapped.y / texel) * texel;
      snapped.applyMatrix4(lightRot);
      sun.target.position.copy(snapped);
      sun.position.copy(snapped).addScaledVector(sunDir, 120);
    },
    // The environment cubemap is baked from unlit proxies of the city: the lit windows, the
    // billboards and every LED, so wet asphalt, glass and paint pick up the neon.
    bakeEnvironment(at) {
      const envScene = new THREE.Scene();
      envScene.fog = new THREE.Fog(scene.fog.color, 200, 2400 - Math.min(1800, scene.fog.density * 6e5));
      const envSky = new THREE.Mesh(sky.geometry, skyMaterial({ ...skyU, flash: { value: 0 } }));
      envSky.position.copy(at);
      envScene.add(envSky);
      const mats = [];
      const basic = (opts) => {
        const m = new THREE.MeshBasicMaterial(opts);
        mats.push(m);
        return m;
      };
      envScene.add(new THREE.Mesh(ocean.geometry, basic({ color: new THREE.Color(oceanU.deep.value).multiplyScalar(0.6) })));
      envScene.add(new THREE.Mesh(groundMesh.geometry, basic({ map: groundTex.emissive, color: 0x6a5a50 })));
      const windows = basic({ map: facade.emissive, color: new THREE.Color(0.45, 0.42, 0.4) });
      for (const m of towerMeshes) envScene.add(new THREE.Mesh(m.geometry, windows));
      envScene.add(new THREE.Mesh(billboards.geometry, basic({ map: billboards.material.map, color: new THREE.Color(1.6, 1.6, 1.6).multiplyScalar(glow), side: THREE.DoubleSide })));
      envScene.add(new THREE.Mesh(neon.geometry, basic({ vertexColors: true })));
      envScene.add(new THREE.Mesh(concrete.geometry, basic({ color: 0x2a2b30 })));
      const sl = new THREE.Mesh(skyline.geometry, basic({ map: skyline.material.map, color: skyline.material.color, fog: false, side: THREE.DoubleSide }));
      sl.position.set(at.x, 0, at.z);
      envScene.add(sl);
      const pmrem = new THREE.PMREMGenerator(renderer);
      const rt = pmrem.fromScene(envScene, 0.02, 0.5, 4000, { size: 256, position: at });
      pmrem.dispose();
      envSky.material.dispose();
      for (const m of mats) m.dispose();
      envTarget?.dispose();
      envTarget = rt;
      scene.environment = rt.texture;
      scene.environmentIntensity = 0.8;
      return rt.texture;
    },
  };
}
