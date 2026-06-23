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

**client/.env**

| Переменная       | По умолчанию                   | Назначение                  |
| ---------------- | ------------------------------ | --------------------------- |
| `VITE_STUN_URLS` | `stun:stun.l.google.com:19302` | STUN-серверы для WebRTC ICE |
