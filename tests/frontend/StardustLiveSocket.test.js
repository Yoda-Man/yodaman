/**
 * useStardustLive must not reconnect a socket it closed on purpose.
 *
 * onclose scheduled a reconnect for every close, including the one the hook
 * makes itself on unmount or when the workspace changes, so each switch left an
 * extra socket open and an unmounted board kept reconnecting forever.
 *
 * No DOM here, so React's hooks are replaced with the smallest stand-ins that
 * keep refs across renders and hand back effects for the test to run.
 */
const mockState = { refs: [], index: 0 };

jest.mock('react', () => ({
    useSyncExternalStore: (_subscribe, get) => get(),
    useCallback: (fn) => fn,
    useRef: (value) => {
        const i = mockState.index++;
        if (!mockState.refs[i]) mockState.refs[i] = { current: value };
        return mockState.refs[i];
    },
    useEffect: (fn) => { mockState.effect = fn; }
}));

jest.mock('../../src/api/api', () => ({
    api: {
        stardustBoard: () => Promise.resolve(null),
        stardustLiveUrl: (root) => `ws://runtime/api/stardust/live?projectRoot=${root}`
    }
}));

const { useStardustLive } = require('../../src/hooks/useStardustLive');

let sockets;

class FakeSocket {
    constructor(url) {
        this.url = url;
        sockets.push(this);
    }

    // Browsers deliver the close event asynchronously.
    close() {
        setTimeout(() => this.onclose && this.onclose(), 0);
    }
}

/** Renders the hook for `root` and runs its effect, returning the cleanup. */
function mount(root, previousCleanup) {
    mockState.index = 0;
    useStardustLive(root);
    if (previousCleanup) previousCleanup();
    return mockState.effect();
}

beforeEach(() => {
    jest.useFakeTimers();
    sockets = [];
    mockState.refs = [];
    global.WebSocket = FakeSocket;
});

afterEach(() => {
    jest.useRealTimers();
    delete global.WebSocket;
});

test('unmounting closes the socket for good', () => {
    const cleanup = mount('/a');
    expect(sockets).toHaveLength(1);

    cleanup();
    jest.advanceTimersByTime(10000);

    expect(sockets).toHaveLength(1);
});

test('switching workspace leaves exactly one socket, for the new workspace', () => {
    const cleanupA = mount('/a');
    mount('/b', cleanupA);
    jest.advanceTimersByTime(10000);

    expect(sockets.map((s) => s.url)).toEqual([
        'ws://runtime/api/stardust/live?projectRoot=/a',
        'ws://runtime/api/stardust/live?projectRoot=/b'
    ]);
});

test('a connection the server drops is still retried', () => {
    mount('/a');
    sockets[0].onclose();
    jest.advanceTimersByTime(3000);

    expect(sockets).toHaveLength(2);
    expect(sockets[1].url).toContain('/a');
});
