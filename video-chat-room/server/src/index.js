import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import { config } from './config.js';

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

const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: { origin: config.clientOrigin },
});

// Обработчики комнат / сигналинга / чата подключаются в задачах 5–8.
// Здесь — только базовый bootstrap соединения (impl §1.1).
io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  socket.on('disconnect', (reason) => {
    console.log(`[socket] disconnected: ${socket.id} (${reason})`);
  });
});

server.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
  console.log(`[server] max members per room: ${config.maxMembers}`);
});

export { app, server, io };
