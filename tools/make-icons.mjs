/* Generates the scoreboard icons: sand digits on deep terracotta.
   Run: node tools/make-icons.mjs   (no dependencies) */
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

/* The Organic pair the rest of the app already uses for a filled control
   carrying a light label: accent-700 ground, --color-bg glyphs. 5.72:1, and
   --color-bg is also the manifest's background_color. */
const GROUND = [0x8c, 0x49, 0x1a];   /* --color-accent-700  #8C491A */
const GLYPH  = [0xf5, 0xea, 0xd8];   /* --color-bg          #F5EAD8 */

/* 5x7 glyphs, one string row per line, '#' = lit pixel. */
const GLYPHS = {
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
};

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 2;    // truecolour RGB
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;   // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixels(x, y);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function render(size, text) {
  const cols = text.length * 6 - 1;          // 5 wide + 1 gap, no trailing gap
  /* 40% of the canvas keeps the glyphs inside the 80%-diameter safe circle
     that maskable icons are cropped to on Android. */
  const scale = Math.floor((size * 0.40) / cols);
  const w = cols * scale;
  const h = 7 * scale;
  const x0 = Math.floor((size - w) / 2);
  const y0 = Math.floor((size - h) / 2);
  return png(size, (x, y) => {
    const gx = Math.floor((x - x0) / scale);
    const gy = Math.floor((y - y0) / scale);
    if (gx >= 0 && gy >= 0 && gy < 7 && gx < cols) {
      const ch = text[Math.floor(gx / 6)];
      const col = gx % 6;
      if (col < 5 && GLYPHS[ch] && GLYPHS[ch][gy][col] === '#') return GLYPH;
    }
    return GROUND;
  });
}

mkdirSync('icons', { recursive: true });
for (const [file, size] of [['icons/icon-192.png', 192], ['icons/icon-512.png', 512], ['icons/apple-touch-icon.png', 180]]) {
  writeFileSync(file, render(size, '07'));
  console.log('wrote', file, size);
}
