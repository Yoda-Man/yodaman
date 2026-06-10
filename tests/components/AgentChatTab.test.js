const fs = require('fs');
const path = require('path');

describe('AgentChatTab component contract', () => {
    const componentPath = path.resolve(__dirname, '../../src/components/AgentChatTab.jsx');
    const apiPath = path.resolve(__dirname, '../../src/api/api.js');
    const appPath = path.resolve(__dirname, '../../src/App.jsx');

    function read(filePath) {
        return fs.readFileSync(filePath, 'utf8');
    }

    test('implements the Codex-style agentic chat layout and controls', () => {
        const text = read(componentPath);

        expect(text).toContain('grid-cols-[minmax(0,7fr)_minmax(280px,3fr)]');
        expect(text).toContain('Current Context');
        expect(text).toContain('Git Context');
        expect(text).toContain('Attached Files');
        expect(text).toContain('Git Timeline');
        expect(text).toContain("import FileUploader from '../../frontend/FileUploader.jsx'");
        expect(text).toContain('View in VR');
        expect(text).toContain('openFileReference');
        expect(text).toContain('startVoiceInput');
        expect(text).toContain('renderMarkdown');
    });

    test('sends task context to the agent SSE endpoint', () => {
        const text = read(apiPath);

        expect(text).toContain('async agentTask(task, projectId, onStep, context = {})');
        expect(text).toContain('JSON.stringify({ task, projectId, context, fileIds: context.fileIds || [] })');
    });

    test('replaces the chat tab with the agentic chat component', () => {
        const text = read(appPath);

        expect(text).toContain("import AgentChatTab from './components/AgentChatTab'");
        expect(text).toContain("<AgentChatTab selectedProject={selectedProject} />");
    });
});
