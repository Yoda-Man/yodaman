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

    test('places collapsible Git Integration directly after Git Context', () => {
        const text = read(componentPath);
        const gitContext = text.indexOf('title="Git Context"');
        const gitIntegration = text.indexOf('title="Git Integration"');

        expect(text).toContain("import GitPanel from './GitPanel'");
        expect(text).toContain('gitIntegration: false');
        expect(gitContext).toBeGreaterThan(-1);
        expect(gitIntegration).toBeGreaterThan(gitContext);
        expect(text).toContain('<GitPanel project={selectedProject} />');
    });

    test('shows workspace-aware Holocron VR control only for the loaded plugin', () => {
        const text = read(componentPath);

        expect(text).toContain("plugin.name === 'holocron-vr'");
        expect(text).toContain('Load in VR');
        expect(text).toContain("api.openPlugin('holocron-vr', selectedProject.path");
        expect(text).toContain("navigator.xr.isSessionSupported('immersive-vr')");
        expect(text).toContain('diagnosticId');
        expect(text).not.toContain('>Agent Chat</h1>');
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

    test('consolidates scoped search and restores durable local history', () => {
        const text = read(componentPath);

        expect(text).toContain("import SearchWindow from './SearchWindow'");
        expect(text).toContain('Scoped to: {selectedProject.name}');
        expect(text).toContain('searchRequest={searchRequest}');
        expect(text).toContain('normalizeMessages');
        expect(text).toContain('if (restored.length > 0) setMessages(restored)');
    });

    test('routes the shared voice-capable composer through semantic search in search mode', () => {
        const text = read(componentPath);

        expect(text).toContain("workspaceView === 'search'");
        expect(text).toContain('submitWorkspaceInput');
        expect(text).toContain('setSearchRequest');
        expect(text).toContain('onAutoSubmit: ({ text }) =>');
        expect(text).toContain("workspaceView === 'search' ? 'Search this workspace...' : 'Give YodaMan an agentic task...'");
        expect(text).not.toContain("workspaceView === 'chat' ? <form");
    });
});
