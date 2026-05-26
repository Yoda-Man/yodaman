const vscode = require('vscode');
// Access the client singleton
const { createYodaManClient } = require('../../../shared/yodamanClient');

let output;
let statusBar;
let sidebarProvider;
let activeTaskId = null;
let runtimeTerminal = null;
let runtimeAvailable = false;
let storedMode = 'code'; // default mode
let lastStatus = null;
let extensionContext = null;

function getRuntimeUrl() {
    return vscode.workspace.getConfiguration('yodaman').get('runtimeUrl').replace(/\/$/, '');
}

function getRuntimeCommand() {
    return vscode.workspace.getConfiguration('yodaman').get('runtimeCommand');
}

function getWorkspaceProjectId() {
    const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    return folder ? folder.uri.fsPath : undefined;
}

async function switchMode() {
    const selection = await vscode.window.showQuickPick([
        { label: 'Code', value: 'code', description: 'Answer from code' },
        { label: 'Documentation', value: 'doc', description: 'Answer from docs' }
    ], {
        placeHolder: 'Select query mode',
        canPickMany: false,
        ignoreFocusOut: true
    });
    if (!selection) return;
    const mode = selection.value;
    storedMode = mode;
    await extensionContext.globalState.update('yodamanMode', mode);
    if (!await ensureRuntimeAvailable()) return;
    await getClient().setMode(mode);
    vscode.window.showInformationMessage(`YodaMan query mode set to ${mode}`);
}

function getClient() { return createYodaManClient(getRuntimeUrl()); }

function friendlyRuntimeMessage(error) {
    return `YodaMan runtime is not available at ${getRuntimeUrl()}. Start the desktop app or run "${getRuntimeCommand()}" from a terminal, then try again. Details: ${error.message}`;
}

async function ensureRuntimeAvailable() {
    const status = await checkStatus(false);
    if (status) return true;

    const choice = await vscode.window.showWarningMessage(
        `YodaMan runtime is offline. Start it now with "${getRuntimeCommand()}"?`,
        'Start Runtime',
        'Open Settings'
    );

    if (choice === 'Open Settings') {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'yodaman.runtime');
        return false;
    }

    if (choice === 'Start Runtime') {
        await startRuntime();
        vscode.window.showInformationMessage('YodaMan runtime start requested. Try again once the status indicator turns green.');
    }

    return false;
}

async function checkStatus(showMessage = true) {
    try {
        const status = await getClient().status();
        runtimeAvailable = true;
        lastStatus = status;
        statusBar.text = '$(check) YodaMan';
        statusBar.tooltip = 'YodaMan runtime is available';
        if (showMessage) {
            vscode.window.showInformationMessage('YodaMan runtime is available.');
        }
        refreshSidebar();
        return status;
    } catch (error) {
        runtimeAvailable = false;
        lastStatus = null;
        statusBar.text = '$(warning) YodaMan';
        statusBar.tooltip = `YodaMan runtime unavailable: ${error.message}`;
        if (showMessage) {
            vscode.window.showWarningMessage(friendlyRuntimeMessage(error));
        }
        refreshSidebar();
        return null;
    }
}

async function startRuntime() {
    const command = getRuntimeCommand();
    if (!command) {
        vscode.window.showWarningMessage('Set yodaman.runtimeCommand before starting the runtime.');
        return;
    }

    if (!runtimeTerminal || runtimeTerminal.exitStatus) {
        runtimeTerminal = vscode.window.createTerminal('YodaMan Runtime');
    }

    runtimeTerminal.show(true);
    runtimeTerminal.sendText(command);
    output.appendLine(`[runtime] started command: ${command}`);
    vscode.window.showInformationMessage('YodaMan runtime start command sent.');
    refreshSidebar();
}

async function askWorkspace() {
    const question = await vscode.window.showInputBox({
        title: 'Ask YodaMan',
        prompt: 'Ask a question about the current workspace'
    });

    if (!question) return;
    if (!await ensureRuntimeAvailable()) return;

    // Prompt user to select mode if not already set
    const mode = await vscode.window.showQuickPick([
        { label: 'Code', value: 'code', description: 'Answer from code context' },
        { label: 'Documentation', value: 'doc', description: 'Answer from docs and comments' }
    ], {
        placeHolder: 'Select query mode',
        canPickMany: false,
        ignoreFocusOut: true
    }).then(item => item ? item.value : storedMode);

    // Persist selected mode
    storedMode = mode;
    extensionContext.globalState.update('yodamanMode', mode);
    await getClient().setMode(mode);

    output.show(true);
    output.appendLine(`> ${question} (mode: ${mode})`);

    try {
        const result = await getClient().ask(question, getWorkspaceProjectId(), mode);
        output.appendLine(result.answer || JSON.stringify(result, null, 2));
    } catch (error) {
        output.appendLine(`[error] ${error.message}`);
        vscode.window.showErrorMessage(`YodaMan ask failed: ${error.message}`);
    }
}

async function runAgentTask() {
    const task = await vscode.window.showInputBox({
        title: 'Run YodaMan Agent Task',
        prompt: 'Describe the coding task YodaMan should work on'
    });
    if (!task) return;
    if (!await ensureRuntimeAvailable()) return;

    // Use stored mode for agent tasks as well
    const mode = storedMode;
    if (mode) {
        await getClient().setMode(mode);
    }

    output.show(true);
    output.appendLine(`\n[task] ${task}`);

    try {
        await getClient().runAgentTask(task, getWorkspaceProjectId(), handleAgentEvent);
        // mode already set via setMode before
    } catch (error) {
        output.appendLine(`[error] ${error.message}`);
        vscode.window.showErrorMessage(`YodaMan agent task failed: ${error.message}`);
    } finally {
        activeTaskId = null;
    }
}

async function handleAgentEvent(event) {
    if (event.taskId) {
        activeTaskId = event.taskId;
    }

    switch (event.type) {
        case 'task_started':
            output.appendLine(`[started] ${event.taskId}`);
            refreshSidebar();
            break;
        case 'tool_start':
            output.appendLine(`[tool:start] ${event.tool} ${JSON.stringify(event.params || {})}`);
            break;
        case 'tool_end':
            output.appendLine(`[tool:end] ${event.tool}`);
            break;
        case 'awaiting_approval':
            output.appendLine(`[approval] ${event.params.filePath}`);
            await reviewWriteProposal(event);
            break;
        case 'final_answer':
            output.appendLine(`[final] ${event.answer}`);
            vscode.window.showInformationMessage('YodaMan agent task finished.');
            refreshSidebar();
            break;
        case 'task_cancelled':
            output.appendLine(`[cancelled] ${event.message || 'Task cancelled.'}`);
            vscode.window.showInformationMessage('YodaMan agent task cancelled.');
            refreshSidebar();
            break;
        case 'error':
            output.appendLine(`[error] ${event.message}`);
            vscode.window.showErrorMessage(`YodaMan error: ${event.message}`);
            break;
        default:
            output.appendLine(`[event] ${JSON.stringify(event)}`);
            break;
    }
}

async function searchWorkspace() {
    const query = await vscode.window.showInputBox({
        title: 'Search with YodaMan',
        prompt: 'Search the current workspace semantically'
    });

    if (!query) return;
    if (!await ensureRuntimeAvailable()) return;

    output.show(true);
    output.appendLine(`\n[search] ${query}`);

    try {
        const results = await getClient().search(query, getWorkspaceProjectId());

        output.appendLine(JSON.stringify(results, null, 2));
    } catch (error) {
        output.appendLine(`[error] ${error.message}`);
        vscode.window.showErrorMessage(`YodaMan search failed: ${error.message}`);
    }
}

async function reindexWorkspace() {
    const projectId = getWorkspaceProjectId();
    if (!projectId) {
        vscode.window.showWarningMessage('Open a workspace folder before reindexing.');
        return;
    }
    if (!await ensureRuntimeAvailable()) return;

    try {
        const result = await getClient().reindex(projectId);
        output.appendLine(`[reindex] ${projectId}`);
        vscode.window.showInformationMessage(result.message || 'YodaMan indexing queued.');
    } catch (error) {
        output.appendLine(`[error] ${error.message}`);
        vscode.window.showErrorMessage(`YodaMan reindex failed: ${error.message}`);
    }
}

async function addWorkspace() {
    if (!await ensureRuntimeAvailable()) return;

    const currentWorkspace = getWorkspaceProjectId();
    const choices = [
        { label: 'Browse Folder', value: 'browse', description: 'Choose a local folder with the native picker' },
        { label: 'Paste Path', value: 'paste', description: 'Enter an absolute workspace path manually' }
    ];

    if (currentWorkspace) {
        choices.unshift({
            label: 'Use Current Workspace',
            value: 'current',
            description: currentWorkspace
        });
    }

    const selected = await vscode.window.showQuickPick(choices, {
        title: 'Add YodaMan Workspace',
        placeHolder: 'Choose how to add a workspace',
        ignoreFocusOut: true
    });
    if (!selected) return;

    let workspacePath;
    if (selected.value === 'current') {
        workspacePath = currentWorkspace;
    } else if (selected.value === 'browse') {
        const picked = await vscode.window.showOpenDialog({
            title: 'Choose YodaMan Workspace Folder',
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Add Workspace'
        });
        workspacePath = picked && picked[0]?.fsPath;
    } else {
        workspacePath = await vscode.window.showInputBox({
            title: 'Add YodaMan Workspace',
            prompt: 'Paste an absolute repository path',
            placeHolder: '/Users/dev/project',
            ignoreFocusOut: true
        });
    }

    if (!workspacePath) return;

    try {
        const result = await getClient().addProject(workspacePath.trim());
        output.appendLine(`[workspace:add] ${result.path || workspacePath}`);
        vscode.window.showInformationMessage(`YodaMan workspace added: ${result.path || workspacePath}`);
        refreshSidebar();
    } catch (error) {
        output.appendLine(`[error] ${error.message}`);
        vscode.window.showErrorMessage(`YodaMan add workspace failed: ${error.message}`);
    }
}

async function addWorkspaceFromPath() {
    if (!await ensureRuntimeAvailable()) return;
    const workspacePath = await vscode.window.showInputBox({
        title: 'Add YodaMan Workspace Path',
        prompt: 'Paste an absolute repository path',
        placeHolder: '/Users/dev/project',
        ignoreFocusOut: true
    });
    if (!workspacePath) return;

    try {
        const result = await getClient().addProject(workspacePath.trim());
        output.appendLine(`[workspace:add] ${result.path || workspacePath}`);
        vscode.window.showInformationMessage(`YodaMan workspace added: ${result.path || workspacePath}`);
        refreshSidebar();
    } catch (error) {
        output.appendLine(`[error] ${error.message}`);
        vscode.window.showErrorMessage(`YodaMan add workspace failed: ${error.message}`);
    }
}

async function reviewWriteProposal(event) {
    const params = event.params || {};
    const fileName = params.filePath ? params.filePath.split(/[\\/]/).pop() : 'proposal.txt';
    const originalUri = await getOriginalUri(params.filePath, params.oldContent || '', fileName);
    const proposalUri = await writeProposalFile(event.taskId, fileName, params.newContent || '');

    await vscode.commands.executeCommand(
        'vscode.diff',
        originalUri,
        proposalUri,
        `YodaMan proposal: ${fileName}`
    );

    const choice = await vscode.window.showWarningMessage(
        `Approve YodaMan write to ${params.filePath}?`,
        { modal: true },
        'Approve',
        'Reject'
    );

    await getClient().approve(event.taskId, choice === 'Approve');

    output.appendLine(choice === 'Approve' ? '[approval] approved' : '[approval] rejected');
}

async function getOriginalUri(filePath, fallbackContent, fileName) {
    if (filePath) {
        const candidate = vscode.Uri.file(filePath);
        try {
            await vscode.workspace.fs.stat(candidate);
            return candidate;
        } catch (error) {
            output.appendLine(`[approval] target file is not on disk yet: ${filePath}`);
        }
    }

    return writeScratchFile('original', fileName, fallbackContent);
}

async function writeProposalFile(taskId, fileName, content) {
    return writeScratchFile(`proposal-${taskId || 'task'}`, fileName, content);
}

async function writeScratchFile(prefix, fileName, content) {
    const scratchDir = vscode.Uri.joinPath(contextStorageUri(), 'diffs');
    await vscode.workspace.fs.createDirectory(scratchDir);

    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'proposal.txt';
    const uri = vscode.Uri.joinPath(scratchDir, `${prefix}-${Date.now()}-${safeName}`);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
    return uri;
}

function contextStorageUri() {
    if (!contextStorageUri.value) {
        throw new Error('YodaMan extension storage is not ready.');
    }
    return contextStorageUri.value;
}

async function cancelAgentTask() {
    if (!activeTaskId) {
        vscode.window.showInformationMessage('No active YodaMan task to cancel.');
        return;
    }

    try {
        if (!await ensureRuntimeAvailable()) return;
        await getClient().cancel(activeTaskId);
        output.appendLine(`[cancel] requested for ${activeTaskId}`);
        refreshSidebar();
    } catch (error) {
        vscode.window.showErrorMessage(`YodaMan cancel failed: ${error.message}`);
    }
}

async function clearTasks() {
    try {
        if (!await ensureRuntimeAvailable()) return;
        const choice = await vscode.window.showWarningMessage(
            'Are you sure you want to clear the entire task history?',
            { modal: true },
            'Clear'
        );
        if (choice !== 'Clear') return;

        await getClient().clearTasks();
        output.appendLine('[clear] Task history cleared');
        vscode.window.showInformationMessage('YodaMan task history cleared.');
        refreshSidebar();
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to clear task history: ${error.message}`);
    }
}

async function clearAudit() {
    try {
        if (!await ensureRuntimeAvailable()) return;
        const choice = await vscode.window.showWarningMessage(
            'Are you sure you want to clear all system audit logs?',
            { modal: true },
            'Clear'
        );
        if (choice !== 'Clear') return;

        await getClient().clearAudit();
        output.appendLine('[clear] Audit logs cleared');
        vscode.window.showInformationMessage('YodaMan audit logs cleared.');
        refreshSidebar();
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to clear audit logs: ${error.message}`);
    }
}

function formatRuntimeLog(entry) {
    const meta = { ...entry };
    delete meta.timestamp;
    delete meta.level;
    delete meta.message;
    const detail = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `[${entry.timestamp}] ${String(entry.level || '').toUpperCase()} ${entry.message}${detail}`;
}

async function openLogs() {
    try {
        if (!await ensureRuntimeAvailable()) return;
        const payload = await getClient().logs(300);
        output.show(true);
        output.appendLine('\n=== YodaMan Runtime Logs ===');
        output.appendLine(`Queue: ${JSON.stringify(payload.queue || {}, null, 2)}`);
        output.appendLine('');
        (payload.logs || []).forEach((entry) => output.appendLine(formatRuntimeLog(entry)));
        output.appendLine('============================');
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to load YodaMan logs: ${error.message}`);
    }
}

function refreshSidebar() {
    if (sidebarProvider) {
        sidebarProvider.refresh();
    }
}

async function viewTaskDetails(task) {
    if (!task) return;
    output.show(true);
    output.appendLine(`\n=== Task Details: ${task.taskId} ===`);
    output.appendLine(`Task Prompt: ${task.task || 'N/A'}`);
    output.appendLine(`Status: ${task.status}`);
    if (task.createdAt) output.appendLine(`Created At: ${task.createdAt}`);
    if (task.updatedAt) output.appendLine(`Updated At: ${task.updatedAt}`);
    if (task.finalAnswer) output.appendLine(`Final Answer: ${task.finalAnswer}`);
    if (task.error) output.appendLine(`Error: ${task.error}`);

    try {
        if (!await ensureRuntimeAvailable()) return;
        const events = await getClient().taskEvents(task.taskId);
        if (events && events.length > 0) {
            output.appendLine('\nTask Events:');
            events.forEach((ev) => {
                const ts = ev.timestamp ? `[${ev.timestamp}] ` : '';
                output.appendLine(`  ${ts}${ev.type}: ${ev.message || ev.tool || ''}`);
            });
        }
    } catch (err) {
        output.appendLine(`\nFailed to fetch events: ${err.message}`);
    }
    output.appendLine('====================================');
}

class YodaManSidebarProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(item) {
        return item;
    }

    async getChildren(item) {
        if (!item) {
            return [
                new SidebarItem('Status & Info', '', 'info', 'category', vscode.TreeItemCollapsibleState.Expanded, 'status'),
                new SidebarItem('Actions', '', 'tools', 'category', vscode.TreeItemCollapsibleState.Expanded, 'actions'),
                new SidebarItem('Recent Tasks', '', 'history', 'category', vscode.TreeItemCollapsibleState.Expanded, 'tasks')
            ];
        }

        if (item.category === 'status') {
            const workspace = getWorkspaceProjectId();
            const items = [
                new SidebarItem(
                    runtimeAvailable ? 'Runtime online' : 'Runtime offline',
                    runtimeAvailable ? 'Connected' : getRuntimeUrl(),
                    runtimeAvailable ? 'check' : 'warning',
                    'yodamanStatus'
                ),
                new SidebarItem(
                    workspace ? 'Workspace' : 'No workspace',
                    workspace || 'Open a folder to use project actions',
                    'root-folder',
                    'yodamanInfo'
                ),
                new SidebarItem(
                    activeTaskId ? 'Active task' : 'No active task',
                    activeTaskId || 'Idle',
                    activeTaskId ? 'sync~spin' : 'circle-outline',
                    'yodamanInfo'
                )
            ];
            if (lastStatus) {
                items.push(new SidebarItem('Status payload available', 'See YodaMan output for details', 'info', 'yodamanInfo'));
            }
            return items;
        }

        if (item.category === 'actions') {
            return [
                SidebarItem.action('Ask Workspace', 'comment-discussion', 'yodaman.askWorkspace'),
                SidebarItem.action('Run Agent Task', 'sparkle', 'yodaman.runAgentTask'),
                SidebarItem.action('Search Workspace', 'search', 'yodaman.searchWorkspace'),
                SidebarItem.action('Add Workspace', 'folder-opened', 'yodaman.addWorkspace'),
                SidebarItem.action('Paste Workspace Path', 'clippy', 'yodaman.addWorkspaceFromPath'),
                SidebarItem.action('Reindex Workspace', 'refresh', 'yodaman.reindexWorkspace'),
                SidebarItem.action('Open Logs', 'output', 'yodaman.openLogs'),
                SidebarItem.action('Start Runtime', 'terminal', 'yodaman.startRuntime'),
                SidebarItem.action('Cancel Active Task', 'circle-slash', 'yodaman.cancelAgentTask'),
                SidebarItem.action('Clear Task History', 'trash', 'yodaman.clearTasks'),
                SidebarItem.action('Clear Audit Logs', 'shield', 'yodaman.clearAudit')
            ];
        }

        if (item.category === 'tasks') {
            if (!runtimeAvailable) {
                return [new SidebarItem('Runtime offline', 'Cannot fetch task history', 'warning', 'yodamanInfo')];
            }
            try {
                const tasksList = await getClient().tasks();
                if (!tasksList || tasksList.length === 0) {
                    return [new SidebarItem('No recent tasks', 'No history found', 'circle-outline', 'yodamanInfo')];
                }
                return tasksList.slice(0, 5).map((t) => {
                    const statusIconMap = {
                        'running': 'sync~spin',
                        'cancelling': 'sync~spin',
                        'cancelled': 'circle-slash',
                        'completed': 'check',
                        'error': 'error',
                        'rejected': 'error',
                        'awaiting_approval': 'question'
                    };
                    const icon = statusIconMap[t.status] || 'circle-outline';
                    const trimmedText = t.task ? (t.task.length > 30 ? t.task.slice(0, 27) + '...' : t.task) : t.taskId;
                    
                    const taskItem = new SidebarItem(
                        trimmedText,
                        `[${t.status}]`,
                        icon,
                        'yodamanTaskItem'
                    );
                    taskItem.command = {
                        command: 'yodaman.viewTaskDetails',
                        title: 'View Task Details',
                        arguments: [t]
                    };
                    return taskItem;
                });
            } catch (err) {
                return [new SidebarItem('Error loading tasks', err.message, 'error', 'yodamanInfo')];
            }
        }

        return [];
    }
}

class SidebarItem extends vscode.TreeItem {
    constructor(label, description, icon, contextValue, collapsibleState = vscode.TreeItemCollapsibleState.None, category = null) {
        super(label, collapsibleState);
        this.description = description;
        this.tooltip = description;
        if (icon) {
            this.iconPath = new vscode.ThemeIcon(icon);
        }
        this.contextValue = contextValue;
        this.category = category;
    }

    static action(label, icon, command) {
        const item = new SidebarItem(label, '', icon, 'yodamanAction');
        item.command = {
            command,
            title: label
        };
        return item;
    }
}

function activate(context) {
    extensionContext = context;
    // Retrieve stored mode or default to 'code'
    storedMode = context.globalState.get('yodamanMode') || 'code';
    output = vscode.window.createOutputChannel('YodaMan');
    sidebarProvider = new YodaManSidebarProvider();
    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBar.command = 'yodaman.checkStatus';
    statusBar.text = '$(sync~spin) YodaMan';
    statusBar.show();

    context.subscriptions.push(
        output,
        statusBar,
        vscode.window.registerTreeDataProvider('yodaman.sidebar', sidebarProvider),
        vscode.commands.registerCommand('yodaman.checkStatus', () => checkStatus(true)),
        vscode.commands.registerCommand('yodaman.startRuntime', startRuntime),
        vscode.commands.registerCommand('yodaman.askWorkspace', askWorkspace),
        vscode.commands.registerCommand('yodaman.runAgentTask', runAgentTask),
        vscode.commands.registerCommand('yodaman.cancelAgentTask', cancelAgentTask),
        vscode.commands.registerCommand('yodaman.searchWorkspace', searchWorkspace),
        vscode.commands.registerCommand('yodaman.addWorkspace', addWorkspace),
        vscode.commands.registerCommand('yodaman.addWorkspaceFromPath', addWorkspaceFromPath),
        vscode.commands.registerCommand('yodaman.reindexWorkspace', reindexWorkspace),
        vscode.commands.registerCommand('yodaman.openLogs', openLogs),
        vscode.commands.registerCommand('yodaman.viewTaskDetails', viewTaskDetails),
        vscode.commands.registerCommand('yodaman.clearTasks', clearTasks),
        vscode.commands.registerCommand('yodaman.clearAudit', clearAudit),
        // New command to switch query mode
        vscode.commands.registerCommand('yodaman.switchMode', switchMode)
    );

    // Store mode in global state for persistence (already handled on changes)

    contextStorageUri.value = context.globalStorageUri;
    checkStatus(false);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
