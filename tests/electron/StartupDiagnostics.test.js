const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '../../electron/main.js'), 'utf8');

describe('Electron startup diagnostics contract', () => {
    test('offers an always-available path to the dashboard', () => {
        expect(source).toContain('id="continue-to-dashboard"');
        expect(source).toContain("document.getElementById('continue-to-dashboard').addEventListener('click'");
        expect(source).toContain('window.location.href = RUNTIME_URL');
    });

    test('reports OpenSpec in the dependency table', () => {
        expect(source).toContain('> OpenSpec</td>');
        expect(source).toContain('id="action-openspec"');
    });

    test('polls every dependency the runtime health endpoint reports', () => {
        expect(source).toContain(
            "const checkKeys = ['node', 'graphify', 'ollama', 'ctx', 'openspec', 'config', 'runtime'];"
        );
    });

    test('check keys line up with the rendered table rows', () => {
        const keys = source
            .match(/const checkKeys = \[([^\]]+)\]/)[1]
            .split(',')
            .map(k => k.trim().replace(/'/g, ''));

        const tableBody = source.slice(
            source.indexOf('<tbody id="checks-body">'),
            source.indexOf('</tbody>')
        );
        const labels = [...tableBody.matchAll(/<\/span>\s*([^<]+?)<\/td>/g)].map(m => m[1].trim());

        // updateTable pairs checkKeys[i] with rows[i], so a mismatch in count or
        // order would silently label the wrong dependency.
        expect(labels).toHaveLength(keys.length);
        expect(labels).toEqual([
            'Node.js',
            'Graphify',
            'Ollama',
            'Context Expert (ctx)',
            'OpenSpec',
            'Config',
            'Runtime'
        ]);
        expect(keys).toEqual(['node', 'graphify', 'ollama', 'ctx', 'openspec', 'config', 'runtime']);
    });

    test('offers a one-click install for each self-healable dependency', () => {
        expect(source).toContain("makeInstallBtn('ollama')");
        expect(source).toContain("makeInstallBtn('ctx', 'ctx CLI')");
        expect(source).toContain("makeInstallBtn('openspec', 'OpenSpec')");
    });
});
