# Видеочат-комната (Video Chat Room)

Групповой видеозвонок до **4 участников** со встроенным текстовым чатом. Вход по ссылке,
без регистрации и без серверного хранения истории. Медиа — **WebRTC mesh (P2P)**,
сигналинг и чат — **Socket.io**, состояние комнат — **в памяти** Node.js-сервера.

Документы фичи: [PRD](../instuctions/prds/video-chat-room/prd-video-chat-room.md) ·
[TDD](../instuctions/prds/video-chat-room/design-video-chat-room.md) ·
[План задач](../instuctions/prds/video-chat-room/impl-video-chat-room.md).

> Этот каркас — результат **задачи 1 (Блок A)** плана: инициализация monorepo.
> Бизнес-логика (комнаты, сигналинг, чат, UI) добавляется в задачах 3–18.

## Стек

- **Сервер:** Node.js (ES modules), Express (статика + health), Socket.io.
- **Клиент:** React 18 + Vite, React Router.
- **Линт/формат:** ESLint (flat config) + Prettier.
- Монорепозиторий на **npm workspaces**.

## Структура

```
video-chat-room/
├── package.json            # workspaces + общие скрипты (dev/build/lint/format)
├── eslint.config.js        # общий flat-config (server=Node, client=React)
├── .prettierrc.json
├── .editorconfig
├── server/
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── index.js        # http + socket.io bootstrap, отдача статики SPA
│       └── config.js       # конфиг из env
└── client/
    ├── package.json
    ├── vite.config.js      # dev-прокси /socket.io → сервер
    ├── index.html
    ├── .env.example
    └── src/
        ├── main.jsx        # точка входа + BrowserRouter
        ├── App.jsx         # роутинг Start ↔ Room
        ├── index.css
        └── pages/
            ├── StartScreen.jsx   # заглушка (задача 13)
            └── RoomScreen.jsx    # заглушка (задача 18)
```

Модули `rooms.js`, `signaling.js`, `chat.js`, `validation.js` (сервер) и
`webrtc/`, `socket/`, `components/` (клиент) добавляются в своих задачах.

## Требования

- Node.js **≥ 18.18** (разработка велась на Node 23).
- HTTPS или `localhost` — `getUserMedia`/WebRTC работают только в secure context.

## Установка

```bash
cd video-chat-room
npm install            # ставит зависимости обоих workspace
cp server/.env.example server/.env
cp client/.env.example client/.env
```

## Запуск (dev)

```bash
npm run dev            # сервер (:3001) и клиент (:5173) одновременно
# по отдельности:
npm run dev:server
npm run dev:client
```

Откройте <http://localhost:5173>. Запросы `/socket.io` проксируются Vite на сервер,
так что для браузера всё на одном origin.

Проверка сервера: <http://localhost:3001/healthz> → `{ "status": "ok" }`.

## HTTPS / secure context

`getUserMedia` и WebRTC работают только в **secure context** — это `https://…`
**или** `http://localhost`. То есть на `localhost` всё работает по HTTP без настройки.

HTTPS нужен, когда вы открываете приложение **не с localhost** (например, по LAN-IP
с другого устройства) или хотите паритет с продом. Включается одной командой:

```bash
npm run certs          # самоподписанный сертификат → certs/ (localhost, 127.0.0.1)
npm run dev            # теперь сервер и Vite поднимаются по HTTPS автоматически
```

Логика общая для сервера и клиента: **если `certs/localhost-*.pem` существуют —
оба поднимаются по HTTPS; если нет — по HTTP** (localhost остаётся secure context).
Никакой ручной правки конфигов не нужно. Браузер покажет предупреждение о доверии
к self-signed — это ожидаемо; для доверенного сертификата используйте
[mkcert](https://github.com/FiloSottile/mkcert) и положите его файлы в `certs/`
под теми же именами (или задайте пути через `SSL_KEY_FILE` / `SSL_CERT_FILE`).

> Каталог `certs/` в `.gitignore` — сертификаты не коммитятся.

## Сборка (prod)

```bash
npm run build          # client → client/dist
npm start              # сервер отдаёт client/dist и поднимает Socket.io
```

## Линт и формат

```bash
npm run lint
npm run format         # или format:check
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

Один процесс: Node-сервер раздаёт собранный SPA (`client/dist`) и поднимает
Socket.io на том же origin (TDD §12). TLS терминируется reverse-proxy'ем
(`nginx`), который проксирует **WSS снаружи → ws внутрь**; сам контейнер слушает
HTTP на `3001`.

```bash
docker build -t video-chat-room .      # multi-stage: сборка клиента + прод-сервер
docker run -p 3001:3001 video-chat-room
```

Полная композиция с reverse-proxy (TLS + WSS):

```bash
# 1. Положите сертификат в deploy/certs/{fullchain,privkey}.pem
# 2. Укажите домен в deploy/nginx.conf (server_name) и CLIENT_ORIGIN в docker-compose.yml
docker compose up --build
```

- `Dockerfile` — multi-stage образ (один процесс).
- `deploy/nginx.conf` — TLS-терминация + апгрейд WebSocket для `/socket.io`.
- `docker-compose.yml` — `app` + `nginx` proxy.

**CI** (`.github/workflows/ci.yml`, на push/PR в `main`):

- `lint-test-build` — `lint` + `format:check`, unit + integration тесты сервера,
  unit-тесты клиента, сборка `client/dist` (артефакт).
- `e2e` — Playwright (fake-медиа Chromium) на собранном приложении.
- `docker-build` — проверка сборки Docker-образа.
