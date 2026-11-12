/**
 * "Run <plugin>" skips the model and calls the plugin with only the workspace
 * filled in. Lightsaber and Graphify needed more (an action, a query) and
 * failed with "Unknown action: undefined" every time, in the user's runtime
 * log, while every test passed: none ran a routed plugin the way the router
 * does. This runs each bundled plugin exactly that way.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const toolBox = require('../../backend/infrastructure/ToolBox');
const agentEngine = require('../../backend/core/AgentReasoningEngine');

describe('plugins reached by "Run <name>"', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'direct-plugin-'));
    fs.writeFileSync(path.join(workspace, 'index.js'), "module.exports = require('./util');\n");
    fs.writeFileSync(path.join(workspace, 'util.js'), 'module.exports = () => 42;\n');
    afterAll(() => fs.rmSync(workspace, { recursive: true, force: true }));

    const bundled = [...toolBox.plugins.keys()];

    test('the bundled plugins are loaded, so this checks something', () => {
        expect(bundled).toEqual(expect.arrayContaining(['CodeTrooper', 'Droid-Sweep', 'Grand-Inquisitor', 'lightsaber', 'graphify']));
    });

    test.each(bundled)('%s either runs with the workspace alone, or is left to the agent', async (name) => {
        const routed = agentEngine.resolveDirectPluginCall(`Run ${name}`);
        if (!routed) return; // the agent loop chooses its parameters
        const events = [];
        const answer = await agentEngine.runPluginDirectly(routed, {
            taskId: `direct-${name}`, task: `Run ${name}`, onStep: (e) => events.push(e), metadata: { projectId: workspace }
        });
        const error = events.find((e) => e.type === 'error');
        expect(error?.message).toBeUndefined();
        expect(answer).toContain(`Ran **${name}** directly`);
    }, 60000);

    test('a plugin that needs an action is not routed directly', () => {
        expect(agentEngine.resolveDirectPluginCall('Run lightsaber')).toBeNull();
    });
});
