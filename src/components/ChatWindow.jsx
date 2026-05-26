import { useState, useRef, useEffect } from 'react'
import { Send, Terminal, Bot, User, AlertCircle, Sparkles, Command } from 'lucide-react'
import { api } from '../api/api'
import ModeToggle from './ModeToggle'

export default function ChatWindow({ selectedProject }) {
    const [messages, setMessages] = useState([])
    const [inputText, setInputText] = useState('')
    const [isGenerating, setIsGenerating] = useState(false)
    const [isAgentMode, setIsAgentMode] = useState(false)
    const [agentSteps, setAgentSteps] = useState([])
    const [mode, setMode] = useState(() => {
        // Load from localStorage or default to 'code'
        try { return localStorage.getItem('yodamanMode') || 'code' }
        catch { return 'code' }
    })
    const messagesEndRef = useRef(null)
    const [pendingApproval, setPendingApproval] = useState(null)

    const handleModeChange = (newMode) => {
        setMode(newMode)
        try { localStorage.setItem('yodamanMode', newMode) } catch (e) {}
        if (selectedProject) {
            api.setMode(newMode, selectedProject.path).catch(console.error)
        }
    }


    const handleApproval = async (approved) => {
        if (!pendingApproval) return
        try {
            await api.approve(pendingApproval.taskId, approved)
            setPendingApproval(null)
            setAgentSteps(prev => [...prev, { 
                type: 'approval_result', 
                tool: 'writeFile', 
                approved 
            }])
        } catch (err) {
            console.error('Approval failed:', err)
        }
    }

    useEffect(() => {
        if (selectedProject) {
            loadSession()
        }
    }, [selectedProject])

    const loadSession = async () => {
        try {
            const history = await api.getSessions(selectedProject.id)
            setMessages(history.map(m => ({ ...m, timestamp: new Date(m.timestamp) })))
        } catch (err) {
            console.error('Failed to load session:', err)
        }
    }

    const clearSession = async () => {
        if (!window.confirm('Are you sure you want to clear this conversation history?')) return
        try {
            await api.clearSessions(selectedProject.id)
            setMessages([])
        } catch (err) {
            console.error('Failed to clear session:', err)
        }
    }

    const sendMessage = async (e) => {
        e.preventDefault()
        if (!inputText.trim() || !selectedProject) return

        const userMsg = { role: 'user', content: inputText, timestamp: new Date() }
        setMessages(prev => [...prev, userMsg])
        setInputText('')
        setIsGenerating(true)
        setAgentSteps([])
        setPendingApproval(null)

        try {
            if (isAgentMode) {
                let currentAiMsg = { role: 'ai', content: '', timestamp: new Date(), isAgent: true }
                setMessages(prev => [...prev, currentAiMsg])

                await api.agentTask(inputText, selectedProject.path, (step) => {
                    if (step.type === 'tool_start') {
                        setAgentSteps(prev => [...prev, { type: 'start', tool: step.tool, params: step.params }])
                    } else if (step.type === 'tool_end') {
                        setAgentSteps(prev => [...prev, { type: 'end', tool: step.tool, result: step.result }])
                    } else if (step.type === 'awaiting_approval') {
                        setPendingApproval(step)
                        setAgentSteps(prev => [...prev, { type: 'approval_needed', tool: step.tool, params: step.params }])
                    } else if (step.type === 'final_answer') {
                        setMessages(prev => {
                            const newMessages = [...prev]
                            newMessages[newMessages.length - 1].content = step.answer
                            return newMessages
                        })
                    } else if (step.type === 'error') {
                        setMessages(prev => [...prev, { role: 'error', content: step.message, timestamp: new Date() }])
                    }
                })
            } else {
                const data = await api.ask(inputText, selectedProject.path, mode)
                const aiMsg = { 
                    role: 'ai', 
                    content: data.answer || 'I couldn\'t find a specific answer in the indexed files.', 
                    timestamp: new Date() 
                }
                setMessages(prev => [...prev, aiMsg])
            }
        } catch (err) {
            console.error(err)
            setMessages(prev => [...prev, { 
                role: 'error', 
                content: err.message || 'YodaMan runtime is not available. Start the desktop app or run "yodaman" from Terminal, then try again.', 
                timestamp: new Date() 
            }])
        } finally {
            setIsGenerating(false)
        }
    }

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages, agentSteps, pendingApproval])

    if (!selectedProject) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center bg-[#020617] p-12 text-center select-none relative overflow-hidden">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none"></div>
                <div className="relative z-10 flex flex-col items-center animate-in fade-in zoom-in duration-700">
                    <div className="h-20 w-20 rounded-3xl bg-slate-900 border border-white/5 flex items-center justify-center mb-8 shadow-2xl">
                        <Command size={40} className="text-indigo-400 opacity-50" />
                    </div>
                    <h3 className="text-2xl font-outfit font-bold text-slate-200 mb-3 tracking-tight">Select a Workspace</h3>
                    <p className="text-slate-500 max-w-sm leading-relaxed text-sm">
                        Choose a repository from the sidebar to start exploring your codebase with AI.
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="flex-1 flex flex-col bg-[#020617] overflow-hidden relative">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500/20 to-transparent"></div>
            
            <div className="px-8 py-4 border-b border-white/5 bg-slate-900/20 backdrop-blur-xl flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                        <Sparkles size={16} className="text-indigo-400" />
                    </div>
                    <div>
                        <h3 className="font-outfit font-bold text-sm text-slate-200 tracking-wide">
                            {selectedProject.name}
                        </h3>
                        <p className="text-[10px] text-slate-500 uppercase tracking-widest font-black">Active Context</p>
                    </div>
                </div>
                
                <div className="flex items-center gap-4">
                    <button 
                        onClick={clearSession}
                        className="px-3 py-1.5 rounded-full border border-white/5 text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-rose-400 hover:border-rose-500/20 transition-all"
                    >
                        Clear Chat
                    </button>

                    <button 
                        onClick={() => setIsAgentMode(!isAgentMode)}
                        className={`flex items-center gap-2 px-4 py-1.5 rounded-full border transition-all text-[10px] font-black uppercase tracking-widest ${isAgentMode ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-400' : 'bg-slate-800/50 border-white/5 text-slate-500'}`}
                    >
                        <Bot size={14} className={isAgentMode ? 'animate-pulse' : ''} />
                        Agent Mode {isAgentMode ? 'ON' : 'OFF'}
                    </button>
                    
                    <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                        <div className="h-1.5 w-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                        <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Synced</span>
                    </div>
                    <ModeToggle mode={mode} onChange={handleModeChange} />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-8 py-8 space-y-8 custom-scrollbar z-0">
                {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full opacity-20 select-none animate-in fade-in duration-1000">
                        <img 
                            src="/logo.png" 
                            className="h-20 w-20 mb-8 rounded-[32px] shadow-[0_0_50px_rgba(79,70,229,0.3)] animate-pulse" 
                            alt="YodaMan Logo" 
                        />
                        <p className="text-lg font-outfit font-medium text-slate-300">How can I help you with <span className="text-indigo-400">{selectedProject.name}</span> today?</p>
                    </div>
                )}
                {messages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-4 duration-500`}>
                        <div className={`flex gap-4 max-w-[80%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                            <div className={`h-10 w-10 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg ${
                                msg.role === 'user' 
                                    ? 'bg-indigo-600 text-white' 
                                    : msg.role === 'error' 
                                        ? 'bg-rose-500/20 border border-rose-500/30 text-rose-400' 
                                        : 'bg-slate-800 border border-white/10 text-indigo-400'
                            }`}>
                                {msg.role === 'user' ? <User size={20} /> : msg.role === 'error' ? <AlertCircle size={20} /> : <Bot size={20} />}
                            </div>
                            <div className={`flex flex-col gap-2 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                <div className={`rounded-2xl px-5 py-3.5 text-sm leading-relaxed shadow-2xl ${
                                    msg.role === 'user' 
                                        ? 'bg-indigo-600 text-white rounded-tr-none' 
                                        : msg.role === 'error' 
                                            ? 'bg-rose-500/10 text-rose-200 border border-rose-500/20 rounded-tl-none'
                                            : 'bg-slate-900 border border-white/5 backdrop-blur-md rounded-tl-none text-slate-200'
                                }`}>
                                    <div className="whitespace-pre-wrap font-inter">{msg.content}</div>
                                    
                                    {msg.isAgent && (msg.steps || (idx === messages.length - 1 && agentSteps.length > 0)) && (
                                        <div className="mt-4 space-y-4 border-t border-white/10 pt-4">
                                            {(msg.steps || agentSteps).map((step, sIdx) => (
                                                <div key={sIdx} className="flex flex-col gap-1">
                                                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-indigo-400/70">
                                                        <Terminal size={10} />
                                                        {step.type === 'start' || step.type === 'tool_start' ? `Executing ${step.tool}...` : 
                                                         step.type === 'approval_needed' || step.type === 'awaiting_approval' ? `Awaiting approval for ${step.tool}` :
                                                         step.type === 'approval_result' ? `${step.tool} ${step.approved ? 'Approved' : 'Rejected'}` :
                                                         `${step.tool} complete`}
                                                    </div>
                                                    {(step.type === 'approval_needed' || step.type === 'awaiting_approval') && (
                                                        <div className="space-y-4 mt-2">
                                                            <DiffViewer 
                                                                filePath={step.params.filePath}
                                                                oldContent={step.params.oldContent}
                                                                newContent={step.params.newContent}
                                                            />
                                                            {idx === messages.length - 1 && !msg.content && (
                                                                <div className="flex gap-2">
                                                                    <button 
                                                                        onClick={() => handleApproval(true)}
                                                                        className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all"
                                                                    >
                                                                        Approve Change
                                                                    </button>
                                                                    <button 
                                                                        onClick={() => handleApproval(false)}
                                                                        className="flex-1 py-2 bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/20 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all"
                                                                    >
                                                                        Reject
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                    {(step.type === 'start' || step.type === 'tool_start') && (
                                                        <div className="bg-black/20 rounded p-2 text-[10px] font-mono text-slate-500 truncate">
                                                            {JSON.stringify(step.params)}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                </div>
                                <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest px-1">
                                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                        </div>
                    </div>
                ))}

                {isGenerating && (
                    <div className="flex justify-start animate-in fade-in duration-300">
                         <div className="flex gap-4 max-w-[80%] items-start">
                            <div className="h-10 w-10 rounded-2xl bg-slate-800 border border-white/10 flex items-center justify-center shadow-lg">
                                <Bot size={20} className="text-indigo-400 animate-pulse" />
                            </div>
                            <div className="bg-slate-900 border border-white/5 px-6 py-4 rounded-2xl rounded-tl-none text-sm text-slate-400 italic backdrop-blur-md flex items-center gap-3">
                                <div className="flex gap-1">
                                    <div className="h-1.5 w-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                                    <div className="h-1.5 w-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                                    <div className="h-1.5 w-1.5 bg-indigo-500 rounded-full animate-bounce"></div>
                                </div>
                                <span>{isAgentMode ? 'Agent is thinking...' : 'Analyzing repository...'}</span>
                            </div>
                         </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="p-8 border-t border-white/5 bg-slate-950/50 backdrop-blur-3xl z-10">
                <form onSubmit={sendMessage} className="flex gap-4 max-w-5xl mx-auto relative group">
                    <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl blur opacity-20 group-focus-within:opacity-40 transition duration-1000 group-hover:duration-200"></div>
                    <div className="relative flex-1 flex gap-2">
                        <input
                            type="text"
                            value={inputText}
                            onChange={e => setInputText(e.target.value)}
                            placeholder={isAgentMode ? "Give Yoda-Agent a coding task..." : "Ask YodaMan anything about your code..."}
                            className="flex-1 input-field pr-16 py-4 bg-slate-900 border-white/5 focus:border-indigo-500/50 text-base shadow-2xl"
                            disabled={isGenerating}
                        />
                        <button 
                            type="submit" 
                            disabled={isGenerating || !inputText.trim()} 
                            className="absolute right-2 top-2 bottom-2 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-all disabled:opacity-20 disabled:grayscale flex items-center justify-center shadow-lg active:scale-95"
                        >
                            <Send size={20} />
                        </button>
                    </div>
                </form>
                <div className="mt-4 flex justify-center gap-4 text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                    <span className="flex items-center gap-1.5"><Command size={10} /> + Enter to send</span>
                    <span className="opacity-20">|</span>
                    <span className="flex items-center gap-1.5">Mode: {isAgentMode ? 'Autonomous Agent' : 'Standard Chat'}</span>
                </div>
            </div>
        </div>
    )
}

function DiffViewer({ filePath, oldContent, newContent }) {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    
    return (
        <div className="bg-black/40 rounded-xl border border-white/10 overflow-hidden text-[11px]">
            <div className="bg-white/5 px-4 py-2 border-b border-white/5 flex items-center justify-between">
                <span className="font-mono text-slate-400 truncate max-w-[70%]">{filePath}</span>
                <span className="text-[9px] font-black uppercase tracking-tighter text-indigo-500 shrink-0">Proposed Changes</span>
            </div>
            <div className="p-4 font-mono max-h-60 overflow-y-auto custom-scrollbar leading-relaxed">
                {oldLines.length > 0 && oldLines.map((line, i) => (
                    line.trim() !== '' && !newLines.includes(line) && (
                        <div key={`del-${i}`} className="text-rose-400 bg-rose-500/10 px-2 -mx-2">
                            - {line}
                        </div>
                    )
                ))}
                {newLines.length > 0 && newLines.map((line, i) => (
                    line.trim() !== '' && !oldLines.includes(line) && (
                        <div key={`add-${i}`} className="text-emerald-400 bg-emerald-500/10 px-2 -mx-2">
                            + {line}
                        </div>
                    )
                ))}
                {oldContent === '' && <div className="text-slate-500 italic">[New File]</div>}
            </div>
        </div>
    );
}
