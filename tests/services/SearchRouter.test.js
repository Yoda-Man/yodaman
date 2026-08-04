jest.mock('../../backend/infrastructure/ToolBox', () => ({
    searchCode: jest.fn(async ({ query, project, top }) => [{ query, project, top }])
}));

jest.mock('../../backend/utils/docPreprocessor', () => ({
    preprocessDocumentation: jest.fn(async () => []),
    updateCtxConfig: jest.fn(async () => {})
}));

jest.mock('../../backend/infrastructure/Logger', () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn()
}));

const fs = require('fs');
const toolBox = require('../../backend/infrastructure/ToolBox');
const docPreprocessor = require('../../backend/utils/docPreprocessor');
const logger = require('../../backend/infrastructure/Logger');
const router = require('../../backend/services/searchRouter');

describe('SearchRouter', () => {
    let originalConfig;

    beforeEach(() => {
        jest.clearAllMocks();
        originalConfig = fs.existsSync('config.json')
            ? fs.readFileSync('config.json', 'utf8')
            : undefined;
    });

    afterEach(() => {
        if (originalConfig === undefined) {
            fs.rmSync('config.json', { force: true });
        } else {
            fs.writeFileSync('config.json', originalConfig);
        }
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

    test('routes documentation queries through preprocessing and returns unified results', async () => {
        const response = await invoke('/', { query: 'how to use the api', project: '/tmp/project', top: 3 });

        expect(response.payload.results).toBeDefined();
        expect(docPreprocessor.preprocessDocumentation).toHaveBeenCalledWith('/tmp/project');
        expect(docPreprocessor.updateCtxConfig).toHaveBeenCalledWith('/tmp/project');
        expect(toolBox.searchCode).toHaveBeenCalledWith({
            query: 'how to use the api',
            project: '/tmp/project',
            top: 3
        });
    });

    test('routes code queries directly to code search', async () => {
        const response = await invoke('/code', { query: 'function classifyQuery', top: 5 });

        expect(response.payload.mode).toBe('code');
        expect(docPreprocessor.preprocessDocumentation).not.toHaveBeenCalled();
        expect(toolBox.searchCode).toHaveBeenCalledWith({
            query: 'function classifyQuery',
            project: undefined,
            top: 5
        });
    });

    test('resolves workspace display names to registered paths before searching', async () => {
        fs.writeFileSync('config.json', JSON.stringify({
            watchedDirectories: ['/tmp/Anchor'],
            removedDirectories: []
        }));

        const response = await invoke('/', { query: 'menu', project: 'Anchor', top: 7 });

        expect(response.statusCode).toBe(200);
        expect(toolBox.searchCode).toHaveBeenCalledWith({
            query: 'menu',
            project: '/tmp/Anchor',
            top: 7
        });
    });

    test('logs search failures with request context before returning errors', async () => {
        const failure = new Error('ctx search unavailable');
        toolBox.searchCode.mockRejectedValueOnce(failure);

        const response = await invoke('/code', { query: 'menu', project: '/tmp/Anchor' });

        expect(response.statusCode).toBe(500);
        expect(response.payload).toEqual(expect.objectContaining({
            error: 'ctx search unavailable',
            code: 'search_failed'
        }));
        expect(logger.error).toHaveBeenCalledWith('search_failed', failure, expect.objectContaining({
            query: 'menu',
            project: '/tmp/Anchor',
            mode: 'code'
        }));
    });
});
