jest.mock('../../backend/infrastructure/ToolBox', () => ({
    contextExpertSearch: jest.fn(async ({ query, project, top }) => [{ query, project, top }])
}));


jest.mock('../../backend/infrastructure/Logger', () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn()
}));

const fs = require('fs');
const toolBox = require('../../backend/infrastructure/ToolBox');
const logger = require('../../backend/infrastructure/Logger');
const router = require('../../backend/services/searchRouter');

// Real folders: the pipeline refuses a workspace that does not exist.
const os = require('os');
const path = require('path');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-search-router-'));
const PROJECT = path.join(ROOT, 'project');
const ANCHOR = path.join(ROOT, 'Anchor');
fs.mkdirSync(PROJECT);
fs.mkdirSync(ANCHOR);
afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

// Its own config.json. This used to overwrite the repository's real one and
// restore it afterwards, so a crash mid-test would have lost the user's
// workspaces; it also only worked because search read the file beside the code.
const CONFIG = path.join(ROOT, 'config.json');

describe('SearchRouter', () => {
    let previousConfigPath;

    beforeEach(() => {
        jest.clearAllMocks();
        previousConfigPath = process.env.YODAMAN_CONFIG_PATH;
        process.env.YODAMAN_CONFIG_PATH = CONFIG;
    });

    afterEach(() => {
        if (previousConfigPath === undefined) delete process.env.YODAMAN_CONFIG_PATH;
        else process.env.YODAMAN_CONFIG_PATH = previousConfigPath;
        fs.rmSync(CONFIG, { force: true });
    });

    function routeHandler(routePath) {
        return router.stack.find((layer) => layer.route?.path === routePath).route.stack[0].handle;
    }

    async function invoke(routePath, query) {
        const req = { query };
        const res = {
            statusCode: 200,
            status: jest.fn(function status(code) {
                this.statusCode = code;
                return this;
            }),
            json: jest.fn(function json(payload) {
                this.payload = payload;
                return this;
            }),
            send: jest.fn(function send(payload) {
                this.payload = payload;
                return this;
            })
        };

        await routeHandler(routePath)(req, res);
        return res;
    }

    test('returns unified results for a documentation query', async () => {
        const response = await invoke('/', { query: 'how to use the api', project: PROJECT, top: 3 });

        expect(response.payload.results).toBeDefined();
        expect(toolBox.contextExpertSearch).toHaveBeenCalledWith({
            query: 'how to use the api',
            project: PROJECT,
            top: 3
        });
    });

    test('routes code queries directly to code search', async () => {
        const response = await invoke('/code', { query: 'function classifyQuery', top: 5 });

        expect(response.payload.mode).toBe('code');
        expect(toolBox.contextExpertSearch).toHaveBeenCalledWith({
            query: 'function classifyQuery',
            project: undefined,
            top: 5
        });
    });

    test('resolves workspace display names to registered paths before searching', async () => {
        fs.writeFileSync(CONFIG, JSON.stringify({
            watchedDirectories: [ANCHOR],
            removedDirectories: []
        }));

        const response = await invoke('/', { query: 'menu', project: 'Anchor', top: 7 });

        expect(response.statusCode).toBe(200);
        expect(toolBox.contextExpertSearch).toHaveBeenCalledWith({
            query: 'menu',
            project: ANCHOR,
            top: 7
        });
    });

    test('logs search failures with request context before returning errors', async () => {
        const failure = new Error('ctx search unavailable');
        toolBox.contextExpertSearch.mockRejectedValueOnce(failure);

        const response = await invoke('/code', { query: 'menu', project: ANCHOR });

        expect(response.statusCode).toBe(500);
        expect(response.payload).toEqual(expect.objectContaining({
            error: 'ctx search unavailable',
            code: 'search_failed'
        }));
        expect(logger.error).toHaveBeenCalledWith('search_failed', failure, expect.objectContaining({
            query: 'menu',
            project: ANCHOR,
            mode: 'code'
        }));
    });
});
