/**
 * Клиентская валидация/санитизация отображаемого имени (PRD п. 38, US-1).
 * Зеркалит серверный `validation.js` как первая линия UX: сервер остаётся
 * источником истины и экранирует повторно (defense-in-depth, TDD §8/§10).
 */

/** Максимальная длина имени в видимых символах (PRD п. 38). */
export const NAME_MAX_LEN = 30;

/** HTML-чувствительные и прочие спецсимволы, запрещённые в имени (PRD п. 38). */
const FORBIDDEN_NAME_CHARS = /[<>&"'/`\\]/g;

/** Обрезает строку до `max` видимых символов (по кодовым точкам, корректно для emoji). */
const truncateByCodePoints = (str, max) => {
  const points = [...str];
  return points.length > max ? points.slice(0, max).join('') : str;
};

/**
 * Очищает «сырой» ввод имени для подстановки обратно в поле: убирает
 * управляющие символы и спецсимволы, обрезает до 30 видимых символов.
 * Не делает trim по краям, чтобы пользователь мог печатать пробелы внутри.
 *
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeNameInput(raw) {
  const withoutControl = [...String(raw ?? '')]
    .filter((ch) => {
      const code = ch.codePointAt(0);
      return code > 0x1f && code !== 0x7f;
    })
    .join('');
  const withoutSpecials = withoutControl.replace(FORBIDDEN_NAME_CHARS, '');
  return truncateByCodePoints(withoutSpecials, NAME_MAX_LEN);
}

/**
 * Готовое к отправке имя: санитизация + trim по краям.
 * Пустой результат означает, что имя невалидно (PRD US-1 «пустое имя»).
 *
 * @param {string} raw
 * @returns {string} нормализованное имя или '' если ввод пуст после очистки.
 */
export function normalizeName(raw) {
  return sanitizeNameInput(raw).trim();
}
