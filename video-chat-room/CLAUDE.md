# CLAUDE.md

Видеочат до 4 участников: WebRTC mesh (P2P) + Socket.io сигналинг/чат, состояние комнат в памяти. Без БД, авторизации, reconnect, TURN.

## Стиль ответов
- НИКОГДА не извиняйся, не приветствуй и не используй пустые фразы (филлер-слова).
- НЕ сопровождай код объяснениями, если об этом прямо не попросили.
- НЕ пиши фразы вроде "Конечно, я помогу" или "Дай знать, если нужно что-то еще".
- Выводи ТОЛЬКО измененный код или сухие технические тезисы.
- При минимальных правках выводи ТОЛЬКО затронутые строки или функции.

## Где что
- Код: `video-chat-room/` (npm workspaces monorepo). Команды запускать оттуда.
- `server/src/`: `index.js` (bootstrap), `config.js` (env), `rooms.js` (`RoomRegistry`), `roomHandlers.js`, `signaling.js`, `chat.js`, `validation.js`.
- `client/src/`: `webrtc/` (`PeerConnectionManager.js`, `useLocalMedia.js`), `socket/useSignaling.js`, `pages/`, `components/`.
- Спека (источник истины): `instuctions/prds/video-chat-room/` — `prd-`, `design-` (TDD), `impl-` (план задач). Сверяйся перед изменениями.

## Команды (из `video-chat-room/`)
- `npm run dev` — сервер :3001 + клиент :5173. `npm run build`, `npm start`.
- `npm run lint`, `npm run format` — гонять перед сдачей.

## Стиль кода (соблюдать строго)
- ES modules, `import`/`export`. Node ≥18.18, без TypeScript.
- Prettier: одинарные кавычки, `;`, ширина 100, trailing comma `all`.
- JSDoc на каждом экспорте и нетривиальной функции: `@param`/`@returns`/`@typedef`. Сложные структуры — через `@typedef`.
- Комментарии и UI-тексты — на русском. В комментариях ссылайся на требования: `PRD F-05` / `PRD п. 38` / `US-5` / `TDD §4.1` / `задача N`.
- Именованные `function` для основных экспортов; стрелки для мелких хелперов. Приватные методы класса — `#field`.
- Обработчики сокета: `registerXHandlers(io, socket)`. Делай их идемпотентными.
- Логи с префиксом: `[server]`, `[socket]`, `[pcm]`.

## Инварианты (не нарушать)
- Лимит 4 на комнату; проверка+вставка в `joinRoom` атомарны (один синхронный блок, без `await` между check и insert).
- Комната живёт пока есть участники; пустая — удаляется с историей чата.
- Имена и текст чата валидируются и HTML-экранируются на сервере (`validation.js`) — XSS. React-рендер без `dangerouslySetInnerHTML`.
- Камера off: `track.stop()` + `replaceVideoTrack(null)` (гасит лампочку). Микрофон off: `audioTrack.enabled=false` (без renegotiation).
- Сигналинг — «тонкий» relay по `to` внутри одной комнаты; сервер не разбирает SDP. Нативный `RTCPeerConnection`, без обёрток.
- Initiator offer'а в паре — peer с лексикографически меньшим `socketId` (анти-glare).
- Конфиг только через `config.js`/env. Ошибки не валят приложение (`console.error`, деградация пары/устройства).

## Socket-контракт
- C→S: `room:join {roomId,name}`, `room:leave`, `chat:send {text}`, `signal:offer|answer|ice {to,...}`.
- S→C: `room:joined {selfId,members,history}`, `room:full`, `room:peer-joined`, `room:peer-left`, `chat:message`, `signal:* {from,...}`, `server:error {code,message}`.
