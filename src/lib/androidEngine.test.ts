import { beforeEach, describe, expect, it, vi } from 'vitest';
const snapshot = (id: string | null) => ({ playing: false, buffering: false, positionMs: 0, durationMs: 0, index: 0, id, speed: 1, repeat: 'off', shuffle: false });
const mocks = vi.hoisted(() => ({
  resolveStream: vi.fn(), playerSetQueue: vi.fn(async (_items: { id: string }[], _index: number, _position: number) => {}), playerPlay: vi.fn(async () => {}),
  playerPause: vi.fn(async () => {}), playerSetUrl: vi.fn(async () => {}), localLibraryTrackPath: vi.fn(async () => 'content://song'),
  playerGetState: vi.fn(async () => snapshot(null)),
  toast: vi.fn(),
  listenPlayerEvent: vi.fn(async (_event: string, _handler: (payload: unknown) => void) => () => {}),
  player: { next: vi.fn(), prevTrack: vi.fn(), queue: [{ id: 'song', title: 'Song', artist: 'Artist' }], index: 0 },
  library: { liked: [] as { id: string }[], toggleLike: vi.fn() },
}));
vi.mock('./bridge', () => ({ ...mocks }));
vi.mock('./resolveStream', () => ({ resolveStream: mocks.resolveStream, MEDIA_USER_AGENT: 'test' }));
vi.mock('../stores/ui', () => ({ useUI: { getState: () => ({ toast: mocks.toast }) } }));
vi.mock('../stores/player', () => ({
  usePlayer: { getState: () => mocks.player },
  currentTrack: (state: { queue: unknown[]; index: number }) => state.queue[state.index] ?? null,
}));
vi.mock('../stores/library', () => ({ useLibrary: { getState: () => mocks.library } }));
vi.mock('../stores/settings', () => ({ useSettings: { getState: () => ({ dataSaver: false }) } }));
import { androidPlay, androidPlayStream, androidPause, startAndroidEngine } from './androidEngine';
beforeEach(() => { vi.clearAllMocks(); mocks.resolveStream.mockResolvedValue({ url: 'https://media/song' }); mocks.library.liked = []; });
async function sendPlayerAction(action: string) {
  startAndroidEngine(vi.fn());
  const handler = mocks.listenPlayerEvent.mock.calls.find(([event]) => event === 'player-action')![1] as (payload: { action: string }) => void;
  handler({ action });
  await new Promise(done => setTimeout(done, 0));
}
describe('Android playback requests', () => {
  it('preserves the requested resume position', async () => {
    await androidPlayStream('song', 'Song', 42);
    expect(mocks.playerSetQueue).toHaveBeenCalledWith(expect.any(Array), 0, 42000);
  });
  it('prevents an older resolution from replacing the selected song', async () => {
    let resolve!: (value: { url: string }) => void;
    mocks.resolveStream.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const first = androidPlayStream('first', 'First');
    await androidPlayStream('second', 'Second');
    resolve({ url: 'https://media/first' });
    await first;
    expect(mocks.playerSetQueue).toHaveBeenCalledTimes(1);
    expect(mocks.playerSetQueue.mock.calls[0][0][0].id).toBe('second');
  });
  it('does not auto-start after pausing during resolution', async () => {
    let resolve!: (value: { url: string }) => void;
    mocks.resolveStream.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = androidPlayStream('song', 'Song');
    androidPause(); resolve({ url: 'https://media/song' });
    await pending;
    expect(mocks.playerPlay).not.toHaveBeenCalled();
  });
  it('re-queues the current stream when the service restarted with an empty queue', async () => {
    await androidPlayStream('song', 'Song');
    vi.clearAllMocks();
    mocks.resolveStream.mockResolvedValue({ url: 'https://media/song' });
    await androidPlay();
    expect(mocks.playerSetQueue).toHaveBeenCalledWith([expect.objectContaining({ id: 'song', url: 'https://media/song' })], 0, 0);
    expect(mocks.playerPlay).toHaveBeenCalledTimes(1);
  });
  it('resumes from the saved position when the native player has none', async () => {
    await androidPlayStream('song', 'Song');
    vi.clearAllMocks();
    mocks.resolveStream.mockResolvedValue({ url: 'https://media/song' });
    Object.assign(mocks.player, { position: 55 });
    await androidPlay();
    Object.assign(mocks.player, { position: undefined });
    expect(mocks.playerSetQueue).toHaveBeenCalledWith(expect.any(Array), 0, 55000);
  });
  it('plays without re-queuing when the native queue still holds the current track', async () => {
    await androidPlayStream('song', 'Song');
    vi.clearAllMocks();
    mocks.playerGetState.mockResolvedValueOnce(snapshot('song'));
    await androidPlay();
    expect(mocks.playerSetQueue).not.toHaveBeenCalled();
    expect(mocks.playerPlay).toHaveBeenCalledTimes(1);
  });
  it('shows an error toast instead of rejecting when the player is unavailable', async () => {
    await androidPlayStream('song', 'Song');
    vi.clearAllMocks();
    mocks.playerGetState.mockRejectedValueOnce({ message: 'player_not_ready' });
    await expect(androidPlay()).resolves.toBeUndefined();
    expect(mocks.toast).toHaveBeenCalledWith('Couldn\'t play "Song"', 'error');
  });
  it('reports plugin errors that are plain objects with a readable message', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.playerPause.mockRejectedValueOnce({ code: 'player_failed', message: 'boom' });
    androidPause();
    await new Promise(done => setTimeout(done, 0));
    expect(warn).toHaveBeenCalledWith('[hushio] android pause failed: {"code":"player_failed","message":"boom"}');
    warn.mockRestore();
  });
});
describe('Android playback metadata', () => {
  const meta = { artist: 'Artist', durationMs: 200_000, artworkUrl: 'https://img/art.jpg' };
  it('sends artist, duration and artwork with the queued stream', async () => {
    await androidPlayStream('song', 'Song', 0, meta);
    expect(mocks.playerSetQueue.mock.calls[0][0][0]).toEqual(expect.objectContaining(meta));
  });
  it('keeps the metadata when the queue is rebuilt after a service restart', async () => {
    await androidPlayStream('song', 'Song', 0, meta);
    vi.clearAllMocks();
    await androidPlay();
    expect(mocks.playerSetQueue).toHaveBeenCalledWith([expect.objectContaining(meta)], 0, 0);
  });
  it('sends the metadata for local tracks too', async () => {
    await androidPlayStream('local:1', 'Local', 0, { artist: 'Artist', durationMs: 90_000 });
    expect(mocks.playerSetQueue.mock.calls[0][0][0]).toEqual(expect.objectContaining({ artist: 'Artist', durationMs: 90_000, contentUri: 'content://song' }));
  });
});
describe('Native player actions', () => {
  it('next and previous drive the JS queue', async () => {
    await sendPlayerAction('next');
    expect(mocks.player.next).toHaveBeenCalledWith(true);
    await sendPlayerAction('previous');
    expect(mocks.player.prevTrack).toHaveBeenCalledTimes(1);
  });
  it('like adds the current track only when it is not liked yet', async () => {
    await sendPlayerAction('like');
    expect(mocks.library.toggleLike).toHaveBeenCalledWith(mocks.player.queue[0]);
    vi.clearAllMocks();
    mocks.library.liked = [{ id: 'song' }];
    await sendPlayerAction('like');
    expect(mocks.library.toggleLike).not.toHaveBeenCalled();
  });
  it('unlike removes the current track only when it is liked', async () => {
    await sendPlayerAction('unlike');
    expect(mocks.library.toggleLike).not.toHaveBeenCalled();
    mocks.library.liked = [{ id: 'song' }];
    await sendPlayerAction('unlike');
    expect(mocks.library.toggleLike).toHaveBeenCalledWith(mocks.player.queue[0]);
  });
  it('ignores play and pause because the player-state path already handles them', async () => {
    await sendPlayerAction('play');
    await sendPlayerAction('pause');
    expect(mocks.player.next).not.toHaveBeenCalled();
    expect(mocks.player.prevTrack).not.toHaveBeenCalled();
    expect(mocks.library.toggleLike).not.toHaveBeenCalled();
  });
});
describe('Android stream refresh limit', () => {
  const flush = () => new Promise(done => setTimeout(done, 0));
  const handlerFor = (event: string) => mocks.listenPlayerEvent.mock.calls.find(([name]) => name === event)![1] as (payload: unknown) => void;
  const refreshCalls = () => mocks.resolveStream.mock.calls.filter(([, refresh]) => refresh === true);
  it('stops after three refreshes within a minute, pauses, and tells the user', async () => {
    const dispatch = vi.fn();
    startAndroidEngine(dispatch);
    await androidPlayStream('song', 'Song');
    const refreshNeeded = handlerFor('player-stream-needed');
    for (let i = 0; i < 4; i++) {
      refreshNeeded({ id: 'song', reason: 'expired' });
      await flush();
    }
    expect(refreshCalls()).toHaveLength(3);
    expect(mocks.playerPause).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith('pause');
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith('Couldn\'t play "Song"', 'error');
  });
  it('starts a fresh count once playback is running again', async () => {
    startAndroidEngine(vi.fn());
    await androidPlayStream('song', 'Song');
    const refreshNeeded = handlerFor('player-stream-needed');
    for (let i = 0; i < 3; i++) {
      refreshNeeded({ id: 'song', reason: 'expired' });
      await flush();
    }
    handlerFor('player-state')({ ...snapshot('song'), playing: true });
    refreshNeeded({ id: 'song', reason: 'expired' });
    await flush();
    expect(refreshCalls()).toHaveLength(4);
    expect(mocks.playerPause).not.toHaveBeenCalled();
  });
});

describe('Android cold start and unrequested playback', () => {
  const flush = () => new Promise(done => setTimeout(done, 0));
  const listener = (name: string) => mocks.listenPlayerEvent.mock.calls.filter(([event]) => event === name).at(-1)![1] as (payload: unknown) => void;
  it('re-queues the restored track at its saved position after a cold start', async () => {
    vi.resetModules();
    const engine = await import('./androidEngine');
    Object.assign(mocks.player, { queue: [{ id: 'song', title: 'Song', artist: 'Artist' }], index: 0, position: 283.644 });
    await engine.androidPlay();
    expect(mocks.playerSetQueue).toHaveBeenCalledWith([expect.objectContaining({ id: 'song', url: 'https://media/song' })], 0, 283644);
    expect(mocks.playerPlay).toHaveBeenCalledTimes(1);
  });
  it('pauses native playback the app did not request', async () => {
    vi.resetModules();
    const engine = await import('./androidEngine');
    const dispatch = vi.fn();
    engine.startAndroidEngine(dispatch);
    await flush();
    listener('player-state')({ ...snapshot('song'), playing: true });
    await flush();
    expect(mocks.playerPause).toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalledWith('play');
  });
  it('keeps playback started from the system media controls', async () => {
    vi.resetModules();
    const engine = await import('./androidEngine');
    const dispatch = vi.fn();
    engine.startAndroidEngine(dispatch);
    await flush();
    listener('player-action')({ action: 'play' });
    listener('player-state')({ ...snapshot('song'), playing: true });
    await flush();
    expect(mocks.playerPause).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith('play');
  });
  it('keeps music that kept playing while the app was closed', async () => {
    vi.resetModules();
    mocks.playerGetState.mockResolvedValueOnce({ ...snapshot('song'), playing: true });
    const engine = await import('./androidEngine');
    const dispatch = vi.fn();
    engine.startAndroidEngine(dispatch);
    await flush();
    listener('player-state')({ ...snapshot('song'), playing: true });
    await flush();
    expect(mocks.playerPause).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith('play');
  });
});

describe('Android audio focus', () => {
  const flush = () => new Promise(done => setTimeout(done, 0));
  const listener = (name: string) => mocks.listenPlayerEvent.mock.calls.filter(([event]) => event === name).at(-1)![1] as (payload: unknown) => void;
  async function startedEngine() {
    vi.resetModules();
    const engine = await import('./androidEngine');
    engine.startAndroidEngine(vi.fn());
    await flush();
    return engine;
  }
  it('does not start playback again when another app takes focus', async () => {
    const engine = await startedEngine();
    await engine.androidPlayStream('song', 'Song');
    const onFocus = listener('player-focus');
    const onState = listener('player-state');
    vi.clearAllMocks();
    onFocus({ state: 'lost' });
    onState({ ...snapshot('song'), playing: false });
    await flush();
    expect(mocks.playerPlay).not.toHaveBeenCalled();
    expect(mocks.playerPause).not.toHaveBeenCalled();
  });
  it('pauses native playback that starts again after focus was lost', async () => {
    const engine = await startedEngine();
    await engine.androidPlayStream('song', 'Song');
    const onFocus = listener('player-focus');
    const onState = listener('player-state');
    onFocus({ state: 'lost' });
    vi.clearAllMocks();
    onState({ ...snapshot('song'), playing: true });
    await flush();
    expect(mocks.playerPause).toHaveBeenCalledTimes(1);
  });
  it('keeps playback the player resumes after a transient focus gain', async () => {
    const engine = await startedEngine();
    await engine.androidPlayStream('song', 'Song');
    const onFocus = listener('player-focus');
    const onState = listener('player-state');
    onFocus({ state: 'lost' });
    onFocus({ state: 'gained' });
    vi.clearAllMocks();
    onState({ ...snapshot('song'), playing: true });
    await flush();
    expect(mocks.playerPause).not.toHaveBeenCalled();
  });
});

describe('Android stale-event guards (ADR-007)', () => {
  const flush = () => new Promise(done => setTimeout(done, 0));
  const listener = (name: string) => mocks.listenPlayerEvent.mock.calls.filter(([event]) => event === name).at(-1)![1] as (payload: unknown) => void;
  const startedEngine = async () => {
    vi.resetModules();
    return await import('./androidEngine');
  };

  it('ignores a late snapshot for a replaced track', async () => {
    const engine = await startedEngine();
    const dispatch = vi.fn();
    engine.startAndroidEngine(dispatch);
    await flush();
    await engine.androidPlayStream('B', 'B');
    const onState = listener('player-state');
    engine.androidPause();
    vi.clearAllMocks();
    // Stale snapshot for A (playing, advanced position) while B is current must
    // not regress `last`, emit media events, or trigger the unrequested auto-pause.
    onState({ ...snapshot('A'), playing: true, positionMs: 9000, durationMs: 180000 });
    await flush();
    expect(mocks.playerPause).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(engine.androidPosition()).toBe(0);
  });

  it('accepts a snapshot matching the current id after A → B → A', async () => {
    const engine = await startedEngine();
    const dispatch = vi.fn();
    engine.startAndroidEngine(dispatch);
    await flush();
    await engine.androidPlayStream('A', 'A');
    await engine.androidPlayStream('B', 'B');
    await engine.androidPlayStream('A', 'A'); // A is re-selected, so currentId is 'A' again
    const onState = listener('player-state');
    vi.clearAllMocks();
    // ADR-007 Decision 1: the wire has no generation field, so a snapshot for the
    // first A occurrence is indistinguishable from one for the re-selected A — both
    // carry id 'A'. The JS guard therefore accepts it when id === currentId.
    onState({ ...snapshot('A'), playing: false, positionMs: 12000, durationMs: 200000 });
    await flush();
    expect(dispatch).toHaveBeenCalledWith('timeupdate');
    expect(engine.androidPosition()).toBe(12);
  });

  it('ignores a snapshot for B after A is re-selected', async () => {
    const engine = await startedEngine();
    const dispatch = vi.fn();
    engine.startAndroidEngine(dispatch);
    await flush();
    await engine.androidPlayStream('A', 'A');
    await engine.androidPlayStream('B', 'B');
    await engine.androidPlayStream('A', 'A');
    const onState = listener('player-state');
    vi.clearAllMocks();
    onState({ ...snapshot('B'), playing: false, positionMs: 5000, durationMs: 100000 });
    await flush();
    expect(dispatch).not.toHaveBeenCalled();
    expect(engine.androidPosition()).toBe(0);
  });

  it('does not end playback for a stale player-ended id', async () => {
    const engine = await startedEngine();
    const dispatch = vi.fn();
    engine.startAndroidEngine(dispatch);
    await flush();
    await engine.androidPlayStream('current', 'Current');
    const onEnded = listener('player-ended');
    onEnded({ id: 'stale' });
    expect(dispatch).not.toHaveBeenCalledWith('ended');
  });

  it('ends playback for a legacy empty player-ended payload', async () => {
    const engine = await startedEngine();
    const dispatch = vi.fn();
    engine.startAndroidEngine(dispatch);
    await flush();
    await engine.androidPlayStream('current', 'Current');
    const onEnded = listener('player-ended');
    onEnded({});
    expect(dispatch).toHaveBeenCalledWith('ended');
  });

  it('ends playback when the player-ended id matches the current track', async () => {
    const engine = await startedEngine();
    const dispatch = vi.fn();
    engine.startAndroidEngine(dispatch);
    await flush();
    await engine.androidPlayStream('current', 'Current');
    const onEnded = listener('player-ended');
    onEnded({ id: 'current' });
    expect(dispatch).toHaveBeenCalledWith('ended');
  });

  it('toasts for a player-error only when it is for the current track', async () => {
    const engine = await startedEngine();
    engine.startAndroidEngine(vi.fn());
    await flush();
    await engine.androidPlayStream('current', 'Current');
    const onError = listener('player-error');
    onError({ index: 0, id: 'stale', code: 'boom', message: 'boom', recoverable: false });
    expect(mocks.toast).not.toHaveBeenCalled();
    onError({ index: 0, id: 'current', code: 'boom', message: 'boom', recoverable: false });
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith('Couldn\'t play "Current"', 'error');
  });

  it('toasts for a player-error when no track is current yet', async () => {
    const engine = await startedEngine();
    engine.startAndroidEngine(vi.fn());
    await flush();
    const onError = listener('player-error');
    onError({ index: 0, id: 'anything', code: 'boom', message: 'boom', recoverable: false });
    expect(mocks.toast).toHaveBeenCalledTimes(1);
  });
});
