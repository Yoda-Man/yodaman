const fs = require('fs');
const path = require('path');

describe('Dashboard component contract', () => {
    test('does not render repository mutation controls', () => {
        const text = fs.readFileSync(path.resolve(__dirname, '../../src/components/Dashboard.jsx'), 'utf8');

        expect(text).not.toContain("import GitPanel from './GitPanel'");
        expect(text).not.toContain('<GitPanel');
    });
});
