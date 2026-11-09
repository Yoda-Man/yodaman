const fs = require('fs');
const path = require('path');

describe('Website downloads', () => {
    const rootDir = path.resolve(__dirname, '../..');
    const websiteDir = path.join(rootDir, 'website');
    const downloadsDir = path.join(websiteDir, 'downloads');
    const version = require(path.join(rootDir, 'package.json')).version;

    const readWebsiteFile = (filename) => fs.readFileSync(path.join(websiteDir, filename), 'utf8');
    const html = readWebsiteFile('index.html');
    const localHrefs = [...html.matchAll(/href="(downloads\/[^"]+)"/g)].map((match) => match[1]);
    const fileFor = (href) => path.join(downloadsDir, decodeURIComponent(href.replace('downloads/', '')));

    test('the page offers downloads at all', () => {
        expect(localHrefs.length).toBeGreaterThan(0);
    });

    // website/downloads/ holds build output and is gitignored, so it is empty on
    // a fresh checkout. This assertion is about a release artifact, not about
    // source, and it can only be meaningful where the artifacts were built.
    //
    // Running it unconditionally made CI fail on every push — the run reached
    // the tests, then died here because a runner has no downloads directory. A
    // test that cannot pass in an environment is not evidence about that
    // environment, it is noise that trains people to ignore the pipeline.
    //
    // It still runs, and still fails hard, wherever the artifacts exist: on the
    // release machine, and in `npm run release:verify` before shipping. That is
    // the only place a broken download link can actually be caught before users
    // see it.
    const artifactsPresent = fs.existsSync(downloadsDir)
        && fs.readdirSync(downloadsDir).some((entry) => !entry.startsWith('.'));
    const testWithArtifacts = artifactsPresent ? test : test.skip;

    testWithArtifacts('every download link resolves to a synced file', () => {
        // The invariant that matters most: a link on the page must never 404.
        const missing = localHrefs.filter((href) => !fs.existsSync(fileFor(href)));
        expect(missing).toEqual([]);
    });

    test('every YodaMan artifact link points at the current release', () => {
        // Catches links left behind on an older version after a bump.
        const stale = localHrefs.filter((href) => {
            const name = decodeURIComponent(href);
            if (!/YodaMan|yodaman|vscode-yodaman/i.test(name)) return false;
            if (/holocron-vr/.test(name)) return false; // versioned independently
            return !name.includes(version);
        });
        expect(stale).toEqual([]);
    });

    test('every locally-buildable platform and the extension are downloadable', () => {
        const joined = localHrefs.join(' ');
        expect(joined).toContain(`YodaMan-${version}-arm64.dmg`);      // macOS installer
        expect(joined).toContain(`YodaMan-${version}-arm64-mac.zip`);  // macOS portable
        expect(joined).toContain(`YodaMan-${version}.AppImage`);       // Linux
        expect(joined).toContain(`yodaman-${version}.zip`);            // Linux portable
        expect(joined).toContain(`vscode-yodaman-${version}.vsix`);    // VS Code
    });

    test('the VS Code extension carries the shared client it loads', () => {
        // extension.js needs core's shared/yodamanClient. vsce only packages
        // the extension folder, so every .vsix through 0.6.4 shipped without
        // it and could not start once installed.
        const extDir = path.join(rootDir, 'extensions', 'vscode-yodaman');
        const manifest = require(path.join(extDir, 'package.json'));
        expect(manifest.scripts['vscode:prepublish']).toContain('copy-shared.js');
        expect(fs.readFileSync(path.join(extDir, '.vscodeignore'), 'utf8')).not.toMatch(/^src\//m);

        const vsix = path.join(downloadsDir, `vscode-yodaman-${version}.vsix`);
        if (!fs.existsSync(vsix)) return; // nothing built yet; the page test above says so
        const listing = require('child_process').execFileSync('unzip', ['-l', vsix], { encoding: 'utf8' });
        expect(listing).toContain('extension/src/shared/yodamanClient.js');
        expect(listing).toContain('extension/src/shared/yodamanProtocol.js');
    });

    test('Windows is pointed at CI rather than shipped from a cross-build', () => {
        // A cross-built Windows installer is a truncated stub, and a stale ZIP
        // from an earlier commit would give Windows users different software
        // under the same version number. Neither is acceptable, so the page
        // links the native build instead of hosting a local artifact.
        expect(localHrefs.some(href => /win/i.test(href))).toBe(false);
        expect(html).toMatch(/native Windows runner/i);
        expect(html).toContain('github.com/Yoda-Man/yodaman/actions');
    });

    test('a linked Windows installer must actually carry its payload', () => {
        // Wine under QEMU on Apple Silicon produces a ~471 KB stub .exe: it
        // looks like an installer and installs nothing. A dead link is bad; a
        // download that silently fails is worse. Only ever link a real one.
        const installers = localHrefs.filter((href) => href.toLowerCase().endsWith('.exe'));
        for (const href of installers) {
            const sizeMb = fs.statSync(fileFor(href)).size / 1024 / 1024;
            expect(sizeMb).toBeGreaterThan(50);
        }
    });

    test('the page does not advertise a platform it cannot deliver', () => {
        // If the copy promises an installer, a real installer link must exist.
        if (/Windows x64 installer/i.test(html)) {
            expect(localHrefs.some((href) => href.toLowerCase().endsWith('.exe'))).toBe(true);
        }
    });

    test('website README tracks the package release version', () => {
        const readme = readWebsiteFile('README.md');

        expect(readme).toContain(`\`${version}\``);
        expect(readme).not.toContain('`0.2.1`');
    });
});
