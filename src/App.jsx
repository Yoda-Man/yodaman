import { useState, useEffect } from 'react'
import ProjectList from './components/ProjectList'
import ChatWindow from './components/ChatWindow'
import SearchWindow from './components/SearchWindow'
import Dashboard from './components/Dashboard'
import StatusBar from './components/StatusBar'
import SettingsModal from './components/SettingsModal'
import LogsModal from './components/LogsModal'
import WelcomeModal from './components/WelcomeModal'
import ManualWindow from './components/ManualWindow'
import PluginsWindow from './components/PluginsWindow'
import { MessageSquare, Search, LayoutDashboard, Book, Puzzle, Settings, Terminal } from 'lucide-react'

import { api } from './api/api'

export default function App() {
  const [projects, setProjects] = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isLogsOpen, setIsLogsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('chat') // 'chat', 'search', 'dashboard', 'manual', 'plugins'
  const [isRefreshingProjects, setIsRefreshingProjects] = useState(false)

  useEffect(() => {
    fetchProjects()
  }, [])


  const fetchProjects = async () => {
    setIsRefreshingProjects(true)
    try {
      const data = await api.getProjects()
      const nextProjects = data.map(p => ({
        id: p.id,
        name: p.name,
        path: p.path,
        included: true,
        files: []
      }))
      setProjects(nextProjects)
      setSelectedProject(current => {
        if (!current) return null
        return nextProjects.find(p => p.path === current.path || p.id === current.id) || null
      })
    } catch (err) {
      console.error('Failed to fetch projects:', err)
    } finally {
      setIsRefreshingProjects(false)
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
      const result = await api.reindex(selectedProject.path)
      await fetchProjects()
      window.alert(result.message || 'Indexing queued.')
    } catch (err) {
      console.error('Reindex failed:', err)
      window.alert(`Sync failed: ${err.message}`)
    }
  }

  const handleDeleteProject = async (path) => {
    try {
      await api.removeProject(path)
      setProjects(prev => prev.filter(p => p.path !== path))
      if (selectedProject?.path === path) {
        setSelectedProject(null)
      }
    } catch (err) {
      console.error('Delete project failed:', err)
      throw err
    }
  }

  const handleUpdateProjectPath = async (path, nextPath) => {
    try {
      const updated = await api.updateProjectPath(path, nextPath)
      await fetchProjects()
      if (selectedProject?.path === path) {
        setSelectedProject({
          id: updated.path,
          name: updated.path.split('/').filter(Boolean).pop() || updated.path,
          path: updated.path,
          included: true,
          files: []
        })
      }
    } catch (err) {
      console.error('Update project path failed:', err)
      throw err
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
          onRefresh={fetchProjects}
          isRefreshing={isRefreshingProjects}
          onDelete={handleDeleteProject}
          onUpdatePath={handleUpdateProjectPath}
        />
        
        <div className="flex-1 flex flex-col relative">
          {/* Tab Navigation */}
          <div className="flex items-end justify-between gap-4 p-4 pb-0">
            <div className="flex gap-1 min-w-0 overflow-x-auto custom-scrollbar">
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
              <button 
                onClick={() => setActiveTab('plugins')}
                className={`flex items-center gap-2 px-6 py-2 rounded-t-2xl border-t border-x border-white/5 transition-all font-bold text-xs uppercase tracking-widest ${activeTab === 'plugins' ? 'bg-white/[0.03] text-indigo-400 border-indigo-500/30' : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.01]'}`}
              >
                <Puzzle size={14} />
                Plugins
              </button>
            </div>
            <div className="mb-2 flex shrink-0 items-center gap-2">
              <button
                onClick={() => setIsLogsOpen(true)}
                className="flex items-center gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-xs font-bold uppercase tracking-widest text-cyan-200 transition-all hover:border-cyan-400/50 hover:bg-cyan-500/20 hover:text-white"
                title="Open runtime logs"
              >
                <Terminal size={15} />
                Logs
              </button>
              <button
                onClick={() => setIsModalOpen(true)}
                className="flex items-center gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-2 text-xs font-bold uppercase tracking-widest text-indigo-300 transition-all hover:border-indigo-400/50 hover:bg-indigo-500/20 hover:text-white"
                title="Open configuration"
              >
                <Settings size={15} />
                Settings
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-hidden bg-white/[0.01] border-t border-white/5">
            {activeTab === 'chat' && <ChatWindow selectedProject={selectedProject} />}
            {activeTab === 'search' && <SearchWindow selectedProject={selectedProject} />}
            {activeTab === 'dashboard' && <Dashboard />}
            {activeTab === 'manual' && <ManualWindow />}
            {activeTab === 'plugins' && <PluginsWindow selectedProject={selectedProject} />}
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

      {isLogsOpen && (
        <LogsModal onClose={() => setIsLogsOpen(false)} />
      )}

      <WelcomeModal />
    </div>
  )
}
