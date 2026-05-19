const vscode = require('vscode');
const { createYodaManClient } = require('../../../shared/yodamanClient');

let output;
let statusBar;
let sidebarProvider;
let activeTaskId = null;
let runtimeTerminal = null;
let runtimeAvailable = false;
let lastStatus = null;

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

function getClient() {
    return createYodaManClient(getRuntimeUrl());
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
            vscode.window.showWarningMessage(`YodaMan runtime unavailable: ${error.message}`);
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

    output.show(true);
    output.appendLine(`> ${question}`);

    try {
        const result = await getClient().ask(question, getWorkspaceProjectId());

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

    output.show(true);
    output.appendLine(`\n[task] ${task}`);

    try {
        await getClient().runAgentTask(task, getWorkspaceProjectId(), handleAgentEvent);
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

    try {
        const result = await getClient().reindex(projectId);
        output.appendLine(`[reindex] ${projectId}`);
        vscode.window.showInformationMessage(result.message || 'YodaMan indexing queued.');
    } catch (error) {
        output.appendLine(`[error] ${error.message}`);
        vscode.window.showErrorMessage(`YodaMan reindex failed: ${error.message}`);
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
        await getClient().cancel(activeTaskId);
        output.appendLine(`[cancel] requested for ${activeTaskId}`);
        refreshSidebar();
    } catch (error) {
        vscode.window.showErrorMessage(`YodaMan cancel failed: ${error.message}`);
    }
}

function refreshSidebar() {
    if (sidebarProvider) {
        sidebarProvider.refresh();
    }
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

    getChildren(item) {
        if (item) return [];

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

        items.push(
            SidebarItem.action('Ask Workspace', 'comment-discussion', 'yodaman.askWorkspace'),
            SidebarItem.action('Run Agent Task', 'sparkle', 'yodaman.runAgentTask'),
            SidebarItem.action('Search Workspace', 'search', 'yodaman.searchWorkspace'),
            SidebarItem.action('Reindex Workspace', 'refresh', 'yodaman.reindexWorkspace'),
            SidebarItem.action('Start Runtime', 'terminal', 'yodaman.startRuntime'),
            SidebarItem.action('Cancel Active Task', 'circle-slash', 'yodaman.cancelAgentTask')
        );

        if (lastStatus) {
            items.push(new SidebarItem('Status payload available', 'See YodaMan output for details', 'info', 'yodamanInfo'));
        }

        return items;
    }
}

class SidebarItem extends vscode.TreeItem {
    constructor(label, description, icon, contextValue) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = description;
        this.tooltip = description;
        this.iconPath = new vscode.ThemeIcon(icon);
        this.contextValue = contextValue;
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
        vscode.commands.registerCommand('yodaman.reindexWorkspace', reindexWorkspace)
    );

    contextStorageUri.value = context.globalStorageUri;
    checkStatus(false);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
