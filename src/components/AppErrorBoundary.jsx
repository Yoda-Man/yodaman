import { Component } from 'react'

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('YodaMan renderer crashed:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <main className="flex min-h-screen items-center justify-center bg-[#020617] p-8 text-slate-100">
        <section className="w-full max-w-xl rounded-2xl border border-rose-500/20 bg-rose-500/10 p-6 text-center">
          <h1 className="text-xl font-black">YodaMan hit a display error</h1>
          <p className="mt-2 text-sm text-slate-300">Your workspace and chat history are safe. Reload the interface to continue.</p>
          <pre className="mt-4 max-h-40 overflow-auto rounded-lg bg-black/30 p-3 text-left text-xs text-rose-200">{this.state.error.message}</pre>
          <button type="button" onClick={() => window.location.reload()} className="mt-5 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-400">
            Reload YodaMan
          </button>
        </section>
      </main>
    )
  }
}
