jest.mock('../../backend/infrastructure/ToolBox', () => ({
    searchCode: jest.fn(async ({ query, project, top }) => [{ query, project, top }])
}));

jest.mock('../../backend/utils/docPreprocessor', () => ({
    preprocessDocumentation: jest.fn(async () => []),
    updateCtxConfig: jest.fn(async () => {})
}));

const toolBox = require('../../backend/infrastructure/ToolBox');
const docPreprocessor = require('../../backend/utils/docPreprocessor');
const router = require('../../backend/services/searchRouter');

describe('SearchRouter', () => {
    beforeEach(() => {
        jest.clearAllMocks();
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

    test('routes documentation queries through preprocessing', async () => {
        const response = await invoke('/', { query: 'how to use the api', project: '/tmp/project', top: 3 });

        expect(response.payload.mode).toBe('doc');
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
});
