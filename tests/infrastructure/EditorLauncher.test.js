/**
 * The Settings editor list must show each editor once. Apps were de-duplicated
 * by bundle file name ("Zed.app") and PATH commands by display name ("Zed"),
 * so an app with its command on PATH was listed twice.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const { detectEditors } = require('../../backend/infrastructure/EditorLauncher');

describe('detectEditors', () => {
    let home;
    const saved = {};

    beforeEach(() => {
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'yodaman-editors-'));
        const cli = path.join(home, 'Applications', 'Zed.app', 'Contents', 'MacOS', 'cli');
        fs.mkdirSync(path.dirname(cli), { recursive: true });
        fs.writeFileSync(cli, '');
        const bin = path.join(home, 'bin');
        fs.mkdirSync(bin);
        fs.writeFileSync(path.join(bin, 'zed'), '');
        saved.HOME = process.env.HOME;
        saved.PATH = process.env.PATH;
        saved.platform = Object.getOwnPropertyDescriptor(process, 'platform');
        process.env.HOME = home;
        process.env.PATH = bin;
        Object.defineProperty(process, 'platform', { value: 'darwin' });
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', saved.platform);
        process.env.HOME = saved.HOME;
        process.env.PATH = saved.PATH;
        fs.rmSync(home, { recursive: true, force: true });
    });

    test('an app whose command is also on PATH is listed once, as the app', () => {
        const zed = detectEditors().filter((editor) => editor.name === 'Zed');
        expect(zed).toEqual([{ name: 'Zed', setting: expect.stringMatching(/Zed\.app$/), atLine: true }]);
    });
});
