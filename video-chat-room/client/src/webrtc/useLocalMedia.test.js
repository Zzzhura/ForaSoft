// @vitest-environment jsdom
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useLocalMedia } from './useLocalMedia.js';

/**
 * Unit-тесты хука `useLocalMedia` (задача 22, TDD §4.4/§7.3/§11; PRD F-06/F-09/F-10,
 * п. 13/14/19/33, US-6/US-7/US-12). `getUserMedia`/`MediaStream` подменяются —
 * проверяем устройства по умолчанию, тумблеры микрофона/камеры и обработку отказов.
 */

/** Мок медиадорожки. */
function makeTrack(kind) {
  return { kind, enabled: true, readyState: 'live', stop: vi.fn(), onended: null };
}

/** Мок `MediaStream` (хук создаёт `new MediaStream()` в резервном захвате). */
class MockMediaStream {
  constructor(tracks = []) {
    this._tracks = [...tracks];
  }
  getTracks() {
    return [...this._tracks];
  }
  getAudioTracks() {
    return this._tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks() {
    return this._tracks.filter((t) => t.kind === 'video');
  }
  addTrack(t) {
    this._tracks.push(t);
  }
  removeTrack(t) {
    const i = this._tracks.indexOf(t);
    if (i >= 0) this._tracks.splice(i, 1);
  }
}

/** Поток с заданными дорожками. */
const streamWith = (tracks) => new MockMediaStream(tracks);

/** Ошибка getUserMedia с заданным `name` (как у DOMException). */
const mediaError = (name) => Object.assign(new Error(name), { name });

/** Назначает (или убирает) `navigator.mediaDevices.getUserMedia`. */
function setGetUserMedia(getUserMedia) {
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    value: getUserMedia ? { getUserMedia } : undefined,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  globalThis.MediaStream = MockMediaStream;
});

afterEach(() => {
  setGetUserMedia(undefined);
  delete globalThis.MediaStream;
});

describe('захват по умолчанию', () => {
  test('микрофон и камера ВЫКЛЮЧЕНЫ по умолчанию, но устройства доступны', async () => {
    const audioTrack = makeTrack('audio');
    const videoTrack = makeTrack('video');
    setGetUserMedia(vi.fn().mockResolvedValue(streamWith([audioTrack, videoTrack])));

    const { result } = renderHook(() => useLocalMedia());
    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(result.current.error).toBeNull();
    // Устройства физически есть → тумблеры активны.
    expect(result.current.hasMic).toBe(true);
    expect(result.current.hasCam).toBe(true);
    // Но по умолчанию выключены у каждого нового участника.
    expect(result.current.audioEnabled).toBe(false);
    expect(result.current.videoEnabled).toBe(false);
    // Микрофон заглушён (дорожку держим), камера освобождена (stop + removeTrack).
    expect(audioTrack.enabled).toBe(false);
    expect(audioTrack.stop).not.toHaveBeenCalled();
    expect(videoTrack.stop).toHaveBeenCalled();
    expect(result.current.localStream.getVideoTracks()).toHaveLength(0);
  });
});

describe('тумблер микрофона (12.1, п. 16, US-7)', () => {
  test('переключает enabled аудиодорожки и НЕ останавливает её', async () => {
    setGetUserMedia(
      vi.fn().mockResolvedValue(streamWith([makeTrack('audio'), makeTrack('video')])),
    );

    const { result } = renderHook(() => useLocalMedia());
    await waitFor(() => expect(result.current.ready).toBe(true));

    const audioTrack = result.current.localStream.getAudioTracks()[0];

    // Стартуем с выключенного микрофона → первый тумблер включает.
    act(() => result.current.toggleAudio());
    expect(result.current.audioEnabled).toBe(true);
    expect(audioTrack.enabled).toBe(true);
    expect(audioTrack.stop).not.toHaveBeenCalled();

    act(() => result.current.toggleAudio());
    expect(result.current.audioEnabled).toBe(false);
    expect(audioTrack.enabled).toBe(false);
  });
});

describe('тумблер камеры (12.2, п. 19, US-7)', () => {
  test('включение захватывает дорожку и отдаёт её в mesh', async () => {
    const freshVideo = makeTrack('video');
    const getUserMedia = vi.fn(async (constraints) => {
      if (constraints.audio && constraints.video) {
        return streamWith([makeTrack('audio'), makeTrack('video')]);
      }
      if (constraints.video) return streamWith([freshVideo]);
      return streamWith([]);
    });
    setGetUserMedia(getUserMedia);
    const onVideoTrackChanged = vi.fn();

    const { result } = renderHook(() => useLocalMedia({ onVideoTrackChanged }));
    await waitFor(() => expect(result.current.ready).toBe(true));

    // Камера выключена по умолчанию → тумблер включает (захват заново).
    await act(async () => {
      await result.current.toggleVideo();
    });

    expect(result.current.videoEnabled).toBe(true);
    expect(result.current.hasCam).toBe(true);
    expect(onVideoTrackChanged).toHaveBeenLastCalledWith(freshVideo);
    expect(result.current.localStream.getVideoTracks()).toHaveLength(1);
  });

  test('выключение останавливает дорожку и снимает её с mesh', async () => {
    const freshVideo = makeTrack('video');
    const getUserMedia = vi.fn(async (constraints) => {
      if (constraints.audio && constraints.video) {
        return streamWith([makeTrack('audio'), makeTrack('video')]);
      }
      if (constraints.video) return streamWith([freshVideo]);
      return streamWith([]);
    });
    setGetUserMedia(getUserMedia);
    const onVideoTrackChanged = vi.fn();

    const { result } = renderHook(() => useLocalMedia({ onVideoTrackChanged }));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.toggleVideo(); // включаем
    });
    await act(async () => {
      await result.current.toggleVideo(); // выключаем
    });

    expect(freshVideo.stop).toHaveBeenCalled();
    expect(result.current.videoEnabled).toBe(false);
    expect(onVideoTrackChanged).toHaveBeenLastCalledWith(null);
    expect(result.current.localStream.getVideoTracks()).toHaveLength(0);
  });
});

describe('обработка отказов (US-12)', () => {
  test('отказ в доступе → error=denied, вход без устройств', async () => {
    setGetUserMedia(vi.fn().mockRejectedValue(mediaError('NotAllowedError')));

    const { result } = renderHook(() => useLocalMedia());
    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(result.current.error).toBe('denied');
    expect(result.current.localStream).toBeNull();
    expect(result.current.hasMic).toBe(false);
    expect(result.current.hasCam).toBe(false);
  });

  test('нет поддержки getUserMedia → error=unsupported', async () => {
    setGetUserMedia(undefined);

    const { result } = renderHook(() => useLocalMedia());
    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(result.current.error).toBe('unsupported');
  });

  test('нет камеры → захват только аудио (резервный по отдельности)', async () => {
    const getUserMedia = vi.fn(async (constraints) => {
      if (constraints.audio && constraints.video) throw mediaError('NotFoundError');
      if (constraints.audio) return streamWith([makeTrack('audio')]);
      throw mediaError('NotFoundError');
    });
    setGetUserMedia(getUserMedia);

    const { result } = renderHook(() => useLocalMedia());
    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(result.current.hasMic).toBe(true);
    expect(result.current.hasCam).toBe(false);
    // Микрофон по умолчанию выключен (включает пользователь тумблером).
    expect(result.current.audioEnabled).toBe(false);
    expect(result.current.videoEnabled).toBe(false);
  });
});
