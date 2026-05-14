import { useState, useEffect } from 'react'
import ProjectList from './components/ProjectList'
import ChatWindow from './components/ChatWindow'
import SearchWindow from './components/SearchWindow'
import Dashboard from './components/Dashboard'
import StatusBar from './components/StatusBar'
import SettingsModal from './components/SettingsModal'
import WelcomeModal from './components/WelcomeModal'
import ManualWindow from './components/ManualWindow'
import { MessageSquare, Search, LayoutDashboard, Book } from 'lucide-react'

import { api } from './api/api'

export default function App() {
  const [projects, setProjects] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('chat') // 'chat', 'search', 'dashboard', 'manual'

  useEffect(() => {
    fetchProjects()
  }, [])

  const fetchProjects = async () => {
    try {
      const data = await api.getProjects()
      setProjects(data.map(p => ({
        id: p.id,
        name: p.name,
        path: p.path,
        included: true,
        files: []
      })))
    } catch (err) {
      console.error('Failed to fetch projects:', err)
    }
  }

  const handleToggleProject = (projectId) => {
    setProjects(projects.map(p =>
      p.id === projectId ? { ...p, included: !p.included } : p
    ))
  }

  const handleReindex = async () => {
    if (!selectedProject) return
    try {
      await api.reindex(selectedProject.path)
    } catch (err) {
      console.error('Reindex failed:', err)
    }
  }

  return (
    <div className="flex flex-col h-screen bg-[#020617] text-slate-100 overflow-hidden font-inter">
      {/* Background Glows */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/5 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/5 rounded-full blur-[120px] pointer-events-none"></div>

      <StatusBar />
      
      <main className="flex flex-1 overflow-hidden relative z-10">
        <ProjectList
          projects={projects}
          selectedProject={selectedProject}
          onSelect={(id) => setSelectedProject(projects.find(p => p.id === id))}
          onToggle={handleToggleProject}
          onReindex={handleReindex}
          onOpenSettings={() => setIsModalOpen(true)}
        />
        
        <div className="flex-1 flex flex-col relative">
          {/* Tab Navigation */}
          <div className="flex gap-1 p-4 pb-0">
            <button 
              onClick={() => setActiveTab('chat')}
              className={`flex items-center gap-2 px-6 py-2 rounded-t-2xl border-t border-x border-white/5 transition-all font-bold text-xs uppercase tracking-widest ${activeTab === 'chat' ? 'bg-white/[0.03] text-indigo-400 border-indigo-500/30' : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.01]'}`}
            >
              <MessageSquare size={14} />
              Chat
            </button>
            <button 
              onClick={() => setActiveTab('search')}
              className={`flex items-center gap-2 px-6 py-2 rounded-t-2xl border-t border-x border-white/5 transition-all font-bold text-xs uppercase tracking-widest ${activeTab === 'search' ? 'bg-white/[0.03] text-indigo-400 border-indigo-500/30' : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.01]'}`}
            >
              <Search size={14} />
              Search
            </button>
            <button 
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center gap-2 px-6 py-2 rounded-t-2xl border-t border-x border-white/5 transition-all font-bold text-xs uppercase tracking-widest ${activeTab === 'dashboard' ? 'bg-white/[0.03] text-indigo-400 border-indigo-500/30' : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.01]'}`}
            >
              <LayoutDashboard size={14} />
              Dashboard
            </button>
            <button 
              onClick={() => setActiveTab('manual')}
              className={`flex items-center gap-2 px-6 py-2 rounded-t-2xl border-t border-x border-white/5 transition-all font-bold text-xs uppercase tracking-widest ${activeTab === 'manual' ? 'bg-white/[0.03] text-indigo-400 border-indigo-500/30' : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.01]'}`}
            >
              <Book size={14} />
              Manual
            </button>
          </div>

          <div className="flex-1 overflow-hidden bg-white/[0.01] border-t border-white/5">
            {activeTab === 'chat' && <ChatWindow selectedProject={selectedProject} />}
            {activeTab === 'search' && <SearchWindow selectedProject={selectedProject} />}
            {activeTab === 'dashboard' && <Dashboard />}
            {activeTab === 'manual' && <ManualWindow />}
          </div>
        </div>
      </main>


      {isModalOpen && (
        <SettingsModal
          onClose={() => setIsModalOpen(false)}
          watchedDirs={projects.map(p => p.path)}
          onWatchChange={async () => {
            await fetchProjects()
            setIsModalOpen(false)
          }}
        />
      )}

      <WelcomeModal />
    </div>
  )
}