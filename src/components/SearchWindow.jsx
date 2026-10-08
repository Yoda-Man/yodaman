import { useEffect, useState } from 'react'
import { Search, FileCode, Hash, ExternalLink, Loader2, ChevronUp, ChevronDown } from 'lucide-react'
import { api } from '../api/api'

// One reader for both hit shapes, shared with the pipeline and the agent.
// This view used to read only metadata.path, so every ctx hit said
// "Source File" and had nothing to open.
import { hitPath as resultPath, hitLine as resultLine } from '../../shared/searchHits.js'

export default function SearchWindow({ selectedProject, searchRequest, onSearchingChange }) {
    const [results, setResults] = useState([])
    const [isSearching, setIsSearching] = useState(false)
    const [error, setError] = useState('')
    const [hasSearched, setHasSearched] = useState(false)
    const [expandedResults, setExpandedResults] = useState({})
    const [openError, setOpenError] = useState('')

    // Opens the hit in the user's own editor, at its line. Search results had
    // no open action before: the icon that looked like one only expanded the
    // snippet, so a search found code the user then had to go and find again.
    async function openResult(result) {
        const filePath = resultPath(result)
        if (!filePath || !selectedProject?.path) return
        setOpenError('')
        try {
            await api.openInEditor(selectedProject.path, filePath, resultLine(result))
        } catch (err) {
            setOpenError(`Could not open ${filePath}: ${err.message}`)
        }
    }

    useEffect(() => {
        const query = String(searchRequest?.query || '').trim()
        if (!query || !searchRequest?.id) return

        let active = true

        setIsSearching(true)
        onSearchingChange?.(true)
        setHasSearched(true)
        setError('')

        api.search(query, selectedProject?.path || selectedProject?.name).then(data => {
            if (!active) return
            setResults(data.isText ? [] : (Array.isArray(data) ? data : (data.results || [])))
        }).catch(err => {
            if (!active) return
            console.error('Search failed:', err)
            setResults([])
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
        }).finally(() => {
            if (!active) return
            setIsSearching(false)
            onSearchingChange?.(false)
        })

        return () => {
            active = false
            onSearchingChange?.(false)
        }
    }, [searchRequest?.id])

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* Results Area */}
            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                <div className="max-w-4xl mx-auto space-y-6">
                    {isSearching && <div className="flex items-center justify-center gap-3 py-20 text-sm text-indigo-300"><Loader2 size={18} className="animate-spin" />Searching {selectedProject?.name}…</div>}
                    {error && <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
                    {openError && <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">{openError}</div>}
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

                    {results.map((result, idx) => (
                        <SearchResultCard
                            key={idx}
                            result={result}
                            expanded={expandedResults[idx] || false}
                            onToggle={() => setExpandedResults(prev => ({ ...prev, [idx]: !prev[idx] }))}
                            onOpen={openResult}
                        />
                    ))}
                </div>
            </div>
        </div>
    )
}

/**
 * One search hit. Exported so it can be rendered in tests: the defect it fixes
 * (no way to open a result) was invisible to every test that only checked the
 * search request, because none of them looked at what a result offered.
 */
export function SearchResultCard({ result, expanded: isExpanded = false, onToggle, onOpen }) {
    const content = result.content || result.text || result.snippet || ''
    const filePath = resultPath(result)
    const line = resultLine(result)
    return (
        <div className="glass-panel group hover:border-indigo-500/30 transition-all">
            <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                <button
                    type="button"
                    onClick={() => onOpen(result)}
                    disabled={!filePath}
                    className="flex min-w-0 items-center gap-3 text-left hover:text-white disabled:cursor-default"
                    title={filePath ? `Open ${filePath}${line ? `:${line}` : ''} in your editor` : undefined}
                >
                    <FileCode size={16} className="shrink-0 text-indigo-400" />
                    <span className="truncate text-sm font-bold text-slate-200 underline-offset-4 group-hover:underline">{filePath || 'Source File'}{line ? `:${line}` : ''}</span>
                </button>
                <div className="flex shrink-0 items-center gap-4">
                    <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                        <Hash size={12} />
                        Score: <span className="text-indigo-400">{(result.score * 100).toFixed(1)}%</span>
                    </div>
                    {filePath ? (
                        <button
                            type="button"
                            onClick={() => onOpen(result)}
                            className="flex items-center gap-1.5 rounded-lg border border-indigo-400/20 bg-indigo-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-indigo-200 hover:bg-indigo-400/20"
                            title="Open in your editor"
                        >
                            <ExternalLink size={12} />
                            Open
                        </button>
                    ) : null}
                    <button
                        type="button"
                        onClick={onToggle}
                        className="p-1.5 hover:bg-white/5 rounded-lg transition-colors text-slate-500 hover:text-white"
                        title={isExpanded ? 'Collapse' : 'Show details'}
                    >
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                </div>
            </div>
            <div className="p-5 bg-slate-950/40">
                <pre className="text-[13px] font-mono text-slate-300 leading-relaxed overflow-x-auto custom-scrollbar">
                    <code>{content}</code>
                </pre>
                {isExpanded && filePath && (
                    <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-2 text-[10px] text-slate-500">
                        <FileCode size={12} />
                        <span>Full path: {filePath}</span>
                        {line && <span className="text-indigo-400">Line {line}</span>}
                    </div>
                )}
            </div>
        </div>
    )
}
