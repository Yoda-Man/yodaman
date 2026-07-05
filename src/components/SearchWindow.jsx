import { useState } from 'react'
import { Search, FileCode, Hash, ExternalLink, Filter, Loader2, Sparkles, ChevronDown, ChevronUp } from 'lucide-react'
import { api } from '../api/api'

export default function SearchWindow({ selectedProject }) {
    const [query, setQuery] = useState('')
    const [results, setResults] = useState([])
    const [isSearching, setIsSearching] = useState(false)
    const [stats, setStats] = useState(null)
    const [error, setError] = useState('')
    const [hasSearched, setHasSearched] = useState(false)
    const [expandedResults, setExpandedResults] = useState({})

    const handleSearch = async (e) => {
        if (e) e.preventDefault()
        if (!query.trim() || isSearching) return

        setIsSearching(true)
        setHasSearched(true)
        setError('')
        try {
            const data = await api.search(query, selectedProject?.path || selectedProject?.name)
            
            if (data.isText) {
                setResults([])
                setStats(null)
            } else {
                setResults(Array.isArray(data) ? data : (data.results || []))
                setStats({ count: Array.isArray(data) ? data.length : (data.results || []).length, time: '240ms' })
            }
        } catch (err) {
            console.error('Search failed:', err)
            setResults([])
            setStats(null)
            setError(err.message || 'Search failed')
            api.reportClientError({
                message: err.message || 'Search failed',
                stack: err.stack,
                userAction: 'code_search',
                component: 'SearchWindow',
                severity: 'high',
                context: {
                    query,
                    project: selectedProject?.path || selectedProject?.name
                }
            })
        } finally {
            setIsSearching(false)
        }
    }

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* Search Header */}
            <div className="p-8 border-b border-white/5 bg-white/[0.01]">
                <div className="max-w-4xl mx-auto space-y-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-2xl font-outfit font-black text-white tracking-tight">Code Search</h2>
                            <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mt-1">Pattern discovery engine</p>
                        </div>
                        {selectedProject && (
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
                                <Filter size={12} className="text-indigo-400" />
                                <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Scoped to: {selectedProject.name}</span>
                            </div>
                        )}
                    </div>

                    <form onSubmit={handleSearch} className="relative group">
                        <div className="absolute inset-y-0 left-5 flex items-center pointer-events-none">
                            <Search size={20} className="text-slate-500 group-focus-within:text-indigo-400 transition-colors" />
                        </div>
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search for functions, variables, or patterns..."
                            className="w-full bg-slate-900/50 border border-white/10 rounded-[24px] py-4 pl-14 pr-32 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 transition-all font-medium"
                        />
                        <button 
                            type="submit"
                            disabled={isSearching || !query.trim()}
                            className="absolute right-3 top-2.5 bottom-2.5 px-6 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-[18px] text-xs font-black uppercase tracking-widest transition-all shadow-[0_0_20px_rgba(79,70,229,0.3)] flex items-center gap-2"
                        >
                            {isSearching ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                            {isSearching ? 'Scanning' : 'Search'}
                        </button>
                    </form>
                    {error && (
                        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                            {error}
                        </div>
                    )}
                </div>
            </div>

            {/* Results Area */}
            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                <div className="max-w-4xl mx-auto space-y-6">
                    {!isSearching && results.length === 0 && hasSearched && (
                        <div className="py-20 text-center">
                            <p className="text-slate-500 font-medium">{error ? 'Search could not complete.' : 'No matches found for your query.'}</p>
                            <p className="text-[10px] text-slate-600 uppercase tracking-widest mt-2 font-black">{error ? 'Open logs for diagnostics' : 'Try broader keywords'}</p>
                        </div>
                    )}

                    {!isSearching && results.length === 0 && !hasSearched && (
                        <div className="py-20 text-center space-y-4">
                            <div className="h-16 w-16 bg-white/[0.02] border border-white/5 rounded-3xl flex items-center justify-center mx-auto">
                                <Search size={32} className="text-slate-700" />
                            </div>
                            <p className="text-slate-500 font-medium italic">Enter a query to begin semantic search across your indices.</p>
                        </div>
                    )}

                    {results.map((result, idx) => {
                        const isExpanded = expandedResults[idx] || false
                        const content = result.content || result.text || result.snippet || ''
                        return (
                        <div key={idx} className="glass-panel group hover:border-indigo-500/30 transition-all">
                            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                                <div className="flex items-center gap-3">
                                    <FileCode size={16} className="text-indigo-400" />
                                    <span className="text-sm font-bold text-slate-200">{result.metadata?.path || 'Source File'}</span>
                                </div>
                                <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                                        <Hash size={12} />
                                        Score: <span className="text-indigo-400">{(result.score * 100).toFixed(1)}%</span>
                                    </div>
                                    <button
                                        onClick={() => setExpandedResults(prev => ({ ...prev, [idx]: !prev[idx] }))}
                                        className="p-1.5 hover:bg-white/5 rounded-lg transition-colors text-slate-500 hover:text-white"
                                        title={isExpanded ? 'Collapse' : 'View full content'}
                                    >
                                        {isExpanded ? <ChevronUp size={14} /> : <ExternalLink size={14} />}
                                    </button>
                                </div>
                            </div>
                            <div className="p-5 bg-slate-950/40">
                                <pre className="text-[13px] font-mono text-slate-300 leading-relaxed overflow-x-auto custom-scrollbar">
                                    <code>{content}</code>
                                </pre>
                                {isExpanded && result.metadata?.path && (
                                    <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-2 text-[10px] text-slate-500">
                                        <FileCode size={12} />
                                        <span>Full path: {result.metadata.path}</span>
                                        {result.metadata?.line && <span className="text-indigo-400">Line {result.metadata.line}</span>}
                                    </div>
                                )}
                            </div>
                        </div>
                    )})}
                </div>
            </div>
        </div>
    )
}
