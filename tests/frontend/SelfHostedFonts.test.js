const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(rootDir, relative), 'utf8');

describe('Self-hosted typography', () => {
    const mainJsx = read('src/main.jsx');
    const indexCss = read('src/index.css');
    const tailwind = read('tailwind.config.cjs');
    const pkg = require(path.join(rootDir, 'package.json'));

    test('no stylesheet reaches out to a font CDN', () => {
        // A local-first product must not call a third party on launch, and the
        // packaged desktop app has no network to fall back on.
        for (const file of ['src/index.css', 'index.html', 'src/main.jsx']) {
            const source = read(file);
            expect(source).not.toMatch(/fonts\.googleapis\.com/);
            expect(source).not.toMatch(/fonts\.gstatic\.com/);
        }
    });

    test('typefaces are imported from bundled packages', () => {
        expect(mainJsx).toContain("@fontsource-variable/inter/wght.css");
        expect(mainJsx).toContain("@fontsource-variable/outfit/wght.css");
        expect(mainJsx).toContain("@fontsource/jetbrains-mono/400.css");
        expect(mainJsx).toContain("@fontsource/jetbrains-mono/500.css");
    });

    test('the font packages are declared, so a fresh install gets them', () => {
        const declared = { ...pkg.dependencies, ...pkg.devDependencies };
        expect(declared['@fontsource-variable/inter']).toBeDefined();
        expect(declared['@fontsource-variable/outfit']).toBeDefined();
        expect(declared['@fontsource/jetbrains-mono']).toBeDefined();
    });

    test('Tailwind names the variable families first', () => {
        // Fontsource registers the variable builds as "Inter Variable" and
        // "Outfit Variable". Naming only the static family silently falls back
        // to a system sans — the exact failure self-hosting was meant to end.
        expect(tailwind).toContain("'Inter Variable'");
        expect(tailwind).toContain("'Outfit Variable'");
        expect(tailwind).toContain("'JetBrains Mono'");
    });

    test('every family still ends in a real fallback, never a bare generic', () => {
        const families = tailwind.match(/(inter|outfit|mono):\s*\[([^\]]+)\]/g) || [];
        expect(families).toHaveLength(3);
        for (const family of families) {
            // More than a lone generic keyword at the end.
            expect(family.split(',').length).toBeGreaterThan(2);
            expect(family).toMatch(/(sans-serif|monospace)/);
        }
    });

    test('index.css records why there is no remote import', () => {
        // Guards against someone "helpfully" restoring the CDN line.
        expect(indexCss).toMatch(/self-hosted|Fontsource/i);
    });
});
