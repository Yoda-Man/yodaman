import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, File, Mic, Send, Trash2, X } from 'lucide-react'
import { api } from '../api/api'
import { VoiceAgentBridge, readVoiceAgentSettings, speakAgentResponse, writeVoiceAgentSettings } from '../../frontend/voiceAgentBridge.js'
import FileUploader from '../../frontend/FileUploader.jsx'
import GitPanel from './GitPanel'

const INITIAL_SECTIONS = {
  current: true,
  git: true,
  gitIntegration: false,
  files: true,
  timeline: true
}

const TASK_PRESETS = [
  {
    label: '📊 Impact Analysis',
    template: `Before editing utils/helpers.js, show me:

  - Which 5 files will be most affected
  - Potential breaking changes based on call hierarchy
  - Suggested test files to update`
  }
]

function normalizeRole(role) {
  if (role === 'ai') return 'assistant'
  return role || 'assistant'
}

function parseStoredJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || '') || fallback
  } catch {
    return fallback
  }
}

function fileRefUrl(ref) {
  const line = ref.line ? `:${ref.line}` : ''
  return `vscode://file/${encodeURI(ref.path)}${line}`
}

function extractFileReferences(content) {
  const refs = []
  const seen = new Set()
  const pattern = /((?:\/|[A-Za-z]:\\|[\w.-]+\/)[\w./\\-]+\.(?:js|jsx|ts|tsx|dart|json|ya?ml|md|log|txt|css|html|go|py|java|rs|c|cpp|h|hpp))(?:[:#L](\d+))?/g
  let match
  while ((match = pattern.exec(String(content || ''))) !== null) {
    const key = `${match[1]}:${match[2] || ''}`
    if (!seen.has(key)) {
      seen.add(key)
      refs.push({ path: match[1], line: match[2] ? Number(match[2]) : null })
    }
  }
  return refs
}

function renderInline(text) {
  const parts = []
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)|(https?:\/\/[^\s)]+)/g
  let lastIndex = 0
  let match
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    const label = match[1] || match[3]
    const href = match[2] || match[3]
    parts.push(
      <a key={`${href}-${match.index}`} href={href} target="_blank" rel="noreferrer" className="text-indigo-300 underline decoration-indigo-400/40 underline-offset-4 hover:text-indigo-100">
        {label}
      </a>
    )
    lastIndex = pattern.lastIndex
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

function renderMarkdown(markdown) {
  const lines = String(markdown || '').split('\n')
  const blocks = []
  let code = []
  let codeLanguage = ''
  let list = []
  let inCode = false

  const flushList = () => {
    if (!list.length) return
    blocks.push(
      <ul key={`list-${blocks.length}`} className="my-3 ml-5 list-disc space-y-1 text-sm leading-6">
        {list.map((item, index) => <li key={index}>{renderInline(item)}</li>)}
      </ul>
    )
    list = []
  }

  const flushCode = () => {
    blocks.push(
      <pre key={`code-${blocks.length}`} className="my-4 max-w-full overflow-x-auto rounded-lg border border-white/10 bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-200">
        {codeLanguage ? <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">{codeLanguage}</div> : null}
        <code>{code.join('\n')}</code>
      </pre>
    )
    code = []
    codeLanguage = ''
  }

  lines.forEach((line, index) => {
    if (line.startsWith('```')) {
      if (inCode) {
        flushCode()
        inCode = false
      } else {
        flushList()
        codeLanguage = line.slice(3).trim()
        inCode = true
      }
      return
    }

    if (inCode) {
      code.push(line)
      return
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      list.push(line.slice(2))
      return
    }

    flushList()
    if (!line.trim()) {
      blocks.push(<div key={`space-${index}`} className="h-3" />)
    } else if (line.startsWith('### ')) {
      blocks.push(<h3 key={index} className="mb-2 mt-4 text-sm font-bold text-slate-100">{renderInline(line.slice(4))}</h3>)
    } else if (line.startsWith('## ')) {
      blocks.push(<h2 key={index} className="mb-2 mt-5 text-base font-black text-slate-100">{renderInline(line.slice(3))}</h2>)
    } else if (line.startsWith('# ')) {
      blocks.push(<h1 key={index} className="mb-3 mt-5 text-lg font-black text-white">{renderInline(line.slice(2))}</h1>)
    } else {
      blocks.push(<p key={index} className="text-sm leading-7 text-slate-200">{renderInline(line)}</p>)
    }
  })

  if (inCode) flushCode()
  flushList()
  return blocks
}

function ContextSection({ id, title, open, onToggle, children }) {
  return (
    <section className="border-b border-white/10 last:border-b-0">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="flex w-full items-center justify-between px-5 py-4 text-left text-[11px] font-black uppercase tracking-widest text-slate-400 transition-colors hover:text-slate-100"
      >
        <span>{title}</span>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      {open ? <div className="px-5 pb-5">{children}</div> : null}
    </section>
  )
}

function MessageBubble({ message, onOpenFile, onViewInVr }) {
  const role = normalizeRole(message.role)
  const isUser = role === 'user'
  const refs = useMemo(() => extractFileReferences(message.content), [message.content])

  return (
    <article className={`flex gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-lg ${isUser ? 'border-indigo-400/20 bg-indigo-500/15' : 'border-white/10 bg-white/[0.04]'}`}>
        {isUser ? '🧑' : <img src="/logo.png" alt="YodaMan" className="h-7 w-7 rounded-full" style={{filter:'drop-shadow(0 0 4px rgba(99,102,241,0.4))'}} />}
      </div>
      <div className={`min-w-0 flex-1 ${isUser ? 'items-end text-right' : 'items-start'}`}>
        <div className={`inline-block max-w-full rounded-lg border px-4 py-3 text-left shadow-sm ${isUser ? 'border-indigo-400/20 bg-indigo-500/15 text-white' : 'border-white/10 bg-slate-900/70 text-slate-100'}`}>
          <div className="prose-yodaman max-w-none">
            {message.streaming && !message.content ? (
              <div className="flex items-center gap-2 py-2">
                <div className="flex gap-1">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400" style={{animationDelay:'0ms'}}></span>
                  <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400" style={{animationDelay:'150ms'}}></span>
                  <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400" style={{animationDelay:'300ms'}}></span>
                </div>
                <span className="text-xs font-medium text-indigo-300">YodaMan is processing your request...</span>
              </div>
            ) : renderMarkdown(message.content || (message.streaming ? 'Thinking...' : ''))}
          </div>
          {refs.length ? (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-3">
              {refs.slice(0, 4).map(ref => (
                <button
                  key={`${ref.path}-${ref.line || 'file'}`}
                  type="button"
                  onClick={() => onOpenFile(ref)}
                  className="inline-flex max-w-full items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 font-mono text-[11px] text-slate-300 hover:border-indigo-400/40 hover:text-indigo-100"
                  title="Open in VS Code"
                >
                  <File size={13} />
                  <span className="truncate">{ref.path}{ref.line ? `:${ref.line}` : ''}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => onViewInVr(refs)}
                className="inline-flex items-center rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1.5 text-[11px] font-bold text-cyan-200 transition-colors hover:border-cyan-300/50 hover:text-white"
              >
                View in VR
              </button>
            </div>
          ) : null}
        </div>
        <div className={`mt-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-600 ${isUser ? 'justify-end' : ''}`}>
          {message.usedVoice ? <span title="Voice input">🎤</span> : null}
          <time>{message.timestamp?.toLocaleTimeString?.([], { hour: '2-digit', minute: '2-digit' }) || ''}</time>
        </div>
      </div>
    </article>
  )
}

export default function AgentChatTab({ selectedProject }) {
  const [messages, setMessages] = useState([])
  const [inputText, setInputText] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [interimTranscript, setInterimTranscript] = useState('')
  const [usedVoiceForDraft, setUsedVoiceForDraft] = useState(false)
  const [voiceSettings, setVoiceSettings] = useState(() => readVoiceAgentSettings())
  const [attachedFiles, setAttachedFiles] = useState([])
  const [gitState, setGitState] = useState({ branch: 'Loading...', ahead: 0, behind: 0, recentCommits: [] })
  const [sections, setSections] = useState(INITIAL_SECTIONS)
  const [error, setError] = useState('')
  const [preset, setPreset] = useState('')
  const [queryMode, setQueryMode] = useState('code')
  const [holocronAvailable, setHolocronAvailable] = useState(false)
  const messagesEndRef = useRef(null)
  const voiceBridgeRef = useRef(null)

  const selectedNodes = parseStoredJson('yodaman:selectedNodes', [])
  const openFiles = useMemo(() => {
    const refs = messages.flatMap(message => extractFileReferences(message.content))
    return refs.slice(-5)
  }, [messages])

  useEffect(() => {
    if (!selectedProject) {
      setMessages([])
      return
    }
    loadHistory()
    loadGitContext()
  }, [selectedProject?.id, selectedProject?.path])

  useEffect(() => {
    api.getPlugins()
      .then(plugins => setHolocronAvailable(
        Array.isArray(plugins) && plugins.some(plugin => plugin.name === 'holocron-vr')
      ))
      .catch(() => setHolocronAvailable(false))
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, isSending])

  useEffect(() => {
    return () => voiceBridgeRef.current?.stop()
  }, [])

  useEffect(() => {
    if (!voiceSettings.voiceInputEnabled) {
      voiceBridgeRef.current?.stop()
    }
  }, [voiceSettings.voiceInputEnabled])

  useEffect(() => {
    if (!selectedProject || !voiceSettings.voiceInputEnabled || !voiceSettings.hotwordDetectionEnabled || isSending) return
    const timer = window.setTimeout(() => {
      if (!voiceBridgeRef.current?.recognition) {
        startVoiceInput(true)
      }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [selectedProject?.path, voiceSettings.voiceInputEnabled, voiceSettings.hotwordDetectionEnabled, isSending])

  async function loadHistory() {
    try {
      const history = await api.getSessions(selectedProject.id)
      setMessages(history.map(item => ({
        ...item,
        role: normalizeRole(item.role),
        timestamp: new Date(item.timestamp)
      })))
    } catch (err) {
      setError(err.message)
    }
  }

  async function loadGitContext() {
    if (!selectedProject?.path) return
    try {
      setGitState(await api.getGitContext(selectedProject.path))
    } catch (err) {
      setGitState({ branch: 'Unavailable', ahead: 0, behind: 0, recentCommits: [], error: err.message })
    }
  }

  function toggleSection(id) {
    setSections(current => ({ ...current, [id]: !current[id] }))
  }

  function removeFile(id) {
    setAttachedFiles(current => current.filter(file => file.fileId !== id))
  }

  function buildAgentContext(extra = {}) {
    return {
      selectedNodes,
      attachedFiles,
      fileIds: attachedFiles.map(file => file.fileId),
      gitState,
      activeWorkspace: selectedProject.path,
      openFiles,
      ...extra
    }
  }

  function updateVoiceSetting(key, value) {
    const next = writeVoiceAgentSettings({ ...voiceSettings, [key]: value })
    setVoiceSettings(next)
    voiceBridgeRef.current?.updateSettings(next)
  }

  function createVoiceBridge() {
    voiceBridgeRef.current?.stop()
    const bridge = new VoiceAgentBridge({
      settings: voiceSettings,
      onListeningChange: setIsListening,
      onInterim: setInterimTranscript,
      onTranscript: ({ text }) => {
        setInputText(text)
        setUsedVoiceForDraft(true)
      },
      onAutoSubmit: ({ text }) => {
        setInterimTranscript('')
        sendAgentMessage(text, { usedVoice: true })
      },
      onCommand: command => {
        setInterimTranscript('')
        sendAgentMessage(command.query, {
          usedVoice: true,
          commandContext: {
            ...command.context,
            voiceCommand: command.label
          }
        })
      },
      onError: setError
    })
    voiceBridgeRef.current = bridge
    return bridge
  }

  function startVoiceInput(hotwordRequired = false) {
    if (isListening) {
      voiceBridgeRef.current?.stop()
      return
    }

    createVoiceBridge()
    voiceBridgeRef.current.startContinuousListening({
      hotwordRequired,
      context: buildAgentContext({
        inVr: selectedNodes.length > 0,
        localOnly: true
      })
    })
  }

  function openFileReference(ref) {
    window.open(fileRefUrl(ref), '_blank', 'noopener,noreferrer')
  }

  function viewInVr(refs) {
    window.dispatchEvent(new CustomEvent('yodaman:view-in-vr', { detail: { refs, selectedProject } }))
  }

  async function openProjectInVr() {
    try {
      setError('')
      await api.openPlugin('holocron-vr', selectedProject.path)
      viewInVr([])
    } catch (err) {
      setError(err.message)
      api.reportClientError({
        message: err.message || 'Failed to open Holocron VR',
        stack: err.stack,
        userAction: 'open_project_in_vr',
        component: 'AgentChatTab',
        severity: 'high',
        context: { project: selectedProject.path }
      })
    }
  }

  async function sendAgentMessage(taskOverride = inputText, { usedVoice = usedVoiceForDraft, commandContext = {} } = {}) {
    const task = String(taskOverride || '').trim()
    if (!task || !selectedProject || isSending) return

    const userMessage = {
      role: 'user',
      content: task,
      timestamp: new Date(),
      usedVoice
    }
    const assistantMessage = {
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      streaming: true,
      processing: true
    }
    const assistantIndex = messages.length + 1
    const context = buildAgentContext(commandContext)

    // Show "still working" message if no response within 10 seconds
    let slowTimer = setTimeout(() => {
      setMessages(current => {
        const next = [...current]
        if (next[assistantIndex] && !next[assistantIndex].content) {
          next[assistantIndex] = { ...next[assistantIndex], content: '⏳ Still thinking... (slow connection or complex task)' }
        }
        return next
      })
    }, 10000)

    setMessages(current => [...current, userMessage, assistantMessage])
    setInputText('')
    setInterimTranscript('')
    setUsedVoiceForDraft(false)
    setAttachedFiles([])
    setIsSending(true)
    setError('')

    try {
      clearTimeout(slowTimer)
      await api.agentTask(task, selectedProject.path, step => {
        if (step.type === 'final_answer') {
          speakAgentResponse(step.answer, voiceSettings)
        }
        setMessages(current => {
          const next = [...current]
          const target = { ...next[assistantIndex] }
          if (step.type === 'final_answer') {
            target.content = step.answer || target.content
            target.streaming = false
          } else if (step.type === 'error') {
            target.content = `${target.content}\n\nError: ${step.message}`.trim()
            target.streaming = false
          } else if (step.delta || step.content || step.message) {
            target.content = `${target.content}${step.delta || step.content || step.message}`
          }
          next[assistantIndex] = target
          return next
        })
      }, context)
    } catch (err) {
      clearTimeout(slowTimer)
      setError(err.message)
      setMessages(current => current.map((message, index) => index === assistantIndex
        ? { ...message, content: '⚠️ ' + err.message, streaming: false }
        : message
      ))
      api.reportClientError({
        message: err.message || 'Agent chat request failed',
        stack: err.stack,
        userAction: 'agent_task',
        component: 'AgentChatTab',
        severity: 'high',
        context: { project: selectedProject.path }
      })
    } finally {
      setIsSending(false)
      loadGitContext()
    }
  }

  async function sendMessage(event) {
    event.preventDefault()
    await sendAgentMessage()
  }

  if (!selectedProject) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--bg-primary)] p-8 text-center">
        <div>
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]"><img src="/logo.png" alt="YodaMan" className="h-10 w-10" /></div>
          <h1 className="text-2xl font-black text-[var(--text-primary)]">Select a workspace</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">Agentic chat needs an active YodaMan workspace.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="grid h-full grid-cols-[minmax(0,7fr)_minmax(280px,3fr)] bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <main className="flex min-w-0 min-h-0 flex-col border-r border-[var(--border-color)]">
        <header className="border-b border-[var(--border-color)] px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <h1 className="truncate text-base font-black text-white">Agent Chat</h1>
                <div className="flex gap-1 bg-slate-800/50 rounded-lg p-0.5 border border-white/5">
                  <button type="button" className={`px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-md transition-all ${queryMode==='code'?'bg-indigo-500/20 text-indigo-200':'text-slate-500 hover:text-slate-300'}`} onClick={async()=>{try{await api.setMode('code',selectedProject?.id);setQueryMode('code');}catch(e){console.error('Mode switch failed:',e)}}}>Code</button>
                  <button type="button" className={`px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-md transition-all ${queryMode==='doc'?'bg-indigo-500/20 text-indigo-200':'text-slate-500 hover:text-slate-300'}`} onClick={async()=>{try{await api.setMode('doc',selectedProject?.id);setQueryMode('doc');}catch(e){console.error('Mode switch failed:',e)}}}>Docs</button>
                </div>
              </div>
              <p className="truncate text-xs text-[var(--text-secondary)]">{selectedProject.path}</p>
            </div>
            <div className="flex items-center gap-2">
              {holocronAvailable ? (
                <button onClick={openProjectInVr} className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-cyan-200 hover:bg-cyan-400/20" title="Load workspace in Holocron VR">Load in VR</button>
              ) : null}
              <button onClick={()=>{setMessages([]);api.clearSessions(selectedProject.id).catch(()=>{});}} className="rounded-full border border-rose-400/20 bg-rose-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-rose-200 hover:bg-rose-400/20" title="Clear conversation">🗑 Clear</button>
              <div className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-200">SSE Ready</div>
            </div>
          </div>
        </header>

        <div className="custom-scrollbar flex-1 space-y-7 overflow-y-auto px-6 py-6">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center text-sm text-[var(--text-secondary)]">
              Ask YodaMan to inspect, explain, or change this workspace.
            </div>
          ) : messages.slice(-50).map((message, index) => (
            <MessageBubble
              key={`${message.timestamp?.toISOString?.() || index}-${index}`}
              message={message}
              onOpenFile={openFileReference}
              onViewInVr={viewInVr}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={sendMessage} className="border-t border-[var(--border-color)] bg-slate-950/70 p-5">
          {error ? <div className="mb-3 rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">{error}</div> : null}

          <div className="mb-3 flex items-center gap-2">
            <select
              value={preset}
              onChange={e => {
                const selected = e.target.value
                setPreset(selected)
                if (selected) {
                  const found = TASK_PRESETS.find(p => p.label === selected)
                  if (found) setInputText(found.template)
                }
              }}
              className="w-full rounded-lg border border-[var(--border-color)] bg-slate-900/80 px-3 py-2 text-xs text-slate-300 outline-none focus:border-indigo-400/50"
            >
              <option value="">💡 Task presets...</option>
              {TASK_PRESETS.map(p => (
                <option key={p.label} value={p.label}>{p.label}</option>
              ))}
            </select>
          </div>

          <div className="rounded-lg border border-[var(--border-color)] bg-slate-900/80 p-3 focus-within:border-indigo-400/50">
            {isListening ? (
              <div className="mb-3 flex items-center gap-3 rounded-md border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">
                <span className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-rose-200 [animation-delay:-0.2s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-rose-200 [animation-delay:-0.1s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-rose-200" />
                </span>
                <span className="font-bold">Listening...</span>
                {interimTranscript ? <span className="min-w-0 truncate text-rose-100/70">{interimTranscript}</span> : <span className="text-rose-100/50">Pause for 2 seconds to send.</span>}
              </div>
            ) : null}
            <textarea
              value={inputText}
              onChange={event => setInputText(event.target.value)}
              disabled={isSending}
              rows={3}
              placeholder="Give YodaMan an agentic task..."
              className="max-h-44 min-h-[84px] w-full resize-y bg-transparent text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-600"
            />
            {interimTranscript && !isListening ? <div className="mt-2 text-xs italic text-slate-500">{interimTranscript}</div> : null}
            {inputText.trim() ? (
              <details className="mt-2 border-t border-white/10 pt-2">
                <summary className="cursor-pointer text-[10px] font-black uppercase tracking-widest text-slate-500">Markdown preview</summary>
                <div className="mt-3 rounded-md bg-black/20 p-3 text-left">{renderMarkdown(inputText)}</div>
              </details>
            ) : null}
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2" style={{minHeight:'36px'}}>
                <FileUploader files={attachedFiles} onFilesChange={setAttachedFiles} disabled={isSending} />
                {usedVoiceForDraft ? <span className="text-sm" title="Voice input used">🎤</span> : null}
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => startVoiceInput(false)} className="flex h-9 w-9 items-center justify-center rounded-md border text-slate-300 hover:text-white border-white/10 bg-white/[0.03]" title="Voice input" style={isListening?{borderColor:'rgba(244,63,94,0.4)',background:'rgba(244,63,94,0.15)',animation:'pulse 1s ease-in-out infinite'}:{}}>
                  <Mic size={16} />
                </button>
                <button type="submit" disabled={isSending || !inputText.trim()} className="inline-flex items-center gap-2 rounded-md bg-indigo-500 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40">
                  <Send size={16} />
                  Send
                </button>
              </div>
            </div>
          </div>
        </form>
      </main>

      <aside className="custom-scrollbar min-w-0 overflow-y-auto bg-slate-950/80">
        <ContextSection id="current" title="Current Context" open={sections.current} onToggle={toggleSection}>
          <div className="space-y-3 text-xs text-slate-400">
            <div>
              <div className="mb-1 font-bold text-slate-300">Active workspace</div>
              <div className="break-words font-mono text-[11px]">{selectedProject.path}</div>
            </div>
            <div>
              <div className="mb-1 font-bold text-slate-300">Selected nodes from VR</div>
              {selectedNodes.length ? selectedNodes.map(node => <div key={String(node)} className="truncate rounded-md bg-white/[0.04] px-2 py-1">{String(node)}</div>) : <div>No VR nodes selected</div>}
            </div>
            <div>
              <div className="mb-1 font-bold text-slate-300">Open files</div>
              {openFiles.length ? openFiles.map(ref => <button key={`${ref.path}-${ref.line || ''}`} type="button" onClick={() => openFileReference(ref)} className="block max-w-full truncate py-1 text-left font-mono text-[11px] text-indigo-200">{ref.path}{ref.line ? `:${ref.line}` : ''}</button>) : <div>No file references yet</div>}
            </div>
          </div>
        </ContextSection>

        <ContextSection id="git" title="Git Context" open={sections.git} onToggle={toggleSection}>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md border border-white/10 bg-white/[0.03] p-2">
              <div className="truncate text-[10px] uppercase tracking-widest text-slate-500">Branch</div>
              <div className="truncate text-xs font-bold text-slate-100">{gitState.branch}</div>
            </div>
            <div className="rounded-md border border-white/10 bg-white/[0.03] p-2">
              <div className="text-[10px] uppercase tracking-widest text-slate-500">Ahead</div>
              <div className="text-xs font-bold text-emerald-200">{gitState.ahead || 0}</div>
            </div>
            <div className="rounded-md border border-white/10 bg-white/[0.03] p-2">
              <div className="text-[10px] uppercase tracking-widest text-slate-500">Behind</div>
              <div className="text-xs font-bold text-amber-200">{gitState.behind || 0}</div>
            </div>
          </div>
          {gitState.error ? <div className="mt-3 text-xs text-slate-500">{gitState.error}</div> : null}
        </ContextSection>

        <ContextSection id="gitIntegration" title="Git Integration" open={sections.gitIntegration} onToggle={toggleSection}>
          <GitPanel project={selectedProject} />
        </ContextSection>

        <ContextSection id="files" title="Attached Files" open={sections.files} onToggle={toggleSection}>
          {attachedFiles.length ? (
            <div className="space-y-2">
              {attachedFiles.map(file => (
                <div key={file.fileId} className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-2 py-2">
                  <File size={14} className="shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-slate-200">{file.filename}</div>
                    <div className="text-[10px] text-slate-500">{Math.max(1, Math.round(file.size / 1024))} KB</div>
                  </div>
                  <button type="button" onClick={() => removeFile(file.fileId)} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-rose-400/10 hover:text-rose-200" title="Remove attachment">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : <div className="text-xs text-slate-500">No files attached</div>}
        </ContextSection>

        <ContextSection id="timeline" title="Git Timeline" open={sections.timeline} onToggle={toggleSection}>
          <div className="mb-4 flex h-10 items-end gap-1">
            {(gitState.recentCommits || []).slice(0, 8).map((commit, index) => (
              <div key={commit.hash || index} className="flex-1 rounded-t bg-indigo-400/60" style={{ height: `${34 - (index % 4) * 6}px` }} title={commit.subject} />
            ))}
          </div>
          <div className="space-y-3">
            {(gitState.recentCommits || []).slice(0, 5).map(commit => (
              <div key={commit.hash} className="border-l border-indigo-400/30 pl-3">
                <div className="font-mono text-[10px] text-indigo-200">{commit.hash}</div>
                <div className="truncate text-xs text-slate-200">{commit.subject}</div>
                <div className="text-[10px] text-slate-500">{commit.relativeTime}</div>
              </div>
            ))}
            {!(gitState.recentCommits || []).length ? <div className="text-xs text-slate-500">No recent commits available</div> : null}
          </div>
        </ContextSection>

        <section className="border-b border-white/10 px-5 py-4">
          <div className="mb-3 text-[11px] font-black uppercase tracking-widest text-slate-400">Voice Settings</div>
          <div className="space-y-3 text-xs text-slate-300">
            <label className="flex items-center justify-between gap-3">
              <span>Voice input</span>
              <input
                type="checkbox"
                checked={voiceSettings.voiceInputEnabled}
                onChange={event => updateVoiceSetting('voiceInputEnabled', event.target.checked)}
                className="h-4 w-4 accent-indigo-500"
              />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span>Hotword</span>
              <input
                type="checkbox"
                checked={voiceSettings.hotwordDetectionEnabled}
                onChange={event => updateVoiceSetting('hotwordDetectionEnabled', event.target.checked)}
                className="h-4 w-4 accent-indigo-500"
              />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span>Voice output</span>
              <input
                type="checkbox"
                checked={voiceSettings.voiceOutputEnabled}
                onChange={event => updateVoiceSetting('voiceOutputEnabled', event.target.checked)}
                className="h-4 w-4 accent-indigo-500"
              />
            </label>
            <p className="text-[10px] leading-4 text-slate-500">Speech recognition and synthesis use local Web Speech APIs. No audio leaves this machine.</p>
          </div>
        </section>

        <div className="px-5 py-4">
          <button type="button" onClick={() => setAttachedFiles([])} className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-rose-200">
            <Trash2 size={14} />
            Clear attachments
          </button>
        </div>
      </aside>
    </div>
  )
}
