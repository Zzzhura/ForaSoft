import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Тот же сертификат, что и у сервера (см. scripts/generate-cert.sh).
// Если он есть — Vite поднимается по HTTPS (secure context для getUserMedia
// при доступе по LAN-IP); иначе HTTP, чего достаточно на localhost (TDD §10/§12).
const certDir = path.resolve(__dirname, '../certs');
const keyFile = path.join(certDir, 'localhost-key.pem');
const certFile = path.join(certDir, 'localhost-cert.pem');
const hasCert = fs.existsSync(keyFile) && fs.existsSync(certFile);
const https = hasCert
  ? { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }
  : undefined;

// Бэкенд использует тот же сертификат → тот же протокол, что и dev-клиент.
const serverPort = process.env.VITE_SERVER_PORT || '3001';
const backendProto = hasCert ? 'https' : 'http';
const backendTarget = `${backendProto}://localhost:${serverPort}`;

// В dev Socket.io проксируется на сервер, чтобы для браузера всё было на одном
// origin (TDD §12). secure:false — принять самоподписанный сертификат бэкенда.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    https,
    proxy: {
      '/socket.io': { target: backendTarget, ws: true, secure: false },
      '/healthz': { target: backendTarget, secure: false },
    },
  },
});
