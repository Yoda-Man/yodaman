import React, { useState, useEffect } from 'react';
import { Puzzle, Upload, Trash2, CheckCircle, Plus, Terminal, Zap, FileCode, BookOpen } from 'lucide-react';
import { api } from '../api/api';
import PluginAuthoringGuide from './PluginAuthoringGuide';

export default function PluginsWindow() {
    const [plugins, setPlugins] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [status, setStatus] = useState(null);
    // 'marketplace' | 'docs'. The docs used to be a plain <a> to /manual.html,
    // which left the SPA entirely — no tab bar, no way back to the agent.
    const [view, setView] = useState('marketplace');

    useEffect(() => {
        loadPlugins();
    }, []);

    const loadPlugins = async () => {
        try {
            const data = await api.getPlugins();
            setPlugins(data);
        } catch (err) {
            console.error('Failed to load plugins:', err);
        }
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        console.log('[PluginUpload] File selected:', file.name, Math.round(file.size/1024)+'KB');

        setIsUploading(true);
        setStatus({ type: 'info', message: `Uploading ${file.name}...` });

        try {
            console.log('[PluginUpload] Sending POST /api/plugins...');
            const result = await api.uploadPlugin(file);
            console.log('[PluginUpload] Upload response:', result);
            setStatus({ type: 'success', message: `${file.name} successfully loaded!` });
            loadPlugins();
        } catch (err) {
            const detail = err.payload?.error || err.message || 'Unknown error';
            console.error('[PluginUpload] FAILED:', err.status, detail);
            setStatus({ type: 'error', message: `Upload failed: ${detail}` });
        } finally {
            setIsUploading(false);
            setTimeout(() => setStatus(null), 3000);
        }
    };

    const deletePlugin = async (name) => {
        if (!window.confirm(`Are you sure you want to remove the '${name}' plugin?`)) return;
        try {
            await api.deletePlugin(name);
            loadPlugins();
        } catch (err) {
            console.error('Delete failed:', err);
        }
    };

    if (view === 'docs') {
        return <PluginAuthoringGuide onBack={() => setView('marketplace')} />;
    }

    return (
        <div className="h-full overflow-y-auto custom-scrollbar bg-[#020617] text-slate-300">
            <div className="max-w-6xl mx-auto py-20 px-8">
                <header className="mb-10 flex items-center justify-between">
                    <div>
                        <h1 className="text-5xl font-black tracking-tighter text-white mb-2">
                            Plugin <span className="text-purple-500">Marketplace</span>
                        </h1>
                        <p className="text-slate-500 font-medium">Extend Yoda-Agent's intelligence with custom JS skills.</p>
                    </div>

                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => setView('docs')}
                            className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 transition-all active:scale-95"
                            title="How to build a plugin"
                        >
                            <BookOpen size={18} />
                            <span className="font-bold text-sm">Docs</span>
                        </button>
                        <button
                            onClick={loadPlugins}
                            className="h-12 w-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-all active:scale-95"
                            title="Refresh Plugins"
                        >
                            <Zap size={20} />
                        </button>
                        <label className="cursor-pointer group relative">
                            <input type="file" accept=".js,.zip" onChange={handleFileUpload} className="hidden" disabled={isUploading} />
                            <div className="flex items-center gap-3 px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-2xl transition-all shadow-2xl shadow-purple-500/20 active:scale-95">
                                <Plus size={20} />
                                <span className="font-bold text-sm">Install Plugin</span>
                            </div>
                        </label>
                    </div>
                </header>

                {status && (
                    <div className={`mb-8 p-4 rounded-2xl border flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300 ${
                        status.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 
                        status.type === 'error' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : 
                        'bg-indigo-500/10 border-indigo-500/20 text-indigo-400'
                    }`}>
                        {status.type === 'success' ? <CheckCircle size={18} /> : <Zap size={18} className="animate-pulse" />}
                        <span className="text-sm font-bold">{status.message}</span>
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {/* Native Tools Info */}
                    <div className="p-8 rounded-[32px] bg-white/[0.02] border border-white/5 flex flex-col justify-between group hover:bg-white/[0.04] transition-all">
                        <div>
                            <div className="h-12 w-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center mb-6">
                                <Terminal size={24} className="text-indigo-400" />
                            </div>
                            <h3 className="text-xl font-bold text-white mb-2">Native Core</h3>
                            <p className="text-xs text-slate-500 leading-relaxed">
                                Built-in tools for file I/O, search, and system commands. These are the foundations of Yoda-Agent.
                            </p>
                        </div>
                        <div className="mt-8 flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500/50">Core System</span>
                            <span className="px-2 py-0.5 rounded-full bg-indigo-500/10 text-[9px] font-bold text-indigo-400">Locked</span>
                        </div>
                    </div>

                    {/* Custom Plugins */}
                    {plugins.map((plugin, idx) => (
                        <div key={idx} className="p-8 rounded-[32px] bg-slate-900/40 border border-white/5 flex flex-col justify-between group hover:border-purple-500/30 transition-all relative overflow-hidden shadow-2xl">
                            {plugin.name !== 'graphify' && (
                                <div className="absolute top-0 right-0 p-4">
                                    <button
                                        onClick={() => deletePlugin(plugin.name)}
                                        className="h-8 w-8 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 opacity-0 group-hover:opacity-100 transition-all hover:bg-rose-500 hover:text-white"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            )}

                            <div>
                                <div className="h-12 w-12 rounded-2xl bg-purple-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                                    <Puzzle size={24} className="text-purple-400" />
                                </div>
                                <h3 className="text-xl font-bold text-white mb-2">{plugin.name}</h3>
                                <p className="text-xs text-slate-500 leading-relaxed">
                                    {plugin.description || 'No description provided.'}
                                </p>
                            </div>
                            
                            <div className="mt-8 space-y-3">
                                <div className="flex flex-wrap gap-2">
                                    {(plugin.permissions || []).map(permission => (
                                        <span key={permission} className={`px-2 py-1 rounded-lg text-[9px] font-mono ${permission === 'unrestricted' ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                                            {permission}
                                        </span>
                                    ))}
                                    {Object.keys(plugin.parameters || {}).map(param => (
                                        <span key={param} className="px-2 py-1 rounded-lg bg-black/40 text-[9px] font-mono text-purple-400">
                                            {param}
                                        </span>
                                    ))}
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-purple-500/50">{plugin.name === 'graphify' ? 'Required Graph Layer' : 'Custom Skill'}</span>
                                    <div className="flex items-center gap-1.5">
                                        <div className="h-1.5 w-1.5 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
                                        <span className="text-[9px] font-bold text-emerald-500 uppercase">{plugin.restricted ? 'Restricted' : 'Active'}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}

                    {/* Empty State / Add New */}
                    {plugins.length === 0 && (
                         <label className="p-8 rounded-[32px] bg-dashed border-2 border-white/5 border-dashed flex flex-col items-center justify-center gap-4 cursor-pointer hover:bg-white/5 transition-all text-slate-600 hover:text-slate-400 group">
                            <input type="file" accept=".js" onChange={handleFileUpload} className="hidden" />
                            <div className="h-12 w-12 rounded-full border border-current flex items-center justify-center group-hover:scale-110 transition-transform">
                                <Upload size={24} />
                            </div>
                            <span className="text-xs font-bold uppercase tracking-widest">Drop a skill here</span>
                         </label>
                    )}
                </div>

                <div className="mt-24 p-12 rounded-[40px] bg-gradient-to-br from-purple-600/10 to-indigo-600/10 border border-white/5 relative overflow-hidden">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-purple-600/5 rounded-full blur-[100px] pointer-events-none"></div>
                    <div className="relative z-10 flex flex-col md:flex-row items-center gap-12">
                        <div className="flex-1 space-y-6">
                            <h2 className="text-3xl font-black text-white">Need a custom skill?</h2>
                            <p className="text-slate-400 leading-relaxed">
                                You can build your own plugins using standard JavaScript. Every plugin you upload is instantly learned by the Yoda-Agent reasoning engine.
                            </p>
                            <div className="flex flex-wrap items-center gap-6">
                                {/* In-app so the Back button can return here. A plain link to
                                    /manual.html leaves the SPA and strands the user. */}
                                <button
                                    onClick={() => setView('docs')}
                                    className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-purple-400 hover:text-purple-300 transition-colors"
                                >
                                    <FileCode size={14} /> View Documentation
                                </button>
                                <a
                                    href="/manual.html#plugins"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-300 transition-colors"
                                >
                                    <BookOpen size={14} /> Full manual
                                </a>
                            </div>
                        </div>
                        <div className="w-full md:w-80 h-48 rounded-3xl bg-black/40 border border-white/10 p-6 font-mono text-[10px] text-slate-500 overflow-hidden relative">
                            <div className="absolute top-0 left-0 right-0 h-8 bg-white/5 flex items-center px-4 gap-1.5">
                                <div className="w-2 h-2 rounded-full bg-rose-500/50"></div>
                                <div className="w-2 h-2 rounded-full bg-amber-500/50"></div>
                                <div className="w-2 h-2 rounded-full bg-emerald-500/50"></div>
                            </div>
                            <div className="mt-6">
                                <span className="text-purple-400">module</span>.<span className="text-white">exports</span> = {'{'} <br/>
                                &nbsp;&nbsp;name: <span className="text-emerald-400">'mySkill'</span>, <br/>
                                &nbsp;&nbsp;description: <span className="text-emerald-400">'...'</span>, <br/>
                                &nbsp;&nbsp;permissions: [<span className="text-emerald-400">'read'</span>], <br/>
                                &nbsp;&nbsp;<span className="text-indigo-400">async</span> execute(params) {'{'} <br/>
                                &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-slate-600">// Logic here</span> <br/>
                                &nbsp;&nbsp;{'}'} <br/>
                                {'}'}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
