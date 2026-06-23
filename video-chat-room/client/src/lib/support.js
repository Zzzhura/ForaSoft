/**
 * Проверка поддержки WebRTC и захвата медиа при старте приложения
 * (PRD п. 36, US-13; TDD §8 «Проверка RTCPeerConnection/getUserMedia → блок-экран»).
 *
 * Требуем одновременно `RTCPeerConnection` (peer-соединения mesh) и
 * `navigator.mediaDevices.getUserMedia` (захват камеры/микрофона). Последний
 * доступен только в secure context (HTTPS/localhost), поэтому его отсутствие на
 * незащищённом origin тоже трактуется как «не поддерживается» — без него звонок
 * невозможен, и мы показываем понятный блок-экран вместо «белого экрана».
 *
 * @returns {boolean}
 */
export function isWebRTCSupported() {
  return (
    typeof window !== 'undefined' &&
    typeof window.RTCPeerConnection === 'function' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}
