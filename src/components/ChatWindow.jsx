import { useState, useRef, useEffect } from 'react'
import { Send, Terminal, Bot, User, AlertCircle, Sparkles, Command } from 'lucide-react'

export default function ChatWindow({ selectedProject }) {
    const [messages, setMessages] = useState([])
    const [inputText, setInputText] = useState('')
    const [isGenerating, setIsGenerating] = useState(false)
    const messagesEndRef = useRef(null)

    const sendMessage = async (e) => {
        e.preventDefault()
        if (!inputText.trim() || !selectedProject) return

        const userMsg = { role: 'user', content: inputText, timestamp: new Date() }
        setMessages(prev => [...prev, userMsg])
        setInputText('')
        setIsGenerating(true)

        try {
            const response = await fetch('/api/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    question: inputText, 
                    projects: [selectedProject.path] 
                }),
            })

            const data = await response.json()
            const aiMsg = { 
                role: 'ai', 
                content: data.answer || 'I couldn\'t find a specific answer in the indexed files.', 
                timestamp: new Date() 
            }
            setMessages(prev => [...prev, aiMsg])
        } catch (err) {
            console.error(err)
            setMessages(prev => [...prev, { 
                role: 'error', 
                content: 'Network error: Failed to connect to YodaMan backend.', 
                timestamp: new Date() 
            }])
        } finally {
            setIsGenerating(false)
        }
    }

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

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
                <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                    <div className="h-1.5 w-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                    <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Synced</span>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-8 py-8 space-y-8 custom-scrollbar z-0">
                {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full opacity-20 select-none animate-in fade-in duration-1000">
                        <Bot size={80} className="mb-6 text-indigo-400" />
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
                                <span>Analyzing repository...</span>
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
                            placeholder="Ask YodaMan anything about your code..."
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
                    <span className="flex items-center gap-1.5">Context: Full Project</span>
                </div>
            </div>
        </div>
    )
}