'use strict';

const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { Server } = require('socket.io');
const { setupGame } = require('./src/socket-server');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();
app.disable('x-powered-by');

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'game-online', timestamp: new Date().toISOString() });
});

// Link mời phòng: /join/123456 -> /?room=123456.
app.get('/join/:roomCode', (req, res) => {
  const { roomCode } = req.params;
  if (!/^\d{6}$/.test(roomCode)) return res.redirect('/');
  res.redirect(`/?room=${encodeURIComponent(roomCode)}`);
});

// Chỉ phục vụ nội dung trong public; mã nguồn game/server không bị public trực tiếp.
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

const server = http.createServer(app);
const io = new Server(server, {
  transports: ['websocket'],
  maxHttpBufferSize: 1_000_000,
  cors: { origin: process.env.CORS_ORIGIN || false },
  // Phát hiện mất mạng nhanh: ping 5s thay vì 25s → đứt kết nối được nhận biết
  // trong ~5–10s thay vì ~25–30s, người chơi vào lại giữ được 30 giây giữ chỗ.
  pingInterval: 5_000,
  pingTimeout: 5_000,
});

const runtime = setupGame(io, {
  baseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`,
});

server.listen(PORT, HOST, () => {
  console.log(`Game server đang chạy: http://localhost:${PORT}`);
  console.log(`Địa chỉ bind: ${HOST}:${PORT}`);
  console.log('Health check: /health');
});

function shutdown(signal) {
  console.log(`\nNhận ${signal}, đang đóng server...`);
  runtime.close();
  io.close(() => {
    console.log('Server đã đóng.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
