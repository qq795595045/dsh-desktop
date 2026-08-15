'use strict';

/**
 * 冒烟测试用的 mock 服务器:模拟 `dsh web` 的行为 —— 绑定后打印
 * `dsh web: http://127.0.0.1:<port>`,并返回一个极简页面。
 * 仅在 DSH_DESKTOP_MOCK=1 时由 main.js 启动。
 */

const http = require('node:http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html><head><meta charset="utf-8"><title>DSH Desktop Mock</title></head><body><h1>Mock DSH Web</h1><p>冒烟测试通过。</p></body></html>');
});

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  console.log(`dsh web: http://127.0.0.1:${port}`);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
