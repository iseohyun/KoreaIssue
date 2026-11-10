/**
 * `class="lucide lucide-newspaper"` 아이콘을 모서리 둥근 사각형(#0f172a 배경)으로 감싼
 * `public/icon.svg` 및 `public/icon.png` 동시 생성 스크립트
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const SVG_CONTENT = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 32 32" fill="none">
  <rect x="0" y="0" width="32" height="32" rx="7" fill="#0f172a"/>
  <g transform="translate(4, 4)" stroke="#f8fafc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-newspaper">
    <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/>
    <path d="M18 14h-8"/>
    <path d="M15 18h-5"/>
    <path d="M10 6h8v4h-8V6Z"/>
  </g>
</svg>
`;

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcVal = crc32(Buffer.concat([typeBuf, data]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function distToArc(px, py, cx, cy, r, startAngle, endAngle) {
  const ang = Math.atan2(py - cy, px - cx);
  let normAng = ang;
  if (normAng < 0) normAng += Math.PI * 2;
  let s = startAngle < 0 ? startAngle + Math.PI * 2 : startAngle;
  let e = endAngle < 0 ? endAngle + Math.PI * 2 : endAngle;
  const inRange = s <= e ? normAng >= s && normAng <= e : normAng >= s || normAng <= e;
  if (inRange) {
    return Math.abs(Math.hypot(px - cx, py - cy) - r);
  }
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  return Math.min(Math.hypot(px - x1, py - y1), Math.hypot(px - x2, py - y2));
}

function insideRoundedRect(x, y, w, h, r) {
  const qx = Math.abs(x - w / 2) - (w / 2 - r);
  const qy = Math.abs(y - h / 2) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function generateNewspaperPng(size = 128) {
  const raw = Buffer.alloc(size * (size * 4 + 1));

  // Background color: #0f172a -> (15, 23, 42)
  // Foreground stroke color: #f8fafc -> (248, 250, 252)
  const bgR = 15, bgG = 23, bgB = 42;
  const fgR = 248, fgG = 250, fgB = 252;

  // Segments in 24x24 Lucide coordinate space (translated by +4, +4 in 32x32 viewBox)
  const segments = [
    // Top edge: (8, 2) to (20, 2)
    [8, 2, 20, 2],
    // Right edge: (22, 4) to (22, 20)
    [22, 4, 22, 20],
    // Bottom edge: (4, 22) to (20, 22)
    [4, 22, 20, 22],
    // Inner vertical spine: (6, 4) to (6, 20)
    [6, 4, 6, 20],
    // Left flap vertical: (2, 11) to (2, 20)
    [2, 11, 2, 20],
    // Left flap top: (4, 9) to (6, 9)
    [4, 9, 6, 9],
    // Headline box: (10, 6)-(18, 6)-(18, 10)-(10, 10)
    [10, 6, 18, 6],
    [18, 6, 18, 10],
    [18, 10, 10, 10],
    [10, 10, 10, 6],
    // Text lines: (10, 14)-(18, 14) and (10, 18)-(15, 18)
    [10, 14, 18, 14],
    [10, 18, 15, 18],
  ];

  // Corner arcs in 24x24 Lucide space: [cx, cy, r, startRad, endRad]
  const arcs = [
    [8, 4, 2, Math.PI, Math.PI * 1.5],
    [20, 4, 2, Math.PI * 1.5, Math.PI * 2],
    [20, 20, 2, 0, Math.PI * 0.5],
    [4, 20, 2, 0, Math.PI],
    [4, 11, 2, Math.PI, Math.PI * 1.5],
  ];

  for (let py = 0; py < size; py++) {
    const rowOffset = py * (size * 4 + 1);
    raw[rowOffset] = 0; // filter type 0

    for (let px = 0; px < size; px++) {
      // Map pixel center to 32x32 coordinate space
      const vx = ((px + 0.5) / size) * 32;
      const vy = ((py + 0.5) / size) * 32;

      const sdfRect = insideRoundedRect(vx, vy, 32, 32, 7);
      const pixelScale = 32 / size;
      const rectAlpha = Math.max(0, Math.min(1, 0.5 - sdfRect / pixelScale));

      if (rectAlpha <= 0) {
        const idx = rowOffset + 1 + px * 4;
        raw[idx] = 0;
        raw[idx + 1] = 0;
        raw[idx + 2] = 0;
        raw[idx + 3] = 0;
        continue;
      }

      // Lucide 24x24 coordinates
      const lx = vx - 4;
      const ly = vy - 4;

      let minDist = Infinity;
      for (const [x1, y1, x2, y2] of segments) {
        const d = distToSegment(lx, ly, x1, y1, x2, y2);
        if (d < minDist) minDist = d;
      }
      for (const [cx, cy, r, sa, ea] of arcs) {
        const d = distToArc(lx, ly, cx, cy, r, sa, ea);
        if (d < minDist) minDist = d;
      }

      const strokeRadius = 1.0; // stroke-width = 2 -> radius = 1.0
      const strokeAlpha = Math.max(
        0,
        Math.min(1, 0.5 - (minDist - strokeRadius) / pixelScale)
      );

      const r = Math.round(bgR * (1 - strokeAlpha) + fgR * strokeAlpha);
      const g = Math.round(bgG * (1 - strokeAlpha) + fgG * strokeAlpha);
      const b = Math.round(bgB * (1 - strokeAlpha) + fgB * strokeAlpha);
      const a = Math.round(rectAlpha * 255);

      const idx = rowOffset + 1 + px * 4;
      raw[idx] = r;
      raw[idx + 1] = g;
      raw[idx + 2] = b;
      raw[idx + 3] = a;
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(PUBLIC_DIR, { recursive: true });
const svgPath = path.join(PUBLIC_DIR, 'icon.svg');
const pngPath = path.join(PUBLIC_DIR, 'icon.png');

fs.writeFileSync(svgPath, SVG_CONTENT, 'utf-8');
fs.writeFileSync(pngPath, generateNewspaperPng(128));

console.log(`[IconGenerator] 아이콘 생성 완료:
  - SVG: ${svgPath}
  - PNG: ${pngPath} (${fs.statSync(pngPath).size} bytes)`);
