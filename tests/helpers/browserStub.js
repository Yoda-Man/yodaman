/**
 * The minimum browser surface a component touches while rendering.
 *
 * Server rendering runs every render body and useState initialiser, and those
 * reach for localStorage, matchMedia, and window before any effect would.
 *
 * This lives in one place because it was about to be copied into a second test
 * file. A copied definition that drifts is the specific failure that cost this
 * project a descriptor leak when one ignore list quietly became four.
 *
 * `fetch` never resolves on purpose: SSR does not await effects, and no test
 * should reach the network.
 */
function installBrowserStub() {
    const store = new Map();
    const storage = {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: (key) => store.delete(key),
        clear: () => store.clear(),
        key: () => null,
        length: 0
    };

    global.localStorage = storage;
    global.sessionStorage = storage;
    global.navigator = { userAgent: 'jest', language: 'en-US' };
    global.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    global.window = {
        localStorage: storage,
        sessionStorage: storage,
        navigator: global.navigator,
        matchMedia: global.matchMedia,
        location: { href: 'http://127.0.0.1:3090/', origin: 'http://127.0.0.1:3090', pathname: '/' },
        addEventListener() {},
        removeEventListener() {},
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        requestAnimationFrame: (cb) => setTimeout(cb, 0),
        cancelAnimationFrame: clearTimeout,
        speechSynthesis: { getVoices: () => [], addEventListener() {}, removeEventListener() {} },
        scrollTo() {}
    };
    global.document = {
        documentElement: { style: {}, classList: { add() {}, remove() {}, toggle() {} } },
        body: { style: {}, classList: { add() {}, remove() {}, toggle() {} } },
        addEventListener() {},
        removeEventListener() {},
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} })
    };
    // Never resolves: SSR does not await effects, and no test should hit the network.
    global.fetch = () => new Promise(() => {});

    // Stands in for Vite's build-time `import.meta` substitution.
    globalThis.__viteImportMeta__ = { env: { DEV: false, PROD: true, MODE: 'test', BASE_URL: '/' }, url: 'file:///test' };
    // Vite's `define` substitution — see vite.config.js.
    globalThis.__APP_VERSION__ = require('../../package.json').version;
}

module.exports = { installBrowserStub };
