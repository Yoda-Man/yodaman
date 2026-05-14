import React from 'react';
import { Book, CheckCircle, Zap, Terminal, Shield, Command, Bot } from 'lucide-react';

export default function ManualWindow() {
    return (
        <div className="h-full overflow-y-auto custom-scrollbar bg-[#020617] text-slate-300 selection:bg-indigo-500/30">
            <div className="max-w-4xl mx-auto py-20 px-8">
                <header class="mb-20 text-center">
                    <div className="inline-flex items-center justify-center h-20 w-20 rounded-3xl bg-slate-900 border border-white/10 shadow-2xl mb-8">
                        <Book size={40} className="text-indigo-400" />
                    </div>
                    <h1 className="text-6xl font-black tracking-tighter mb-4 text-white">
                        YodaMan <span className="text-indigo-500">Manual</span>
                    </h1>
                    <div className="flex items-center justify-center gap-3">
                        <span className="px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-[10px] font-black uppercase tracking-widest text-indigo-400">Version 0.1.4</span>
                        <span className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-black uppercase tracking-widest text-emerald-400">Production Ready</span>
                    </div>
                </header>

                <div className="space-y-20">
                    {/* 1. Introduction */}
                    <section className="relative p-10 rounded-[40px] bg-white/[0.02] border border-white/5 overflow-hidden group">
                        <div className="absolute -top-10 -right-10 opacity-5 group-hover:opacity-10 transition-opacity">
                            <Zap size={200} className="text-indigo-500" />
                        </div>
                        <h2 className="text-3xl font-black text-white mb-6 flex items-center gap-4">
                            <span className="h-8 w-1 bg-indigo-500 rounded-full"></span>
                            1. Introduction
                        </h2>
                        <p className="text-lg leading-relaxed text-slate-400">
                            YodaMan is a professional, full-stack intelligence platform designed for developers who demand total privacy and deep semantic understanding across their entire ecosystem. Unlike rival tools limited to single-project analysis, YodaMan unifies all your projects, documentation, and codebases into a single, coherent knowledge base.
                        </p>
                    </section>

                    {/* 2. Quick Setup */}
                    <section className="space-y-8 px-4">
                        <h2 className="text-3xl font-black text-white flex items-center gap-4">
                            <span className="h-8 w-1 bg-emerald-500 rounded-full"></span>
                            2. Quick Setup
                        </h2>
                        <p className="text-slate-400">The fastest way to initialize the ecosystem on macOS is via the automated doctor script:</p>
                        <div className="bg-black/40 rounded-2xl p-6 border border-white/5 font-mono text-indigo-300 relative group">
                            <code>sh setup.sh</code>
                            <button className="absolute right-4 top-4 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-white">Copy</button>
                        </div>
                        <p className="text-sm italic text-slate-500 border-l-2 border-slate-800 pl-6">
                            This script audits your system, installs missing dependencies (Node.js, Python, Ollama), and launches the GUI automatically.
                        </p>
                    </section>

                    {/* 3. Core Concepts */}
                    <section className="p-10 rounded-[40px] bg-white/[0.02] border border-white/5 grid grid-cols-1 md:grid-cols-2 gap-12">
                        <div className="space-y-4">
                            <h3 className="text-xl font-bold text-indigo-400 flex items-center gap-3">
                                <Zap size={20} />
                                Ecosystem Intelligence
                            </h3>
                            <p className="text-sm leading-relaxed text-slate-500">
                                YodaMan doesn't just look at one folder. It understands your entire digital workspace across disparate projects and documentation sets.
                            </p>
                        </div>
                        <div className="space-y-4">
                            <h3 className="text-xl font-bold text-emerald-400 flex items-center gap-3">
                                <Shield size={20} />
                                Semantic Search
                            </h3>
                            <p className="text-sm leading-relaxed text-slate-500">
                                Understands the <em>meaning</em> of your code. Finds logic patterns and developer intent instead of just raw text matches.
                            </p>
                        </div>
                    </section>

                    {/* 4. Agent Mode (NEW) */}
                    <section className="p-10 rounded-[40px] bg-indigo-500/5 border border-indigo-500/10 relative overflow-hidden group">
                         <div className="absolute -bottom-10 -right-10 opacity-5 group-hover:opacity-10 transition-opacity">
                            <Bot size={200} className="text-indigo-400" />
                        </div>
                        <h2 className="text-3xl font-black text-white mb-6 flex items-center gap-4">
                            <span className="h-8 w-1 bg-indigo-500 rounded-full"></span>
                            4. Autonomous Agent Mode
                        </h2>
                        <p className="text-lg leading-relaxed text-slate-400 mb-8">
                            Yoda-Agent transforms the platform from a passive search engine into an active coding partner.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">
                            <div className="p-6 rounded-3xl bg-slate-900/50 border border-white/5">
                                <h4 className="font-bold text-indigo-400 mb-2">Activation</h4>
                                <p className="text-xs text-slate-500">Toggle "Agent Mode" in any chat. The interface will switch to a multi-step reasoning view where you can monitor tool usage.</p>
                            </div>
                            <div className="p-6 rounded-3xl bg-slate-900/50 border border-white/5">
                                <h4 className="font-bold text-emerald-400 mb-2">Capabilities</h4>
                                <p className="text-xs text-slate-500">The agent can read/write files, execute shell commands, and search indices to solve complex, multi-file refactoring tasks.</p>
                            </div>
                        </div>
                    </section>

                    {/* 5. Troubleshooting */}
                    <section className="px-4 space-y-8">
                        <h2 className="text-3xl font-black text-rose-500 flex items-center gap-4">
                            <span className="h-8 w-1 bg-rose-500 rounded-full"></span>
                            5. Troubleshooting
                        </h2>
                        <div className="space-y-6">
                            <div className="flex gap-4">
                                <div className="h-6 w-6 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center shrink-0">
                                    <AlertTriangle size={12} className="text-rose-500" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-white text-sm mb-1">Engine Not Found</h4>
                                    <p className="text-xs text-slate-500">Ensure @contextexpert/cli is installed globally and in your PATH.</p>
                                </div>
                            </div>
                            <div className="flex gap-4">
                                <div className="h-6 w-6 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center shrink-0">
                                    <AlertTriangle size={12} className="text-rose-500" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-white text-sm mb-1">Slow Indexing</h4>
                                    <p className="text-xs text-slate-500">Large repos take time. Monitor the "Queue" in the Dashboard to track progress.</p>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>

                <footer className="mt-32 pt-12 border-t border-white/5 text-center">
                    <p className="text-[10px] font-black uppercase tracking-[0.5em] text-slate-600">
                        YodaMan Intelligence Ecosystem © 2026
                    </p>
                </footer>
            </div>
        </div>
    );
}

function AlertTriangle({ size, className }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
        </svg>
    );
}
