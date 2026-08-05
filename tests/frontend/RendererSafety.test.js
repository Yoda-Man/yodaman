const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

function sourceFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const filePath = path.join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(filePath);
        return /\.(js|jsx)$/.test(entry.name) ? [filePath] : [];
    });
}

// Everything the browser itself provides. Any other unbound identifier is a
// missing import or a state hook that was never declared.
const BROWSER_GLOBALS = new Set([
    // Constructors and namespaces
    'AbortController', 'ArrayBuffer', 'Array', 'Audio', 'BigInt', 'Blob', 'Boolean',
    'CustomEvent', 'DataView', 'Date', 'DOMParser', 'Error', 'Event', 'EventSource',
    'File', 'FileReader', 'Float32Array', 'FormData', 'Headers', 'Image', 'Infinity',
    'Int32Array', 'Intl', 'IntersectionObserver', 'JSON', 'Map', 'Math', 'MutationObserver',
    'NaN', 'Notification', 'Number', 'Object', 'Promise', 'Proxy', 'Reflect', 'RegExp',
    'Request', 'ResizeObserver', 'Response', 'Set', 'SpeechRecognition', 'String', 'Symbol',
    'TextDecoder', 'TextEncoder', 'TypeError', 'RangeError', 'SyntaxError', 'URL',
    'URLSearchParams', 'Uint8Array', 'Uint16Array', 'WeakMap', 'WeakSet', 'WebSocket',
    'Worker', 'XMLHttpRequest',
    // Lower-case globals and functions
    'alert', 'atob', 'btoa', 'cancelAnimationFrame', 'clearInterval', 'clearTimeout',
    'confirm', 'console', 'crypto', 'decodeURI', 'decodeURIComponent', 'document',
    'encodeURI', 'encodeURIComponent', 'fetch', 'getComputedStyle', 'globalThis',
    'history', 'isFinite', 'isNaN', 'localStorage', 'location', 'matchMedia',
    'navigator', 'parseFloat', 'parseInt', 'performance', 'queueMicrotask',
    'requestAnimationFrame', 'screen', 'sessionStorage', 'setInterval', 'setTimeout',
    'speechSynthesis', 'structuredClone', 'undefined', 'webkitSpeechRecognition', 'window',
    // Replaced at build time by vite's `define` — see vite.config.js.
    '__APP_VERSION__'
]);

describe('renderer safety', () => {
    const srcDir = path.resolve(__dirname, '../../src');

    test('browser components do not reference Node-only process globals', () => {
        const offenders = sourceFiles(srcDir)
            .filter(filePath => /\bprocess\s*\./.test(fs.readFileSync(filePath, 'utf8')))
            .map(filePath => path.relative(srcDir, filePath));

        expect(offenders).toEqual([]);
    });

    test('every JSX component has an in-scope import or declaration', () => {
        const missing = [];

        sourceFiles(srcDir).forEach(filePath => {
            const source = fs.readFileSync(filePath, 'utf8');
            const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
            traverse(ast, {
                JSXOpeningElement(elementPath) {
                    const name = elementPath.node.name;
                    if (name.type !== 'JSXIdentifier' || !/^[A-Z]/.test(name.name)) return;
                    if (!elementPath.scope.hasBinding(name.name)) {
                        missing.push(`${path.relative(srcDir, filePath)}:${name.name}`);
                    }
                }
            });
        });

        expect(missing).toEqual([]);
    });

    // The JSX check above only sees <Component /> positions, which let two
    // different crashes ship:
    //   0.4.1 — `{ id: 'impact', icon: BarChart3 }`, a missing icon import. Threw
    //           while the module evaluated, so React never mounted: black window.
    //   0.4.2 — `holocronAvailable` read in AgentChatTab's render with no matching
    //           useState declaration. Threw during render, so the error boundary
    //           replaced the UI. The paired `setHolocronAvailable` call sat inside
    //           a .then() whose .catch() also threw, hiding it as an unhandled
    //           rejection until the render read it.
    // Babel resolves references at every nesting depth, so one unbound-identifier
    // sweep over the file catches both — regardless of casing.
    test('no reference is left unbound', () => {
        const unbound = [];

        sourceFiles(srcDir).forEach(filePath => {
            const source = fs.readFileSync(filePath, 'utf8');
            const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
            traverse(ast, {
                Program(programPath) {
                    Object.keys(programPath.scope.globals)
                        .filter(name => !BROWSER_GLOBALS.has(name))
                        .forEach(name => {
                            unbound.push(`${path.relative(srcDir, filePath)}:${name}`);
                        });
                }
            });
        });

        expect(unbound).toEqual([]);
    });

    test('the React root is protected by a recoverable error boundary', () => {
        const main = fs.readFileSync(path.join(srcDir, 'main.jsx'), 'utf8');
        const boundary = fs.readFileSync(path.join(srcDir, 'components', 'AppErrorBoundary.jsx'), 'utf8');

        expect(main).toContain('<AppErrorBoundary>');
        expect(boundary).toContain('componentDidCatch');
        expect(boundary).toContain('Reload YodaMan');
    });
});
