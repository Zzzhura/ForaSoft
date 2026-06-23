# Implementation Plan — Видеочат-комната (Video Chat Room)

| | |
|---|---|
| **Документ** | Implementation Plan (IP) |
| **Версия** | 1.0 |
| **Основан на PRD** | [`prd-video-chat-room.md`](./prd-video-chat-room.md) (v1.0) |
| **Основан на TDD** | [`design-video-chat-room.md`](./design-video-chat-room.md) (v1.0) |
| **Шаблон** | [`prd-tasks.mdc`](../../prd-tasks.mdc) |
| **feature-name** | `video-chat-room` |

> Последовательный список малых атомарных задач (каждая ≤ 1 рабочего дня, оформляется одним MR/PR).
> Трассировка: `_Requirements_` — F-коды / номера пунктов / US из PRD; `_Design_` — № разделов TDD.
> Рекомендуемый порядок: блоки 1 → 9 идут в основном последовательно; внутри блока подзадачи можно дробить на отдельные PR. Зависимости указаны явно.

---

## Блок A. Каркас проекта и инфраструктура (DevOps)

- [ ] 1. Инициализация monorepo
  - Создать структуру `server/` + `client/` (Vite/React), общий README, `.gitignore`, `.editorconfig`, ESLint/Prettier.
  - 1.1 `server/`: Node.js + `package.json`, скрипты `dev`/`start`, базовый `index.js` (http + socket.io bootstrap).
  - 1.2 `client/`: Vite + React, `package.json`, базовый `App.jsx` с роутингом Start ↔ Room.
  - 1.3 Конфиг через env: `PORT`, `STUN_URLS`, `MAX_MEMBERS=4`, `CHAT_HISTORY_CAP=200`, `MESSAGE_MAX_LEN`.
  - _Requirements: Технические ограничения (раздел 7 PRD); Design: §2, §12_

- [ ] 2. Локальный HTTPS / secure context
  - Поднять dev-сервер на `localhost` (secure context) и наладить отдачу статики SPA сервером на том же origin.
  - _Requirements: п. 34–37 PRD (HTTPS обязателен для getUserMedia); Design: §10, §12_

---

## Блок B. Сервер: комнаты, лимит, жизненный цикл

- [ ] 3. `RoomRegistry` — in-memory модель комнат (`rooms.js`)
  - Реализовать `Map<roomId, Room>` со структурами `Room/Member/Message`; методы `joinRoom/leaveRoom/getMembers/getHistory`.
  - 3.1 `joinRoom`: атомарная проверка `members.size >= 4` и вставка в одном синхронном блоке (без `await` между check и insert).
  - 3.2 `leaveRoom`: удаление участника; при падении счётчика до 0 — удалить комнату + историю чата.
  - 3.3 Создание комнаты при первом входе по новому/несуществующему `roomId`.
  - _Requirements: F-05, п. 7–9 PRD, US-5, US-10; Design: §4.1, §5_

- [ ] 4. Валидация (`validation.js`)
  - Sanitize имени (≤30 символов, фильтрация спецсимволов, экранирование) и текста сообщения (непустой, ≤ `MESSAGE_MAX_LEN`, экранирование).
  - _Requirements: п. 24, 38, 39, 40 PRD, US-1, US-8; Design: §8, §10_

- [ ] 5. Обработчик `room:join` + события состава
  - Принять `{roomId, name}`, валидировать, вызвать `RoomRegistry.joinRoom`; ответить `room:joined` (с `members` и `history`) либо `room:full`; разослать `room:peer-joined`.
  - _Requirements: F-01, F-04, F-05, п. 5,6,8 PRD, US-2, US-4, US-5; Design: §4.2, §6.1, §6.2, §7.1_
  - _Зависит от: задача 3, 4_

- [ ] 6. Обработчики `room:leave` / `disconnect`
  - Удалить участника, разослать `room:peer-left` + системное сообщение «покинул комнату»; обработать удаление пустой комнаты.
  - _Requirements: F-17, F-18, п. 28,29 PRD, US-10, US-11; Design: §6.1, §7.2_
  - _Зависит от: задача 3_

---

## Блок C. Сервер: сигналинг и чат

- [ ] 7. Relay сигналинга (`signaling.js`)
  - Пробросить `signal:offer` / `signal:answer` / `signal:ice` адресату `to`, добавив `from = socket.id`; без разбора SDP.
  - _Requirements: F-06 PRD (WebRTC), US-6; Design: §4.2, §6.1, §6.2, §7.1_
  - _Зависит от: задача 5_

- [ ] 8. Чат и системные события (`chat.js`)
  - Обработчик `chat:send` → валидация → `Message` → broadcast `chat:message` всем в комнате + запись в историю (cap `CHAT_HISTORY_CAP`).
  - 8.1 Системные сообщения join/leave как `Message{type:'system'}`.
  - 8.2 Кольцевой буфер истории (cap 200) против роста памяти.
  - _Requirements: F-12, F-13, F-14, F-15, п. 24,40 PRD, US-8, US-9; Design: §6, §8, §9_
  - _Зависит от: задача 3, 4_

---

## Блок D. Клиент: медиа и WebRTC mesh

- [ ] 9. `useLocalMedia` — локальные устройства (`webrtc/useLocalMedia.js`)
  - `getUserMedia` (audio+video), состояние `hasMic/hasCam`, обработка reject/notfound/unsupported; устройства включены по умолчанию.
  - _Requirements: F-06, п. 13,14,33 PRD, US-6, US-12; Design: §4.4, §8_

- [ ] 10. `PeerConnectionManager` — набор `RTCPeerConnection` (`webrtc/PeerConnectionManager.js`)
  - `addPeer/handleOffer/handleAnswer/handleIce/removePeer/closeAll`; ICE-конфиг с Google STUN; до 3 соединений.
  - 10.1 Детерминированное правило initiator: offer шлёт peer с лексикографически меньшим `socketId` (анти-glare).
  - 10.2 `onRemoteStream` / `onPeerLeft` колбэки для UI.
  - _Requirements: F-06, F-07, п. 7 PRD (лимит 4), US-5, US-6, US-11; Design: §3, §4.3, §7.1, §13_
  - _Зависит от: задача 9_

- [ ] 11. `useSignaling` — socket.io-client (`socket/useSignaling.js`)
  - Подключение к серверу, отправка/приём событий из §6; обработка `connect_error` (сервер недоступен).
  - _Requirements: п. 35 PRD, US-13; Design: §4.2, §6, §8_
  - _Зависит от: задача 5, 7_

- [ ] 12. Тумблеры микрофона и камеры
  - 12.1 Микрофон: `audioTrack.enabled = false/true` (передаёт тишину; без renegotiation).
  - 12.2 Камера: `track.stop()` + `removeTrack` + `replaceVideoTrack(null)` при выключении; `getUserMedia` заново + `replaceVideoTrack(newTrack)` при включении (освобождение аппаратной лампочки).
  - 12.3 Реакция на `track.onended` (потеря устройства во время звонка).
  - _Requirements: F-09, F-10, п. 16,18,19,20 PRD, US-7; Design: §4.3, §7.3_
  - _Зависит от: задача 9, 10_

---

## Блок E. Клиент: UI-экраны и компоненты

- [ ] 13. `StartScreen` — стартовый экран
  - Поле имени (валидация ≤30, без спецсимволов, запрет пустого), кнопка «Создать комнату», переход на URL с `roomId` (`nanoid(8)`).
  - _Requirements: F-01, F-02, п. 38 PRD, US-1, US-2; Design: §4.5, §5, §8_

- [ ] 14. Вход по ссылке-приглашению + копирование ссылки
  - Чтение `roomId` из URL → запрос имени → вход; кнопка «Скопировать ссылку» с подтверждением.
  - _Requirements: F-03, F-04, п. 5,6 PRD, US-3, US-4; Design: §4.5, §6_
  - _Зависит от: задача 13_

- [ ] 15. `VideoGrid` + `VideoTile` — видеосетка
  - Адаптивная CSS-сетка 1–4 плитки (2×2), self-view отдельно; оверлей имени; иконка перечёркнутого микрофона; заглушка-силуэт при отсутствии видео.
  - _Requirements: F-07, F-08, п. 16,18 PRD, US-6, US-12; Design: §4.5, §7.3_
  - _Зависит от: задача 10, 12_

- [ ] 16. `ChatPanel` + `ParticipantList`
  - Лента сообщений (имя + время HH:MM по локали клиента), ввод с запретом пустого, автоскролл вниз; экранирование; список участников в реальном времени; системные сообщения.
  - _Requirements: F-12, F-13, F-14, F-15, F-16, п. 24,39 PRD, US-8, US-9; Design: §4.5, §6, §10_
  - _Зависит от: задача 8, 11_

- [ ] 17. `Controls` + выход из комнаты
  - Панель: mic/cam toggle, «Выйти» (`room:leave`, `closeAll`); закрытие вкладки = выход.
  - _Requirements: F-17, п. 28 PRD, US-10; Design: §4.5, §7.2_
  - _Зависит от: задача 12, 14_

- [ ] 18. `RoomScreen` — оркестрация
  - Сборка media + signaling + peers + UI; реакция на `room:peer-joined/left`; жест входа для autoplay (разблокировка remote audio).
  - _Requirements: F-16, п. 37 PRD, US-6, US-9, US-13; Design: §4.5, §7.1, §8_
  - _Зависит от: задача 10, 11, 15, 16, 17_

---

## Блок F. Обработка ошибок и крайних случаев

- [ ] 19. Экраны/баннеры ошибок окружения
  - «Комната заполнена» (+ кнопка повторить), отказ в доступе к устройствам, сервер недоступен, WebRTC не поддерживается, autoplay-жест.
  - _Requirements: п. 8,33,35,36,37 PRD, US-5, US-12, US-13; Design: §8, §13_
  - _Зависит от: задача 11, 18_

- [ ] 20. Деградация без падения приложения
  - Недоступность STUN / недостижимый peer (строгий NAT) не валит комнату; несколько вкладок = отдельные слоты.
  - _Requirements: п. 34 PRD, US-11; Design: §8, §13, §14 (TBD-1)_
  - _Зависит от: задача 10_

---

## Блок G. Тестирование

- [ ] 21. Unit-тесты сервера
  - `RoomRegistry` (join/leave, атомарный лимит ≤4, удаление пустой комнаты, capping); `validation`. Цель ≥90% на критичном пути.
  - _Requirements: F-05, п. 9,24,38,39 PRD, US-5, US-10; Design: §11_
  - _Зависит от: задача 3, 4_

- [ ] 22. Unit-тесты клиента
  - `useLocalMedia` тумблеры; `PeerConnectionManager` (моки RTCPeerConnection), правило initiator.
  - _Requirements: F-06, F-09, F-10, п. 19 PRD, US-6, US-7; Design: §11_
  - _Зависит от: задача 10, 12_

- [ ] 23. Integration-тесты сокет-слоя
  - socket.io-client против тестового сервера: join→joined, full, chat relay, signaling relay, peer-left при disconnect.
  - _Requirements: F-05, F-12, F-18 PRD; Design: §6, §11_
  - _Зависит от: задача 5, 6, 7, 8_

- [ ] 24. E2E-тесты (Playwright, fake media)
  - 2–4 браузера: вход по ссылке, видимость потоков, чат real-time, mute-индикация, выход/обрыв, «комната заполнена». Сценарии на базе Gherkin из PRD.
  - _Requirements: US-1…US-13; Design: §11_
  - _Зависит от: задача 18, 19_

---

## Блок H. Деплой и документация

- [ ] 25. CI/CD + контейнеризация
  - Pipeline: lint + unit + integration на PR; build артефакта; Dockerfile (один процесс), WSS через reverse proxy.
  - _Requirements: раздел 7 PRD; Design: §12_
  - _Зависит от: задача 21, 22, 23_

- [ ] 26. README и эксплуатационная документация
  - Запуск локально (HTTPS/localhost), env-переменные, ограничения (mesh лимит 4, без reconnect/TURN), известные TBD.
  - _Requirements: раздел 5,7 PRD; Design: §12, §14_

---

## Открытые вопросы (блокеры до старта связанных задач)

Из §14 TDD — решить до/в процессе соответствующих задач:

1. **Поведение при недостижимом peer (строгий NAT)** — влияет на задачу 20. _(TDD §14, п.1)_
2. **Значения rate-limit / длины сообщения** — влияет на задачи 4, 8. _(TDD §14, п.2)_
3. **ICE restart при кратковременном сбое** — влияет на задачу 10. По умолчанию не реализуем. _(TDD §14, п.3)_
4. **Нативный `RTCPeerConnection` vs `simple-peer`** — влияет на задачу 10. Рекомендация — нативный. _(TDD §14, п.4)_
5. **`nanoid` vs `UUID` для `roomId`** — влияет на задачи 1, 13. Рекомендация — `nanoid(8)`. _(TDD §14, п.5)_
