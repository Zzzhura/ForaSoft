import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Парсит целое из env с безопасным fallback. */
const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Загружает TLS-сертификат для HTTPS (secure context для getUserMedia/WebRTC,
 * PRD п. 34–37, TDD §10/§12). Пути берутся из env или из certs/ по умолчанию.
 * Если файлов нет — возвращает null, сервер стартует по HTTP (localhost тоже
 * является secure context, поэтому dev работает и без сертификата).
 */
const loadTls = () => {
  const defaultDir = path.resolve(__dirname, '../../certs');
  const keyFile = process.env.SSL_KEY_FILE || path.join(defaultDir, 'localhost-key.pem');
  const certFile = process.env.SSL_CERT_FILE || path.join(defaultDir, 'localhost-cert.pem');
  if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
    return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
  }
  return null;
};

/**
 * Единая конфигурация сервера из env (TDD §12).
 * Значения по умолчанию совпадают с дефолтами из плана задач (impl §1.3).
 */
export const config = {
  port: toInt(process.env.PORT, 3001),
  // Origin Vite dev-сервера для CORS. В проде SPA отдаётся с того же origin (§12).
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  // Лимит участников в комнате — жёстко 4 из-за mesh-топологии (PRD F-05).
  maxMembers: toInt(process.env.MAX_MEMBERS, 4),
  // Кольцевой буфер истории чата на комнату (TDD §9).
  chatHistoryCap: toInt(process.env.CHAT_HISTORY_CAP, 200),
  // Максимальная длина одного сообщения чата (PRD п. 40).
  messageMaxLen: toInt(process.env.MESSAGE_MAX_LEN, 1000),
  // STUN потребляется на клиенте (VITE_STUN_URLS); здесь — для справки/логов.
  stunUrls: (process.env.STUN_URLS || 'stun:stun.l.google.com:19302')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean),
  // TLS-сертификат (или null → HTTP-фоллбэк). См. loadTls().
  tls: loadTls(),
};
