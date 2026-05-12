import { useState } from 'react'
import { X, FolderPlus, Trash2, ShieldCheck, Info, Globe, HardDrive } from 'lucide-react'

export default function SettingsModal({ onClose, watchedDirs, onWatchChange }) {
    const [newDir, setNewDir] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)

    const addDir = async () => {
        if (!newDir.trim() || isSubmitting) return
        setIsSubmitting(true)
        try {
            const res = await fetch('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: newDir.trim() })
            })
            if (res.ok) {
                setNewDir('')
                onWatchChange()
            }
        } catch (err) {
            console.error('Failed to add project:', err)
        } finally {
            setIsSubmitting(false)
        }
    }

    const removeDir = async (dir) => {
        try {
            await fetch('/api/projects', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: dir })
            })
            onWatchChange()
        } catch (err) {
            console.error('Failed to remove project:', err)
        }
    }

    return (
        <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-md flex items-center justify-center z-[100] p-6 animate-in fade-in duration-300">
            <div className="bg-slate-900/90 border border-white/10 rounded-[32px] shadow-[0_0_100px_rgba(0,0,0,0.5)] max-w-xl w-full overflow-hidden flex flex-col animate-in zoom-in-95 duration-300">
                <div className="px-8 py-6 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                            <ShieldCheck size={20} className="text-indigo-400" />
                        </div>
                        <div>
                            <h2 className="text-lg font-outfit font-bold text-slate-100 tracking-tight">
                                Configuration
                            </h2>
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-black">System Preferences</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-xl transition-all group border border-transparent hover:border-white/10">
                        <X size={20} className="text-slate-500 group-hover:text-white" />
                    </button>
                </div>

                <div className="p-8 space-y-8">
                    <div>
                        <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-[0.25em] mb-4">
                            <HardDrive size={12} />
                            Add Watch Directory
                        </label>
                        <div className="flex gap-3">
                            <input
                                type="text"
                                value={newDir}
                                onChange={e => setNewDir(e.target.value)}
                                placeholder="Enter absolute repository path..."
                                className="flex-1 input-field font-mono text-xs py-3"
                                onKeyDown={(e) => e.key === 'Enter' && addDir()}
                                disabled={isSubmitting}
                            />
                            <button 
                                onClick={addDir} 
                                disabled={isSubmitting || !newDir.trim()}
                                className="btn-primary"
                            >
                                <FolderPlus size={18} />
                                <span>Register</span>
                            </button>
                        </div>
                        <div className="flex items-center gap-2 mt-3 text-[10px] text-slate-600 font-medium">
                            <Info size={12} className="text-indigo-500" />
                            <span>Paths must be absolute (e.g. <code className="bg-white/5 px-1 rounded text-slate-400">/Users/dev/project</code>)</span>
                        </div>
                    </div>

                    <div className="flex-1 flex flex-col min-h-0">
                        <label className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-[0.25em] mb-4">
                            <Globe size={12} />
                            Tracked Locations ({watchedDirs.length})
                        </label>
                        <div className="space-y-3 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                            {watchedDirs.length === 0 && (
                                <div className="text-center py-12 bg-slate-950/30 rounded-[24px] border border-dashed border-white/5">
                                    <p className="text-sm text-slate-600 font-medium">No active indices found.</p>
                                    <p className="text-[10px] text-slate-700 uppercase tracking-widest mt-1">Add a directory to begin</p>
                                </div>
                            )}
                            {watchedDirs.map(dir => (
                                <div key={dir} className="group flex items-center justify-between bg-white/[0.02] p-4 rounded-2xl border border-white/5 hover:border-indigo-500/30 transition-all hover:bg-white/[0.04]">
                                    <div className="flex flex-col truncate">
                                        <span className="text-sm font-bold text-slate-200 truncate" title={dir}>
                                            {dir.split('/').pop()}
                                        </span>
                                        <span className="text-[11px] text-slate-500 truncate font-mono mt-0.5">
                                            {dir}
                                        </span>
                                    </div>
                                    <button 
                                        onClick={() => removeDir(dir)} 
                                        className="p-2.5 text-slate-600 hover:text-rose-400 hover:bg-rose-400/10 rounded-xl transition-all border border-transparent hover:border-rose-500/20"
                                        title="Stop watching"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="p-6 bg-white/[0.02] border-t border-white/5 flex justify-between items-center px-8">
                    <a 
                        href="/manual.html" 
                        target="_blank" 
                        className="text-[10px] font-black text-indigo-400 hover:text-indigo-300 uppercase tracking-widest flex items-center gap-2"
                    >
                        <Info size={14} />
                        View User Manual
                    </a>
                    <button 
                        onClick={onClose} 
                        className="btn-secondary px-8"
                    >
                        DISMISS
                    </button>
                </div>
            </div>
        </div>
    )
}

