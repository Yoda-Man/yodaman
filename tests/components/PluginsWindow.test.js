const fs = require('fs');
const path = require('path');

describe('PluginsWindow page contract', () => {
    const componentPath = path.resolve(__dirname, '../../src/components/PluginsWindow.jsx');
    const manualPath = path.resolve(__dirname, '../../public/manual.html');

    function source() {
        return fs.readFileSync(componentPath, 'utf8');
    }

    test('does not include the Graph Studio migration notice', () => {
        const text = source();

        expect(text).not.toContain('Graphify is now in Graph Studio');
        expect(text).not.toContain('Use the Graph tab for visual exploration, report reading, graph queries, and impact analysis.');
    });

    test('View Documentation links to the shipped plugins manual section', () => {
        const text = source();
        const manual = fs.readFileSync(manualPath, 'utf8');

        expect(text).not.toContain('href="#"');
        expect(text).toMatch(/href=["']\/manual\.html#plugins["']/);
        expect(manual).toContain('id="plugins"');
    });
});
