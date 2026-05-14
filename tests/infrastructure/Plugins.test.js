const toolBox = require('../../backend/infrastructure/ToolBox');
const fs = require('fs');
const path = require('path');

describe('Plugin System', () => {
    const pluginsDir = path.resolve(__dirname, '../../plugins');
    const testPluginFile = path.join(pluginsDir, 'testPlugin.js');

    beforeAll(() => {
        if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir);
        
        // Create a dummy plugin
        const content = `
            module.exports = {
                name: 'testPlugin',
                description: 'A test plugin',
                execute: async () => ({ success: true })
            };
        `;
        fs.writeFileSync(testPluginFile, content);
        toolBox.loadPlugins();
    });

    afterAll(() => {
        if (fs.existsSync(testPluginFile)) fs.unlinkSync(testPluginFile);
        toolBox.plugins.delete('testPlugin');
    });

    test('should load plugins from directory', () => {
        expect(toolBox.plugins.has('testPlugin')).toBe(true);
        const plugin = toolBox.plugins.get('testPlugin');
        expect(plugin.description).toBe('A test plugin');
    });

    test('should execute plugin tools', async () => {
        const result = await toolBox.callTool('testPlugin', {});
        expect(result.success).toBe(true);
    });

    test('should list plugins in tool definitions', () => {
        const docs = toolBox.getToolDefinitions();
        expect(docs).toContain('testPlugin');
        expect(docs).toContain('A test plugin');
    });
});
