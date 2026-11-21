/**
 * Every /stardust/* call names its workspace, and a refusal reaches the user.
 *
 * The server resolves each Stardust route to a registered workspace and answers
 * 404 `workspace_not_registered` ({ error, code }) otherwise. stardustSetValidation
 * sent only { status }, so a validation verdict was stored under the runtime's
 * own folder, and the Stardust tab swallowed the failure.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

beforeAll(() => require('../helpers/browserStub').installBrowserStub());

function respond(status, body) {
    return {
        ok: status < 400,
        status,
        headers: { get: () => 'application/json' },
        json: async () => body
    };
}

test('every api.js method that calls a /stardust/ route takes a projectRoot', () => {
    const methods = [...read('src/api/api.js').matchAll(/^ {4}(?:async )?(\w+)\(([^)]*)\) \{([\s\S]*?)^ {4}\},?$/gm)]
        .filter(([, , , body]) => body.includes('/stardust/'));

    expect(methods.map(([, name]) => name)).toEqual(expect.arrayContaining(['stardustSetValidation', 'stardustDrift', 'stardustBoard']));
    for (const [, name, params, body] of methods) {
        expect({ name, named: /\bprojectRoot\b/.test(params) && /\bprojectRoot\b/.test(body) }).toEqual({ name, named: true });
    }
});

test('a validation verdict is sent with its workspace', async () => {
    const { api } = require('../../src/api/api');
    global.fetch = jest.fn(async () => respond(200, { ok: true }));

    await api.stardustSetValidation('add-x', 'ok', '/work/app');

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain('/stardust/validation/add-x');
    expect(JSON.parse(options.body)).toEqual({ status: 'ok', projectRoot: '/work/app' });
});

test('a workspace refusal arrives as the server error message', async () => {
    const { api } = require('../../src/api/api');
    global.fetch = jest.fn(async () => respond(404, { error: 'Workspace is not registered: /x', code: 'workspace_not_registered' }));

    await expect(api.stardustDrift('/x')).rejects.toMatchObject({ message: 'Workspace is not registered: /x', status: 404 });
});

test('the Stardust tab shows a refused call instead of dropping it', () => {
    const stardust = read('src/components/Stardust.jsx');
    expect(stardust).toMatch(/stardustSetValidation\(target, [^\n]*, effectiveCwd/);
    expect(stardust).not.toMatch(/stardustSetValidation\([^\n]*catch \(_\)/);

    // Both drift readers turn a refusal into the `reason` their views already render.
    expect(read('src/hooks/useStardustPipeline.js')).toMatch(/stardustDrift\(projectRoot\)\.catch\(err => \(\{ available: false, reason: err\.message \}\)\)/);
    expect(read('src/components/SpecDriftPanel.jsx')).toMatch(/catch \(err\) \{\s*setOwnReport\(\{ available: false, reason: err\.message \}\)/);
});
