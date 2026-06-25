# Видеочат-комната (Video Chat Room)

Групповой видеозвонок до **4 участников** со встроенным текстовым чатом. Вход по ссылке,
без регистрации и без серверного хранения истории. Медиа — **WebRTC mesh (P2P)**,
сигналинг и чат — **Socket.io**, состояние комнат — **в памяти** Node.js-сервера.

Документы фичи: [PRD](instuctions/prds/video-chat-room/prd-video-chat-room.md) ·
[TDD](instuctions/prds/video-chat-room/design-video-chat-room.md) ·
[План задач и трассировка](instuctions/prds/video-chat-room/impl-video-chat-room.md).

## Возможности

- Создание комнаты и вход по ссылке-приглашению (до 4 участников).
- WebRTC mesh: видео/аудио P2P, сигналинг через сервер.
- Текстовый чат в реальном времени с историей сессии и системными сообщениями.
- Список участников в боковой панели (обновляется при входе/выходе, F-16/US-9).
- Тумблеры микрофона и камеры, выбор устройств, индикатор «говорит».
- Копирование ссылки-приглашения, выход из комнаты.
- Обработка ошибок: комната заполнена, отказ в устройствах, сервер недоступен, WebRTC не поддерживается.

## Ограничения и отклонения от PRD

| Тема | Поведение |
|------|-----------|
| Mesh | До 4 участников; без TURN (строгий NAT может не пробиться). |
| Reconnect | Нет автопереподключения — обрыв = выход, возврат вручную. |
| БД | Нет — комнаты и чат только в памяти сервера. |
| Камера/микрофон по умолчанию | **Выключены** при входе (opt-in тумблерами). PRD п. 13 требует включёнными — осознанное UX-решение (лампочка камеры не горит). |

## Стек

- **Сервер:** Node.js ≥ 18.18 (ES modules), Express, Socket.io.
- **Клиент:** React 18, Vite, React Router, нативный WebRTC (`RTCPeerConnection`).
- **Тесты:** Vitest (клиент), `node --test` (сервер), Playwright (E2E).
- **Линт/формат:** ESLint (flat config) + Prettier.
- Монорепозиторий на **npm workspaces** (`video-chat-room/`).

## Структура

```
video-chat-room/
├── package.json              # workspaces + общие скрипты
├── eslint.config.js
├── playwright.config.js
├── e2e/video-chat.spec.js    # E2E (8 сценариев, US из PRD)
├── Dockerfile, docker-compose.yml, deploy/nginx.conf
├── scripts/generate-cert.sh
├── server/
│   ├── src/
│   │   ├── index.js          # HTTP/HTTPS + Socket.io + статика SPA
│   │   ├── config.js         # env-конфиг
│   │   ├── rooms.js          # RoomRegistry (in-memory)
│   │   ├── roomHandlers.js   # room:join/leave, media:state
│   │   ├── signaling.js      # relay signal:offer/answer/ice
│   │   ├── chat.js           # chat:send, системные сообщения
│   │   └── validation.js     # sanitize имени/сообщений (XSS)
│   └── test/                 # unit + integration (55 тестов)
└── client/
    ├── public/               # icon.svg, forasoft-logo-full.svg
    └── src/
        ├── pages/            # StartScreen, RoomScreen
        ├── components/       # VideoGrid, VideoTile, ChatPanel, ParticipantList, Controls, …
        ├── webrtc/           # useLocalMedia, PeerConnectionManager, useSpeaking
        └── socket/           # useSignaling
```

## Требования

- Node.js **≥ 18.18**.
- HTTPS или `localhost` — `getUserMedia`/WebRTC работают только в secure context.

## Установка

```bash
cd video-chat-room
npm install
cp server/.env.example server/.env    # опционально
cp client/.env.example client/.env    # опционально
```

## Запуск (dev)

```bash
npm run dev            # сервер :3001 + клиент :5173
# по отдельности:
npm run dev:server
npm run dev:client
```

Откройте <http://localhost:5173>. Запросы `/socket.io` проксируются Vite на сервер.

Проверка сервера: <http://localhost:3001/healthz> → `{ "status": "ok" }`.

## HTTPS / secure context

`getUserMedia` и WebRTC работают в **secure context** — `https://…` или `http://localhost`.

Для доступа не с localhost (LAN и т.п.):

```bash
npm run certs          # самоподписанный сертификат → certs/
npm run dev            # сервер и Vite поднимаются по HTTPS автоматически
```

Если `certs/localhost-*.pem` существуют — HTTPS; иначе HTTP (localhost остаётся secure context).
Каталог `certs/` в `.gitignore`.

## Сборка (prod)

```bash
npm run build          # client → client/dist
npm start              # сервер отдаёт client/dist + Socket.io на :3001
```

## Тесты и качество

```bash
npm run lint
npm run format:check
npm run test           # server (55) + client (29) unit/integration
npm run test:e2e       # Playwright, 8 E2E-сценариев (нужен build + certs для CI-паритета)
```

Для E2E локально без конфликта порта:

```bash
npm run build && CI=1 npm run test:e2e
```

## Переменные окружения

**server/.env**

| Переменная         | По умолчанию                   | Назначение                                  |
| ------------------ | ------------------------------ | ------------------------------------------- |
| `PORT`             | `3001`                         | Порт сигнального сервера                    |
| `CLIENT_ORIGIN`    | `http://localhost:5173`        | Origin клиента для CORS                     |
| `MAX_MEMBERS`      | `4`                            | Лимит участников в комнате (mesh, PRD F-05) |
| `CHAT_HISTORY_CAP` | `200`                          | Размер буфера истории чата на комнату       |
| `MESSAGE_MAX_LEN`  | `1000`                         | Максимальная длина сообщения                |
| `STUN_URLS`        | `stun:stun.l.google.com:19302` | STUN (справочно; клиент берёт из VITE\_\*)  |
| `SSL_KEY_FILE`     | `certs/localhost-key.pem`      | TLS-ключ для HTTPS (опционально)            |
| `SSL_CERT_FILE`    | `certs/localhost-cert.pem`     | TLS-сертификат для HTTPS (опционально)      |

**client/.env**

| Переменная       | По умолчанию                   | Назначение                  |
| ---------------- | ------------------------------ | --------------------------- |
| `VITE_STUN_URLS` | `stun:stun.l.google.com:19302` | STUN-серверы для WebRTC ICE |

## Деплой (Docker) и CI

Один процесс: Node-сервер раздаёт SPA (`client/dist`) и Socket.io на одном origin.
TLS — на reverse-proxy (`nginx`).

```bash
docker build -t video-chat-room .
docker run -p 3001:3001 video-chat-room
```

С TLS и WSS:

```bash
# deploy/certs/{fullchain,privkey}.pem + server_name в deploy/nginx.conf
docker compose up --build
```

**CI** (`.github/workflows/ci.yml`, push/PR в `main`):

1. `lint-test-build` — lint, format, unit/integration (84 теста), build.
2. `e2e` — Playwright (fake-медиа Chromium).
3. `docker-build` — сборка Docker-образа.

## Трассировка требований

Статус задач 1–26 и соответствие PRD/US — в
[impl-video-chat-room.md](instuctions/prds/video-chat-room/impl-video-chat-room.md).
