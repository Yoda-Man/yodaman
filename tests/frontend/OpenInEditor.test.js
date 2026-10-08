/**
 * Every place that shows a file must be able to open it, in the user's editor.
 *
 * Two defects shipped together and no test noticed either:
 *
 *   - Chat file links were `vscode://file/...` URLs. They opened VS Code even on
 *     a machine whose default editor is something else (Antigravity IDE, in the
 *     report that found this), and nothing at all without VS Code.
 *   - Search results had no open action. The icon that looked like "open"
 *     only expanded the snippet, and ctx hits were labelled "Source File"
 *     because the card read a field ctx does not set.
 *
 * The render tests only ever mounted SearchWindow with no results, so what a
 * result offered was never looked at. These tests look.
 */
const fs = require('fs');
const path = require('path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

beforeAll(() => {
    require('../helpers/browserStub').installBrowserStub();
});

const SRC = path.join(__dirname, '..', '..', 'src');

function sourceFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        return /\.(jsx?|tsx?)$/.test(entry.name) ? [full] : [];
    });
}

describe('no editor is hardcoded in the UI', () => {
    const files = sourceFiles(SRC);

    test('there are source files to check', () => {
        expect(files.length).toBeGreaterThan(20);
    });

    test('nothing builds an editor-specific URL', () => {
        // Comments may explain the history; code may not build the URL. A
        // string literal or template containing the scheme is what opened the
        // wrong editor, so that is what is refused.
        const offenders = files.filter((file) => {
            const code = fs.readFileSync(file, 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/(^|[^:])\/\/.*$/gm, '$1');
            return /['"`](?:vscode|cursor|windsurf|zed|subl|idea|antigravity)(?:-insiders)?:\/\//i.test(code);
        }).map((file) => path.relative(SRC, file));
        expect(offenders).toEqual([]);
    });
});

describe('search results', () => {
    // Required after the browser stub is installed: api.js reads import.meta.env
    // at load time.
    const { hitPath: resultPath, hitLine: resultLine, dedupeHits: dedupeResults } = require('../../shared/searchHits');
    let SearchResultCard;
    beforeAll(() => {
        ({ SearchResultCard } = require('../../src/components/SearchWindow'));
    });

    // Exactly what `ctx search --json` returns: no metadata block.
    const ctxHit = { score: 0.96, filePath: 'auth/login.py', lineStart: 12, content: 'def login(user):' };
    const fallbackHit = { score: 0.5, content: 'x', metadata: { path: 'lib/util.js', line: 3 } };

    test('read the file and line from either result shape', () => {
        expect([resultPath(ctxHit), resultLine(ctxHit)]).toEqual(['auth/login.py', 12]);
        expect([resultPath(fallbackHit), resultLine(fallbackHit)]).toEqual(['lib/util.js', 3]);
    });

    test('a ctx hit shows its real path, not "Source File"', () => {
        const html = renderToStaticMarkup(React.createElement(SearchResultCard, { result: ctxHit, onOpen: () => {}, onToggle: () => {} }));
        expect(html).toContain('auth/login.py:12');
        expect(html).not.toContain('Source File');
    });

    test('every result with a file offers an Open action', () => {
        const html = renderToStaticMarkup(React.createElement(SearchResultCard, { result: ctxHit, onOpen: () => {}, onToggle: () => {} }));
        expect(html).toMatch(/>Open</);
        expect(html).toMatch(/title="Open in your editor"/);
    });

    test('the Open action calls the handler with the hit', () => {
        // Render to a tree and find the button's onClick, without a DOM.
        const opened = [];
        const element = SearchResultCard({ result: ctxHit, onOpen: (r) => opened.push(r), onToggle: () => {} });
        const buttons = [];
        (function walk(node) {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) return node.forEach(walk);
            if (node.type === 'button') buttons.push(node);
            walk(node.props?.children);
        })(element);
        const open = buttons.find((b) => b.props.title === 'Open in your editor');
        expect(open).toBeDefined();
        open.props.onClick();
        expect(opened).toEqual([ctxHit]);
    });

    test('duplicate hits are shown once', () => {
        expect(dedupeResults([ctxHit, { ...ctxHit }, fallbackHit])).toHaveLength(2);
    });
});

describe('chat file links', () => {
    test('open through the runtime, not through the browser', () => {
        const chat = fs.readFileSync(path.join(SRC, 'components', 'AgentChatTab.jsx'), 'utf8');
        const body = chat.slice(chat.indexOf('function openFileReference'), chat.indexOf('function viewInVr'));
        expect(body).toMatch(/api\.openInEditor\(/);
        expect(body).not.toMatch(/window\.open\(/);
    });
});
