import React from 'react';
import {
    Book,
    Bot,
    CheckCircle2,
    Code2,
    Database,
    FolderCog,
    GitBranch,
    Laptop,
    Link,
    Plug,
    Search,
    Shield,
    Smartphone,
    Terminal,
    Wrench
} from 'lucide-react';

const featureGroups = [
    {
        icon: FolderCog,
        title: 'Workspaces',
        items: [
            'Register absolute project folders by pasting a path, browsing in desktop clients, or using the desktop Add Project Folder command.',
            'Select the active workspace from the sidebar before chatting, searching, or reindexing.',
            'Edit a tracked path when a repository moves, delete stale workspaces, validate health, and sync indexes.'
        ]
    },
    {
        icon: Bot,
        title: 'Chat and agent work',
        items: [
            'Ask project questions from the Chat tab using the selected workspace context.',
            'Toggle between Code mode and Docs mode using the Code/Docs buttons next to the chat title.',
            'Yoda-Agent loads a default coding skill for assumptions, simplicity, surgical edits, and verification.',
            'Agent tasks stream tool events, can be cancelled, and pause for approval before applying writes.',
            'An animated processing indicator shows when the agent is thinking, with a "still working" fallback after 10 seconds on slow connections.',
            'Use the 🗑 Clear button to reset the conversation and start fresh follow-up questions.'
        ]
    },
    {
        icon: GitBranch,
        title: 'Graphify',
        items: [
            'Graphify is required in version 0.3.3 and uses Ollama local execution only for semantic extraction.',
            'Graphify builds knowledge graphs for code, docs, diagrams, and architecture.',
            'Sync Repository updates the Context Expert index and the Graphify graph together.',
            'Run yodaman doctor --graph to check active graphs, freshness, orphaned nodes, and the most dependency-heavy file.',
            'Chat and agent answers include graph report context plus question-specific graph traversal.',
            'The Graph tab opens Graph Studio for visualizations, report reading, graph queries, impact analysis, and architecture maps.'
        ]
    },
    {
        icon: Search,
        title: 'Search',
        items: [
            'Run semantic search across indexed code and documentation.',
            'Search can target the selected project so results stay focused.',
            'Use Sync Repository after large changes or when search results look stale.'
        ]
    },
    {
        icon: Plug,
        title: 'Plugins',
        items: [
            'Upload JavaScript plugins from the Plugins tab or place them in the plugins directory.',
            'Plugins expose a name, description, parameters, permissions, and an async execute function.',
            'Three pre-installed plugins come with YodaMan: CodeTrooper (count lines of code), Droid-Sweep (find unused files), and Lightsaber (Git hotspot analysis). Enable or disable any plugin from Settings → Developer Settings.',
            'Plugin uploads, unrestricted plugins, and agent shell commands can be toggled from Settings → Developer Settings without restarting the server.'
        ]
    },
    {
        icon: Database,
        title: 'Persistence and audit',
        items: [
            'Task history and audit logs persist locally in SQLite when available.',
            'YodaMan falls back to JSON files on Node runtimes without SQLite support.',
            'Clients can search runtime logs by text, severity, level, and user action, inspect index queue state, and clear task history or audit logs.'
        ]
    },
    {
        icon: Laptop,
        title: 'Developer Settings',
        items: [
            'All environment-level settings (plugin uploads, unrestricted plugins, agent shell commands, pairing tokens) are now managed from Settings → Developer Settings.',
            'Changes take effect immediately — no server restart required.',
            'Settings are persisted in config.json and can still be overridden by environment variables.'
        ]
    },
    {
        icon: Laptop,
        title: 'Desktop shell',
        items: [
            'The Electron app starts or reuses the local runtime on port 3090.',
            'Menu and tray actions show the app, restart the managed runtime, copy mobile pairing links, add folders, or quit.',
            'If the runtime fails, the recovery screen shows the YodaMan logo, recent logs, retry/status actions, and Copy Error.'
        ]
    },
    {
        icon: Code2,
        title: 'VS Code extension',
        items: [
            'Check runtime status, start the runtime, ask, search, and reindex from the command palette.',
            'Add a workspace by browsing for a folder, pasting an absolute path, or registering the current VS Code workspace.',
            'Open searchable runtime logs to inspect request, reindex, agent, search, and indexing output.',
            'Run agent tasks, inspect streamed events, open proposed writes as diffs, and approve or reject changes.',
            'Use the YodaMan activity bar sidebar for workspace state, task details, and clear-history actions.'
        ]
    },
    {
        icon: Smartphone,
        title: 'Mobile companion',
        items: [
            'Pair with yodaman:// links generated by the desktop menu or Dashboard.',
            'List projects, choose a workspace, ask, search, inspect task timelines, and cancel active tasks.',
            'Review pending approvals from the phone when it can reach the desktop runtime on the same network.'
        ]
    }
];

export default function ManualWindow() {
    return (
        <div className="h-full overflow-y-auto custom-scrollbar bg-[#020617] text-slate-300 selection:bg-indigo-500/30">
            <div className="max-w-5xl mx-auto py-16 px-8">
                <header className="mb-14">
                    <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-slate-900 border border-white/10 shadow-2xl mb-6">
                        <Book size={32} className="text-indigo-400" />
                    </div>
                    <h1 className="text-5xl font-black tracking-tight mb-4 text-white">
                        YodaMan Manual
                    </h1>
                    <p className="text-lg leading-relaxed text-slate-400 max-w-3xl">
                        YodaMan 0.3.3 is a local-first workspace intelligence system for developers. It connects the web UI, desktop app, VS Code extension, mobile companion, CLI runtime, mandatory Graphify knowledge graphs, plugins, search, chat, supervised agent workflows, and a growing ecosystem of pre-installed tools around one private local runtime.
                    </p>
                    <div className="mt-6 flex flex-wrap items-center gap-3">
                        <span className="px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-[10px] font-black uppercase tracking-widest text-indigo-400">Version 0.3.3</span>
                        <span className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-black uppercase tracking-widest text-emerald-400">Local runtime</span>
                        <span className="px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-[10px] font-black uppercase tracking-widest text-cyan-300">Graphify required</span>
                        <span className="px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-[10px] font-black uppercase tracking-widest text-amber-300">Human approved writes</span>
                    </div>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-14">
                    <InfoCard icon={Terminal} title="Start" text="Run npm start for the runtime, npm run client for the web UI, or npm run desktop for Electron." />
                    <InfoCard icon={Wrench} title="Configure" text="Open Settings from the top-right button, paste an absolute path, or browse with the desktop folder picker." />
                    <InfoCard icon={Link} title="Pair" text="Use Dashboard or the desktop menu to create a mobile pairing link." />
                </div>

                <section className="mb-14">
                    <h2 className="text-2xl font-black text-white mb-5 flex items-center gap-3">
                        <Shield size={22} className="text-indigo-400" />
                        How YodaMan works
                    </h2>
                    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 text-sm leading-7 text-slate-400">
                        YodaMan watches registered folders, indexes local code and docs through Context Expert, builds mandatory Graphify knowledge graphs, and exposes that context through a local Express API at <code>http://localhost:3090</code>. The React client, Electron shell, VS Code extension, and mobile app all talk to the same runtime. File-changing agent work is designed to be supervised: proposed writes are surfaced for approval before they are applied.
                    </div>
                </section>

                <section className="mb-14">
                    <h2 className="text-2xl font-black text-white mb-5 flex items-center gap-3">
                        <CheckCircle2 size={22} className="text-emerald-400" />
                        Features
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {featureGroups.map(group => (
                            <FeatureGroup key={group.title} {...group} />
                        ))}
                    </div>
                </section>

                <section className="mb-14">
                    <h2 className="text-2xl font-black text-white mb-5">Quick commands</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <CommandBlock title="Install and run" code={`npm install -g @contextexpert/cli\nnpm install -g @fission-ai/openspec@latest\npython3 -m pip install graphifyy\nnpm install\nsh setup.sh\nnpm start`} />
                        <CommandBlock title="Develop and verify" code={`npm run client\nnpm test\nnpm run build\nnpm run release:smoke`} />
                        <CommandBlock title="Dependency health" code={`yodaman doctor\nyodaman doctor --json`} />
                        <CommandBlock title="Graphify health" code={`yodaman doctor --graph`} />
                        <CommandBlock title="Desktop builds" code={`npm run desktop\nnpm run desktop:pack\nnpm run desktop:dist`} />
                        <CommandBlock title="VS Code extension" code={`cd extensions/vscode-yodaman\nnpm install\nnpm run lint\nnpm run package`} />
                    </div>
                </section>

                <section>
                    <h2 className="text-2xl font-black text-white mb-5">Troubleshooting</h2>
                    <div className="space-y-3 text-sm text-slate-400">
                        <Trouble title="Runtime unreachable" text="Confirm port 3090 is free, then use YodaMan > Restart Managed Runtime or run yodaman from Terminal." />
                        <Trouble title="Not sure what is missing" text="Run yodaman doctor for a full report on Ollama, ctx, Graphify, and OpenSpec, including the install command for anything missing." />
                        <Trouble title="Context Expert missing" text="Install @contextexpert/cli and verify ctx --version works in your shell." />
                        <Trouble title="Graphify missing" text="Install graphifyy, verify graphify --help works, or set YODAMAN_GRAPHIFY_BIN to the executable path." />
                        <Trouble title="OpenSpec missing" text="Install @fission-ai/openspec@latest and verify openspec --version works, or use Install Now in the Stardust tab or the desktop diagnostics screen." />
                        <Trouble title="Graph health warnings" text="Run yodaman doctor --graph, then sync the affected workspace if orphaned nodes or missing graphs are reported." />
                        <Trouble title="Moved repository" text="Open Settings, edit the workspace path, save, then run Sync Repository." />
                        <Trouble title="Search looks stale" text="Select the workspace and run Sync Repository to queue a fresh index." />
                        <Trouble title="Plugin blocked" text="Add explicit plugin permissions or set YODAMAN_ALLOW_UNRESTRICTED_PLUGINS=true only for trusted plugins." />
                        <Trouble title="Crash screen" text="Use Copy Error to capture the exact runtime message and recent logs for support." />
                    </div>
                </section>
            </div>
        </div>
    );
}

function InfoCard({ icon: Icon, title, text }) {
    return (
        <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-5">
            <Icon size={20} className="text-indigo-400 mb-4" />
            <h3 className="font-bold text-white mb-2">{title}</h3>
            <p className="text-xs leading-6 text-slate-500">{text}</p>
        </div>
    );
}

function FeatureGroup({ icon: Icon, title, items }) {
    return (
        <div className="rounded-2xl bg-slate-900/50 border border-white/5 p-6">
            <h3 className="font-bold text-white mb-4 flex items-center gap-3">
                <Icon size={18} className="text-indigo-400" />
                {title}
            </h3>
            <ul className="space-y-3">
                {items.map(item => (
                    <li key={item} className="text-xs leading-6 text-slate-500">{item}</li>
                ))}
            </ul>
        </div>
    );
}

function CommandBlock({ title, code }) {
    return (
        <div className="rounded-2xl bg-black/35 border border-white/5 p-5">
            <h3 className="font-bold text-slate-200 text-sm mb-3">{title}</h3>
            <pre className="text-xs leading-6 text-indigo-200 overflow-x-auto"><code>{code}</code></pre>
        </div>
    );
}

function Trouble({ title, text }) {
    return (
        <div className="rounded-xl bg-white/[0.02] border border-white/5 p-4">
            <div className="font-bold text-slate-200 mb-1">{title}</div>
            <div>{text}</div>
        </div>
    );
}
