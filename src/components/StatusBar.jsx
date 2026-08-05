import { useEffect, useState } from 'react'
import { Cpu, Wifi, Clock, Zap, Shield } from 'lucide-react'
import useHealthCheck from '../hooks/useHealthCheck'
import HealthIndicator from './HealthIndicator'

export default function StatusBar() {
    const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString())
    const { checks } = useHealthCheck()

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date().toLocaleTimeString()), 1000)
        return () => clearInterval(timer)
    }, [])

    // Derive status labels from health checks (reliable DependencyChecker data)
    const ctxOk = checks?.ctx?.ok
    const ctxVer = checks?.ctx?.version
    const engineLabel = ctxOk ? `ctx${ctxVer ? ' ' + ctxVer : ''}` : 'ctx unavailable'
    const ollamaOk = checks?.ollama?.ok
    const ollamaVer = checks?.ollama?.version
    const modelLabel = ollamaOk ? (ollamaVer || 'ollama') : 'n/a'

    return (
        <div className="starfield w-full bg-slate-950/80 backdrop-blur-md border-b border-white/5 text-[10px] flex items-center px-6 py-2 gap-6 select-none z-50">
            <div className="flex items-center gap-3 group">
                <div className="relative flex items-center gap-2">
                    <img src="/logo.png" className="h-5 w-5 rounded-md shadow-[0_0_10px_rgba(99,102,241,0.5)]" alt="YodaMan" />
                    <div className="absolute -top-1 -right-1 h-2 w-2 bg-indigo-500 rounded-full shadow-[0_0_12px_rgba(99,102,241,0.8)] animate-pulse"></div>
                </div>
                <span className="font-outfit font-black text-slate-400 uppercase tracking-[0.3em] group-hover:text-indigo-400 transition-colors">YodaMan Core</span>
            </div>
            
            <div className="h-4 w-[1px] bg-white/5 mx-2"></div>
            
            <div className="flex items-center gap-2 text-slate-500 hover:text-emerald-400 transition-colors cursor-default">
                <HealthIndicator checks={checks} />
                <span className="uppercase tracking-[0.15em] font-bold">Status: <span className="text-slate-200">
                    {checks ? 'Active' : '...'}
                </span></span>
            </div>

            <div className="flex items-center gap-2 text-slate-500 hover:text-indigo-400 transition-colors cursor-default">
                <Cpu size={12} className="text-indigo-400/80" />
                <span className="uppercase tracking-[0.15em] font-bold">Engine: <span className="text-slate-200">{engineLabel}</span></span>
            </div>

            <div className="flex items-center gap-2 text-slate-500 hover:text-amber-400 transition-colors cursor-default">
                <Shield size={12} className="text-amber-400/80" />
                <span className="uppercase tracking-[0.15em] font-bold">LLM: <span className="text-slate-200">{modelLabel}</span></span>
            </div>
            
            <div className="flex-1"></div>
            
            <div className="flex items-center gap-6">
                <div className="flex items-center gap-2 text-slate-500 bg-white/5 px-3 py-1 rounded-full border border-white/5">
                    <Clock size={12} className="text-slate-400" />
                    {/* tabular-nums stops the clock jittering as digits change width each second */}
                    <span className="font-mono text-[11px] text-slate-300 font-medium tracking-tight tabular-nums">{currentTime}</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-slate-600 font-bold uppercase tracking-[0.2em]">Build</span>
                    {/* __APP_VERSION__ is replaced at build time with package.json's version. */}
                    <span className="text-indigo-400/80 font-black px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20">v{__APP_VERSION__}</span>
                </div>
            </div>
        </div>
    )
}
