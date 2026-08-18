import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Copy, File, FileText, Filter, Link2, MessageSquare, Mic, Search, Send, Square, Terminal, Trash2, X } from 'lucide-react'
import { api } from '../api/api'
import { VoiceAgentBridge, readVoiceAgentSettings, speakAgentResponse, writeVoiceAgentSettings } from '../../frontend/voiceAgentBridge.js'
import FileUploader from '../../frontend/FileUploader.jsx'
import GitPanel from './GitPanel'
import SearchWindow from './SearchWindow'

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

/**
 * Turn a plugin into text for the composer.
 *
 * Selecting a plugin fills the box; it does not run anything. Plugins are tool
 * executions with declared permissions, not prompt templates, so they keep the
 * same "you press Send" contract as everything else typed here — and the
 * inserted phrase teaches the chat syntax rather than hiding it.
 *
 * Every shipped plugin carries a `💡 Chat usage:` hint holding quoted example
 * phrases; the first is the most natural invocation. Plugins without a hint
 * fall back to "Run <name>", which the agent resolves by tool name.
 */
function pluginInvocation(plugin) {
  const description = plugin?.description || ''
  const hintIndex = description.indexOf('Chat usage:')
  if (hintIndex !== -1) {
    const quoted = [...description.slice(hintIndex).matchAll(/"([^"]+)"/g)]
      .map(match => match[1].trim())
      .filter(Boolean)

    // Prefer the explicit "Run <plugin>" phrasing over the conversational one.
    // Picking the first hint inserted "How many lines of code?" for CodeTrooper,
    // and the agent went looking for documentation about code size instead of
    // calling the tool. The conversational phrasings exist for people who do not
    // know the plugin exists — but selecting from this menu is already that
    // discovery, and by then what you want is the invocation that lands.
    const explicit = quoted.find(phrase => /^run\b/i.test(phrase))
    if (explicit) return explicit
    if (quoted.length) return quoted[0]
  }
  return `Run ${plugin?.name || 'plugin'}`
}

/**
 * A short, literal statement of what a plugin's permissions let it do, or null
 * when there is nothing worth warning about.
 *
 * Mapped explicitly against PLUGIN_PERMISSION_ALLOWLIST in ToolBox.js, which is
 * a closed set — an earlier version pattern-matched the permission strings and
 * labelled anything containing "write" as able to modify your code. That flagged
 * `audit:write`, which writes the audit log and nothing else, and so described a
 * VR graph viewer as capable of changing files. A label that overstates is worse
 * than no label: it trains people to ignore the one that matters.
 *
 * Ordered by consequence — the strongest capability wins.
 */
const PLUGIN_CAPABILITY_LABELS = [
  ['unrestricted', 'unrestricted'],
  ['write', 'writes files'],
  ['command', 'runs commands'],
  ['agent:invoke', 'starts agent tasks'],
  ['task:create', 'starts agent tasks'],
  ['network', 'network access']
]

function pluginCapability(plugin) {
  const permissions = Array.isArray(plugin?.permissions) ? plugin.permissions : []
  const match = PLUGIN_CAPABILITY_LABELS.find(([permission]) => permissions.includes(permission))
  return match ? match[1] : null
}

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

let messageCounter = 0
function nextMessageId() {
  messageCounter += 1
  return `m${Date.now().toString(36)}-${messageCounter}`
}

function normalizeMessages(items) {
  return (Array.isArray(items) ? items : []).map(item => ({
    ...item,
    id: item.id || nextMessageId(),
    role: normalizeRole(item.role),
    timestamp: item.timestamp ? new Date(item.timestamp) : new Date()
  }))
}

function isAbsolutePath(filePath) {
  return filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath)
}

// Search hits and agent answers cite paths relative to the workspace
// (`graphify-out/GRAPH_REPORT.md`). Handing one of those to vscode://file
// unresolved makes VS Code look for it at the filesystem root, so anchor
// relative refs to the active workspace before building the URI.
function resolveRefPath(refPath, workspaceRoot) {
  const filePath = String(refPath || '').replace(/^\.\//, '')
  if (!filePath || isAbsolutePath(filePath) || !workspaceRoot) return filePath
  return `${String(workspaceRoot).replace(/[\\/]+$/, '')}/${filePath}`
}

function fileRefUrl(ref, workspaceRoot) {
  const absolute = resolveRefPath(ref.path, workspaceRoot).replace(/\\/g, '/')
  // vscode://file/ already supplies the leading slash of a POSIX path.
  const encoded = encodeURI(absolute.replace(/^\/+/, ''))
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F')
  const line = ref.line ? `:${ref.line}` : ''
  return `vscode://file/${encoded}${line}`
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

// Handles `inline code`, **bold**, [label](url), and bare URLs. Ordered so a
// backtick span wins over the markers inside it — otherwise `**` inside a code
// span would render as bold.
const INLINE_PATTERN = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)]+)\)|(https?:\/\/[^\s)]+)/g

function renderInline(text) {
  const parts = []
  let lastIndex = 0
  let match
  INLINE_PATTERN.lastIndex = 0
  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    const key = `inline-${match.index}`

    if (match[1] !== undefined) {
      parts.push(
        <code key={key} className="rounded border border-white/10 bg-black/30 px-1.5 py-0.5 font-mono text-[0.85em] text-indigo-100">
          {match[1]}
        </code>
      )
    } else if (match[2] !== undefined) {
      parts.push(<strong key={key} className="font-bold text-white">{match[2]}</strong>)
    } else {
      const label = match[3] || match[5]
      const href = match[4] || match[5]
      parts.push(
        <a key={key} href={href} target="_blank" rel="noreferrer" className="text-indigo-300 underline decoration-indigo-400/40 underline-offset-4 hover:text-indigo-100">
          {label}
        </a>
      )
    }
    lastIndex = INLINE_PATTERN.lastIndex
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

function CopyButton({ value, label = 'Copy', className = '' }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(String(value ?? ''))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex items-center gap-1 rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] font-black uppercase tracking-widest text-slate-400 transition-colors hover:border-indigo-400/40 hover:text-indigo-100 ${className}`}
      title="Copy to clipboard"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? 'Copied' : label}
    </button>
  )
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
    const source = code.join('\n')
    blocks.push(
      <div key={`code-${blocks.length}`} className="group/code relative my-4">
        <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover/code:opacity-100 focus-within:opacity-100">
          <CopyButton value={source} />
        </div>
        <pre className="max-w-full overflow-x-auto rounded-lg border border-white/10 bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-200">
          {codeLanguage ? <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">{codeLanguage}</div> : null}
          <code>{source}</code>
        </pre>
      </div>
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

/**
 * Line-level diff for a proposed file write. The agent blocks until the user
 * approves or rejects, so this has to render even when the diff is large.
 */
function DiffPanel({ filePath, oldContent, newContent }) {
  const rows = useMemo(() => {
    const oldLines = String(oldContent ?? '').split('\n')
    const newLines = String(newContent ?? '').split('\n')
    const oldSet = new Set(oldLines)
    const newSet = new Set(newLines)
    const output = []

    for (const line of oldLines) {
      if (line.trim() && !newSet.has(line)) output.push({ kind: 'del', line })
    }
    for (const line of newLines) {
      if (line.trim() && !oldSet.has(line)) output.push({ kind: 'add', line })
    }
    return output
  }, [oldContent, newContent])

  const added = rows.filter(r => r.kind === 'add').length
  const removed = rows.filter(r => r.kind === 'del').length

  return (
    <div className="hud-frame hud-imperial overflow-hidden rounded-lg border border-white/10 bg-black/40 text-[11px]">
      <div className="flex items-center justify-between gap-3 border-b border-white/5 bg-white/5 px-3 py-2">
        <span className="min-w-0 truncate font-mono text-slate-300" title={filePath}>{filePath}</span>
        <span className="shrink-0 font-black uppercase tracking-widest tabular-nums">
          <span className="text-emerald-400">+{added}</span>{' '}
          <span className="text-rose-400">-{removed}</span>
        </span>
      </div>
      <div className="custom-scrollbar max-h-60 overflow-y-auto p-3 font-mono leading-relaxed">
        {!String(oldContent ?? '') ? <div className="italic text-slate-500">[New file]</div> : null}
        {rows.length ? rows.map((row, index) => (
          <div
            key={`${row.kind}-${index}`}
            className={`-mx-1 whitespace-pre-wrap px-1 ${row.kind === 'add' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300'}`}
          >
            {row.kind === 'add' ? '+ ' : '- '}{row.line}
          </div>
        )) : <div className="italic text-slate-500">No line-level changes detected.</div>}
      </div>
    </div>
  )
}

const READINESS_STYLES = {
  ready: { label: 'Graph current', className: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' },
  stale: { label: 'Graph stale', className: 'border-amber-400/25 bg-amber-400/10 text-amber-200' },
  building: { label: 'Refreshing', className: 'border-indigo-400/25 bg-indigo-400/10 text-indigo-200' },
  unindexed: { label: 'Not indexed', className: 'border-rose-400/25 bg-rose-400/10 text-rose-200' }
}

/**
 * Whether this workspace's answers can be trusted right now. Index staleness
 * and graph build state used to live in separate tabs, so a stale answer was
 * indistinguishable from a correct one.
 */
function ReadinessBadge({ readiness }) {
  if (!readiness?.state) return null
  const style = READINESS_STYLES[readiness.state] || READINESS_STYLES.unindexed

  return (
    <div
      className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest ${style.className}`}
      title={readiness.action || 'Answers reflect the current source'}
    >
      {style.label}
    </div>
  )
}

const RISK_STYLES = {
  high: { label: 'High risk', className: 'border-rose-400/30 bg-rose-500/10 text-rose-200' },
  moderate: { label: 'Review carefully', className: 'border-amber-400/30 bg-amber-500/10 text-amber-200' },
  low: { label: 'Low risk', className: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200' }
}

/**
 * Graph-derived blast radius for a proposed write. This is what turns the
 * approval gate from "does this diff look right" into "do I accept this reach".
 */
function ImpactPanel({ impact, specImpact, filePath, onExpandCompose }) {
  const [showDepth, setShowDepth] = useState(false)
  const [depth, setDepth] = useState(null) // null = default 2-hop

  if (!impact) return null

  if (!impact.available) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] text-slate-400">
        Blast radius unavailable — {impact.reason || 'no graph data'}.
        {' '}Build the workspace graph to see what depends on this file.
      </div>
    )
  }

  const risk = RISK_STYLES[impact.risk] || RISK_STYLES.low
  const noTests = impact.testCount === 0 && impact.impactedCount > 0
  const hasSpecs = specImpact?.available && specImpact.mentionedIn?.length > 0

  return (
    <div className="space-y-2">
      {/* Risk badge + counts */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${risk.className}`}>
          {risk.label}
        </span>
        <span className="font-mono text-[11px] text-slate-300">
          {impact.impactedCount} dependent file{impact.impactedCount === 1 ? '' : 's'}
        </span>
        <span className={`font-mono text-[11px] ${noTests ? 'text-rose-300' : 'text-emerald-300'}`}>
          {impact.testCount === 0 ? 'no covering tests' : `${impact.testCount} covering test${impact.testCount === 1 ? '' : 's'}`}
        </span>
        {impact.stale ? (
          <span className="font-mono text-[11px] text-amber-300" title="The graph is older than the source — rebuild for an exact count">
            graph stale
          </span>
        ) : (
          <span className="font-mono text-[11px] text-emerald-500/70">graph current</span>
        )}
      </div>

      {/* Spec awareness — which specs describe this file */}
      {hasSpecs ? (
        <div className="text-[11px] leading-5 text-amber-300/90">
          <FileText size={11} className="inline mr-1 text-amber-400" />
          <span className="font-black uppercase tracking-widest">Specs affected: </span>
          <span className="font-mono">{specImpact.mentionedIn.join(', ')}</span>
        </div>
      ) : specImpact?.available ? (
        <div className="text-[10px] text-slate-600">
          No OpenSpec specs describe this file.
        </div>
      ) : null}

      {/* Top dependents */}
      {impact.topDependents?.length ? (
        <div className="text-[11px] leading-5 text-slate-400">
          <span className="font-black uppercase tracking-widest text-slate-500">Reaches</span>{' '}
          <span className="font-mono">{impact.topDependents.join(', ')}</span>
          {impact.impactedCount > impact.topDependents.length
            ? <span className="text-slate-500"> +{impact.impactedCount - impact.topDependents.length} more</span>
            : null}
        </div>
      ) : null}

      {noTests ? (
        <div className="text-[11px] text-rose-300/90">
          Nothing tests this path. Consider asking for a test alongside the change.
        </div>
      ) : null}

      {/* Depth control */}
      <button
        onClick={() => setShowDepth(!showDepth)}
        className="text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-300 transition-colors"
      >
        {showDepth ? 'Hide' : 'Adjust'} impact depth →
      </button>
      {showDepth && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500">Hops:</span>
          {[1, 2, 3, 4].map(d => (
            <button
              key={d}
              onClick={() => setDepth(d)}
              className={`rounded px-2 py-0.5 text-[10px] font-mono transition-colors ${
                (depth || 2) === d
                  ? 'bg-indigo-500/20 border border-indigo-500/30 text-indigo-300'
                  : 'border border-white/5 text-slate-500 hover:text-slate-300'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      )}

      {/* Cross-reference expander */}
      {filePath && (
        <button
          onClick={() => onExpandCompose?.(filePath)}
          className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-indigo-400 hover:text-indigo-200 transition-colors"
        >
          <Link2 size={10} />
          Full cross-reference (Stardust Compose)
        </button>
      )}
    </div>
  )
}

/**
 * Compact trail of the tool calls behind an answer. Without this the UI sits
 * silent while the agent runs tools, which reads as a hang.
 */
function StepTrail({ steps }) {
  if (!steps?.length) return null

  return (
    <div className="mt-3 space-y-1.5 border-t border-white/10 pt-3">
      {steps.map((step, index) => (
        <div key={`${step.tool}-${index}`} className="flex items-start gap-2 text-[10px] leading-4">
          <Terminal size={10} className={`mt-0.5 shrink-0 ${step.done ? 'text-slate-600' : 'text-indigo-400'}`} />
          <span className={`font-black uppercase tracking-widest ${step.done ? 'text-slate-600' : 'text-indigo-300'}`}>
            {step.tool}
          </span>
          {step.done ? (
            <span className={step.failed ? 'min-w-0 flex-1 truncate text-rose-400/80' : 'min-w-0 flex-1 truncate text-slate-600'}>
              {step.failed ? String(step.error).slice(0, 120) : 'done'}
            </span>
          ) : (
            <span className="text-slate-500">running…</span>
          )}
        </div>
      ))}
    </div>
  )
}

function MessageBubble({ message, onOpenFile, onViewInVr, onApprove, isApprovable }) {
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

          <StepTrail steps={message.steps} />

          {message.approval ? (
            <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
              <div className="readout flex items-center gap-2 !text-amber-300">
                Approval required — {message.approval.tool}
              </div>
              <ImpactPanel impact={message.approval.impact} specImpact={message.approval.specImpact} filePath={message.approval.params?.filePath} onExpandCompose={onOpenFile} />
              <DiffPanel
                filePath={message.approval.params?.filePath}
                oldContent={message.approval.params?.oldContent}
                newContent={message.approval.params?.newContent}
              />
              {isApprovable ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onApprove(true)}
                    className="saber flex-1 rounded-md bg-emerald-600 py-2 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-emerald-500"
                  >
                    Approve change
                  </button>
                  <button
                    type="button"
                    onClick={() => onApprove(false)}
                    className="saber flex-1 rounded-md border border-rose-500/20 bg-rose-600/20 py-2 text-[10px] font-black uppercase tracking-widest text-rose-300 transition-colors hover:bg-rose-600/30"
                  >
                    Reject
                  </button>
                </div>
              ) : (
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  {message.approval.resolved === true ? 'Approved' : message.approval.resolved === false ? 'Rejected' : 'No longer actionable'}
                </div>
              )}
            </div>
          ) : null}
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
          {!message.streaming && message.content ? <CopyButton value={message.content} /> : null}
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
  const [plugins, setPlugins] = useState([])
  const [vrStatus, setVrStatus] = useState(null)
  const [isOpeningVr, setIsOpeningVr] = useState(false)
  const [holocronAvailable, setHolocronAvailable] = useState(false)
  const [workspaceView, setWorkspaceView] = useState('chat')
  const [searchRequest, setSearchRequest] = useState({ id: 0, query: '' })
  const [isSearchPending, setIsSearchPending] = useState(false)
  const [pendingApproval, setPendingApproval] = useState(null)
  const [activeTaskId, setActiveTaskId] = useState(null)
  const [lastPrompt, setLastPrompt] = useState(null)
  const [readiness, setReadiness] = useState(null)
  const messagesEndRef = useRef(null)
  const voiceBridgeRef = useRef(null)

  const selectedNodes = parseStoredJson('yodaman:selectedNodes', [])
  const openFiles = useMemo(() => {
    const refs = messages.flatMap(message => extractFileReferences(message.content))
    return refs.slice(-5)
  }, [messages])

  // Loaded from the runtime rather than hardcoded: plugins can be uploaded,
  // removed or fail to load at any time, and a menu offering one that is not
  // there is a support ticket. A failure leaves the list empty, which simply
  // hides the group.
  useEffect(() => {
    let cancelled = false
    api.getPlugins()
      .then(result => {
        if (cancelled) return
        const list = Array.isArray(result) ? result : result?.plugins || []
        setPlugins(list)
      })
      .catch(() => { if (!cancelled) setPlugins([]) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!selectedProject) return
    // Restore from localStorage first so the thread appears instantly, then
    // reconcile against server-side history.
    const saved = normalizeMessages(parseStoredJson(`yodaman:messages:${selectedProject.id}`, []))
    if (saved.length > 0) setMessages(saved)
    loadHistory()
    loadGitContext()
    loadReadiness()
  }, [selectedProject?.id, selectedProject?.path])

  // Persist the thread, but not on every streaming delta — serializing the
  // whole array per token is wasted work on a long conversation.
  useEffect(() => {
    if (!selectedProject?.id) return
    if (messages.some(message => message.streaming)) return
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(`yodaman:messages:${selectedProject.id}`, JSON.stringify(messages))
      } catch (_) { /* localStorage quota exceeded — ignore */ }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [messages, selectedProject?.id])

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
      const restored = normalizeMessages(history)
      if (restored.length > 0) setMessages(restored)
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

  async function loadReadiness() {
    if (!selectedProject?.path) return
    try {
      setReadiness(await api.getReadiness(selectedProject.path))
    } catch {
      setReadiness(null)
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
        submitWorkspaceInput(text, { usedVoice: true })
      },
      onCommand: command => {
        setInterimTranscript('')
        submitWorkspaceInput(command.query, {
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

  // Callers hand over either a {path, line} ref (file chips) or a bare path
  // string (the approval panel's cross-reference link).
  function openFileReference(ref) {
    const normalized = typeof ref === 'string' ? { path: ref, line: null } : ref
    if (!normalized?.path) return
    window.open(fileRefUrl(normalized, selectedProject?.path), '_blank', 'noopener,noreferrer')
  }

  function viewInVr(refs, diagnostics) {
    window.dispatchEvent(new CustomEvent('yodaman:view-in-vr', { detail: { refs, selectedProject, diagnostics } }))
  }

  async function openProjectInVr() {
    if (isOpeningVr) return
    const diagnosticId = `vr-${Date.now().toString(36)}`
    setIsOpeningVr(true)
    try {
      setError('')
      setVrStatus({ type: 'info', message: `Checking VR runtime… (${diagnosticId})` })
      const webxrSupported = Boolean(window.isSecureContext && navigator.xr)
      const immersiveSupported = webxrSupported
        ? await navigator.xr.isSessionSupported('immersive-vr').catch(() => false)
        : false
      const result = await api.openPlugin('holocron-vr', selectedProject.path, {
        diagnosticId,
        webxrSupported,
        immersiveSupported
      })
      if (!result?.result?.opened) {
        throw new Error(result?.result?.message || 'Holocron VR did not confirm that its viewer opened')
      }
      viewInVr([], { diagnosticId, webxrSupported, immersiveSupported })
      setVrStatus({
        type: immersiveSupported ? 'success' : 'warning',
        message: immersiveSupported
          ? `VR viewer opened. WebXR is ready; put on the headset and select Enter VR. (${diagnosticId})`
          : `Viewer opened in desktop mode. No immersive VR headset is available to this browser. Check the headset connection and WebXR permissions. (${diagnosticId})`
      })
    } catch (err) {
      const message = `VR launch failed: ${err.message} (${diagnosticId})`
      setError(message)
      setVrStatus({ type: 'error', message })
      await api.reportClientError({
        message: err.message || 'Failed to open Holocron VR',
        stack: err.stack,
        userAction: 'open_project_in_vr',
        component: 'AgentChatTab',
        severity: 'high',
        context: { project: selectedProject.path, diagnosticId, secureContext: window.isSecureContext, webxrAvailable: Boolean(navigator.xr) }
      })
    } finally {
      setIsOpeningVr(false)
    }
  }

  /** Update one message by id — array indices shift when history loads mid-stream. */
  function patchMessage(id, patch) {
    setMessages(current => current.map(message => (
      message.id === id ? { ...message, ...(typeof patch === 'function' ? patch(message) : patch) } : message
    )))
  }

  async function resolveApproval(approved) {
    const approval = pendingApproval
    if (!approval) return

    setPendingApproval(null)
    patchMessage(approval.messageId, message => ({
      approval: { ...message.approval, resolved: approved }
    }))

    try {
      await api.approve(approval.taskId, approved)
    } catch (err) {
      setError(`Could not send the approval decision: ${err.message}`)
      setPendingApproval(approval)
      patchMessage(approval.messageId, message => ({
        approval: { ...message.approval, resolved: undefined }
      }))
    }
  }

  async function cancelActiveTask() {
    if (!activeTaskId) return
    try {
      await api.cancelAgentTask(activeTaskId)
      setPendingApproval(null)
    } catch (err) {
      setError(`Could not cancel the task: ${err.message}`)
    }
  }

  async function sendAgentMessage(taskOverride = inputText, { usedVoice = usedVoiceForDraft, commandContext = {} } = {}) {
    const task = String(taskOverride || '').trim()
    if (!task || !selectedProject || isSending) return

    const userMessage = {
      id: nextMessageId(),
      role: 'user',
      content: task,
      timestamp: new Date(),
      usedVoice
    }
    const assistantId = nextMessageId()
    const assistantMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      streaming: true,
      steps: []
    }
    const context = buildAgentContext(commandContext)
    setLastPrompt({ task, usedVoice, commandContext })

    setMessages(current => [...current, userMessage, assistantMessage])
    setInputText('')
    setInterimTranscript('')
    setUsedVoiceForDraft(false)
    setAttachedFiles([])
    setIsSending(true)
    setPendingApproval(null)
    setActiveTaskId(null)
    setError('')

    // Reassure the user if nothing has streamed back yet. Cleared as soon as
    // any content, tool call, or approval arrives.
    let slowTimer = window.setTimeout(() => {
      patchMessage(assistantId, message => (
        message.content || message.steps?.length
          ? {}
          : { content: '⏳ Still working — this is a slow connection or a complex task.' }
      ))
    }, 10000)

    const clearSlowTimer = () => {
      if (slowTimer) {
        window.clearTimeout(slowTimer)
        slowTimer = null
      }
    }

    try {
      await api.agentTask(task, selectedProject.path, step => {
        if (step.taskId) setActiveTaskId(step.taskId)

        switch (step.type) {
          case 'tool_start':
            clearSlowTimer()
            patchMessage(assistantId, message => ({
              steps: [...(message.steps || []), { tool: step.tool, params: step.params, done: false }]
            }))
            return

          case 'tool_end':
            patchMessage(assistantId, message => {
              const steps = [...(message.steps || [])]
              for (let i = steps.length - 1; i >= 0; i -= 1) {
                if (steps[i].tool === step.tool && !steps[i].done) {
                  steps[i] = {
                    ...steps[i],
                    done: true,
                    failed: Boolean(step.result?.error),
                    error: step.result?.error
                  }
                  break
                }
              }
              return { steps }
            })
            return

          case 'awaiting_approval':
            clearSlowTimer()
            setPendingApproval({ taskId: step.taskId, messageId: assistantId, tool: step.tool })
            patchMessage(assistantId, {
              approval: { tool: step.tool, params: step.params, impact: step.impact, resolved: undefined }
            })
            return

          case 'task_cancelled':
            clearSlowTimer()
            setPendingApproval(null)
            patchMessage(assistantId, message => ({
              content: `${message.content}\n\n⏹ Task cancelled.`.trim(),
              streaming: false
            }))
            return

          // The Context Expert CLI exited while streaming this step's answer, so
          // whatever arrived is a fragment. Flagged as it happens rather than only
          // in the final answer, because on a multi-step task the truncated step is
          // usually the one that was about to call a tool.
          case 'response_truncated':
            patchMessage(assistantId, message => ({
              steps: [...(message.steps || []), {
                tool: 'context expert',
                done: true,
                failed: true,
                error: `Answer truncated on step ${step.iteration}: ${step.message || 'the CLI exited mid-stream'}`
              }]
            }))
            return

          case 'final_answer':
            clearSlowTimer()
            speakAgentResponse(step.answer, voiceSettings)
            patchMessage(assistantId, message => ({
              content: step.answer || message.content,
              streaming: false
            }))
            return

          case 'error':
            clearSlowTimer()
            patchMessage(assistantId, message => ({
              content: `${message.content}\n\nError: ${step.message}`.trim(),
              streaming: false
            }))
            return

          default:
            if (step.delta || step.content) {
              clearSlowTimer()
              patchMessage(assistantId, message => ({
                content: `${message.content}${step.delta || step.content}`
              }))
            }
        }
      }, context)

      // The stream can end without a final_answer (cancelled task, dropped
      // connection). Never leave a bubble stuck in the streaming state.
      patchMessage(assistantId, message => (
        message.streaming
          ? { streaming: false, content: message.content || '⚠️ The agent stream ended without an answer.' }
          : {}
      ))
    } catch (err) {
      setError(err.message)
      patchMessage(assistantId, { content: `⚠️ ${err.message}`, streaming: false })
      api.reportClientError({
        message: err.message || 'Agent chat request failed',
        stack: err.stack,
        userAction: 'agent_task',
        component: 'AgentChatTab',
        severity: 'high',
        context: { project: selectedProject.path }
      })
    } finally {
      clearSlowTimer()
      setIsSending(false)
      setActiveTaskId(null)
      setPendingApproval(null)
      loadGitContext()
      loadReadiness()
    }
  }

  function clearConversation() {
    if (!window.confirm('Clear this conversation? The message history for this workspace will be deleted.')) return
    setMessages([])
    setPendingApproval(null)
    setLastPrompt(null)
    setError('')
    try {
      localStorage.removeItem(`yodaman:messages:${selectedProject.id}`)
    } catch (_) { /* ignore */ }
    api.clearSessions(selectedProject.id).catch(() => { })
  }

  async function retryLastPrompt() {
    if (!lastPrompt || isSending) return
    setError('')
    await sendAgentMessage(lastPrompt.task, {
      usedVoice: lastPrompt.usedVoice,
      commandContext: lastPrompt.commandContext
    })
  }

  async function sendMessage(event) {
    event.preventDefault()
    await submitWorkspaceInput()
  }

  // Enter and Cmd/Ctrl+Enter send; Shift+Enter inserts a newline. Without this
  // the composer had no keyboard path to send at all.
  function handleComposerKeyDown(event) {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey) return
    event.preventDefault()
    submitWorkspaceInput()
  }

  async function submitWorkspaceInput(text = inputText, options = {}) {
    const query = String(text || '').trim()
    if (!query || isSending || isSearchPending) return

    if (workspaceView === 'search') {
      setSearchRequest(current => ({ id: current.id + 1, query }))
      setInputText('')
      setInterimTranscript('')
      setUsedVoiceForDraft(false)
      return
    }

    await sendAgentMessage(query, options)
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
                <div className="flex gap-1 rounded-lg border border-white/5 bg-slate-800/50 p-0.5">
                  <button type="button" onClick={() => setWorkspaceView('chat')} className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-[10px] font-black uppercase tracking-widest transition-all ${workspaceView === 'chat' ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-500 hover:text-slate-300'}`}><MessageSquare size={12} />Chat</button>
                  <button type="button" onClick={() => setWorkspaceView('search')} className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-[10px] font-black uppercase tracking-widest transition-all ${workspaceView === 'search' ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-500 hover:text-slate-300'}`}><Search size={12} />Search</button>
                </div>

              </div>
              <p className="truncate text-xs text-[var(--text-secondary)]">{selectedProject.path}</p>
            </div>
            <div className="flex items-center gap-2">
              {holocronAvailable ? (
                <button onClick={openProjectInVr} disabled={isOpeningVr} className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-cyan-200 hover:bg-cyan-400/20 disabled:cursor-wait disabled:opacity-60" title="Load workspace in Holocron VR">{isOpeningVr ? 'Checking VR…' : 'Load in VR'}</button>
              ) : null}
              <div className="flex items-center gap-1.5 rounded-full border border-indigo-400/20 bg-indigo-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-indigo-200"><Filter size={11} />Scoped to: {selectedProject.name}</div>
              <ReadinessBadge readiness={readiness} />
              <button onClick={clearConversation} disabled={isSending || !messages.length} className="rounded-full border border-rose-400/20 bg-rose-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-rose-200 hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-40" title="Clear conversation">🗑 Clear</button>
              <div className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-200">SSE Ready</div>
            </div>
          </div>
        </header>

        <div className={`${workspaceView === 'search' ? 'flex' : 'hidden'} min-h-0 flex-1`}>
          <SearchWindow selectedProject={selectedProject} searchRequest={searchRequest} onSearchingChange={setIsSearchPending} />
        </div>
        <div className={`${workspaceView === 'chat' ? 'block' : 'hidden'} custom-scrollbar min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-6`}>
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center text-sm text-[var(--text-secondary)]">
              Ask YodaMan to inspect, explain, or change this workspace.
            </div>
          ) : (
            <>
              {messages.length > 50 ? (
                <div className="text-center text-[10px] font-black uppercase tracking-widest text-slate-600">
                  Showing the last 50 of {messages.length} messages
                </div>
              ) : null}
              {messages.slice(-50).map((message, index) => (
                <MessageBubble
                  key={message.id || `${message.timestamp?.toISOString?.() || index}-${index}`}
                  message={message}
                  onOpenFile={openFileReference}
                  onViewInVr={viewInVr}
                  onApprove={resolveApproval}
                  isApprovable={pendingApproval?.messageId === message.id}
                />
              ))}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={sendMessage} className="border-t border-[var(--border-color)] bg-slate-950/70 p-5">
          {vrStatus ? <div role="status" className={`mb-3 rounded-lg border px-3 py-2 text-xs ${vrStatus.type === 'error' ? 'border-rose-400/20 bg-rose-400/10 text-rose-100' : vrStatus.type === 'success' ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100' : 'border-amber-400/20 bg-amber-400/10 text-amber-100'}`}>{vrStatus.message}</div> : null}
          {error ? <div className="mb-3 rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">{error}</div> : null}

          {workspaceView === 'chat' ? <div className="mb-3 flex items-center gap-2">
            <select
              aria-label="Insert a task preset or plugin command"
              value={preset}
              onChange={e => {
                const selected = e.target.value
                setPreset(selected)
                if (!selected) return

                // Both branches only fill the composer. Nothing here sends, and
                // nothing here runs a plugin: a plugin is a tool execution with
                // declared permissions, so it keeps the same "you press Send"
                // contract as anything else typed into this box.
                if (selected.startsWith('plugin:')) {
                  const name = selected.slice('plugin:'.length)
                  const plugin = plugins.find(item => item.name === name)
                  if (plugin) setInputText(pluginInvocation(plugin))
                  return
                }
                const found = TASK_PRESETS.find(p => p.label === selected)
                if (found) setInputText(found.template)
              }}
              className="w-full rounded-lg border border-[var(--border-color)] bg-slate-900/80 px-3 py-2 text-xs text-slate-300 outline-none focus:border-indigo-400/50"
            >
              <option value="">💡 Insert a preset or plugin...</option>
              <optgroup label="Task presets">
                {TASK_PRESETS.map(p => (
                  <option key={p.label} value={p.label}>{p.label}</option>
                ))}
              </optgroup>
              {plugins.length > 0 ? (
                <optgroup label="Plugins — inserts a command, does not run it">
                  {plugins.map(plugin => (
                    <option key={plugin.name} value={`plugin:${plugin.name}`}>
                      {`🔌 ${plugin.name}${pluginCapability(plugin) ? ` · ${pluginCapability(plugin)}` : ''}`}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </div> : null}

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
              onKeyDown={handleComposerKeyDown}
              disabled={isSending || isSearchPending}
              rows={3}
              placeholder={workspaceView === 'search' ? 'Search this workspace...' : 'Give YodaMan an agentic task...'}
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
                <FileUploader files={attachedFiles} onFilesChange={setAttachedFiles} disabled={isSending || isSearchPending} />
                {usedVoiceForDraft ? <span className="text-sm" title="Voice input used">🎤</span> : null}
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => startVoiceInput(false)} className="flex h-9 w-9 items-center justify-center rounded-md border text-slate-300 hover:text-white border-white/10 bg-white/[0.03]" title="Voice input" style={isListening?{borderColor:'rgba(244,63,94,0.4)',background:'rgba(244,63,94,0.15)',animation:'pulse 1s ease-in-out infinite'}:{}}>
                  <Mic size={16} />
                </button>
                {isSending && activeTaskId ? (
                  <button
                    type="button"
                    onClick={cancelActiveTask}
                    className="inline-flex items-center gap-2 rounded-md border border-rose-400/30 bg-rose-500/15 px-4 py-2 text-sm font-bold text-rose-200 transition-colors hover:bg-rose-500/25"
                    title="Stop the running agent task"
                  >
                    <Square size={14} />
                    Stop
                  </button>
                ) : (
                  <button type="submit" disabled={isSending || isSearchPending || !inputText.trim()} className="saber inline-flex items-center gap-2 rounded-md bg-indigo-500 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40">
                    {workspaceView === 'search' ? <Search size={16} /> : <Send size={16} />}
                    {isSearchPending ? 'Searching' : workspaceView === 'search' ? 'Search' : 'Send'}
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between px-1 text-[10px] font-bold uppercase tracking-widest text-slate-600">
            <span>Enter to send · Shift+Enter for a new line</span>
            {!isSending && lastPrompt ? (
              <button type="button" onClick={retryLastPrompt} className="text-slate-500 transition-colors hover:text-indigo-300">
                Retry last prompt
              </button>
            ) : null}
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
