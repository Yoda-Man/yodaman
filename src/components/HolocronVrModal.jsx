import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { api } from '../api/api'

const COMMUNITY_COLORS = [
  '#38bdf8', '#a78bfa', '#34d399', '#fb7185', '#fbbf24',
  '#22d3ee', '#c084fc', '#4ade80', '#f97316', '#60a5fa',
  '#e879f9', '#facc15'
]

function nodeKind(node) {
  const path = node.sourceFile || node.label || ''
  const extension = path.includes('.') ? path.split('.').pop().toUpperCase() : ''
  if (extension && extension.length <= 10) return extension
  return String(node.fileType || 'symbol').replaceAll('_', ' ')
}

function nodeDescription(node, connections = 0) {
  const kind = nodeKind(node)
  const location = [node.sourceFile, node.sourceLocation].filter(Boolean).join(' · ')
  return {
    title: node.label || node.id,
    kind,
    location: location || 'Graphify knowledge graph node',
    summary: `${kind} node in architecture cluster ${node.community ?? 'unknown'}, connected to ${connections} ${connections === 1 ? 'relationship' : 'relationships'}.`
  }
}

function disposeObject(object) {
  object?.geometry?.dispose?.()
  if (Array.isArray(object?.material)) object.material.forEach(material => material.dispose?.())
  else object?.material?.dispose?.()
}

export default function HolocronVrModal({ project, diagnostics, onClose }) {
  const mountRef = useRef(null)
  const labelsRef = useRef(null)
  const tooltipRef = useRef(null)
  const rendererRef = useRef(null)
  const [status, setStatus] = useState('Mapping workspace constellation…')
  const [error, setError] = useState('')
  const [vrSupported, setVrSupported] = useState(false)
  const [session, setSession] = useState(null)
  const [selectedNode, setSelectedNode] = useState(null)
  const [communities, setCommunities] = useState([])

  useEffect(() => {
    let disposed = false
    let frame = 0
    let removeResize
    let controls
    let renderer
    let scene
    const mount = mountRef.current
    const labelsLayer = labelsRef.current
    const tooltip = tooltipRef.current

    async function start() {
      try {
        const graph = await api.mapGraphify(project.path, 500)
        if (disposed) return

        renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
        rendererRef.current = renderer
        renderer.xr.enabled = true
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.setSize(mount.clientWidth, mount.clientHeight)
        renderer.outputEncoding = THREE.sRGBEncoding
        mount.appendChild(renderer.domElement)

        scene = new THREE.Scene()
        scene.background = new THREE.Color(0x02040c)
        scene.fog = new THREE.FogExp2(0x02040c, 0.018)

        const camera = new THREE.PerspectiveCamera(58, mount.clientWidth / mount.clientHeight, 0.1, 220)
        camera.position.set(0, 5, 34)
        controls = new OrbitControls(camera, renderer.domElement)
        controls.enableDamping = true
        controls.dampingFactor = 0.06
        controls.minDistance = 5
        controls.maxDistance = 85
        controls.autoRotate = true
        controls.autoRotateSpeed = 0.22

        const nodes = graph.nodes || []
        const links = graph.links || []
        const nodeIndex = new Map(nodes.map((node, index) => [node.id, index]))
        const degrees = new Uint16Array(nodes.length)
        links.forEach(link => {
          const source = nodeIndex.get(link.source)
          const target = nodeIndex.get(link.target)
          if (source !== undefined) degrees[source]++
          if (target !== undefined) degrees[target]++
        })

        const grouped = new Map()
        nodes.forEach((node, index) => {
          const key = String(node.community ?? 'unknown')
          if (!grouped.has(key)) grouped.set(key, [])
          grouped.get(key).push(index)
        })
        const groups = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length)
        const communityCss = new Map(groups.map(([key], index) => [key, COMMUNITY_COLORS[index % COMMUNITY_COLORS.length]]))
        const communityColor = new Map(groups.map(([key]) => [key, new THREE.Color(communityCss.get(key))]))
        setCommunities(groups.slice(0, 6).map(([key, members], index) => ({
          key,
          count: members.length,
          color: COMMUNITY_COLORS[index % COMMUNITY_COLORS.length]
        })))

        const positions = new Array(nodes.length)
        const goldenAngle = Math.PI * (3 - Math.sqrt(5))
        groups.forEach(([_key, members], groupIndex) => {
          const groupAngle = groupIndex * goldenAngle
          const groupRadius = groupIndex === 0 ? 0 : 5.2 + Math.sqrt(groupIndex) * 3.1
          const center = new THREE.Vector3(
            Math.cos(groupAngle) * groupRadius,
            Math.sin(groupAngle * 1.7) * Math.min(7, groupRadius * 0.42),
            Math.sin(groupAngle) * groupRadius * 0.62
          )
          members.forEach((nodePosition, memberIndex) => {
            const localAngle = memberIndex * goldenAngle
            const localRadius = 0.7 + Math.sqrt(memberIndex) * 0.66
            positions[nodePosition] = new THREE.Vector3(
              center.x + Math.cos(localAngle) * localRadius,
              center.y + Math.sin(localAngle * 1.31) * localRadius * 0.7,
              center.z + Math.sin(localAngle) * localRadius * 0.58
            )
          })
        })

        const geometry = new THREE.SphereGeometry(1, 14, 10)
        const material = new THREE.MeshBasicMaterial({ vertexColors: true })
        const mesh = new THREE.InstancedMesh(geometry, material, nodes.length)
        const matrix = new THREE.Matrix4()
        const nodeScales = new Float32Array(nodes.length)
        nodes.forEach((node, index) => {
          const scale = Math.min(0.7, 0.17 + Math.sqrt(degrees[index]) * 0.075)
          nodeScales[index] = scale
          matrix.makeScale(scale, scale, scale)
          matrix.setPosition(positions[index])
          mesh.setMatrixAt(index, matrix)
          mesh.setColorAt(index, communityColor.get(String(node.community ?? 'unknown')))
        })
        mesh.instanceMatrix.needsUpdate = true
        mesh.instanceColor.needsUpdate = true
        scene.add(mesh)

        const haloMaterial = new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.16,
          side: THREE.BackSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        })
        const halos = new THREE.InstancedMesh(geometry, haloMaterial, nodes.length)
        nodes.forEach((node, index) => {
          const scale = nodeScales[index] * 1.9
          matrix.makeScale(scale, scale, scale)
          matrix.setPosition(positions[index])
          halos.setMatrixAt(index, matrix)
          halos.setColorAt(index, communityColor.get(String(node.community ?? 'unknown')))
        })
        halos.instanceMatrix.needsUpdate = true
        halos.instanceColor.needsUpdate = true
        scene.add(halos)

        const edgePositions = []
        const edgeColors = []
        links.forEach(link => {
          const sourceIndex = nodeIndex.get(link.source)
          const targetIndex = nodeIndex.get(link.target)
          if (sourceIndex === undefined || targetIndex === undefined) return
          edgePositions.push(...positions[sourceIndex].toArray(), ...positions[targetIndex].toArray())
          const sourceColor = communityColor.get(String(nodes[sourceIndex].community ?? 'unknown'))
          const targetColor = communityColor.get(String(nodes[targetIndex].community ?? 'unknown'))
          edgeColors.push(...sourceColor.toArray(), ...targetColor.toArray())
        })
        const edgeGeometry = new THREE.BufferGeometry()
        edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3))
        edgeGeometry.setAttribute('color', new THREE.Float32BufferAttribute(edgeColors, 3))
        const lines = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.2,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        }))
        scene.add(lines)

        const starPositions = new Float32Array(900 * 3)
        for (let i = 0; i < starPositions.length; i += 3) {
          const radius = 35 + Math.random() * 65
          const theta = Math.random() * Math.PI * 2
          const phi = Math.acos(2 * Math.random() - 1)
          starPositions[i] = radius * Math.sin(phi) * Math.cos(theta)
          starPositions[i + 1] = radius * Math.cos(phi)
          starPositions[i + 2] = radius * Math.sin(phi) * Math.sin(theta)
        }
        const starsGeometry = new THREE.BufferGeometry()
        starsGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
        const stars = new THREE.Points(starsGeometry, new THREE.PointsMaterial({ color: 0x64748b, size: 0.055, transparent: true, opacity: 0.6 }))
        scene.add(stars)

        const importantNodes = nodes
          .map((node, index) => ({ node, index, degree: degrees[index] }))
          .sort((a, b) => b.degree - a.degree)
          .slice(0, Math.min(18, nodes.length))
        const labels = importantNodes.map(({ node, index }) => {
          const label = document.createElement('div')
          label.className = 'absolute -translate-x-1/2 rounded-md border border-white/10 bg-slate-950/75 px-2 py-1 text-[10px] font-semibold text-slate-100 shadow-lg backdrop-blur-md'
          label.textContent = node.label || node.id
          label.style.borderColor = communityCss.get(String(node.community ?? 'unknown'))
          label.style.whiteSpace = 'nowrap'
          labelsLayer.appendChild(label)
          return { element: label, index }
        })

        const raycaster = new THREE.Raycaster()
        const pointer = new THREE.Vector2()
        let hoveredIndex = -1
        const updatePointer = event => {
          const rect = renderer.domElement.getBoundingClientRect()
          pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
          pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
          raycaster.setFromCamera(pointer, camera)
          const hit = raycaster.intersectObject(mesh, false)[0]
          hoveredIndex = hit?.instanceId ?? -1
          renderer.domElement.style.cursor = hoveredIndex >= 0 ? 'pointer' : 'grab'
          if (hoveredIndex < 0) {
            tooltip.style.opacity = '0'
            return
          }
          const detail = nodeDescription(nodes[hoveredIndex], degrees[hoveredIndex])
          const title = document.createElement('strong')
          const meta = document.createElement('span')
          title.textContent = detail.title
          meta.textContent = `${detail.kind} · ${degrees[hoveredIndex]} connections`
          tooltip.replaceChildren(title, meta)
          tooltip.style.left = `${event.clientX - rect.left + 14}px`
          tooltip.style.top = `${event.clientY - rect.top + 14}px`
          tooltip.style.opacity = '1'
        }
        const selectHovered = () => {
          if (hoveredIndex < 0) return
          controls.autoRotate = false
          controls.target.copy(positions[hoveredIndex])
          setSelectedNode({ ...nodeDescription(nodes[hoveredIndex], degrees[hoveredIndex]), color: communityCss.get(String(nodes[hoveredIndex].community ?? 'unknown')) })
        }
        renderer.domElement.addEventListener('pointermove', updatePointer)
        renderer.domElement.addEventListener('pointerleave', () => { tooltip.style.opacity = '0' })
        renderer.domElement.addEventListener('click', selectHovered)

        const resize = () => {
          if (!mount.clientWidth || !mount.clientHeight) return
          camera.aspect = mount.clientWidth / mount.clientHeight
          camera.updateProjectionMatrix()
          renderer.setSize(mount.clientWidth, mount.clientHeight)
        }
        window.addEventListener('resize', resize)
        removeResize = () => window.removeEventListener('resize', resize)

        const projected = new THREE.Vector3()
        let renderCount = 0
        renderer.setAnimationLoop(() => {
          controls.update()
          stars.rotation.y += 0.00008
          if (renderCount++ % 2 === 0) {
            labels.forEach(({ element, index }) => {
              projected.copy(positions[index]).project(camera)
              const visible = projected.z < 1 && Math.abs(projected.x) < 1.05 && Math.abs(projected.y) < 1.05
              element.style.display = visible ? 'block' : 'none'
              if (visible) {
                element.style.left = `${(projected.x * 0.5 + 0.5) * mount.clientWidth}px`
                element.style.top = `${(-projected.y * 0.5 + 0.5) * mount.clientHeight - 18}px`
              }
            })
          }
          renderer.render(scene, camera)
        })
        frame = requestAnimationFrame(resize)

        const supported = Boolean(navigator.xr) && await navigator.xr.isSessionSupported('immersive-vr').catch(() => false)
        setVrSupported(supported)
        const shown = nodes.length === graph.totalNodes ? `${nodes.length} nodes` : `${nodes.length} of ${graph.totalNodes || nodes.length} nodes`
        setStatus(`${shown} · ${links.length} relationships · ${groups.length} architecture clusters${supported ? ' · headset ready' : ' · desktop mode'}`)
      } catch (err) {
        setError(`Could not start Holocron VR: ${err.message}`)
        api.reportClientError({ message: err.message, stack: err.stack, userAction: 'render_holocron_vr', component: 'HolocronVrModal', severity: 'high', context: { project: project.path, diagnostics } })
      }
    }

    start()
    return () => {
      disposed = true
      removeResize?.()
      cancelAnimationFrame(frame)
      renderer?.setAnimationLoop(null)
      renderer?.domElement?.remove()
      labelsLayer?.replaceChildren()
      scene?.traverse(disposeObject)
      renderer?.dispose()
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
      next.addEventListener('end', () => { setSession(null); setStatus('VR session ended · desktop constellation active') })
      await rendererRef.current.xr.setSession(next)
      setSession(next)
      setStatus('Headset connected · immersive constellation active')
    } catch (err) {
      setError(`Headset connection failed: ${err.message}. Confirm the headset is awake, connected, and WebXR permission is allowed.`)
      api.reportClientError({ message: err.message, stack: err.stack, userAction: 'enter_immersive_vr', component: 'HolocronVrModal', severity: 'high', context: { project: project.path, diagnostics } })
    }
  }

  return <div className="starfield fixed inset-0 z-[100] flex flex-col bg-[#02040c] text-slate-100">
    <header className="relative z-30 flex items-center justify-between border-b border-cyan-300/10 bg-slate-950/90 px-5 py-3 backdrop-blur-xl">
      <div><div className="font-black tracking-tight">Holocron VR <span className="ml-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] text-cyan-200">v0.5.1</span></div><div className="max-w-[48vw] truncate text-xs text-slate-400">{project.path}</div></div>
      <div className="flex items-center gap-3">
        <span role="status" className="max-w-[42vw] text-right text-xs text-cyan-200">{error || status}</span>
        <button type="button" onClick={toggleVr} disabled={!vrSupported && !session} className="saber rounded-lg bg-cyan-400 px-4 py-2 text-xs font-black text-slate-950 shadow-[0_0_24px_rgba(34,211,238,.24)] disabled:bg-slate-700 disabled:text-slate-400 disabled:shadow-none">{session ? 'Exit VR' : vrSupported ? 'Enter VR' : 'No headset detected'}</button>
        <button type="button" onClick={onClose} className="rounded-lg border border-white/15 px-4 py-2 text-xs font-black hover:bg-white/10">Close</button>
      </div>
    </header>
    {error ? <div className="relative z-30 border-b border-rose-400/30 bg-rose-500/10 px-5 py-3 text-sm text-rose-100">{error}</div> : null}
    <div ref={mountRef} className="relative min-h-0 flex-1 overflow-hidden">
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 z-10 overflow-hidden" />
      <div ref={tooltipRef} className="pointer-events-none absolute z-20 grid max-w-xs gap-1 rounded-lg border border-white/15 bg-slate-950/90 px-3 py-2 text-xs opacity-0 shadow-2xl backdrop-blur-xl transition-opacity [&_span]:text-[10px] [&_span]:text-slate-400" />
      <div className="pointer-events-none absolute left-5 top-5 z-20 rounded-xl border border-white/10 bg-slate-950/70 p-3 shadow-xl backdrop-blur-xl">
        <div className="mb-2 text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Architecture clusters</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">{communities.map(community => <div key={community.key} className="flex items-center gap-2 text-[10px] text-slate-300"><span className="h-2 w-2 rounded-full shadow-[0_0_8px_currentColor]" style={{ background: community.color, color: community.color }} /><span>Cluster {community.key}</span><span className="text-slate-500">{community.count}</span></div>)}</div>
      </div>
      <div className="pointer-events-none absolute bottom-5 left-5 z-20 rounded-lg border border-white/10 bg-slate-950/65 px-3 py-2 text-[10px] text-slate-400 backdrop-blur-xl">Drag to orbit · scroll to zoom · click a node to inspect</div>
      {selectedNode ? <aside className="absolute bottom-5 right-5 z-20 w-80 rounded-xl border bg-slate-950/90 p-4 shadow-2xl backdrop-blur-xl" style={{ borderColor: selectedNode.color }}>
        <button type="button" onClick={() => setSelectedNode(null)} className="absolute right-3 top-3 text-slate-500 hover:text-white" aria-label="Close node details">×</button>
        <div className="mb-1 text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: selectedNode.color }}>{selectedNode.kind}</div>
        <h2 className="pr-6 text-base font-black text-white">{selectedNode.title}</h2>
        <p className="mt-1 break-all text-[10px] leading-4 text-slate-400">{selectedNode.location}</p>
        <p className="mt-3 border-t border-white/10 pt-3 text-xs leading-5 text-slate-300">{selectedNode.summary}</p>
      </aside> : null}
    </div>
  </div>
}
