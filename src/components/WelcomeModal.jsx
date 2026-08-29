import { useState, useEffect } from 'react'
import { Sparkles, Zap, Shield, Search, MessageSquare, ArrowRight, X } from 'lucide-react'

export default function WelcomeModal() {
    const [step, setStep] = useState(1)
    const [isVisible, setIsVisible] = useState(false)

    useEffect(() => {
        const hasSeen = localStorage.getItem('yodaman_onboarding_seen')
        if (!hasSeen) {
            setIsVisible(true)
        }
    }, [])

    const dismiss = () => {
        localStorage.setItem('yodaman_onboarding_seen', 'true')
        setIsVisible(false)
    }

    if (!isVisible) return null

    const steps = [
        {
            title: "Welcome to YodaMan",
            // Was: "The professional command center for your Context Expert
            // engine." That sold someone else's product and said nothing about
            // what this one does. Lead with the finding no other tool produces
            // — which modules carry the codebase and what nothing describes —
            // and with the promise that makes it possible to say at all.
            desc: "Your codebase, understood on your own machine. YodaMan maps how your code fits together, then shows you which modules carry it \u2014 and which of those nothing describes. Your code never leaves this computer.",
            icon: <Sparkles className="text-amber-400" size={32} />,
            color: "bg-amber-500/10"
        },
        {
            title: "Index Your Code",
            desc: "Register a repository in 'Workspaces' to begin. YodaMan automatically watches for changes and keeps your AI brain up to date.",
            icon: <Zap className="text-indigo-400" size={32} />,
            color: "bg-indigo-500/10"
        },
        {
            title: "Semantic Search",
            desc: "Use the Search tab to find patterns, not just text. It understands the context of your functions and logic.",
            icon: <Search className="text-emerald-400" size={32} />,
            color: "bg-emerald-500/10"
        },
        {
            title: "AI Chat Q&A",
            desc: "Ask complex questions in the Chat window. YodaMan uses RAG (Retrieval-Augmented Generation) to give precise, code-aware answers.",
            icon: <MessageSquare className="text-purple-400" size={32} />,
            color: "bg-purple-500/10"
        }
    ]

    const currentStep = steps[step - 1]

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 animate-in fade-in duration-500">
            <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-xl" onClick={dismiss}></div>
            
            <div className="relative w-full max-w-lg bg-slate-900 border border-white/10 rounded-[40px] shadow-[0_0_100px_rgba(0,0,0,0.8)] overflow-hidden animate-in zoom-in-95 duration-500">
                <div className="p-10 space-y-8">
                    <div className="flex justify-between items-start">
                        <div className={`p-4 rounded-3xl ${currentStep.color} border border-white/5`}>
                            {currentStep.icon}
                        </div>
                        <button onClick={dismiss} className="p-2 hover:bg-white/5 rounded-full text-slate-500 hover:text-white transition-all">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="space-y-4">
                        <h2 className="text-3xl font-outfit font-black text-white tracking-tight leading-tight">
                            {currentStep.title}
                        </h2>
                        <p className="text-slate-400 font-medium leading-relaxed">
                            {currentStep.desc}
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        {steps.map((_, i) => (
                            <div 
                                key={i} 
                                className={`h-1.5 rounded-full transition-all duration-300 ${i + 1 === step ? 'w-8 bg-indigo-500' : 'w-2 bg-slate-700'}`}
                            ></div>
                        ))}
                    </div>

                    <div className="flex gap-4 pt-4">
                        {step < steps.length ? (
                            <button 
                                onClick={() => setStep(step + 1)}
                                className="flex-1 btn-primary py-4 rounded-2xl flex items-center justify-center gap-2 group"
                            >
                                <span>Continue</span>
                                <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                            </button>
                        ) : (
                            <button 
                                onClick={dismiss}
                                className="flex-1 btn-primary py-4 rounded-2xl flex items-center justify-center gap-2 shadow-[0_0_30px_rgba(79,70,229,0.4)]"
                            >
                                <span>Enter Workspace</span>
                            </button>
                        )}
                        {step < steps.length && (
                            <button 
                                onClick={dismiss}
                                className="px-8 btn-secondary py-4 rounded-2xl text-slate-500 font-bold"
                            >
                                SKIP
                            </button>
                        )}
                    </div>
                </div>
                
                {/* Decorative Elements */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 blur-[60px] pointer-events-none"></div>
                <div className="absolute bottom-0 left-0 w-32 h-32 bg-purple-500/10 blur-[60px] pointer-events-none"></div>
            </div>
        </div>
    )
}
