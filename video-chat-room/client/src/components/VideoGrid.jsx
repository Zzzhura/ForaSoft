import VideoTile from './VideoTile.jsx';

/**
 * @typedef {object} Tile
 * @property {string} id - уникальный ключ плитки (socketId или 'self').
 * @property {string} name - отображаемое имя.
 * @property {MediaStream | null} [stream] - медиапоток участника.
 * @property {boolean} [isSelf] - признак собственной плитки (self-view).
 * @property {boolean} [audioEnabled] - состояние микрофона участника.
 * @property {boolean} [videoEnabled] - состояние камеры участника.
 */

/**
 * Адаптивная видеосетка на 1–4 плитки (CSS grid, 2×2 при 3–4 участниках);
 * self-view идёт отдельной плиткой с признаком `isSelf` (PRD F-07, TDD §4.5,
 * задача 15). Раскладка выбирается по числу плиток через модификатор класса.
 *
 * `onPlayBlocked`/`playToken` пробрасываются в плитки для autoplay-гейта
 * (PRD п. 37, US-13, задача 19).
 *
 * @param {{ tiles: Tile[], onPlayBlocked?: () => void, playToken?: number }} props
 * @returns {JSX.Element}
 */
export default function VideoGrid({ tiles, onPlayBlocked, playToken = 0 }) {
  // Лимит комнаты — 4 (mesh), сетка не строит больше 2×2 (PRD F-05/F-07).
  const count = Math.min(tiles.length, 4);

  return (
    <div className={`video-grid video-grid--${count}`}>
      {tiles.map((tile) => (
        <VideoTile
          key={tile.id}
          stream={tile.stream}
          name={tile.name}
          isSelf={tile.isSelf}
          audioEnabled={tile.audioEnabled}
          videoEnabled={tile.videoEnabled}
          onPlayBlocked={onPlayBlocked}
          playToken={playToken}
        />
      ))}
    </div>
  );
}
