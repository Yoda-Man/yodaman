const fs = require('fs');
const path = require('path');

describe('PluginsWindow page contract', () => {
    const componentPath = path.resolve(__dirname, '../../src/components/PluginsWindow.jsx');
    const guidePath = path.resolve(__dirname, '../../src/components/PluginAuthoringGuide.jsx');
    const manualPath = path.resolve(__dirname, '../../public/manual.html');

    function source() {
        return fs.readFileSync(componentPath, 'utf8');
    }

    test('does not include the Graph Studio migration notice', () => {
        const text = source();

        expect(text).not.toContain('Graphify is now in Graph Studio');
        expect(text).not.toContain('Use the Graph tab for visual exploration, report reading, graph queries, and impact analysis.');
    });

    test('View Documentation opens the in-app guide rather than navigating away', () => {
        const text = source();

        expect(text).not.toContain('href="#"');
        // The guide renders inside the SPA so its Back button can return here.
        // A plain <a> to /manual.html left the page with no way back to the agent.
        expect(text).toContain("import PluginAuthoringGuide from './PluginAuthoringGuide'");
        expect(text).toMatch(/setView\(['"]docs['"]\)/);
        expect(text).toMatch(/<PluginAuthoringGuide\s+onBack=/);
    });

    test('the in-app guide offers a way back', () => {
        const guide = fs.readFileSync(guidePath, 'utf8');

        expect(guide).toMatch(/onBack/);
        expect(guide).toContain('Back to Plugins');
    });

    test('any link out to the manual opens in a new tab and lands on a real anchor', () => {
        const text = source();
        const manual = fs.readFileSync(manualPath, 'utf8');
        const guide = fs.readFileSync(guidePath, 'utf8');

        const links = [text, guide].flatMap(src => src.match(/href=["']\/manual\.html[^"']*["'][^>]*/g) || []);
        expect(links.length).toBeGreaterThan(0);
        for (const link of links) {
            expect(link).toContain('target="_blank"');
        }

        expect(manual).toContain('id="plugins"');
        // The manual is a standalone document, so it carries its own way back.
        expect(manual).toContain('Back to YodaMan');
    });

    test('the manual documents the plugin authoring contract', () => {
        const manual = fs.readFileSync(manualPath, 'utf8');

        expect(manual).toContain('id="plugin-authoring"');
        expect(manual).toContain('async execute');
        expect(manual).toContain('graphify:read');
    });
});
