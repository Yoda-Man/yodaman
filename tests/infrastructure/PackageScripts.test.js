const fs = require('fs');
const path = require('path');

describe('package runtime scripts', () => {
    test('default GUI server runs without nodemon restarts', () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));

        expect(manifest.scripts.server).toBe('node server.js');
        expect(manifest.scripts['server:watch']).toBe('nodemon server.js');
    });
});
