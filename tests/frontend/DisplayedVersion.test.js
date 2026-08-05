/**
 * The status bar's build badge must match the real version.
 *
 * It was hardcoded as `v0.3.8` and stayed there through the 0.4.0 and 0.4.1
 * releases, so the running app told users it was three versions older than it was.
 * A version bump touches package.json, and nothing forced the badge to follow.
 */
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '../..');
const version = require(path.join(rootDir, 'package.json')).version;

describe('displayed version', () => {
    const statusBar = fs.readFileSync(path.join(rootDir, 'src', 'components', 'StatusBar.jsx'), 'utf8');

    test('the build badge is injected, never hardcoded', () => {
        expect(statusBar).toContain('__APP_VERSION__');
        // Any literal x.y.z in this file is a version that will go stale.
        expect(statusBar).not.toMatch(/v\d+\.\d+\.\d+/);
    });

    test('vite substitutes the badge from package.json', () => {
        const viteConfig = fs.readFileSync(path.join(rootDir, 'vite.config.js'), 'utf8');

        expect(viteConfig).toContain('__APP_VERSION__');
        expect(viteConfig).toContain('package.json');
    });

    test('the built bundle carries the current version', () => {
        const assetsDir = path.join(rootDir, 'dist', 'assets');
        if (!fs.existsSync(assetsDir)) {
            // Nothing built yet; the two checks above still hold the invariant.
            return;
        }

        const bundles = fs.readdirSync(assetsDir).filter(name => name.endsWith('.js'));
        const carriesVersion = bundles.some(name =>
            fs.readFileSync(path.join(assetsDir, name), 'utf8').includes(version)
        );

        expect(carriesVersion).toBe(true);
    });
});
