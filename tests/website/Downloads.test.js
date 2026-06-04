const fs = require('fs');
const path = require('path');

describe('Website downloads', () => {
    const rootDir = path.resolve(__dirname, '../..');
    const websiteDir = path.join(rootDir, 'website');
    const downloadsDir = path.join(websiteDir, 'downloads');
    const version = require(path.join(rootDir, 'package.json')).version;

    const readWebsiteFile = (filename) => fs.readFileSync(path.join(websiteDir, filename), 'utf8');

    test('download links target the current release artifacts', () => {
        const html = readWebsiteFile('index.html');
        const expectedHrefs = [
            `downloads/YodaMan-${version}-arm64.dmg`,
            `downloads/YodaMan-${version}-arm64-mac.zip`,
            `downloads/YodaMan%20Setup%20${version}.exe`,
            `downloads/YodaMan-${version}-win.zip`,
            `downloads/YodaMan-${version}.AppImage`,
            `downloads/yodaman-${version}.zip`,
            `downloads/vscode-yodaman-${version}.vsix`
        ];

        expectedHrefs.forEach((href) => {
            expect(html).toContain(`href="${href}"`);
        });
        expect(html).not.toMatch(/downloads\/[^"]*0\.2\.1/);
    });

    test('local download links point to synced files', () => {
        const html = readWebsiteFile('index.html');
        const localHrefs = [...html.matchAll(/href="downloads\/([^"]+)"/g)].map((match) => match[1]);

        expect(localHrefs.length).toBeGreaterThan(0);
        localHrefs.forEach((href) => {
            const filename = decodeURIComponent(href);
            expect(fs.existsSync(path.join(downloadsDir, filename))).toBe(true);
        });
    });

    test('website README tracks the package release version', () => {
        const readme = readWebsiteFile('README.md');

        expect(readme).toContain(`\`${version}\``);
        expect(readme).not.toContain('`0.2.1`');
    });
});
