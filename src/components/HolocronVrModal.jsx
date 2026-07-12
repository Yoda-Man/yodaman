import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { api } from '../api/api'

export default function HolocronVrModal({ project, diagnostics, onClose }) {
  const mountRef = useRef(null)
  const rendererRef = useRef(null)
  const [status, setStatus] = useState('Loading workspace graph…')
  const [error, setError] = useState('')
  const [vrSupported, setVrSupported] = useState(false)
  const [session, setSession] = useState(null)

  useEffect(() => {
    let disposed = false
    let frame = 0
    let controls
    let renderer
    const mount = mountRef.current

    async function start() {
      try {
        const graph = await api.mapGraphify(project.path, 500)
        if (disposed) return
        renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
        rendererRef.current = renderer
        renderer.xr.enabled = true
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.setSize(mount.clientWidth, mount.clientHeight)
        mount.appendChild(renderer.domElement)

        const scene = new THREE.Scene()
        scene.background = new THREE.Color(0x020617)
        scene.fog = new THREE.Fog(0x020617, 35, 100)
        const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 200)
        camera.position.set(0, 4, 28)
        controls = new OrbitControls(camera, renderer.domElement)
        controls.enableDamping = true
        scene.add(new THREE.AmbientLight(0x6677aa, 0.8))
        const light = new THREE.PointLight(0x22d3ee, 2, 100)
        light.position.set(10, 15, 15)
        scene.add(light)

        const nodes = graph.nodes || []
        const geometry = new THREE.SphereGeometry(0.22, 10, 8)
        const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 })
        const mesh = new THREE.InstancedMesh(geometry, material, nodes.length)
        const positions = new Map()
        const matrix = new THREE.Matrix4()
        const color = new THREE.Color()
        nodes.forEach((node, index) => {
          const phi = Math.acos(1 - 2 * (index + 0.5) / Math.max(nodes.length, 1))
          const theta = Math.PI * (1 + Math.sqrt(5)) * index
          const radius = 8 + (Number(node.community || 0) % 5) * 1.5
          const position = new THREE.Vector3(radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta))
          positions.set(node.id, position)
          matrix.makeTranslation(position.x, position.y, position.z)
          mesh.setMatrixAt(index, matrix)
          mesh.setColorAt(index, color.setHSL(((Number(node.community) || 0) * 0.137) % 1, 0.75, 0.58))
        })
        scene.add(mesh)

        const linePoints = []
        ;(graph.links || []).forEach(link => {
          const from = positions.get(link.source)
          const to = positions.get(link.target)
          if (from && to) linePoints.push(from, to)
        })
        const lines = new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(linePoints),
          new THREE.LineBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.32 })
        )
        scene.add(lines)

        const resize = () => {
          if (!mount.clientWidth || !mount.clientHeight) return
          camera.aspect = mount.clientWidth / mount.clientHeight
          camera.updateProjectionMatrix()
          renderer.setSize(mount.clientWidth, mount.clientHeight)
        }
        window.addEventListener('resize', resize)
        renderer.setAnimationLoop(() => {
          controls.update()
          mesh.rotation.y += 0.0008
          lines.rotation.y = mesh.rotation.y
          renderer.render(scene, camera)
        })
        frame = requestAnimationFrame(resize)
        const supported = Boolean(navigator.xr) && await navigator.xr.isSessionSupported('immersive-vr').catch(() => false)
        setVrSupported(supported)
        setStatus(`${nodes.length} nodes and ${(graph.links || []).length} links loaded${supported ? ' — headset ready' : ' — desktop mode'}.`)
        return () => window.removeEventListener('resize', resize)
      } catch (err) {
        setError(`Could not start Holocron VR: ${err.message}`)
        api.reportClientError({ message: err.message, stack: err.stack, userAction: 'render_holocron_vr', component: 'HolocronVrModal', severity: 'high', context: { project: project.path, diagnostics } })
      }
    }

    let removeResize
    start().then(cleanup => { removeResize = cleanup })
    return () => {
      disposed = true
      removeResize?.()
      cancelAnimationFrame(frame)
      renderer?.setAnimationLoop(null)
      renderer?.dispose()
      renderer?.domElement?.remove()
    }
  }, [project.path])

  async function toggleVr() {
    try {
      if (session) {
        await session.end()
        return
      }
      setStatus('Requesting headset permission…')
      const next = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] })
      next.addEventListener('end', () => { setSession(null); setStatus('VR session ended — desktop mode active.') })
      await rendererRef.current.xr.setSession(next)
      setSession(next)
      setStatus('Headset connected — immersive VR session active.')
    } catch (err) {
      setError(`Headset connection failed: ${err.message}. Confirm the headset is awake, connected, and WebXR permission is allowed.`)
      api.reportClientError({ message: err.message, stack: err.stack, userAction: 'enter_immersive_vr', component: 'HolocronVrModal', severity: 'high', context: { project: project.path, diagnostics } })
    }
  }

  return <div className="fixed inset-0 z-[100] flex flex-col bg-slate-950 text-slate-100">
    <header className="flex items-center justify-between border-b border-white/10 px-5 py-3">
      <div><div className="font-black">Holocron VR</div><div className="text-xs text-slate-400">{project.path}</div></div>
      <div className="flex items-center gap-3">
        <span role="status" className="text-xs text-cyan-200">{error || status}</span>
        <button type="button" onClick={toggleVr} disabled={!vrSupported && !session} className="rounded-lg bg-cyan-500 px-4 py-2 text-xs font-black text-slate-950 disabled:bg-slate-700 disabled:text-slate-400">{session ? 'Exit VR' : vrSupported ? 'Enter VR' : 'No headset detected'}</button>
        <button type="button" onClick={onClose} className="rounded-lg border border-white/15 px-4 py-2 text-xs font-black">Close</button>
      </div>
    </header>
    {error ? <div className="border-b border-rose-400/30 bg-rose-500/10 px-5 py-3 text-sm text-rose-100">{error}</div> : null}
    <div ref={mountRef} className="min-h-0 flex-1" />
  </div>
}
