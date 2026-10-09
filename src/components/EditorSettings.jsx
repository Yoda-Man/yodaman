import { useEffect, useState } from 'react'
import { api } from '../api/api'

const CUSTOM = '__custom__'

/**
 * Settings > Editor: which program opens files from search results and chat.
 *
 * Nothing here assumes an editor. "System default" (the default) asks the OS
 * which app opens that file type. The list shows editors found on this
 * machine. "Custom command" takes any command with {file}, {line} and {column},
 * so an editor YodaMan has never heard of still opens at the right line.
 */
export default function EditorSettings() {
    const [options, setOptions] = useState(null)
    const [choice, setChoice] = useState('')
    const [custom, setCustom] = useState('')
    const [status, setStatus] = useState('')

    useEffect(() => {
        let cancelled = false
        api.getEditorOptions().then(data => {
            if (cancelled) return
            setOptions(data)
            const current = data.editorCommand || ''
            const known = !current || (data.detected || []).some(editor => editor.setting === current)
            setChoice(known ? current : CUSTOM)
            setCustom(known ? '' : current)
        }).catch(err => {
            if (!cancelled) setStatus(`Could not load editor settings: ${err.message}`)
        })
        return () => { cancelled = true }
    }, [])

    const save = async (value) => {
        setStatus('')
        try {
            await api.updateSettings({ editorCommand: value || 'system' })
            setStatus('Saved')
            setTimeout(() => setStatus(''), 1500)
        } catch (err) {
            setStatus(err.message)
        }
    }

    const onSelect = (value) => {
        setChoice(value)
        if (value !== CUSTOM) save(value)
    }

    const systemLabel = options?.systemDefault ? `System default (${options.systemDefault})` : 'System default'

    return (
        <div className="space-y-3 rounded-xl border border-white/5 bg-white/[0.02] p-4" id="editor-settings">
            <div>
                <div className="font-medium text-slate-200">Open files in</div>
                <div className="text-[11px] text-slate-500">Used by search results and file links in chat.</div>
            </div>
            <select
                aria-label="Editor"
                value={choice}
                onChange={e => onSelect(e.target.value)}
                disabled={!options}
                className="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-200"
            >
                <option value="">{systemLabel}</option>
                {(options?.detected || []).map(editor => (
                    <option key={editor.setting} value={editor.setting}>{editor.name}</option>
                ))}
                <option value={CUSTOM}>Custom command…</option>
            </select>
            {choice === CUSTOM ? (
                <div className="space-y-2">
                    <div className="flex gap-2">
                        <input
                            aria-label="Custom editor command"
                            value={custom}
                            onChange={e => setCustom(e.target.value)}
                            placeholder="idea --line {line} {file}"
                            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-200"
                        />
                        <button
                            type="button"
                            onClick={() => save(custom.trim())}
                            disabled={!custom.trim()}
                            className="rounded-lg bg-indigo-500 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-400 disabled:opacity-40"
                        >
                            Save
                        </button>
                    </div>
                    <div className="text-[11px] leading-5 text-slate-500">
                        Any editor works. Use <code className="text-slate-300">{'{file}'}</code>, <code className="text-slate-300">{'{line}'}</code> and <code className="text-slate-300">{'{column}'}</code> where your editor expects them; if <code className="text-slate-300">{'{file}'}</code> is left out, the file is added at the end. Quote paths that contain spaces.
                    </div>
                </div>
            ) : null}
            {status ? <div className={`text-[11px] ${status === 'Saved' ? 'text-emerald-300' : 'text-rose-300'}`}>{status}</div> : null}
        </div>
    )
}
