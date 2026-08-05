/**
 * Renders every top-level view for real.
 *
 * The Electron smoke test only ever sees the first paint, so a crash inside a tab
 * the initial screen does not mount is invisible to it — that is exactly how the
 * 0.4.2 `holocronAvailable` crash reached a release: AgentChatTab threw the moment
 * it rendered, and nothing in the suite ever rendered it.
 *
 * These are server renders, so effects never run and no network call is made. What
 * they do execute is every component's render body and its useState initialisers,
 * which is where an undeclared hook or a missing import blows up.
 */
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Components read a small browser surface while rendering. Stub it rather than
// pulling in jsdom, which is not a dependency of this project.
beforeAll(() => {
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
});

// A workspace shaped like the real thing, so components that read it during render
// take their populated branch rather than an early "no project" return.
const selectedProject = {
    id: 'probe-workspace',
    name: 'probe-workspace',
    path: '/tmp/probe-workspace'
};

// A fully-shaped pipeline: TrustDashboard reads `layers.<tool>.state` directly, so
// an empty object is not enough to reach its render body.
const layer = { state: 'ready', detail: 'stubbed for render test', version: '1.0.0' };
const pipeline = { layers: { ctx: { ...layer }, graph: { ...layer }, spec: { ...layer } } };

const VIEWS = [
    ['AgentChatTab', () => require('../../src/components/AgentChatTab')],
    ['Dashboard', () => require('../../src/components/Dashboard')],
    ['ImpactAnalysisTab', () => require('../../src/components/ImpactAnalysisTab')],
    ['TrustDashboard', () => require('../../src/components/TrustDashboard')],
    ['SearchTrace', () => require('../../src/components/SearchTrace')],
    ['ComposePanel', () => require('../../src/components/ComposePanel')],
    ['SpecDriftPanel', () => require('../../src/components/SpecDriftPanel')],
    ['ProjectList', () => require('../../src/components/ProjectList')],
    ['StatusBar', () => require('../../src/components/StatusBar')]
];

// `Stardust` and `App` cannot be server-rendered: useStardustLive calls
// useSyncExternalStore without a getServerSnapshot, which react-dom/server rejects
// outright. They are covered by the unbound-identifier sweep in
// RendererSafety.test.js instead — that one reads every file in src/ and needs no
// render at all. Adding getServerSnapshot purely to satisfy this test would be
// changing shipping code to suit the harness.

describe('every top-level view renders', () => {
    test.each(VIEWS)('%s renders without throwing', (name, load) => {
        const loaded = load();
        const Component = loaded.default || loaded;

        expect(typeof Component).toBe('function');

        // Both prop shapes appear across these components; passing all of them is
        // harmless and keeps each one on its populated path.
        const markup = renderToStaticMarkup(
            React.createElement(Component, {
                selectedProject,
                project: selectedProject,
                cwd: selectedProject.path,
                pipeline,
                projects: [selectedProject]
            })
        );

        expect(typeof markup).toBe('string');
    });
});
