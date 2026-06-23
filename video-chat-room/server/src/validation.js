import { config } from './config.js';

/** Максимальная длина отображаемого имени в видимых символах (PRD п. 38). */
export const NAME_MAX_LEN = 30;

/**
 * @typedef {{ ok: true, value: string }} ValidationOk
 * @typedef {{ ok: false, code: string, message: string }} ValidationError
 * @typedef {ValidationOk | ValidationError} ValidationResult
 */

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
  '`': '&#x60;',
};

/**
 * Экранирует HTML-чувствительные символы (защита от XSS, PRD п. 39, TDD §10).
 * Это defense-in-depth поверх экранирования React при рендере.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  return str.replace(/[&<>"'/`]/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * Удаляет управляющие символы C0 (U+0000–U+001F) и DEL (U+007F), оставляя
 * печатаемый текст. Фильтр по кодовым точкам, без regex с control-байтами.
 * @param {string} str
 * @returns {string}
 */
const stripControlChars = (str) =>
  [...str]
    .filter((ch) => {
      const code = ch.codePointAt(0);
      return code > 0x1f && code !== 0x7f;
    })
    .join('');

/** Обрезает строку до `max` видимых символов (по кодовым точкам, корректно для emoji). */
const truncateByCodePoints = (str, max) => {
  const points = [...str];
  return points.length > max ? points.slice(0, max).join('') : str;
};

/**
 * Валидирует и санитизирует отображаемое имя (PRD п. 38/39, US-1).
 * Поведение: trim → удаление управляющих символов → обрезка до 30 видимых
 * символов → HTML-экранирование. Имя «не принимается в таком виде», но не
 * отвергается целиком; отказ только если после очистки строка пустая.
 *
 * @param {unknown} raw
 * @returns {ValidationResult} value — безопасное для вывода имя.
 */
export function validateName(raw) {
  const cleaned = stripControlChars(String(raw ?? '').trim());
  if (cleaned.length === 0) {
    return { ok: false, code: 'INVALID_NAME', message: 'Имя не может быть пустым' };
  }
  // Обрезаем по видимым символам ДО экранирования, чтобы лимит был «человеческим»
  // (иначе & → &amp; искусственно раздувает длину).
  const truncated = truncateByCodePoints(cleaned, NAME_MAX_LEN);
  return { ok: true, value: escapeHtml(truncated) };
}

/**
 * Валидирует и санитизирует текст сообщения чата (PRD п. 24/39/40, US-8).
 * Пустое/пробельное — отказ (п. 24); длиннее лимита — отказ (п. 40);
 * иначе HTML-экранирование (п. 39).
 *
 * @param {unknown} raw
 * @param {{ maxLen?: number }} [options]
 * @returns {ValidationResult} value — безопасный для вывода текст.
 */
export function validateMessage(raw, { maxLen = config.messageMaxLen } = {}) {
  const cleaned = stripControlChars(String(raw ?? '').trim());
  if (cleaned.length === 0) {
    return { ok: false, code: 'EMPTY_MESSAGE', message: 'Пустое сообщение не отправляется' };
  }
  if ([...cleaned].length > maxLen) {
    return {
      ok: false,
      code: 'MESSAGE_TOO_LONG',
      message: `Сообщение длиннее ${maxLen} символов`,
    };
  }
  return { ok: true, value: escapeHtml(cleaned) };
}
