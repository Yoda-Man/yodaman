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

    test('handles every event type the agent engine can emit', () => {
        // The approval prompt was previously unreachable in the UI because the
        // stream handler only knew about final_answer and error, so the agent
        // blocked forever waiting for a decision the user was never shown.
        const enginePath = path.resolve(__dirname, '../../backend/core/AgentReasoningEngine.js');
        const emitted = new Set(
            [...read(enginePath).matchAll(/type:\s*'([a-z_]+)'/g)].map(match => match[1])
        );

        expect(emitted.size).toBeGreaterThan(0);

        const text = read(componentPath);
        for (const eventType of emitted) {
            expect(text).toContain(`case '${eventType}':`);
        }
    });

    test('surfaces the write-approval gate with a diff and a decision', () => {
        const text = read(componentPath);

        expect(text).toContain("case 'awaiting_approval':");
        expect(text).toContain('setPendingApproval({ taskId: step.taskId, messageId: assistantId, tool: step.tool })');
        expect(text).toContain('api.approve(approval.taskId, approved)');
        expect(text).toContain('function DiffPanel(');
        expect(text).toContain('Approve change');
        expect(text).toContain('Reject');
        expect(text).toContain('isApprovable={pendingApproval?.messageId === message.id}');
    });

    test('lets the user stop a running agent task', () => {
        const text = read(componentPath);

        expect(text).toContain('api.cancelAgentTask(activeTaskId)');
        expect(text).toContain("case 'task_cancelled':");
        expect(text).toContain('Stop the running agent task');
    });

    test('shows tool activity instead of stalling silently', () => {
        const text = read(componentPath);

        expect(text).toContain("case 'tool_start':");
        expect(text).toContain("case 'tool_end':");
        expect(text).toContain('function StepTrail(');
        expect(text).toContain('<StepTrail steps={message.steps} />');
    });

    test('addresses streamed messages by stable id, not array index', () => {
        const text = read(componentPath);

        expect(text).toContain('function patchMessage(id, patch)');
        expect(text).toContain('message.id === id');
        expect(text).toContain('function nextMessageId()');
        // The old index arithmetic broke whenever history loaded mid-stream.
        expect(text).not.toContain('const assistantIndex = messages.length + 1');
        expect(text).not.toContain('next[assistantIndex]');
    });

    test('offers keyboard send, copy, retry, and a guarded clear', () => {
        const text = read(componentPath);

        expect(text).toContain('function handleComposerKeyDown(event)');
        expect(text).toContain('onKeyDown={handleComposerKeyDown}');
        expect(text).toContain('function CopyButton(');
        expect(text).toContain('retryLastPrompt');
        expect(text).toContain('window.confirm(');
    });

    test('never leaves a message bubble stuck in the streaming state', () => {
        const text = read(componentPath);

        expect(text).toContain('The agent stream ended without an answer.');
        expect(text).toContain('clearSlowTimer');
        // The slow-task hint used to be cleared one line after it was set.
        expect(text).not.toMatch(/try \{\s*clearTimeout\(slowTimer\)/);
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
