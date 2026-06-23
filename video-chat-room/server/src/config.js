import 'dotenv/config';

/** Парсит целое из env с безопасным fallback. */
const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
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
};
