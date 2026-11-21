/**
 * The runtime never writes its state next to its own code.
 *
 * The install folder is the app bundle or the npm package: every upgrade
 * replaces it, and writing into a signed macOS bundle breaks the signature.
 * config.json, yodaman.db and sessions.json moved to the data folder for that
 * reason (backend/infrastructure/DataPaths.js), but the disabled-plugin list
 * stayed in plugins/config.json and was lost on every desktop upgrade.
 *
 * This finds every state-file path built from __dirname under backend/ and
 * fails if the same file writes to it. Reading one (an old file to migrate)
 * is fine.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function sources(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sources(full);
        return entry.name.endsWith('.js') ? [full] : [];
    });
}

function installFolderWrites(file) {
    const text = fs.readFileSync(file, 'utf8');
    const names = [...text.matchAll(/(\w+)\s*=\s*path\.(?:join|resolve)\(\s*__dirname[^)]*\.(?:json|jsonl|db)['"]\s*\)/g)].map(([, name]) => name);
    return names.filter((name) => new RegExp(
        `(?:writeFileSync|appendFileSync|writeFile|appendFile|createWriteStream)\\(\\s*${name}\\b|copyFileSync\\([^,]+,\\s*${name}\\b`
    ).test(text)).map((name) => `${path.relative(ROOT, file).split(path.sep).join('/')}: ${name}`);
}

describe('state files', () => {
    test('no backend module writes a state file inside the install folder', () => {
        expect(sources(path.join(ROOT, 'backend')).flatMap(installFolderWrites)).toEqual([]);
    });

    test('the scan sees a write when there is one', () => {
        const probe = path.join(require('os').tmpdir(), `yodaman-state-probe-${process.pid}.js`);
        fs.writeFileSync(probe, "const P = path.join(__dirname, '../../plugins/config.json');\nfs.writeFileSync(P, '{}');\n");
        try {
            expect(installFolderWrites(probe)).toHaveLength(1);
        } finally {
            fs.rmSync(probe, { force: true });
        }
    });
});
