import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import EntryScreen from '../components/EntryScreen.jsx';
import VideoGrid from '../components/VideoGrid.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
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
  // Название комнаты от создателя (router state). У входящих по ссылке его нет —
  // тогда название придёт с сервера в `room:joined` (источник истины).
  const initialRoomTitle = location.state?.roomTitle ?? '';

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

  return <RoomCall roomId={roomId} name={name} initialRoomTitle={initialRoomTitle} />;
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
 * @param {{ roomId: string, name: string, initialRoomTitle?: string }} props
 * @returns {JSX.Element}
 */
function RoomCall({ roomId, name, initialRoomTitle = '' }) {
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
  /** @type {[Record<string, {audioEnabled:boolean,videoEnabled:boolean}>, Function]} Состояние медиа удалённых по socketId (US-7/US-12). */
  const [remoteMediaState, setRemoteMediaState] = useState({});
  /** @type {[Record<string, RTCPeerConnectionState>, Function]} Состояние P2P по socketId (задача 20). */
  const [peerStates, setPeerStates] = useState({});
  const [messages, setMessages] = useState([]);
  const [roomFull, setRoomFull] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  // Название комнаты: оптимистично от создателя (router state), затем уточняется
  // сервером в room:joined (источник истины). Пусто → показываем id комнаты.
  const [roomTitle, setRoomTitle] = useState(initialRoomTitle);
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
    onJoined: ({ selfId: id, members, history, title }) => {
      setSelfId(id);
      setRemoteMembers(members);
      // Текущее состояние микрофона/камеры уже присутствующих участников (источник
      // истины — сервер), чтобы сразу показать их индикаторы/заглушку (US-7/US-12).
      setRemoteMediaState(
        Object.fromEntries(
          members.map((m) => [
            m.socketId,
            { audioEnabled: m.audioEnabled ?? true, videoEnabled: m.videoEnabled ?? true },
          ]),
        ),
      );
      setMessages(history);
      // Название комнаты от сервера (создателя); пустое не затираем — UI покажет id.
      if (title) setRoomTitle(title);
      // PCM создаём в момент входа: selfId известен, локальные дорожки захвачены
      // (join гейтится по `ready`), поэтому они попадают в каждое соединение.
      const pcm = new PeerConnectionManager({
        selfId: id,
        localStream: localStreamRef.current,
        sendSignal,
        onRemoteStream: (sid, stream) => setRemoteStreams((prev) => ({ ...prev, [sid]: stream })),
        onPeerLeft: (sid) => {
          setRemoteStreams((prev) => {
            const next = { ...prev };
            delete next[sid];
            return next;
          });
          setPeerStates((prev) => {
            if (!(sid in prev)) return prev;
            const next = { ...prev };
            delete next[sid];
            return next;
          });
          setRemoteMediaState((prev) => {
            if (!(sid in prev)) return prev;
            const next = { ...prev };
            delete next[sid];
            return next;
          });
        },
        // Состояние пары → индикатор «соединение не установлено» при сбое ICE
        // (строгий NAT / STUN недоступен), участника не удаляем (задача 20).
        onPeerState: (sid, state) =>
          setPeerStates((prev) => (prev[sid] === state ? prev : { ...prev, [sid]: state })),
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
    // Удалённый участник сменил микрофон/камеру → обновляем его индикаторы/заглушку
    // (US-7/US-12). До прихода события считаем устройства включёнными (PRD п. 13).
    onMediaState: ({ from, audioEnabled: a, videoEnabled: v }) =>
      setRemoteMediaState((prev) => ({ ...prev, [from]: { audioEnabled: a, videoEnabled: v } })),
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
      // Название шлёт только создатель (есть в router state); сервер игнорирует
      // его для уже существующей комнаты — название остаётся за создателем.
      signalingRef.current.joinRoom(roomId, name, initialRoomTitle);
    }
  }, [connected, ready, roomId, name, initialRoomTitle]);

  // Транслируем своё состояние медиа остальным: первый раз — после входа (когда
  // известен selfId), затем при каждом переключении микрофона/камеры. У остальных
  // обновляются индикатор mute (US-7) и заглушка-силуэт (US-12). Поздние участники
  // получают актуальные флаги из room:joined (сервер хранит их в реестре).
  useEffect(() => {
    if (selfId) signalingRef.current?.sendMediaState(audioEnabled, videoEnabled);
  }, [selfId, audioEnabled, videoEnabled]);

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

  // Терминальные экраны (ошибка сервера / комната заполнена): звонок невозможен —
  // закрываем mesh и физически освобождаем камеру/микрофон, чтобы на экране-заглушке
  // не горел индикатор камеры. Иначе устройства остаются захваченными вплоть до
  // размонтирования. Зависим и от `localStream`: если устройства захватились уже
  // после ошибки, освобождаем их сразу. При следующем заходе getUserMedia
  // запросит доступ заново (нативный prompt на каждом входе).
  useEffect(() => {
    if (!serverError && !roomFull) return;
    pcmRef.current?.closeAll();
    pcmRef.current = null;
    localStream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
  }, [serverError, roomFull, localStream]);

  const handleLeave = () => {
    pcmRef.current?.closeAll();
    pcmRef.current = null;
    signalingRef.current?.leaveRoom();
    navigate('/');
  };

  // Копирование ссылки-приглашения (PRD F-03, US-3): URL комнаты = текущий адрес.
  // Clipboard API доступен в secure context (HTTPS/localhost), который и так
  // обязателен для getUserMedia; при отказе/недоступности — предупреждающий тост.
  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast({ type: 'success', text: 'Ссылка-приглашение скопирована' });
    } catch {
      showToast({ type: 'warning', text: 'Не удалось скопировать ссылку' });
    }
  }, [showToast]);

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
  // микрофона/камеры удалённых приходит по media:state (US-7/US-12); до первого
  // события считаем устройства включёнными (PRD п. 13). Силуэт показываем, когда
  // камера выключена ИЛИ поток ещё не пришёл.
  const tiles = [
    {
      id: selfId ?? 'self',
      name,
      stream: localStream,
      isSelf: true,
      audioEnabled,
      videoEnabled,
    },
    ...remoteMembers.map((member) => {
      const media = remoteMediaState[member.socketId];
      const stream = remoteStreams[member.socketId] ?? null;
      return {
        id: member.socketId,
        name: member.name,
        stream,
        isSelf: false,
        audioEnabled: media?.audioEnabled ?? true,
        videoEnabled: (media?.videoEnabled ?? true) && Boolean(stream),
        // 'failed' → ICE-сбой пары (строгий NAT / STUN недоступен): показываем
        // индикатор, но участника оставляем (задача 20, TDD §14 TBD-1).
        connectionFailed: peerStates[member.socketId] === 'failed',
      };
    }),
  ];

  return (
    <div className={`room${chatOpen ? '' : ' room--no-chat'}`}>
      {/* Левая колонка: контент (с отступами) + нижняя панель на всю ширину.
          Переключение чата меняет ширину этой колонки, но панель всегда снизу. */}
      <div className="room__main">
        {/* Контент с внутренними отступами; панель кнопок ниже идёт без них. */}
        <div className="room__content">
          {/* Брендинг сверху: «Разработано» + лого Fora Soft (как в футере старт-экрана). */}
          <header className="room__topbar">
            <span className="room__topbar-label">Разработано</span>
            <a
              className="room__topbar-link"
              href="https://www.forasoft.com/"
              target="_blank"
              rel="noreferrer"
            >
              <img className="room__topbar-logo" src="/forasoft-logo-full.svg" alt="Fora Soft" />
            </a>
          </header>

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
          {/* Мета-строка над панелью: слева — название комнаты, справа — число участников. */}
          <div className="room__meta">
            <span className="room__meta-name" title={roomTitle || roomId}>
              {roomTitle || roomId}
            </span>
            <span className="room__meta-count">Участников: {1 + remoteMembers.length}</span>
          </div>
        </div>
        {/* Панель управления — на всю ширину левой колонки, вплотную к левому краю чата. */}
        <Controls
          audioEnabled={audioEnabled}
          videoEnabled={videoEnabled}
          hasMic={hasMic}
          hasCam={hasCam}
          chatOpen={chatOpen}
          onToggleAudio={toggleAudio}
          onToggleVideo={toggleVideo}
          onToggleChat={() => setChatOpen((open) => !open)}
          onCopyLink={handleCopyLink}
          onLeave={handleLeave}
        />
      </div>
      {/* Чат — прямоугольник во всю высоту справа (референс). */}
      {chatOpen && (
        <aside className="room__side">
          <ChatPanel
            messages={messages}
            onSend={signaling.sendChat}
            onClose={() => setChatOpen(false)}
          />
        </aside>
      )}
    </div>
  );
}
