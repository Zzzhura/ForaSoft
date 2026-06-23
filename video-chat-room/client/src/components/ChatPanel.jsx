import { useEffect, useRef, useState } from 'react';

/**
 * @typedef {object} ChatMessage
 * @property {string} id - уникальный идентификатор сообщения.
 * @property {'user'|'system'} type - пользовательское или системное (PRD F-15).
 * @property {string} [name] - имя отправителя (для `type: 'user'`).
 * @property {string} text - текст сообщения (уже экранирован сервером).
 * @property {number} ts - метка времени, Unix-ms.
 */

/** Время сообщения в HH:MM по локали клиента (PRD F-13). */
const formatTime = (ts) =>
  new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

/**
 * Панель чата: лента сообщений с автоскроллом вниз + поле ввода (PRD F-12/F-13/
 * F-14, US-8). Пустые/пробельные сообщения не отправляются (PRD п. 24). Текст
 * рендерится React'ом как текст, без `dangerouslySetInnerHTML` — защита от XSS
 * (PRD п. 39, TDD §10); сервер экранирует дополнительно (defense-in-depth).
 *
 * @param {{ messages: ChatMessage[], onSend: (text: string) => void }} props
 * @returns {JSX.Element}
 */
export default function ChatPanel({ messages, onSend }) {
  const [text, setText] = useState('');
  const bottomRef = useRef(null);

  // Автоскролл к последнему сообщению при изменении ленты (PRD F-14, US-8).
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const handleSubmit = (event) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return;
    }
    onSend(trimmed);
    setText('');
  };

  return (
    <section className="chat">
      <div className="chat__list">
        {messages.map((message) =>
          message.type === 'system' ? (
            <p key={message.id} className="chat__system">
              {message.text}
            </p>
          ) : (
            <div key={message.id} className="chat__message">
              <div className="chat__meta">
                <span className="chat__author">{message.name}</span>
                <span className="chat__time">{formatTime(message.ts)}</span>
              </div>
              <p className="chat__text">{message.text}</p>
            </div>
          ),
        )}
        <div ref={bottomRef} />
      </div>

      <form className="chat__form" onSubmit={handleSubmit}>
        <input
          className="field"
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Написать сообщение…"
          autoComplete="off"
        />
        <button className="btn btn--primary" type="submit" disabled={text.trim().length === 0}>
          Отправить
        </button>
      </form>
    </section>
  );
}
