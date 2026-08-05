/**
 * Backend counterpart to the sweep in tests/frontend/RendererSafety.test.js.
 *
 * The 0.4.1 dead-code cleanup ("remove dead Code/Docs mode toggle") deleted the
 * `mode` variable from the /api/ask route but left a `mode` reference behind in
 * that route's catch block. Because it only executes on the error path, every test
 * passed and the runtime stayed healthy — until a request failed, at which point
 * the error handler itself threw `ReferenceError: mode is not defined` and the
 * original error was lost.
 *
 * Nothing here executes the code. It parses each file and asks Babel which
 * identifiers are never bound, which is exactly the residue a cleanup leaves.
 */
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const rootDir = path.resolve(__dirname, '../..');
const TREES = ['backend', 'shared', 'electron', 'plugins', 'scripts', 'bin'];

const ALLOWED = new Set([
    // Node runtime
    'require', 'module', 'exports', '__dirname', '__filename', 'process', 'Buffer',
    'global', 'globalThis', 'setImmediate', 'clearImmediate', 'queueMicrotask',
    'structuredClone', 'console', 'setTimeout', 'clearTimeout', 'setInterval',
    'clearInterval', 'performance', 'crypto', 'fetch', 'Headers', 'Request',
    'Response', 'AbortController', 'AbortSignal', 'URL', 'URLSearchParams',
    'TextEncoder', 'TextDecoder', 'WebAssembly', 'MessageChannel', 'BroadcastChannel',
    // Language built-ins
    'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Math',
    'JSON', 'Date', 'RegExp', 'Function', 'Error', 'TypeError', 'RangeError',
    'SyntaxError', 'EvalError', 'ReferenceError', 'Promise', 'Map', 'Set', 'WeakMap',
    'WeakSet', 'WeakRef', 'FinalizationRegistry', 'Proxy', 'Reflect', 'ArrayBuffer',
    'SharedArrayBuffer', 'DataView', 'Atomics', 'Uint8Array', 'Uint16Array',
    'Uint32Array', 'Int8Array', 'Int16Array', 'Int32Array', 'Float32Array',
    'Float64Array', 'BigInt64Array', 'BigUint64Array', 'parseInt', 'parseFloat',
    'isNaN', 'isFinite', 'NaN', 'Infinity', 'undefined', 'eval',
    'encodeURI', 'decodeURI', 'encodeURIComponent', 'decodeURIComponent',
    // Electron preload scripts run with a browser surface
    'window', 'document', 'navigator', 'location', 'localStorage'
]);

function sourceFiles(directory, collected = []) {
    if (!fs.existsSync(directory)) return collected;

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const filePath = path.join(directory, entry.name);
        if (entry.isDirectory()) sourceFiles(filePath, collected);
        else if (/\.(js|cjs|mjs|jsx)$/.test(entry.name)) collected.push(filePath);
    }
    return collected;
}

// Generated bundles are single enormous lines of mangled names; parsing them for
// hand-written mistakes tells you nothing. frontend/VRViewer.js is one of these.
function isGeneratedBundle(source) {
    const lines = source.split('\n');
    return lines.some(line => line.length > 2000);
}

describe('no unbound references outside the renderer', () => {
    test('every backend identifier resolves to a binding', () => {
        const unbound = [];

        for (const tree of TREES) {
            for (const filePath of sourceFiles(path.join(rootDir, tree))) {
                const source = fs.readFileSync(filePath, 'utf8');
                if (isGeneratedBundle(source)) continue;

                let ast;
                try {
                    ast = parser.parse(source, {
                        sourceType: 'unambiguous',
                        allowReturnOutsideFunction: true,
                        plugins: ['jsx']
                    });
                } catch (error) {
                    unbound.push(`${path.relative(rootDir, filePath)}: unparseable — ${error.message.split('\n')[0]}`);
                    continue;
                }

                traverse(ast, {
                    Program(programPath) {
                        Object.keys(programPath.scope.globals)
                            .filter(name => !ALLOWED.has(name))
                            .forEach(name => {
                                unbound.push(`${path.relative(rootDir, filePath)}: ${name}`);
                            });
                    }
                });
            }
        }

        expect(unbound).toEqual([]);
    });
});
