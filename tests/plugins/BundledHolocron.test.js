/**
 * The Holocron VR plugin bundled with YodaMan matches the Holocron release.
 *
 * YodaMan ships its own copy of the plugin's manifest and entry point
 * (plugins/plugin.json, plugins/main.js). Nothing kept them in step with the
 * Holocron repository: the bundled manifest said 0.5.1 while Holocron shipped
 * 0.5.6, so the app reported a version that did not exist anywhere else.
 *
 * Runs only where the Holocron checkout sits beside core, as it does for a
 * release build; CI checks out core alone and skips.
 */
const fs = require('fs');
const path = require('path');

const HOLOCRON = path.join(__dirname, '..', '..', '..', 'Holocron VR');
const bundled = require('../../plugins/plugin.json');
const present = fs.existsSync(path.join(HOLOCRON, 'package.json'));

(present ? describe : describe.skip)('bundled Holocron VR', () => {
    const holocron = require(path.join(HOLOCRON, 'package.json'));
    const manifest = JSON.parse(fs.readFileSync(path.join(HOLOCRON, 'plugin.json'), 'utf8'));

    test('has the version Holocron is releasing', () => {
        expect(bundled.version).toBe(holocron.version);
    });

    test('declares the same permissions as the Holocron manifest', () => {
        // Permissions are what YodaMan enforces; a drift here changes what the
        // plugin is allowed to do without anyone deciding it.
        expect([...bundled.permissions].sort()).toEqual([...manifest.permissions].sort());
    });
});

test('the in-app viewer shows the bundled version, not a hardcoded one', () => {
    // It said "v0.5.1" in a string literal for every release after 0.5.1.
    const modal = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'components', 'HolocronVrModal.jsx'), 'utf8');
    const code = modal.replace(/\/\/.*$/gm, '');
    expect(code).toMatch(/holocronManifest\.version/);
    expect(code).not.toMatch(/>v\d+\.\d+\.\d+</);
});
