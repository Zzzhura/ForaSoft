import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import { config } from './config.js';
import { registerRoomHandlers } from './roomHandlers.js';
import { registerSignalingHandlers } from './signaling.js';
import { registerChatHandlers } from './chat.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors({ origin: config.clientOrigin }));

// Health-check для проверки доступности сервера.
app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok' });
});

// Отдача собранного SPA (client/dist) в проде. В dev клиент поднимается на Vite (§12).
const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(404).end();
  });
});

// HTTPS, если есть сертификат (secure context для getUserMedia/WebRTC),
// иначе HTTP — на localhost этого достаточно как secure context (TDD §10/§12).
const protocol = config.tls ? 'https' : 'http';
const server = config.tls ? https.createServer(config.tls, app) : http.createServer(app);

const io = new SocketIOServer(server, {
  cors: { origin: config.clientOrigin },
});

// Регистрация обработчиков по сокету: комнаты/состав, сигналинг WebRTC, чат.
io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  registerRoomHandlers(io, socket);
  registerSignalingHandlers(io, socket);
  registerChatHandlers(io, socket);

  socket.on('disconnect', (reason) => {
    console.log(`[socket] disconnected: ${socket.id} (${reason})`);
  });
});

server.listen(config.port, () => {
  console.log(`[server] listening on ${protocol}://localhost:${config.port}`);
  console.log(
    `[server] secure context: ${config.tls ? 'HTTPS (cert loaded)' : 'HTTP (localhost only)'}`,
  );
  console.log(`[server] max members per room: ${config.maxMembers}`);
});

export { app, server, io };
