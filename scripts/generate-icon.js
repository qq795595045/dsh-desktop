'use strict';

/**
 * 生成应用图标 assets/icon.png(1024x1024 RGBA)。
 * 纯 Node 实现(仅依赖内置 zlib),无任何第三方依赖:
 * 深色圆角底 + 白色对话气泡 + 三个圆点。
 */

const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const SIZE = 1024;

// ---- 颜色工具 -------------------------------------------------------------

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

function gradient(c0, c1) {
  return (t) => [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
}

// ---- 形状测试 -------------------------------------------------------------

function inRoundedRect(x, y, cx, cy, w, h, r) {
  const x0 = cx - w / 2, x1 = cx + w / 2;
  const y0 = cy - h / 2, y1 = cy + h / 2;
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const nx = Math.max(x0 + r - x, 0, x - (x1 - r));
  const ny = Math.max(y0 + r - y, 0, y - (y1 - r));
  return nx * nx + ny * ny <= r * r;
}

function inCircle(x, y, cx, cy, r) {
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

// ---- 绘制 -------------------------------------------------------------

const bg = gradient([15, 23, 42], [30, 41, 59]);   // #0f172a -> #1e293b
const px = Buffer.alloc(SIZE * SIZE * 4);

for (let y = 0; y < SIZE; y++) {
  const t = y / (SIZE - 1);
  const [r, g, b] = bg(t);
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  }
}

const cx = SIZE / 2;
const cy = SIZE / 2;

// 白色对话气泡(带小尾巴)
const bubble = (x, y) => {
  const inBody = inRoundedRect(x, y, cx, cy - 40, 560, 420, 96);
  if (inBody) return true;
  // 尾巴:底部左下的三角形(用圆近似)
  const tailCx = cx - 160, tailCy = cy + 180;
  return inCircle(x, y, tailCx, tailCy, 70) && (y - tailCy) - (x - tailCx) * 0.6 < 20;
};

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (bubble(x, y)) {
      const i = (y * SIZE + x) * 4;
      px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = 255;
    }
  }
}

// 三个圆点
const dotColor = [15, 23, 42];
const dots = [
  [cx - 150, cy - 10],
  [cx, cy - 10],
  [cx + 150, cy - 10]
];
for (const [dx, dy] of dots) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (inCircle(x, y, dx, dy, 42)) {
        const i = (y * SIZE + x) * 4;
        px[i] = dotColor[0]; px[i + 1] = dotColor[1]; px[i + 2] = dotColor[2]; px[i + 3] = 255;
      }
    }
  }
}

// ---- PNG 编码 -------------------------------------------------------------

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // color type: RGBA
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const idat = zlib.deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0))
]);

const out = path.join(__dirname, '..', 'assets', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`已生成图标: ${out} (${png.length} 字节)`);
