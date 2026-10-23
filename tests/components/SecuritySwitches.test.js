/**
 * Settings' security switches show what is saved, not a hard-coded guess.
 */
function render(props) {
    require('../helpers/browserStub').installBrowserStub();
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { SecuritySwitches } = require('../../src/components/SettingsModal');
    return renderToStaticMarkup(React.createElement(SecuritySwitches, { onToggle() {}, ...props }));
}

const input = (html, id) => html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))[0];

test('each switch shows the saved setting, including ones that differ from the old defaults', () => {
    const html = render({ values: { allowPluginUploads: false, allowUnrestrictedPlugins: true, allowAgentCommands: true, allowSelfHealInstall: true, requirePairingToken: false } });
    for (const id of ['s-unrestricted', 's-commands', 's-repair']) expect(input(html, id)).toContain('checked=""');
    for (const id of ['s-upload', 's-pairing']) expect(input(html, id)).not.toContain('checked=""');
    expect(html).not.toContain('disabled=""');
});

test('before the settings load, every switch is disabled and none claims to be on', () => {
    const html = render({ values: null });
    expect(html.match(/<input/g)).toHaveLength(5);
    expect(html.match(/disabled=""/g)).toHaveLength(5);
    expect(html).not.toContain('checked=""');
});
