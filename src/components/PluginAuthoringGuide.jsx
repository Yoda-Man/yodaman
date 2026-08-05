/**
 * PluginAuthoringGuide — the "how do I actually build one" half of the Plugins page.
 *
 * Lives inside the SPA rather than behind a link to /manual.html. The manual is a
 * separate document with no app chrome, so following a plain <a> to it left the
 * page with no way back to the agent. This renders in place, keeps the tab bar,
 * and hands back via onBack.
 *
 * Everything here is checked against the real loader rather than written from
 * memory — the contract is ToolBox.validatePlugin / normalizePluginPermissions
 * (backend/infrastructure/ToolBox.js) and the upload route
 * POST /api/plugins (backend/interfaces/RestController.js). The permission list
 * is PLUGIN_PERMISSION_ALLOWLIST; the model-facing signature is built by
 * ToolBox.getToolDefinitions().
 */

import React, { useState } from 'react';
import {
    ArrowLeft, FileCode, Puzzle, ShieldCheck, Terminal, Zap, AlertTriangle,
    BookOpen, GitBranch, Upload, ExternalLink, CheckCircle2, Copy, Check,
} from 'lucide-react';

// Mirrors PLUGIN_PERMISSION_ALLOWLIST in backend/infrastructure/ToolBox.js.
// Anything not on this list makes the plugin fail to load with
// "declares unsupported permissions".
const PERMISSIONS = [
    ['read', 'Read files inside the workspace.', 'safe'],
    ['write', 'Create or modify files.', 'care'],
    ['command', 'Run shell commands (still subject to the blocked-command policy).', 'care'],
    ['network', 'Make outbound HTTP requests.', 'care'],
    ['search', 'Query the retrieval index.', 'safe'],
    ['graphify:read', 'Read the knowledge graph — use this instead of scanning the filesystem.', 'safe'],
    ['git:read', 'Read git history and status.', 'safe'],
    ['agent:invoke', 'Start a nested agent task.', 'care'],
    ['task:create', 'Queue background work.', 'safe'],
    ['audit:write', 'Append entries to the audit log.', 'safe'],
    ['upload:temp', 'Read files from the temporary upload directory.', 'safe'],
    ['filesystem:read-selected', 'Read a user-picked file outside the workspace.', 'care'],
    ['desktop:openFile', 'Open a file in the desktop app.', 'safe'],
    ['storage:indexeddb', 'Persist state in the browser (UI plugins).', 'safe'],
    ['webxr', 'Use the WebXR surface (Holocron VR style plugins).', 'safe'],
    ['speech', 'Use speech input/output.', 'safe'],
    ['unrestricted', 'No sandbox. Blocked unless "Allow unrestricted plugins" is on in Settings.', 'danger'],
];

const MINIMAL = `// core/plugins/Kyber-Count.js
const fs = require('fs');
const path = require('path');

module.exports = {
    // The tool name the model emits in its tool_call. Keep it unique and
    // free of spaces — this exact string is what gets matched.
    name: 'Kyber-Count',

    // This IS the prompt. It is the only thing that decides whether the
    // model reaches for your plugin, so name the triggers explicitly.
    description: 'Counts lines of code per file extension in a workspace. ' +
        '💡 Chat usage: "count the lines in this project" or "run Kyber-Count".',

    // Required for uploaded plugins. Omitting it means ['unrestricted'],
    // which is refused at call time unless enabled in Settings.
    permissions: ['read'],

    // Only the KEYS reach the model — it sees Kyber-Count(workspacePath).
    // Put the meaning of each parameter in the description above.
    parameters: {
        workspacePath: {
            type: 'string',
            required: true,
            description: 'Absolute path to the project to analyze'
        }
    },

    async execute(params = {}) {
        // Insist on the path. Falling back to the current working directory
        // gives you the runtime's directory, never the user's workspace.
        if (!params.workspacePath) {
            // A returned error is data the model can recover from.
            // A thrown error ends the step.
            return { error: 'workspacePath is required (absolute path to the project).' };
        }
        const root = path.resolve(params.workspacePath);
        if (!fs.existsSync(root)) {
            return { error: \`Path not found: \${root}\` };
        }

        const counts = {};
        const walk = (dir, depth = 0) => {
            if (depth > 8) return;
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) { walk(full, depth + 1); continue; }
                const ext = path.extname(entry.name) || '(none)';
                counts[ext] = (counts[ext] || 0) + 1;
            }
        };
        walk(root);

        // Keep the return small. The whole object is JSON.stringify'd into the
        // model's context, so a 200-file dump costs you the rest of the task.
        const top = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        return {
            project: root,
            fileCount: Object.values(counts).reduce((a, b) => a + b, 0),
            topExtensions: Object.fromEntries(top)
        };
    }
};`;

const GRAPH_AWARE = `// Prefer the graph over the filesystem. It holds import edges resolved by a
// real parser, so it is not fooled by aliased imports, dynamic requires, or two
// files sharing a basename — and one graph read replaces a whole tree walk.
const graphFacts = require('../backend/infrastructure/GraphFacts');

module.exports = {
    name: 'Dead-Weight',
    description: 'Lists files nothing imports (dead code candidates) using the ' +
        'knowledge graph. 💡 Chat usage: "what code is unused here?"',
    permissions: ['read', 'graphify:read'],
    parameters: {
        workspacePath: { type: 'string', required: true, description: 'Absolute project path' }
    },

    async execute({ workspacePath } = {}) {
        // Read the graph once and reuse it for every question you ask.
        const facts = graphFacts.load(workspacePath);
        if (!facts) {
            return {
                error: 'No knowledge graph for this workspace yet.',
                hint: 'Sync the repository from the sidebar, then run this again.'
            };
        }

        const orphans = graphFacts.orphanFiles(workspacePath, { facts }) || [];
        const central = graphFacts.centralFiles(workspacePath, { facts, limit: 5 }) || [];

        return {
            method: 'graph',
            nodeCount: facts.nodeCount,
            orphanCount: orphans.length,
            orphans: orphans.slice(0, 20).map(o => o.file),
            busiestFiles: central.map(c => \`\${c.file} (\${c.connections} edges)\`)
        };
    }
};`;

const LIFECYCLE = `// Long-running or UI-facing plugins can use the lifecycle form instead of
// execute(). ToolBox wraps these into an execute() for you and injects a
// PluginAPI instance (see backend/infrastructure/PluginAPI.js).
module.exports = {
    name: 'Holocron-Bridge',
    description: 'Registers a Holocron VR panel and a keyboard shortcut.',
    permissions: ['read', 'webxr'],

    async onLoad(api) {
        api.log.info('Holocron bridge loaded');
        api.ui.registerPluginCard({ id: 'holocron', label: 'Holocron VR' });
    },
    async onEnable(api) {
        api.ui.registerShortcut({ id: 'holo.open', label: 'Open Holocron', keys: 'Cmd+Shift+H' });
    },
    async onDisable(api) {
        api.ui.unregisterShortcut('holo.open');
    },
    async onUnload(api) {
        api.worker.terminateAll();
    }
};

// api surface: api.log.{info,warn,error} · api.ui.{registerPluginCard,openModal,
// registerShortcut,unregisterShortcut} · api.fetch(url, opts) · api.worker.run
// · api.config.get`;

export default function PluginAuthoringGuide({ onBack }) {
    return (
        <div className="h-full overflow-y-auto custom-scrollbar bg-[#020617] text-slate-300">
            {/* Sticky bar so Back is reachable from anywhere in a long document. */}
            <div className="sticky top-0 z-20 backdrop-blur-xl bg-[#020617]/85 border-b border-white/5">
                <div className="max-w-5xl mx-auto px-8 py-4 flex items-center justify-between gap-4">
                    <button
                        onClick={onBack}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-bold uppercase tracking-widest text-slate-300 hover:text-white hover:bg-white/10 transition-all active:scale-95"
                    >
                        <ArrowLeft size={14} />
                        Back to Plugins
                    </button>
                    <a
                        href="/manual.html#plugins"
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-purple-300 transition-colors"
                    >
                        <ExternalLink size={12} />
                        Full manual
                    </a>
                </div>
            </div>

            <div className="max-w-5xl mx-auto px-8 pt-12 pb-24 space-y-12">
                <header className="space-y-4">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20">
                        <BookOpen size={12} className="text-purple-400" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-purple-400">Plugin Documentation</span>
                    </div>
                    <h1 className="text-4xl font-black tracking-tighter text-white">
                        Building a <span className="text-purple-500">Skill</span>
                    </h1>
                    <p className="text-slate-400 leading-relaxed max-w-3xl">
                        A plugin is one CommonJS file that exports an object. Drop it in{' '}
                        <Code>core/plugins/</Code> and the agent can call it by name on the next
                        load — no build step, no registration, no restart of the UI.
                    </p>
                </header>

                <Section n="1" title="The contract" icon={Puzzle}>
                    <p className="text-sm text-slate-400 leading-relaxed mb-4">
                        The loader (<Code>ToolBox.validatePlugin</Code>) enforces exactly two
                        things. Everything else is optional but shapes how well the model uses
                        your tool.
                    </p>
                    <FieldTable rows={[
                        ['name', 'string', 'Required', 'The tool name the model emits. Must be unique across built-ins and plugins.'],
                        ['execute', 'async function', 'Required*', 'Receives the parameters object, returns a JSON-serializable result.'],
                        ['description', 'string', 'Strongly advised', 'Injected verbatim into the system prompt. This is what makes the model choose your tool.'],
                        ['permissions', 'string[]', 'Required for uploads', 'Must contain only allowlisted values. Omitted means ["unrestricted"].'],
                        ['parameters', 'object', 'Advised', 'Only the keys reach the model, as a call signature.'],
                    ]} />
                    <Note icon={AlertTriangle} tone="amber">
                        * <Code>execute</Code> may be replaced by the lifecycle form
                        (<Code>onLoad</Code> / <Code>onEnable</Code>) — see step 6. A plugin with
                        neither is rejected with{' '}
                        <em>"must export an execute function"</em>.
                    </Note>
                </Section>

                <Section n="2" title="A complete plugin" icon={FileCode}>
                    <p className="text-sm text-slate-400 leading-relaxed mb-4">
                        Copy this into <Code>core/plugins/Kyber-Count.js</Code>. It loads as-is.
                    </p>
                    <CodeBlock code={MINIMAL} filename="core/plugins/Kyber-Count.js" />
                </Section>

                <Section n="3" title="How the model sees your plugin" icon={Zap}>
                    <p className="text-sm text-slate-400 leading-relaxed mb-4">
                        Before every task, <Code>ToolBox.getToolDefinitions()</Code> appends one
                        line per plugin to the system prompt. For the example above the model
                        receives:
                    </p>
                    <div className="rounded-2xl bg-black/50 border border-white/10 p-5 font-mono text-[11px] leading-relaxed text-slate-400">
                        <span className="text-slate-600">15. </span>
                        <span className="text-purple-300">Kyber-Count</span>
                        <span className="text-slate-500">(</span>
                        <span className="text-emerald-400">workspacePath</span>
                        <span className="text-slate-500">)</span>: Counts lines of code per file
                        extension in a workspace. 💡 Chat usage: "count the lines in this
                        project" or "run Kyber-Count".
                    </div>
                    <p className="text-sm text-slate-400 leading-relaxed mt-4">
                        Four consequences worth designing around:
                    </p>
                    <Bullets items={[
                        <>Your <Code>type</Code> and <Code>required</Code> flags <strong>do</strong> reach the model, rendered as <Code>workspacePath: string</Code> versus <Code>limit?: number</Code>. A per-parameter <Code>description</Code> is appended in parentheses, so keep it to a few words.</>,
                        <>The description is the entire selection signal. Include the phrases a user would actually type; the shipped plugins use a <Code>💡 Chat usage:</Code> suffix for exactly this. It is capped at 300 characters in the prompt.</>,
                        <><strong>Your signature costs tokens on every reasoning step of every task</strong>, not once. The whole tool block is re-sent each iteration because Context Expert keeps no session, and answer quality degrades measurably as the prompt grows. A plugin nobody uses still taxes every task — disable it.</>,
                        <>The model calls one tool per turn, and a task is capped at 10 turns. A plugin that answers a whole question in one call is worth more than three that each answer a third of it.</>,
                    ]} />
                    <div className="mt-4 rounded-2xl bg-black/50 border border-white/10 p-5 font-mono text-[11px] leading-relaxed">
                        <div className="text-slate-600 mb-2">// What the model then emits:</div>
                        <div className="text-slate-500">&lt;tool_call&gt;</div>
                        <div className="text-slate-300 pl-3">{'{'} <span className="text-cyan-300">"name"</span>: <span className="text-emerald-400">"Kyber-Count"</span>,</div>
                        <div className="text-slate-300 pl-6"><span className="text-cyan-300">"parameters"</span>: {'{'} <span className="text-cyan-300">"workspacePath"</span>: <span className="text-emerald-400">"/Users/you/proj"</span> {'}'} {'}'}</div>
                        <div className="text-slate-500">&lt;/tool_call&gt;</div>
                    </div>
                </Section>

                <Section n="4" title="Permissions" icon={ShieldCheck}>
                    <p className="text-sm text-slate-400 leading-relaxed mb-4">
                        Declare the narrowest set that works. A value outside this list stops the
                        plugin from loading; <Code>unrestricted</Code> loads but is refused at
                        call time unless you have explicitly allowed it in Settings.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {PERMISSIONS.map(([key, blurb, tone]) => (
                            <div key={key} className="rounded-xl bg-white/[0.02] border border-white/5 px-4 py-3">
                                <div className="flex items-center gap-2 mb-1">
                                    <code className={`font-mono text-[11px] font-bold ${
                                        tone === 'danger' ? 'text-rose-400' : tone === 'care' ? 'text-amber-400' : 'text-emerald-400'
                                    }`}>{key}</code>
                                    {tone === 'danger' && <span className="px-1.5 py-0.5 rounded bg-rose-500/10 text-[8px] font-black uppercase tracking-widest text-rose-400">Gated</span>}
                                </div>
                                <p className="text-[11px] text-slate-500 leading-relaxed">{blurb}</p>
                            </div>
                        ))}
                    </div>
                    <Note icon={AlertTriangle} tone="rose">
                        Uploading through <strong>Install Plugin</strong> validates with{' '}
                        <Code>requireExplicitPermissions</Code>, so an uploaded file{' '}
                        <strong>must</strong> declare a <Code>permissions</Code> array — omitting
                        it fails the upload rather than defaulting quietly. Uploads themselves are
                        off until <em>Allow plugin uploads</em> is enabled in Settings; a file
                        copied straight into <Code>core/plugins/</Code> bypasses that gate.
                    </Note>
                </Section>

                <Section n="5" title="Use the graph, not the filesystem" icon={GitBranch}>
                    <p className="text-sm text-slate-400 leading-relaxed mb-4">
                        Structural questions — what imports this, what is unused, what do the
                        tests cover — are already answered by the knowledge graph. Re-deriving
                        them with a tree walk and regex is both slower and wrong at the edges.
                    </p>
                    <CodeBlock code={GRAPH_AWARE} filename="core/plugins/Dead-Weight.js" />
                    <p className="text-xs text-slate-500 leading-relaxed mt-3">
                        <Code>GraphFacts</Code> exposes <Code>load</Code>,{' '}
                        <Code>orphanFiles</Code>, <Code>coverageByFile</Code> and{' '}
                        <Code>centralFiles</Code>. Pass the loaded <Code>facts</Code> into each
                        call so the graph is read once per invocation.
                    </p>
                </Section>

                <Section n="6" title="Lifecycle plugins" icon={Terminal}>
                    <p className="text-sm text-slate-400 leading-relaxed mb-4">
                        A plugin that registers UI, holds a worker, or needs teardown can export
                        lifecycle hooks instead of <Code>execute</Code>. The loader synthesizes an{' '}
                        <Code>execute</Code> that drives them.
                    </p>
                    <CodeBlock code={LIFECYCLE} filename="core/plugins/Holocron-Bridge.js" />
                </Section>

                <Section n="7" title="Install, reload, disable" icon={Upload}>
                    <Steps items={[
                        [<>Drop the <Code>.js</Code> file into <Code>core/plugins/</Code>, or use <strong>Install Plugin</strong> to upload a <Code>.js</Code> or <Code>.zip</Code>. In a zip, <Code>main.js</Code> wins, otherwise the first <Code>.js</Code> found; a bundled <Code>plugin.json</Code> contributes its <Code>permissions</Code>.</>],
                        [<>Press the <strong>⚡ refresh</strong> button on the Plugins page. The loader clears the require cache per file, so an edited plugin is picked up without restarting the runtime.</>],
                        [<>Check the card. If it did not appear, the runtime logs the reason — open <strong>Logs</strong> and look for <Code>Failed to load plugin</Code> or <Code>plugin_upload_failed</Code>.</>],
                        [<>Ask for it in Chat using a phrase from your description. Every call is written to the audit log with its duration and a summarized result.</>],
                        [<>Disabling writes the name to <Code>core/plugins/config.json</Code> and calls <Code>onDisable</Code> if present. Deleting removes the file; the shipped defaults cannot be deleted.</>],
                    ]} />
                </Section>

                <Section n="8" title="Things that will bite you" icon={AlertTriangle}>
                    <div className="space-y-2">
                        <Gotcha problem="The plugin loads but the model never calls it">
                            The description is doing no work. Add the literal phrases a user would
                            type. The model only ever sees <Code>name(params): description</Code>.
                        </Gotcha>
                        <Gotcha problem="Renaming the file did nothing">
                            Plugins are keyed by the exported <Code>name</Code>, not the filename.
                            Two files exporting the same name means the last one loaded wins.
                        </Gotcha>
                        <Gotcha problem="A big result derails the task">
                            The whole return value is <Code>JSON.stringify</Code>'d into the
                            conversation, and the transcript is re-sent on every remaining
                            iteration. Results are clipped at the transcript boundary, so an
                            oversized one is simply truncated — better to cap arrays yourself and
                            return counts alongside a short sample than to have the useful half
                            cut off arbitrarily.
                        </Gotcha>
                        <Gotcha problem="Everything fails with 'declares unsupported permissions'">
                            One of your permission strings is not on the allowlist in step 4.
                            They are lowercased and de-duplicated, but not otherwise mapped.
                        </Gotcha>
                        <Gotcha problem="A crash inside execute ends the whole step">
                            Throwing surfaces as an agent error. Return{' '}
                            <Code>{'{ error, hint }'}</Code> instead when the model could
                            reasonably try something else.
                        </Gotcha>
                        <Gotcha problem="Relative requires resolve oddly">
                            The file is required from <Code>core/plugins/</Code>, so backend
                            modules are <Code>require('../backend/…')</Code>. Node built-ins and
                            anything in the root <Code>node_modules</Code> are available.
                        </Gotcha>
                    </div>
                </Section>

                <div className="rounded-[32px] bg-gradient-to-br from-purple-600/10 to-indigo-600/10 border border-white/5 p-10">
                    <div className="flex items-start gap-4">
                        <CheckCircle2 size={22} className="text-emerald-400 shrink-0 mt-0.5" />
                        <div className="space-y-2">
                            <h3 className="text-lg font-bold text-white">Verify before you ship</h3>
                            <p className="text-sm text-slate-400 leading-relaxed">
                                From <Code>core/</Code>, list what the loader actually registered:
                            </p>
                            <CodeBlock
                                code={`node -e "const t=require('./backend/infrastructure/ToolBox');console.log([...t.plugins.keys()])"`}
                                filename="shell"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Presentational helpers ──

function Code({ children }) {
    return <code className="px-1.5 py-0.5 rounded bg-white/[0.06] font-mono text-[11px] text-purple-300">{children}</code>;
}

function Section({ n, title, icon: Icon, children }) {
    return (
        <section className="space-y-4">
            <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
                    <Icon size={16} className="text-purple-400" />
                </div>
                <h2 className="text-xl font-bold text-white">
                    <span className="text-purple-500/60 font-mono text-sm mr-2">{n}</span>
                    {title}
                </h2>
            </div>
            <div className="pl-0 md:pl-12">{children}</div>
        </section>
    );
}

function CodeBlock({ code, filename }) {
    const [copied, setCopied] = useState(false);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
        } catch (_) { /* clipboard unavailable — the code is still selectable */ }
    };

    return (
        <div className="rounded-2xl bg-black/50 border border-white/10 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-white/[0.03] border-b border-white/5">
                <span className="font-mono text-[10px] text-slate-500">{filename}</span>
                <button
                    onClick={copy}
                    className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-purple-300 transition-colors"
                >
                    {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                    {copied ? 'Copied' : 'Copy'}
                </button>
            </div>
            <pre className="p-5 overflow-x-auto custom-scrollbar">
                <code className="font-mono text-[11px] leading-relaxed text-slate-300 whitespace-pre">{code}</code>
            </pre>
        </div>
    );
}

function FieldTable({ rows }) {
    return (
        <div className="rounded-2xl border border-white/5 overflow-hidden">
            <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse min-w-[560px]">
                    <thead>
                        <tr className="bg-white/[0.03]">
                            {['Field', 'Type', 'Required', 'Notes'].map(h => (
                                <th key={h} className="px-4 py-2.5 text-[9px] font-black uppercase tracking-widest text-slate-500">{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(([field, type, required, notes]) => (
                            <tr key={field} className="border-t border-white/[0.04]">
                                <td className="px-4 py-3 font-mono text-[11px] text-purple-300 whitespace-nowrap">{field}</td>
                                <td className="px-4 py-3 font-mono text-[10px] text-slate-500 whitespace-nowrap">{type}</td>
                                <td className="px-4 py-3 text-[10px] font-bold whitespace-nowrap">
                                    <span className={required.startsWith('Required') ? 'text-rose-400' : 'text-slate-500'}>{required}</span>
                                </td>
                                <td className="px-4 py-3 text-[11px] text-slate-400 leading-relaxed">{notes}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function Note({ icon: Icon, tone, children }) {
    const tones = {
        amber: 'border-amber-500/20 bg-amber-500/[0.06] text-amber-200/80',
        rose: 'border-rose-500/20 bg-rose-500/[0.06] text-rose-200/80',
    };
    return (
        <div className={`mt-4 rounded-2xl border px-5 py-4 flex items-start gap-3 ${tones[tone] || tones.amber}`}>
            <Icon size={15} className="shrink-0 mt-0.5" />
            <p className="text-[11px] leading-relaxed">{children}</p>
        </div>
    );
}

function Bullets({ items }) {
    return (
        <ul className="space-y-2.5">
            {items.map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-purple-500/50 shrink-0" />
                    <span className="text-sm text-slate-400 leading-relaxed">{item}</span>
                </li>
            ))}
        </ul>
    );
}

function Steps({ items }) {
    return (
        <ol className="space-y-3">
            {items.map(([body], i) => (
                <li key={i} className="flex items-start gap-4">
                    <span className="shrink-0 h-6 w-6 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center font-mono text-[10px] font-bold text-purple-400">
                        {i + 1}
                    </span>
                    <span className="text-sm text-slate-400 leading-relaxed pt-0.5">{body}</span>
                </li>
            ))}
        </ol>
    );
}

function Gotcha({ problem, children }) {
    return (
        <details className="group rounded-2xl bg-white/[0.02] border border-white/5 open:border-purple-500/20 transition-colors">
            <summary className="px-5 py-3.5 cursor-pointer list-none flex items-center justify-between gap-3">
                <span className="text-sm font-bold text-slate-300 group-open:text-white">{problem}</span>
                <span className="text-purple-500/60 font-mono text-xs shrink-0 group-open:rotate-90 transition-transform">›</span>
            </summary>
            <p className="px-5 pb-4 text-[11px] text-slate-500 leading-relaxed">{children}</p>
        </details>
    );
}
