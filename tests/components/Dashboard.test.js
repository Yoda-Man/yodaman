const fs = require('fs');
const path = require('path');

describe('Dashboard component contract', () => {
    const text = fs.readFileSync(path.resolve(__dirname, '../../src/components/Dashboard.jsx'), 'utf8');

    test('does not render repository mutation controls', () => {
        expect(text).not.toContain("import GitPanel from './GitPanel'");
        expect(text).not.toContain('<GitPanel');
    });

    test('offers the Ollama restart button only when the runtime can apply it', () => {
        // POST /api/ollama/context can only rewrite a Homebrew-run Ollama (`managed`).
        const button = text.indexOf('Set 32,768 & restart Ollama');
        const guard = text.lastIndexOf('{contextWindow.small && contextWindow.managed ? (', button);
        expect(guard).toBeGreaterThan(-1);
        expect(text.slice(guard, button)).not.toContain(') : null}');
    });
});
