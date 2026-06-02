const fs = require('fs');
const path = require('path');

describe('GraphStudio page contract', () => {
    const componentPath = path.resolve(__dirname, '../../src/components/GraphStudio.jsx');

    function source() {
        return fs.readFileSync(componentPath, 'utf8');
    }

    test('shows an in-progress build state instead of asking users to start a new build', () => {
        const text = source();

        expect(text).toContain('buildInProgress');
        expect(text).toContain('Graph build in progress');
        expect(text).toContain('YodaMan is generating the Graphify visualization for this workspace.');
    });
});
