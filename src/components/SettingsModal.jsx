import { useState } from 'react'
import { X, FolderPlus, Trash2, ShieldCheck, Info, Globe, HardDrive, Pencil, Save, FolderOpen, Clipboard } from 'lucide-react'
import { api } from '../api/api'

export default function SettingsModal({ onClose, watchedDirs, onWatchChange }) {
    const [newDir, setNewDir] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [editingDir, setEditingDir] = useState(null)
    const [draftDir, setDraftDir] = useState('')
    const [savingDir, setSavingDir] = useState(null)
    const canBrowseFolders = Boolean(window.yodamanDesktop?.pickWorkspaceFolder)

    const addDir = async () => {
        if (!newDir.trim() || isSubmitting) return
        setIsSubmitting(true)
        try {
            await api.addProject(newDir.trim())
            setNewDir('')
            onWatchChange()
        } catch (err) {
            console.error('Failed to add project:', err)
        } finally {
            setIsSubmitting(false)
        }
    }

    const browseDir = async () => {
        if (!canBrowseFolders || isSubmitting) return

        try {
            const selectedPath = await window.yodamanDesktop.pickWorkspaceFolder()
            if (selectedPath) {
                setNewDir(selectedPath)
            }
        } catch (err) {
            console.error('Failed to browse for project folder:', err)
        }
    }

    const removeDir = async (dir) => {
        try {
            await api.removeProject(dir)
            onWatchChange()
        } catch (err) {
            console.error('Failed to remove project:', err)
        }
    }

    const startEdit = (dir) => {
        setEditingDir(dir)
        setDraftDir(dir)
    }

    const cancelEdit = () => {
        setEditingDir(null)
        setDraftDir('')
    }

    const updateDir = async (dir) => {
        const nextPath = draftDir.trim()
        if (!nextPath || nextPath === dir || savingDir) {
            cancelEdit()
            return
        }

        setSavingDir(dir)
        try {
            await api.updateProjectPath(dir, nextPath)
            cancelEdit()
            onWatchChange()
        } catch (err) {
            console.error('Failed to update project path:', err)
        } finally {
            setSavingDir(null)
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
                            Add Workspace
                        </label>
                        <div className="flex gap-3">
                            <input
                                type="text"
                                value={newDir}
                                onChange={e => setNewDir(e.target.value)}
                                placeholder="Paste an absolute repository path..."
                                className="flex-1 input-field font-mono text-xs py-3"
                                onKeyDown={(e) => e.key === 'Enter' && addDir()}
                                disabled={isSubmitting}
                            />
                            <button
                                onClick={browseDir}
                                disabled={!canBrowseFolders || isSubmitting}
                                className="btn-secondary"
                                title={canBrowseFolders ? 'Browse for folder' : 'Folder browsing is available in the desktop app'}
                            >
                                <FolderOpen size={18} />
                                <span>Browse</span>
                            </button>
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
                            <span>
                                <Clipboard size={11} className="inline mr-1 text-slate-500" />
                                Paste an absolute path, or use Browse in the desktop app.
                            </span>
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
                                    {editingDir === dir ? (
                                        <div className="flex min-w-0 flex-1 items-center gap-2">
                                            <input
                                                value={draftDir}
                                                onChange={(e) => setDraftDir(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') updateDir(dir)
                                                    if (e.key === 'Escape') cancelEdit()
                                                }}
                                                className="min-w-0 flex-1 input-field font-mono text-xs py-2"
                                                autoFocus
                                                disabled={savingDir === dir}
                                            />
                                            <button
                                                onClick={() => updateDir(dir)}
                                                className="p-2.5 text-emerald-400 hover:bg-emerald-400/10 rounded-xl transition-all border border-transparent hover:border-emerald-500/20"
                                                title="Save path"
                                                disabled={savingDir === dir}
                                            >
                                                <Save size={18} />
                                            </button>
                                            <button
                                                onClick={cancelEdit}
                                                className="p-2.5 text-slate-600 hover:text-slate-200 hover:bg-white/10 rounded-xl transition-all border border-transparent hover:border-white/10"
                                                title="Cancel"
                                                disabled={savingDir === dir}
                                            >
                                                <X size={18} />
                                            </button>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="flex flex-col truncate">
                                                <span className="text-sm font-bold text-slate-200 truncate" title={dir}>
                                                    {dir.split('/').pop()}
                                                </span>
                                                <span className="text-[11px] text-slate-500 truncate font-mono mt-0.5">
                                                    {dir}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <button 
                                                    onClick={() => startEdit(dir)}
                                                    className="p-2.5 text-slate-600 hover:text-sky-400 hover:bg-sky-400/10 rounded-xl transition-all border border-transparent hover:border-sky-500/20"
                                                    title="Update file path"
                                                >
                                                    <Pencil size={18} />
                                                </button>
                                                <button 
                                                    onClick={() => removeDir(dir)} 
                                                    className="p-2.5 text-slate-600 hover:text-rose-400 hover:bg-rose-400/10 rounded-xl transition-all border border-transparent hover:border-rose-500/20"
                                                    title="Stop watching"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                        </>
                                    )}
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
