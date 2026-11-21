/**
 * Input validation on the /api/graphify/* question routes: a bad value is a
 * 400 with a code, and never reaches the graphify command line.
 *
 * `/affected` used to pass `Number(depth || 2)` straight through, so
 * `depth: "abc"` ran `graphify affected <node> --depth NaN`.
 */
const os = require('os');
const path = require('path');

// A registered workspace that does not exist: if validation let a request
// through, building its graph would fail with 404, never with 400.
const mockWorkspace = path.join(os.tmpdir(), 'yodaman-graphify-routes-no-such-workspace');
jest.mock('../../backend/interfaces/support/workspaces', () => ({
    ...jest.requireActual('../../backend/interfaces/support/workspaces'),
    resolveRegisteredProjectPath: () => mockWorkspace
}));

jest.mock('../../backend/infrastructure/Logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const router = require('../../backend/interfaces/routes/graphifyRoutes');
const { findRouteHandler } = require('../helpers/routeHandler');

async function post(route, body) {
    const req = { body: { path: mockWorkspace, ...body }, query: {}, id: 'test' };
    const res = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; }
    };
    await findRouteHandler(router, 'post', route)(req, res);
    return res;
}

describe('graphify question routes validate their input', () => {
    test.each([
        ['/graphify/affected', { node: 'Router', depth: 'abc' }],
        ['/graphify/affected', { node: 'Router', depth: 0 }],
        ['/graphify/affected', { node: 'Router', depth: 99 }],
        ['/graphify/affected', { node: '-h' }],
        ['/graphify/affected', { node: 'Router', relations: ['--graph'] }],
        ['/graphify/explain', { node: '--help' }],
        ['/graphify/path', { source: '-h', target: 'Router' }],
        ['/graphify/path', { source: 'Router', target: '--directed' }]
    ])('%s %j is a 400 with code graphify_invalid_argument', async (route, body) => {
        const res = await post(route, body);
        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ code: 'graphify_invalid_argument' });
    });
});
