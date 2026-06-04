const watcherService = require('../../backend/infrastructure/FileSystemWatcher');

describe('FileSystemWatcher', () => {
    test('ignores generated Graphify output and release artifacts', () => {
        expect(watcherService.ignored).toEqual(expect.arrayContaining([
            '**/graphify-out/**',
            '**/release/**',
            '**/dist/**',
            '**/build/**'
        ]));
    });
});
