'use strict';

/**
 * 生成应用图标 assets/icon.png(1024x1024 RGBA)。
 * 纯 Node 实现(仅依赖内置 zlib):画一只 DeepSeek 风格的蓝色鲸鱼。
 */

const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const SIZE = 1024;

// ---- 基础工具 -------------------------------------------------------------

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

function gradient(c0, c1) {
  return (t) => [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
}

function inCircle(x, y, cx, cy, r) {
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function inEllipse(x, y, cx, cy, rx, ry) {
  const dx = (x - cx) / rx, dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

function inRotEllipse(x, y, cx, cy, rx, ry, angleDeg) {
  const a = angleDeg * Math.PI / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const dx = x - cx, dy = y - cy;
  const X = cos * dx + sin * dy;
  const Y = -sin * dx + cos * dy;
  return (X * X) / (rx * rx) + (Y * Y) / (ry * ry) <= 1;
}

// ---- 鲸鱼形状(头部朝左,尾巴朝右) -----------------------------------------

function whaleShape(x, y) {
  // 前段身体(头部更圆润)
  if (inEllipse(x, y, 400, 555, 230, 195)) return true;
  // 后段身体(略窄,向尾部收拢)
  if (inEllipse(x, y, 640, 555, 225, 165)) return true;
  // 尾鳍(上下两瓣,中间留 V 形缺口)
  if (inRotEllipse(x, y, 850, 425, 105, 50, -28)) return true;
  if (inRotEllipse(x, y, 850, 685, 105, 50, 28)) return true;
  // 背鳍(背部)
  if (inRotEllipse(x, y, 600, 385, 65, 30, -35)) return true;
  // 胸鳍(腹部)
  if (inRotEllipse(x, y, 430, 715, 100, 40, 45)) return true;
  return false;
}

// ---- 绘制 -----------------------------------------------------------------

const bg = gradient([255, 255, 255], [232, 238, 255]);   // 白 → 极淡蓝
const whaleGrad = gradient([93, 124, 250], [59, 91, 219]); // 深蓝鲸鱼(#5D7CFA → #3B5BDB)

const px = Buffer.alloc(SIZE * SIZE * 4);

for (let y = 0; y < SIZE; y++) {
  const t = y / (SIZE - 1);
  const [r, g, b] = bg(t);
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  }
}

// 鲸鱼主体(带轻微上下渐变)
for (let y = 0; y < SIZE; y++) {
  const t = y / (SIZE - 1);
  const [wr, wg, wb] = whaleGrad(t);
  for (let x = 0; x < SIZE; x++) {
    if (whaleShape(x, y)) {
      const i = (y * SIZE + x) * 4;
      px[i] = wr; px[i + 1] = wg; px[i + 2] = wb; px[i + 3] = 255;
    }
  }
}

// 眼睛:白色眼白 + 深色瞳孔
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (inCircle(x, y, 300, 520, 26)) {
      const i = (y * SIZE + x) * 4;
      px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = 255;
    } else if (inCircle(x, y, 292, 520, 12)) {
      const i = (y * SIZE + x) * 4;
      px[i] = 20; px[i + 1] = 28; px[i + 2] = 55; px[i + 3] = 255;
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
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
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
console.log(`已生成鲸鱼图标: ${out} (${png.length} 字节)`);
