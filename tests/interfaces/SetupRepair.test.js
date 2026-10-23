/**
 * The Dashboard's Repair: the plan it shows, and the install it runs.
 */
const router = require('../../backend/interfaces/RestController');
const { findRouteHandler } = require('../helpers/routeHandler');
const dependencyChecker = require('../../backend/infrastructure/DependencyChecker');
const setupPlanner = require('../../backend/infrastructure/SetupPlanner');
const settings = require('../../backend/infrastructure/SettingsProvider');

const CTX_COMMAND = dependencyChecker.SERVICES.ctx.installUrl;

/** Repair is off unless the user turned it on in Settings. */
function allowRepair(allowed = true) {
    const real = settings.get.bind(settings);
    jest.spyOn(settings, 'get').mockImplementation((key) => (key === 'allowSelfHealInstall' ? allowed : real(key)));
}

const MISSING_CTX = {
    ollama: { found: true, version: '0.30.8', path: '/opt/homebrew/bin/ollama' },
    ctx: { found: false, error: 'ctx not found' },
    graphify: { found: true, version: '0.4.2', path: '/u/bin/graphify' },
    openspec: { found: true, version: '1.2.0', path: '/u/bin/openspec' }
};

function response() {
    return {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.payload = payload; return this; }
    };
}

function request({ ip = '127.0.0.1', healthState = {} } = {}) {
    return { ip, app: { get: (key) => (key === 'healthState' ? healthState : undefined) } };
}

afterEach(() => jest.restoreAllMocks());

test('off by default: installing software needs the Settings opt-in', async () => {
    const run = jest.spyOn(setupPlanner, 'runSetupPlan');
    const res = response();
    await findRouteHandler(router, 'post', '/setup/repair')(request(), res);
    expect(res.statusCode).toBe(403);
    expect(res.payload.code).toBe('self_heal_install_disabled');
    expect(res.payload.error).toMatch(/Settings/);
    expect(run).not.toHaveBeenCalled();
});

test('the plan says what is missing and the one command that fixes it', async () => {
    jest.spyOn(dependencyChecker, 'checkAll').mockResolvedValue(MISSING_CTX);
    const res = response();
    await findRouteHandler(router, 'get', '/setup/plan')(request(), res);
    expect(res.payload.automatic).toEqual([{ name: 'ctx', command: CTX_COMMAND }]);
    expect(res.payload.ok).toBe(false);
});

test('repair installs what is missing, re-checks, and refreshes the health the Dashboard reads', async () => {
    allowRepair();
    const fixed = { ...MISSING_CTX, ctx: { found: true, version: '1.4.0', path: '/u/.nvm/versions/node/v24.22.1/bin/ctx' } };
    jest.spyOn(dependencyChecker, 'checkAll').mockResolvedValue(MISSING_CTX);
    const run = jest.spyOn(setupPlanner, 'runSetupPlan').mockResolvedValue({ failed: [], stillMissing: [], after: fixed });
    const healthState = { ctx: { ok: false, message: 'ctx not found' } };
    const res = response();

    await findRouteHandler(router, 'post', '/setup/repair')(request({ healthState }), res);

    expect(run.mock.calls[0][0].automatic).toEqual([{ name: 'ctx', command: CTX_COMMAND }]);
    expect(res.payload).toMatchObject({ installed: [{ name: 'ctx' }], failed: [], stillMissing: [] });
    expect(healthState.ctx).toEqual({ ok: true, version: '1.4.0', message: 'v1.4.0 at /u/.nvm/versions/node/v24.22.1/bin/ctx' });
});

test('only from this computer: a phone or another machine on the network is refused', async () => {
    allowRepair();
    const run = jest.spyOn(setupPlanner, 'runSetupPlan');
    const res = response();
    await findRouteHandler(router, 'post', '/setup/repair')(request({ ip: '192.168.1.20' }), res);
    expect(res.statusCode).toBe(403);
    expect(res.payload.code).toBe('repair_local_only');
    expect(run).not.toHaveBeenCalled();
});

test('one repair at a time; the next is allowed once it finishes', async () => {
    allowRepair();
    jest.spyOn(dependencyChecker, 'checkAll').mockResolvedValue(MISSING_CTX);
    let finish;
    jest.spyOn(setupPlanner, 'runSetupPlan').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const handler = findRouteHandler(router, 'post', '/setup/repair');

    const first = handler(request(), response());
    await new Promise((r) => setImmediate(r));
    const second = response();
    await handler(request(), second);
    expect(second.statusCode).toBe(409);

    finish({ failed: [], stillMissing: [], after: MISSING_CTX });
    await first;
    const third = response();
    const done = handler(request(), third);
    await new Promise((r) => setImmediate(r));
    finish({ failed: [], stillMissing: [], after: MISSING_CTX });
    await done;
    expect(third.statusCode).toBe(200);
});

test('health entries read the same at startup and after a repair', () => {
    expect(dependencyChecker.healthEntry({ found: true, version: '0.30.8', path: '/opt/homebrew/bin/ollama', running: true }, { includeRunning: true }))
        .toEqual({ ok: true, version: '0.30.8', message: 'v0.30.8 at /opt/homebrew/bin/ollama (running)' });
    expect(dependencyChecker.healthEntry({ found: false, error: 'ctx not found' })).toEqual({ ok: false, version: null, message: 'ctx not found' });
});
