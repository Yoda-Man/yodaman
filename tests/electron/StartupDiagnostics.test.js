const fs = require('fs');
const path = require('path');

describe('Electron startup diagnostics contract', () => {
    test('offers an always-available path to the dashboard', () => {
        const text = fs.readFileSync(path.resolve(__dirname, '../../electron/main.js'), 'utf8');

        expect(text).toContain('id="continue-to-dashboard"');
        expect(text).toContain("document.getElementById('continue-to-dashboard').addEventListener('click'");
        expect(text).toContain('window.location.href = RUNTIME_URL');
    });
});
