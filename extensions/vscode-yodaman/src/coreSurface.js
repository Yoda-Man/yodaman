/**
 * LOAD-BEARING — DO NOT DELETE BECAUSE "NOTHING IMPORTS IT" IS WRONG HERE.
 * Required by src/extension.js, which VS Code itself resolves via "main".
 *
 * The rest of the runtime, surfaced in the editor. extension.js covers ask,
 * search, agent tasks and approvals; this module covers the three-tool pillar
 * proper — Stardust specs, Graphify blast radius, and workspace trust.
 *
 * These lean on what only an editor can do: blast radius is computed for the
 * file you are actually looking at, and spec drift is published into the
 * Problems panel as real diagnostics rather than printed to a log, so it sits
 * where a developer already looks for things that need fixing.
 *
 * Response shapes are matched against backend/interfaces/routes/stardustRoutes.js
 * and backend/stardust/SpecDrift.js. Note that the Stardust routes key off
 * `projectRoot`, not the `path` the rest of the API uses — passing the wrong one
 * does not error, it silently falls back to the runtime's own cwd.
 */
const vscode = require('vscode');
const path = require('path');

let driftDiagnostics = null;

function init(context) {
    driftDiagnostics = vscode.languages.createDiagnosticCollection('yodaman-drift');
    context.subscriptions.push(driftDiagnostics);
    return driftDiagnostics;
}

// ── Impact ────────────────────────────────────────────────────────────────

/**
 * Blast radius for the file in the active editor: which specs describe it, what
 * depends on it, whether a test covers it. The question a developer asks right
 * before changing something, answered without leaving the file.
 */
async function impactForActiveFile(deps) {
    const { getClient, getWorkspaceProjectId, ensureRuntimeAvailable, output } = deps;

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('Open a file before asking for its blast radius.');
        return;
    }
    const projectRoot = getWorkspaceProjectId();
    if (!projectRoot) {
        vscode.window.showWarningMessage('Open a workspace folder first.');
        return;
    }
    if (!await ensureRuntimeAvailable()) return;

    const relative = path.relative(projectRoot, editor.document.uri.fsPath) || editor.document.uri.fsPath;

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `YodaMan: blast radius for ${path.basename(relative)}` },
        async () => {
            try {
                const result = await getClient().stardustCompose(projectRoot, relative, 2);
                renderCompose(result, relative, output);
            } catch (error) {
                output.appendLine(`[impact] ${error.message}`);
                vscode.window.showErrorMessage(`YodaMan impact failed: ${error.message}`);
            }
        }
    );
}

function renderCompose(result, relative, output) {
    const graph = result.graphify || {};
    const spec = result.openspec || {};

    output.show(true);
    output.appendLine(`\n[impact] ${relative}`);
    output.appendLine(`  dependents     ${graph.dependents ?? 0}`);
    output.appendLine(`  blast radius   ${graph.blastRadius ?? 0}`);
    output.appendLine(`  centrality     ${graph.centrality ?? 0}`);
    output.appendLine(`  tests          ${graph.coveredByTests ? `${graph.testCount} covering` : 'NONE'}`);
    output.appendLine(`  specs          ${spec.mentionedIn?.length ? spec.mentionedIn.join(', ') : 'none mention this file'}`);
    if (graph.risk) output.appendLine(`  risk           ${graph.risk}`);
    if (graph.reason) output.appendLine(`  note           ${graph.reason}`);

    // The uncovered-with-dependents case is the one worth interrupting for.
    const uncovered = !graph.coveredByTests && (graph.dependents ?? 0) > 0;
    const summary = `${graph.dependents ?? 0} dependents · ${graph.coveredByTests ? `${graph.testCount} tests` : 'no covering test'}`;
    if (uncovered) {
        vscode.window.showWarningMessage(`${path.basename(relative)}: ${summary}`, 'Show detail')
            .then((choice) => { if (choice) output.show(true); });
    } else {
        vscode.window.showInformationMessage(`${path.basename(relative)}: ${summary}`);
    }
}

// ── Stardust ──────────────────────────────────────────────────────────────

/** The active OpenSpec change board, as a pick list. */
async function showStardustBoard(deps) {
    const { getClient, getWorkspaceProjectId, ensureRuntimeAvailable, output } = deps;
    const projectRoot = getWorkspaceProjectId();
    if (!await ensureRuntimeAvailable()) return;

    try {
        const board = await getClient().stardustBoard(projectRoot);
        const changes = board.changes || [];
        if (!changes.length) {
            vscode.window.showInformationMessage(
                board.ready === false
                    ? 'No active OpenSpec changes (OpenSpec is not initialised in this workspace).'
                    : 'No active OpenSpec changes.'
            );
            return;
        }
        const picked = await vscode.window.showQuickPick(
            changes.map((c) => ({
                label: c.name || c.id || 'change',
                description: c.status || '',
                detail: c.mtimeMs ? new Date(c.mtimeMs).toLocaleString() : undefined,
                change: c
            })),
            { title: `Stardust — graph ${board.graphStatus || 'unknown'}`, placeHolder: 'Active changes' }
        );
        if (picked) {
            output.show(true);
            output.appendLine(`\n[stardust] ${picked.label}`);
            output.appendLine(JSON.stringify(picked.change, null, 2));
        }
    } catch (error) {
        vscode.window.showErrorMessage(`YodaMan Stardust board failed: ${error.message}`);
    }
}

/**
 * Publish spec drift into the Problems panel.
 *
 * Two kinds, and they land on different files: a stale reference is a spec
 * citing a file the graph does not have, so it belongs on the spec; an
 * undocumented module is a load-bearing file no spec mentions, so it belongs on
 * that file.
 */
async function publishDrift(deps) {
    const { getClient, getWorkspaceProjectId, ensureRuntimeAvailable, output } = deps;
    const projectRoot = getWorkspaceProjectId();
    if (!projectRoot) {
        vscode.window.showWarningMessage('Open a workspace folder first.');
        return;
    }
    if (!await ensureRuntimeAvailable()) return;

    try {
        const report = await getClient().stardustDrift(projectRoot);
        driftDiagnostics.clear();

        if (report.available === false) {
            vscode.window.showInformationMessage(`YodaMan drift unavailable: ${report.reason || 'unknown reason'}`);
            return;
        }

        const byFile = new Map();
        const add = (fsPath, diagnostic) => {
            const key = fsPath;
            if (!byFile.has(key)) byFile.set(key, []);
            byFile.get(key).push(diagnostic);
        };
        const firstLine = new vscode.Range(0, 0, 0, 0);

        for (const stale of report.staleReferences || []) {
            const specPath = path.join(projectRoot, 'openspec', `${stale.spec}.md`);
            const d = new vscode.Diagnostic(
                firstLine,
                `Spec "${stale.spec}" cites "${stale.reference}", which is not in the knowledge graph.`,
                vscode.DiagnosticSeverity.Warning
            );
            d.source = 'YodaMan drift';
            add(specPath, d);
        }

        for (const entry of report.undocumented || []) {
            const d = new vscode.Diagnostic(
                firstLine,
                `No OpenSpec spec describes this file, and ${entry.dependents} module(s) depend on it.`,
                vscode.DiagnosticSeverity.Information
            );
            d.source = 'YodaMan drift';
            add(path.join(projectRoot, entry.file), d);
        }

        for (const [fsPath, diags] of byFile) {
            driftDiagnostics.set(vscode.Uri.file(fsPath), diags);
        }

        output.appendLine(`\n[drift] ${report.summary || ''}`);
        const message = report.inSync
            ? 'YodaMan: specs and workspace are in sync.'
            : `YodaMan drift: ${report.staleCount} stale reference(s), ${report.undocumentedCount} undocumented module(s).`;
        if (report.inSync) {
            vscode.window.showInformationMessage(message);
        } else {
            vscode.window.showWarningMessage(message, 'Open Problems')
                .then((choice) => {
                    if (choice) vscode.commands.executeCommand('workbench.actions.view.problems');
                });
        }
    } catch (error) {
        vscode.window.showErrorMessage(`YodaMan drift failed: ${error.message}`);
    }
}

function clearDrift() {
    if (driftDiagnostics) driftDiagnostics.clear();
}

// ── Trust ─────────────────────────────────────────────────────────────────

/** Dependency health, workspace readiness, and the OpenSpec diagnose report. */
async function runtimeDiagnostics(deps) {
    const { getClient, getWorkspaceProjectId, ensureRuntimeAvailable, output } = deps;
    if (!await ensureRuntimeAvailable()) return;

    const client = getClient();
    const projectRoot = getWorkspaceProjectId();

    output.show(true);
    output.appendLine('\n[diagnostics]');

    // Settled, not all-or-nothing: one unavailable subsystem should not hide
    // the others — that is the whole point of a diagnostics view.
    const [health, readiness, diagnose] = await Promise.all([
        client.health().catch((e) => ({ error: e.message })),
        client.readiness().catch((e) => ({ error: e.message })),
        client.stardustDiagnose(projectRoot).catch((e) => ({ error: e.message }))
    ]);

    const checks = (health && health.checks) || health || {};
    for (const name of ['ctx', 'graphify', 'openspec', 'ollama']) {
        const c = checks[name];
        const mark = c ? (c.ok === true ? 'ok  ' : c.ok === false ? 'FAIL' : '... ') : '?   ';
        output.appendLine(`  ${mark} ${name.padEnd(10)} ${c ? (c.message || c.version || '') : 'not reported'}`);
    }

    if (readiness && !readiness.error) {
        output.appendLine(`  readiness: ${readiness.overall} (trustworthy: ${readiness.trustworthy})`);
        for (const w of readiness.workspaces || []) {
            output.appendLine(`    ${w.state.padEnd(10)} ${w.path}`);
            if (w.action) output.appendLine(`      → ${w.action}`);
        }
    } else if (readiness) {
        output.appendLine(`  readiness unavailable: ${readiness.error}`);
    }

    if (diagnose && !diagnose.error) {
        output.appendLine(`  openspec: installed=${diagnose.installed} version=${diagnose.version || 'n/a'}`);
    }

    const summary = readiness && !readiness.error
        ? `Readiness: ${readiness.overall}`
        : 'Runtime diagnostics written to the YodaMan output channel.';
    vscode.window.showInformationMessage(`YodaMan — ${summary}`);
}

/** Pending write proposals, so approvals are reachable without a live task. */
async function showPendingApprovals(deps) {
    const { getClient, ensureRuntimeAvailable, output } = deps;
    if (!await ensureRuntimeAvailable()) return;

    try {
        const result = await getClient().pendingApprovals();
        const approvals = Array.isArray(result) ? result : [];
        if (!approvals.length) {
            vscode.window.showInformationMessage('YodaMan: no pending approvals.');
            return;
        }
        const picked = await vscode.window.showQuickPick(
            approvals.map((a) => ({
                label: a.approval?.params?.filePath || a.taskId,
                description: a.task || '',
                approval: a
            })),
            { title: 'Pending write proposals', placeHolder: 'Select one to inspect' }
        );
        if (!picked) return;

        output.show(true);
        output.appendLine(`\n[approval] ${picked.label}`);
        output.appendLine(JSON.stringify(picked.approval, null, 2));

        const choice = await vscode.window.showWarningMessage(
            `Approve the proposed write to ${picked.label}?`,
            { modal: true },
            'Approve',
            'Reject'
        );
        if (!choice) return;
        await getClient().approve(picked.approval.taskId, choice === 'Approve');
        vscode.window.showInformationMessage(`YodaMan: ${choice.toLowerCase()}ed ${picked.label}.`);
    } catch (error) {
        vscode.window.showErrorMessage(`YodaMan approvals failed: ${error.message}`);
    }
}

/** Loaded plugins and their permissions. */
async function listPlugins(deps) {
    const { getClient, ensureRuntimeAvailable, output } = deps;
    if (!await ensureRuntimeAvailable()) return;

    try {
        const result = await getClient().plugins();
        const plugins = Array.isArray(result) ? result : result.plugins || [];
        if (!plugins.length) {
            vscode.window.showInformationMessage('YodaMan: no plugins loaded.');
            return;
        }
        const picked = await vscode.window.showQuickPick(
            plugins.map((p) => ({
                label: p.name,
                description: p.enabled === false ? 'disabled' : 'enabled',
                detail: p.description,
                plugin: p
            })),
            { title: `Plugins (${plugins.length})`, placeHolder: 'Loaded plugins' }
        );
        if (picked) {
            output.show(true);
            output.appendLine(`\n[plugin] ${picked.label}`);
            output.appendLine(JSON.stringify(picked.plugin, null, 2));
        }
    } catch (error) {
        vscode.window.showErrorMessage(`YodaMan plugins failed: ${error.message}`);
    }
}

module.exports = {
    init,
    impactForActiveFile,
    showStardustBoard,
    publishDrift,
    clearDrift,
    runtimeDiagnostics,
    showPendingApprovals,
    listPlugins
};
