import { useEffect, useRef, useState } from 'react'
import { Search, FileCode, Hash, ExternalLink, Loader2, ChevronUp, ChevronDown, Sparkles } from 'lucide-react'
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
    const resultsRef = useRef(null)
    // { state: 'writing' | 'done' | 'error', text, model, error }, or null when there is nothing to summarise.
    const [summary, setSummary] = useState(null)

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

        setIsSearching(true)
        onSearchingChange?.(true)
        setHasSearched(true)
        setError('')
        setResults([])
        setSummary(null)

        const project = selectedProject?.path || selectedProject?.name
        const source = new EventSource(api.searchStreamUrl(query, project))
        const read = (event) => JSON.parse(event.data)
        let finished = false
        let gotResults = false
        const searchDone = () => {
            setIsSearching(false)
            onSearchingChange?.(false)
        }
        const fail = (message) => {
            setResults([])
            setError(message)
            searchDone()
            api.reportClientError({ message, userAction: 'code_search', component: 'SearchWindow', severity: 'high', context: { query, project } })
        }

        source.addEventListener('results', (event) => {
            gotResults = true
            setResults(read(event).results || [])
            searchDone()
        })
        source.addEventListener('summary_start', (event) => setSummary({ state: 'writing', text: '', model: read(event).model }))
        source.addEventListener('summary', (event) => {
            const { text } = read(event)
            setSummary((current) => ({ ...current, text: (current?.text || '') + text }))
        })
        source.addEventListener('summary_error', (event) => setSummary((current) => ({ ...current, state: 'error', error: read(event).error })))
        source.addEventListener('search_error', (event) => {
            finished = true
            source.close()
            fail(read(event).error || 'Search failed')
        })
        source.addEventListener('done', () => {
            finished = true
            source.close()
            setSummary((current) => (current && current.state === 'writing' ? { ...current, state: 'done' } : current))
        })
        // A dropped connection. EventSource would reconnect and run the search
        // again, so stop it and say what happened instead.
        source.onerror = () => {
            if (finished) return
            finished = true
            source.close()
            if (!gotResults) fail('Search could not reach the runtime')
            else setSummary((current) => (current && current.state === 'writing' ? { ...current, state: 'error', error: 'The connection closed before the summary finished' } : current))
        }

        return () => {
            finished = true
            source.close()
            onSearchingChange?.(false)
        }
    }, [searchRequest?.id])

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* Results Area */}
            <div ref={resultsRef} className="flex-1 overflow-y-auto p-8 custom-scrollbar">
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

                    {summary ? <SearchSummary summary={summary} resultCount={results.length} onCite={(n) => scrollToResult(resultsRef.current, n)} /> : null}

                    {results.map((result, idx) => (
                        <div key={idx} id={`search-result-${idx + 1}`}>
                            <SearchResultCard
                                result={result}
                                expanded={expandedResults[idx] || false}
                                onToggle={() => setExpandedResults(prev => ({ ...prev, [idx]: !prev[idx] }))}
                                onOpen={openResult}
                            />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}

/**
 * Scroll the results list, and only it, to result n. scrollIntoView also
 * scrolled the page itself, pushing the app's header off screen.
 */
function scrollToResult(list, n) {
    const card = list?.querySelector(`#search-result-${n}`)
    if (!card) return
    const top = list.scrollTop + card.getBoundingClientRect().top - list.getBoundingClientRect().top - 16
    list.scrollTo({ top, behavior: 'smooth' })
}

/** Summary text with each [n] that names a result turned into a link to it. */
function withCitations(text, resultCount, onCite) {
    return text.split(/(\[\d+\])/).map((part, i) => {
        const n = Number(/^\[(\d+)\]$/.exec(part)?.[1])
        if (!n || n > resultCount) return part
        return <button key={i} type="button" onClick={() => onCite?.(n)} className="font-bold text-indigo-300 hover:text-white hover:underline" aria-label={`Go to result ${n}`}>{part}</button>
    })
}

/**
 * The local model's answer, drawn only from the results below it. Exported
 * for tests. [n] refers to the nth result card, and links to it.
 */
export function SearchSummary({ summary, resultCount = 0, onCite }) {
    return (
        <div className="glass-panel border-indigo-400/20 p-5" aria-live="polite">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-indigo-300">
                <Sparkles size={12} />
                AI summary of these results
                {summary.model ? <span className="normal-case tracking-normal text-slate-500">· {summary.model}, on this machine</span> : null}
                {summary.state === 'writing' ? <Loader2 size={12} className="animate-spin text-slate-500" /> : null}
            </div>
            {summary.text ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{withCitations(summary.text, resultCount, onCite)}</p> : null}
            {summary.state === 'writing' && !summary.text ? <p className="text-sm text-slate-500">Reading the results…</p> : null}
            {summary.state === 'error' ? <p className="mt-1 text-xs text-amber-200">Summary unavailable: {summary.error}</p> : null}
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
