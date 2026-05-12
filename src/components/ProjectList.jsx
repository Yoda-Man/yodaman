import { useState } from 'react'
import { Settings, RefreshCw, CheckCircle, Circle, Folder, Plus, CheckCircle2, AlertCircle } from 'lucide-react'

export default function ProjectList({ 
    projects, 
    selectedProject, 
    onSelect, 
    onToggle, 
    onReindex, 
    onOpenSettings 
}) {
    const [checking, setChecking] = useState(null)
    const [health, setHealth] = useState({})

    const handleCheck = async (e, path) => {
        e.stopPropagation()
        setChecking(path)
        try {
            const res = await fetch(`/api/check?path=${encodeURIComponent(path)}`)
            const data = await res.json()
            setHealth(prev => ({ ...prev, [path]: data.status || 'healthy' }))
        } catch (err) {
            setHealth(prev => ({ ...prev, [path]: 'error' }))
        } finally {
            setChecking(false)
        }
    }

    return (
        <div className="w-72 bg-slate-900/50 backdrop-blur-xl border-r border-white/5 flex flex-col h-full z-20">
            <div className="p-6 border-b border-white/5 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <Folder size={18} className="text-indigo-400" />
                    <h2 className="font-outfit font-bold text-sm uppercase tracking-widest text-slate-200">Workspaces</h2>
                </div>
                <button 
                    onClick={onOpenSettings} 
                    className="p-2 hover:bg-white/5 rounded-xl text-slate-400 hover:text-indigo-400 transition-all active:scale-95 border border-transparent hover:border-white/10"
                >
                    <Plus size={18} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                {projects.length === 0 && (
                    <div className="p-8 text-center bg-slate-800/20 rounded-2xl border border-dashed border-white/5 mx-2">
                        <p className="text-xs text-slate-500 italic leading-relaxed">No projects indexed yet.</p>
                        <button 
                            onClick={onOpenSettings} 
                            className="text-[11px] font-bold text-indigo-400 hover:text-indigo-300 mt-3 flex items-center gap-1 justify-center w-full"
                        >
                            <span>Add directory</span>
                            <Plus size={12} />
                        </button>
                    </div>
                )}
                {projects.map(project => (
                    <div 
                        key={project.id} 
                        onClick={() => onSelect(project.id)}
                        className={`group p-4 rounded-2xl cursor-pointer transition-all duration-300 border ${
                            selectedProject?.id === project.id 
                            ? 'bg-indigo-600/10 border-indigo-500/30 shadow-lg shadow-indigo-500/5' 
                            : 'hover:bg-white/5 border-transparent'
                        }`}
                    >
                        <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-3 truncate">
                                <div className={`p-2 rounded-xl transition-colors ${
                                    selectedProject?.id === project.id ? 'bg-indigo-500 text-white' : 'bg-white/5 text-slate-500 group-hover:text-slate-300'
                                }`}>
                                    <Folder size={16} />
                                </div>
                                <div className="truncate">
                                    <p className={`text-sm font-bold truncate ${selectedProject?.id === project.id ? 'text-white' : 'text-slate-300'}`}>
                                        {project.name}
                                    </p>
                                    <div className="flex items-center gap-1.5 mt-1">
                                        {health[project.path] === 'healthy' ? (
                                            <span className="flex items-center gap-1 text-[9px] font-black text-emerald-500 uppercase tracking-widest">
                                                <CheckCircle2 size={10} /> Valid
                                            </span>
                                        ) : health[project.path] === 'error' ? (
                                            <span className="flex items-center gap-1 text-[9px] font-black text-rose-500 uppercase tracking-widest">
                                                <AlertCircle size={10} /> Error
                                            </span>
                                        ) : (
                                            <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Indexed</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button 
                                    onClick={(e) => handleCheck(e, project.path)}
                                    className="p-1.5 hover:bg-white/10 rounded-lg text-slate-500 hover:text-emerald-400"
                                    title="Validate Health"
                                >
                                    <RefreshCw size={14} className={checking === project.path ? 'animate-spin' : ''} />
                                </button>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); onToggle(project.id); }} 
                                    className={`p-1.5 rounded-lg transition-all ${
                                        project.included 
                                        ? 'text-indigo-400 bg-indigo-400/10' 
                                        : 'text-slate-700 hover:text-slate-500 hover:bg-slate-700/10'
                                    }`}
                                >
                                    {project.included ? <CheckCircle size={16} /> : <Circle size={16} />}
                                </button>
                            </div>
                        </div>
                        <p className="text-[9px] text-slate-500 font-mono truncate bg-white/[0.02] px-2 py-1 rounded-md">
                            {project.path}
                        </p>
                    </div>
                ))}
            </div>

            <div className="p-6 border-t border-white/5 bg-slate-900/80 backdrop-blur-md">
                <button 
                    onClick={onReindex}
                    disabled={!selectedProject}
                    className="w-full btn-primary flex items-center justify-center gap-2 disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed text-xs py-3 group shadow-[0_0_20px_rgba(79,70,229,0.2)]"
                >
                    <RefreshCw size={14} className={selectedProject ? "group-hover:rotate-180 transition-transform duration-700" : ""} />
                    <span>Sync Repository</span>
                </button>
            </div>
        </div>
    )
}


