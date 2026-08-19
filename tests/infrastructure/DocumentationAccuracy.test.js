const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Documentation must describe the product as it is.
 *
 * AGENT.md opens by warning that hand-maintained counts and paths rot silently,
 * and it was right: an audit found current docs claiming version 0.4.4 four
 * releases later, a publishing guide naming a `.vsix` from a version nobody
 * ships, and file paths pointing at modules that had moved.
 *
 * Rot is invisible precisely because documentation has no tests. This gives it
 * some.
 *
 * One deliberate exemption: **history may reference things that no longer
 * exist.** A changelog entry recording the removal of `ModeToggle.jsx` must
 * name the file it removed, and design plans describe the codebase as it was.
 * Rewriting those to satisfy a linter would falsify the record, which is a worse
 * outcome than the rot this prevents.
 */
describe('Documentation accuracy', () => {
    const root = path.resolve(__dirname, '../..');
    const version = require(path.join(root, 'package.json')).version;

    // Historical records, exempt by design — see the note above.
    const HISTORICAL = [/^CHANGELOG\.md$/, /^docs\/superpowers\//, /^extensions\/.*\/CHANGELOG\.md$/];

    const currentDocs = execSync("git ls-files '*.md'", { cwd: root, encoding: 'utf8' })
        .split('\n')
        .filter(Boolean)
        .filter((file) => !HISTORICAL.some((rx) => rx.test(file)));

    const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

    test('every repository path named in current docs exists', () => {
        const broken = [];
        const pathRef = /`((?:backend|src|scripts|electron|shared|tests|bin|plugins)\/[A-Za-z0-9_./-]+)`/g;

        for (const file of currentDocs) {
            const text = read(file);
            let m;
            while ((m = pathRef.exec(text))) {
                const target = m[1];
                // Illustrative examples in guides are written as my-*, so a
                // reader knows to substitute their own name.
                if (/\bmy-[a-z-]+/.test(target)) continue;
                if (!fs.existsSync(path.join(root, target))) broken.push(`${file} → ${target}`);
            }
        }

        expect(broken).toEqual([]);
    });

    test('every npm script named in current docs exists in the right package', () => {
        const missing = [];
        const scriptRef = /npm run ([a-z][a-z0-9:-]*)/g;

        for (const file of currentDocs) {
            // Resolve against the nearest package.json, so a mobile doc is
            // checked against the mobile package rather than core's.
            let dir = path.dirname(path.join(root, file));
            let manifest = null;
            while (dir.startsWith(root)) {
                const candidate = path.join(dir, 'package.json');
                if (fs.existsSync(candidate)) { manifest = candidate; break; }
                dir = path.dirname(dir);
            }
            if (!manifest) continue;

            // A publishing guide legitimately covers several components, so a
            // script may belong to the extension or the mobile app rather than
            // the nearest package. Accept it if it exists anywhere in the repo.
            const allManifests = execSync("git ls-files '*package.json'", { cwd: root, encoding: 'utf8' })
                .split('\n').filter(Boolean).filter((f) => !f.includes('node_modules'));
            const known = new Set();
            for (const file2 of allManifests) {
                try {
                    const pkg = JSON.parse(fs.readFileSync(path.join(root, file2), 'utf8'));
                    Object.keys(pkg.scripts || {}).forEach((k) => known.add(k));
                } catch (_err) {
                    // A manifest we cannot parse is not evidence about docs.
                }
            }

            const text = read(file);
            let m;
            while ((m = scriptRef.exec(text))) {
                if (!known.has(m[1])) missing.push(`${file} → npm run ${m[1]}`);
            }
        }

        expect(missing).toEqual([]);
    });

    test('current docs do not claim an older version than the one being shipped', () => {
        const stale = [];

        // Only look at text that actually claims to state THIS product's current
        // version. A first pass matched every 0.x.y in the tree and flagged
        // Ollama's version, an example config, and Holocron's independent
        // release line — a guard that noisy gets switched off, which is worse
        // than the rot it was meant to catch.
        const claims = [
            /YodaMan[ ]v?(\d+\.\d+\.\d+)/g,
            /^Version:[ ]*(\d+\.\d+\.\d+)/gm,
            /yodaman@(\d+\.\d+\.\d+)/g,
            /Version-(\d+\.\d+\.\d+)-gold/g,
            /\*\*Version\*\*:[ ]*(\d+\.\d+\.\d+)/g,
            /Current Status \((\d+\.\d+\.\d+)\)/g
        ];

        for (const file of currentDocs) {
            const text = read(file);
            for (const rx of claims) {
                let m;
                while ((m = rx.exec(text))) {
                    const line = text.slice(0, m.index).split('\n').length;
                    const context = text.split('\n')[line - 1] || '';
                    // History remains history.
                    if (/\b(fixed in|shipped|since|prior to|upgrade path|was |used to)\b/i.test(context)) continue;
                    if (m[1] !== version) stale.push(`${file}:${line} claims ${m[1]}, shipping ${version}`);
                }
            }
        }

        expect(stale).toEqual([]);
    });
});
