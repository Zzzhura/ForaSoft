import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import EntryScreen from '../components/EntryScreen.jsx';
import VideoGrid from '../components/VideoGrid.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import ParticipantList from '../components/ParticipantList.jsx';
import Controls from '../components/Controls.jsx';
import NoticeScreen from '../components/NoticeScreen.jsx';
import { useToast } from '../components/Toast.jsx';
import { useLocalMedia } from '../webrtc/useLocalMedia.js';
import { useSignaling } from '../socket/useSignaling.js';
import { PeerConnectionManager } from '../webrtc/PeerConnectionManager.js';

/**
 * Экран комнаты. Имя приходит из `StartScreen` через router state; при прямом
 * открытии ссылки state пуст — спрашиваем имя (PRD F-04, US-4). Перезагрузка
 * теряет state → повторный ввод имени = «новый вход» (PRD п. 28).
 *
 * Гейт имени держится отдельно от оркестрации, чтобы хуки звонка (`RoomCall`)
 * вызывались безусловно (правила хуков).
 *
 * @returns {JSX.Element}
 */
export default function RoomScreen() {
  const { roomId } = useParams();
  const location = useLocation();
  const [name, setName] = useState(location.state?.name ?? null);

  if (!name) {
    return (
      <EntryScreen
        title="Видеочат-комната"
        byline="от Fora Soft"
        caption="Введите имя, чтобы присоединиться к звонку."
        placeholder="Введите ваше имя"
        submitLabel="Войти"
        onSubmit={setName}
      />
    );
  }

  return <RoomCall roomId={roomId} name={name} />;
}

/**
 * Оркестрация звонка (задача 18, TDD §4.5/§7.1): собирает локальное медиа,
 * сигналинг и mesh из `PeerConnectionManager`, реагирует на состав комнаты
 * (`room:peer-joined/left`) и рендерит сетку + чат + участников + контролы.
 *
 * Жест входа (клик «Создать комнату»/«Войти») обычно снимает autoplay-блокировку,
 * так что удалённое аудио/видео воспроизводится (PRD п. 37, US-13). Если браузер
 * всё же блокирует автозапуск, плитки сообщают об этом и показывается баннер
 * «Включить звук» (задача 19). Экраны ошибок окружения — `NoticeScreen`.
 *
 * @param {{ roomId: string, name: string }} props
 * @returns {JSX.Element}
 */
function RoomCall({ roomId, name }) {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const pcmRef = useRef(null);
  const joinedRef = useRef(false);
  const signalingRef = useRef(null);
  const localStreamRef = useRef(null);
  const mediaToastRef = useRef(false);

  const [selfId, setSelfId] = useState(null);
  /** @type {[Array<{socketId:string,name:string}>, Function]} */
  const [remoteMembers, setRemoteMembers] = useState([]);
  /** @type {[Record<string, MediaStream>, Function]} */
  const [remoteStreams, setRemoteStreams] = useState({});
  const [messages, setMessages] = useState([]);
  const [roomFull, setRoomFull] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  // Autoplay-гейт (PRD п. 37, US-13): если браузер заблокировал воспроизведение
  // удалённого видео/аудио без жеста, показываем баннер «Включить звук».
  // `playToken` инкрементится по клику и заставляет плитки повторить play() уже
  // внутри пользовательского жеста — после чего звук воспроизводится.
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [playToken, setPlayToken] = useState(0);

  // Стабильный проброс сигналинга в PCM: читаем актуальный сокет из ref, чтобы
  // не пересоздавать менеджер и не ловить stale-closure.
  const sendSignal = useCallback(
    (type, to, payload) => signalingRef.current?.sendSignal(type, to, payload),
    [],
  );

  const {
    localStream,
    audioEnabled,
    videoEnabled,
    hasMic,
    hasCam,
    ready,
    error: mediaError,
    toggleAudio,
    toggleVideo,
  } = useLocalMedia({
    // Тумблер камеры (задача 12) меняет локальную дорожку → пробрасываем в mesh.
    onVideoTrackChanged: (track) => pcmRef.current?.replaceVideoTrack(track),
  });
  localStreamRef.current = localStream;

  // Отказ в доступе к камере/микрофону — тост, входим без устройств (PRD п. 33,
  // US-12), приложение не «вылетает». Показываем один раз.
  useEffect(() => {
    if (mediaError === 'denied' && !mediaToastRef.current) {
      mediaToastRef.current = true;
      showToast({
        type: 'warning',
        text: 'Доступ к камере и микрофону отклонён. Вы можете войти без них.',
      });
    }
  }, [mediaError, showToast]);

  const signaling = useSignaling({
    onJoined: ({ selfId: id, members, history }) => {
      setSelfId(id);
      setRemoteMembers(members);
      setMessages(history);
      // PCM создаём в момент входа: selfId известен, локальные дорожки захвачены
      // (join гейтится по `ready`), поэтому они попадают в каждое соединение.
      const pcm = new PeerConnectionManager({
        selfId: id,
        localStream: localStreamRef.current,
        sendSignal,
        onRemoteStream: (sid, stream) => setRemoteStreams((prev) => ({ ...prev, [sid]: stream })),
        onPeerLeft: (sid) =>
          setRemoteStreams((prev) => {
            const next = { ...prev };
            delete next[sid];
            return next;
          }),
      });
      pcmRef.current = pcm;
      // Для каждого уже присутствующего участника поднимаем соединение; роль
      // initiator определяется детерминированно внутри PCM (анти-glare, §7.1).
      members.forEach((member) => pcm.addPeer(member.socketId));
    },
    onRoomFull: () => setRoomFull(true),
    onPeerJoined: ({ socketId, name: peerName }) => {
      setRemoteMembers((prev) =>
        prev.some((m) => m.socketId === socketId) ? prev : [...prev, { socketId, name: peerName }],
      );
      pcmRef.current?.addPeer(socketId);
    },
    onPeerLeft: ({ socketId }) => {
      // removePeer → onPeerLeft колбэк уберёт поток; снимаем участника из состава.
      pcmRef.current?.removePeer(socketId);
      setRemoteMembers((prev) => prev.filter((m) => m.socketId !== socketId));
    },
    onChatMessage: (message) => setMessages((prev) => [...prev, message]),
    onSignalOffer: ({ from, sdp }) => pcmRef.current?.handleOffer(from, sdp),
    onSignalAnswer: ({ from, sdp }) => pcmRef.current?.handleAnswer(from, sdp),
    onSignalIce: ({ from, candidate }) => pcmRef.current?.handleIce(from, candidate),
    onServerError: ({ code, message }) => console.error(`[room] server:error ${code}: ${message}`),
  });
  signalingRef.current = signaling;

  const { connected, serverError } = signaling;

  // Входим в комнату один раз — когда есть связь и попытка захвата медиа
  // завершена (даже при отказе в устройствах входим без них, US-12).
  useEffect(() => {
    if (connected && ready && !joinedRef.current) {
      joinedRef.current = true;
      signalingRef.current.joinRoom(roomId, name);
    }
  }, [connected, ready, roomId, name]);

  // Размонтирование (выход/закрытие вкладки) — закрываем mesh и выходим из комнаты.
  useEffect(
    () => () => {
      pcmRef.current?.closeAll();
      pcmRef.current = null;
      signalingRef.current?.leaveRoom();
      joinedRef.current = false;
    },
    [],
  );

  const handleLeave = () => {
    pcmRef.current?.closeAll();
    pcmRef.current = null;
    signalingRef.current?.leaveRoom();
    navigate('/');
  };

  // Плитка сообщила, что автозапуск заблокирован — поднимаем баннер-жест.
  const handlePlayBlocked = useCallback(() => setAudioBlocked(true), []);

  // Клик по баннеру — пользовательский жест: убираем баннер и просим плитки
  // повторить play() (через смену playToken), теперь воспроизведение разрешено.
  const handleEnableAudio = () => {
    setAudioBlocked(false);
    setPlayToken((token) => token + 1);
  };

  if (serverError) {
    return (
      <NoticeScreen
        title="Ошибка сервера"
        text="Не удалось подключиться к серверу. Проверьте соединение и попробуйте снова."
        actionLabel="На главную"
        onAction={() => navigate('/')}
      />
    );
  }

  if (roomFull) {
    return (
      <NoticeScreen
        title="Комната заполнена"
        text="В комнате уже 4 участника — это максимум."
        actionLabel="Повторить вход"
        onAction={() => window.location.reload()}
      />
    );
  }

  // self-view — первой плиткой (PRD F-07); удалённые участники следом. Состояние
  // микрофона/камеры удалённых не передаётся текущим socket-контрактом, поэтому
  // считаем их активными; силуэт показываем, пока поток ещё не пришёл.
  const tiles = [
    {
      id: selfId ?? 'self',
      name,
      stream: localStream,
      isSelf: true,
      audioEnabled,
      videoEnabled,
    },
    ...remoteMembers.map((member) => ({
      id: member.socketId,
      name: member.name,
      stream: remoteStreams[member.socketId] ?? null,
      isSelf: false,
      audioEnabled: true,
      videoEnabled: Boolean(remoteStreams[member.socketId]),
    })),
  ];

  const participants = [{ socketId: selfId ?? 'self', name }, ...remoteMembers];

  return (
    <div className="room">
      {/* Верхний блок: сцена + чат. Переключение чата меняет только этот блок и
          не затрагивает нижнюю панель управления. */}
      <div className={`room__body${chatOpen ? '' : ' room__body--full'}`}>
        <main className="room__stage">
          {audioBlocked && (
            <button className="audio-gate" type="button" onClick={handleEnableAudio}>
              <span className="audio-gate__icon" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
                  <path d="M16 9a5 5 0 0 1 0 6" />
                  <path d="M19.364 18.364a9 9 0 0 0 0-12.728" />
                </svg>
              </span>
              Включить звук
            </button>
          )}
          <VideoGrid tiles={tiles} onPlayBlocked={handlePlayBlocked} playToken={playToken} />
        </main>
        {chatOpen && (
          <aside className="room__side">
            <ParticipantList members={participants} selfId={selfId ?? 'self'} />
            <ChatPanel messages={messages} onSend={signaling.sendChat} />
          </aside>
        )}
      </div>
      {/* Нижняя панель управления — всегда видима, во всю ширину, вне потока сцены/чата. */}
      <Controls
        audioEnabled={audioEnabled}
        videoEnabled={videoEnabled}
        hasMic={hasMic}
        hasCam={hasCam}
        chatOpen={chatOpen}
        onToggleAudio={toggleAudio}
        onToggleVideo={toggleVideo}
        onToggleChat={() => setChatOpen((open) => !open)}
        onLeave={handleLeave}
      />
    </div>
  );
}
