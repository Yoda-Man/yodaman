/**
 * A route that takes a workspace path from the request resolves it through the
 * registered-workspace helper.
 *
 * Without that, an endpoint can be pointed at any folder on the machine.
 * POST /api/ask resolved any path it was given and wrote graphify-out/ into it;
 * GET /api/readiness read whatever projectId it was sent. This scans every
 * route in RestController for a path-like request field and fails when the
 * route never calls resolveRegisteredProjectPath (or resolveProjectPath, which
 * must itself go through it). The exceptions are listed with their reason.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'backend', 'interfaces', 'RestController.js');

const PATH_FIELD = /req\.(body|query)\??\.(path|projectId|nextPath|project|workspace|root|projectRoot)\b/;
const RESOLVES = /\bresolve(Registered)?ProjectPath\(/;

const EXCEPTIONS = {
    'post /projects': 'registers a new folder, checked by validateWorkspaceCandidate',
    'delete /projects': 'unregisters; a ctx-only index is not in the list but can still be removed',
    'put /projects': 'checks the old path against the registered list itself; the new one by validateWorkspaceCandidate',
    'get /sessions': 'projectId is a chat-history key, never opened on disk',
    'delete /sessions': 'projectId is a chat-history key, never opened on disk',
    'post /plugins/:name/open': 'passed to the plugin as a viewer hint; the route opens nothing',
    'get /check': 'read-only health probe for listed projects, which include ctx-only ones'
};

/** Each `router.<method>('<path>', ...)` with the source up to the next route. */
function routes(text) {
    const starts = [...text.matchAll(/router\.(get|post|put|delete)\('([^']+)'/g)];
    return starts.map((match, i) => ({
        key: `${match[1]} ${match[2]}`,
        body: text.slice(match.index, starts[i + 1]?.index ?? text.length)
    }));
}

function unresolved(text) {
    return routes(text)
        .filter(({ key, body }) => PATH_FIELD.test(body) && !RESOLVES.test(body) && !EXCEPTIONS[key])
        .map(({ key }) => key);
}

describe('workspace paths from a request are registered workspaces', () => {
    const text = fs.readFileSync(FILE, 'utf8');

    test('every route resolves them through the helper', () => {
        expect(unresolved(text)).toEqual([]);
    });

    test('resolveProjectPath itself goes through resolveRegisteredProjectPath', () => {
        const fn = /function resolveProjectPath\([^)]*\)\s*{([\s\S]*?)\n}/.exec(text);
        expect(fn).not.toBeNull();
        expect(fn[1]).toMatch(/resolveRegisteredProjectPath\(/);
    });

    test('every exception still names a route that exists', () => {
        const keys = new Set(routes(text).map((r) => r.key));
        expect(Object.keys(EXCEPTIONS).filter((key) => !keys.has(key))).toEqual([]);
    });

    test('the scan finds the defect it exists for', () => {
        const old = "router.get('/readiness', (req, res) => {\n    const projectId = req.query.projectId;\n    res.json(x(projectId));\n});\n";
        expect(unresolved(old)).toEqual(['get /readiness']);
    });
});
