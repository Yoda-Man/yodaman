/**
 * The Holocron constellation: three.js scene, camera, post-processing and
 * interaction, behind a small imperative API the React modal drives.
 *
 *   createConstellation({ mount, labelsLayer, model, positions, onHover, onSelect })
 *     -> { renderer, setVisible, setFocus, setHeat, flyTo, resetCamera, dispose }
 *
 * Look: shaded spheres sized by how connected a node is, an additive glow
 * halo per node (larger and brighter for hubs) fed through a bloom pass, edges
 * in their cluster's colour, a deep starfield, and named clusters. Selecting a
 * node lights its neighbourhood and dims everything else.
 *
 * Bloom runs on the desktop only. In a headset the scene renders directly:
 * EffectComposer does not render stereo, and frame rate matters more there.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { neighborhood } from './graphModel'

const BACKGROUND = 0x02030a
const DIM = 0.1
const HEAT_COLD = new THREE.Color('#1e3a8a')
const HEAT_WARM = new THREE.Color('#f59e0b')
const HEAT_HOT = new THREE.Color('#ef4444')

const GLOW_VERTEX = `
  attribute float size;
  attribute vec3 tint;
  attribute float alpha;
  varying vec3 vTint;
  varying float vAlpha;
  void main() {
    vTint = tint;
    vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (320.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`
const GLOW_FRAGMENT = `
  varying vec3 vTint;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vTint, a * a * vAlpha);
  }
`

// Hierarchy is the look: leaves small and quiet, hubs large and bright.
function nodeScale(degree) {
  return Math.min(1.3, 0.13 + Math.pow(degree, 0.62) * 0.07)
}

function heatColor(value, target) {
  if (value <= 0) return target.setRGB(0.18, 0.2, 0.26)
  return value < 0.5
    ? target.copy(HEAT_COLD).lerp(HEAT_WARM, value * 2)
    : target.copy(HEAT_WARM).lerp(HEAT_HOT, (value - 0.5) * 2)
}

function extentOf(positions) {
  let radius = 0
  for (let i = 0; i < positions.length; i += 3) radius = Math.max(radius, Math.hypot(positions[i], positions[i + 1], positions[i + 2]))
  return Math.max(radius, 8)
}

export function createConstellation({ mount, labelsLayer, model, positions, onHover, onSelect }) {
  const count = model.nodes.length
  const radius = extentOf(positions)
  const at = (i) => new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
  const clusterColors = model.clusters.map((c) => new THREE.Color(c.color))
  const baseColor = (i) => clusterColors[model.nodes[i].cluster]

  // ── Renderer, camera, controls ─────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  renderer.xr.enabled = true
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(mount.clientWidth, mount.clientHeight)
  mount.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(BACKGROUND)
  scene.fog = new THREE.FogExp2(BACKGROUND, 0.55 / radius)

  const camera = new THREE.PerspectiveCamera(55, mount.clientWidth / mount.clientHeight, 0.1, radius * 20)
  // Above the disc at an angle, so clusters spread across the view instead of
  // stacking along the horizon.
  const home = new THREE.Vector3(0, radius * 0.95, radius * 1.45)
  camera.position.copy(home)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.07
  controls.minDistance = 2
  controls.maxDistance = radius * 5
  controls.autoRotate = true
  controls.autoRotateSpeed = 0.18
  controls.addEventListener('start', () => { controls.autoRotate = false })

  scene.add(new THREE.AmbientLight(0xffffff, 0.55))
  const key = new THREE.DirectionalLight(0xffffff, 0.9)
  key.position.set(1, 1.4, 1.2)
  scene.add(key)
  const rim = new THREE.PointLight(0x7dd3fc, 0.8, radius * 6)
  camera.add(rim)
  scene.add(camera)

  // ── Nodes: shaded spheres ──────────────────────────────────────────────
  const sphere = new THREE.SphereGeometry(1, 24, 16)
  const nodeMaterial = new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.15 })
  const mesh = new THREE.InstancedMesh(sphere, nodeMaterial, count)
  const matrix = new THREE.Matrix4()
  const color = new THREE.Color()
  const scales = model.nodes.map((n) => nodeScale(n.degree))

  // ── Glow halos ─────────────────────────────────────────────────────────
  const glowGeometry = new THREE.BufferGeometry()
  glowGeometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(positions), 3))
  const glowSize = new Float32Array(count)
  const glowTint = new Float32Array(count * 3)
  const glowAlpha = new Float32Array(count)
  glowGeometry.setAttribute('size', new THREE.BufferAttribute(glowSize, 1))
  glowGeometry.setAttribute('tint', new THREE.BufferAttribute(glowTint, 3))
  glowGeometry.setAttribute('alpha', new THREE.BufferAttribute(glowAlpha, 1))
  const glow = new THREE.Points(glowGeometry, new THREE.ShaderMaterial({
    vertexShader: GLOW_VERTEX,
    fragmentShader: GLOW_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  }))
  const hubs = new Set(model.clusters.map((c) => c.hub))

  // ── Edges ──────────────────────────────────────────────────────────────
  const edgeCount = model.edges.length / 2
  const edgePositions = new Float32Array(edgeCount * 6)
  const edgeColors = new Float32Array(edgeCount * 6)
  for (let e = 0; e < edgeCount; e++) {
    const s = model.edges[e * 2]
    const t = model.edges[e * 2 + 1]
    edgePositions.set([positions[s * 3], positions[s * 3 + 1], positions[s * 3 + 2], positions[t * 3], positions[t * 3 + 1], positions[t * 3 + 2]], e * 6)
  }
  const edgeGeometry = new THREE.BufferGeometry()
  edgeGeometry.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3))
  edgeGeometry.setAttribute('color', new THREE.BufferAttribute(edgeColors, 3))
  // Normal blending, not additive: a fan of links between two clusters lies
  // almost on one line, and additively it summed to a white streak brighter
  // than any node. Overlaps now stay their cluster's colour; the nodes glow.
  const edges = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false
  }))

  // ── Starfield ──────────────────────────────────────────────────────────
  const starCount = 2600
  const stars = new Float32Array(starCount * 3)
  for (let i = 0; i < starCount; i++) {
    const r = radius * (3 + Math.random() * 7)
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    stars.set([r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)], i * 3)
  }
  const starGeometry = new THREE.BufferGeometry()
  starGeometry.setAttribute('position', new THREE.BufferAttribute(stars, 3))
  const starfield = new THREE.Points(starGeometry, new THREE.PointsMaterial({
    color: 0x9fb4d8, size: radius * 0.012, sizeAttenuation: true, transparent: true, opacity: 0.55, fog: false, depthWrite: false
  }))

  // ── Focus ring around the selected node ────────────────────────────────
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.35, 1.5, 64),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
  )
  ring.visible = false

  scene.add(starfield, edges, mesh, glow, ring)

  // ── Post-processing (desktop only) ─────────────────────────────────────
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(mount.clientWidth, mount.clientHeight), 0.85, 0.55, 0.12)
  composer.addPass(bloom)

  // ── State and repaint ──────────────────────────────────────────────────
  let visible = new Uint8Array(count).fill(1)
  let focus = null
  let focusSet = null
  let heat = null

  function nodeColor(i, target) {
    if (heat) heatColor(heat[i], target)
    else target.copy(baseColor(i))
    if (focusSet && !focusSet.has(i)) target.multiplyScalar(DIM)
    return target
  }

  function repaint() {
    for (let i = 0; i < count; i++) {
      const s = visible[i] ? scales[i] * (i === focus ? 1.35 : 1) : 0
      const p = at(i)
      matrix.makeScale(s, s, s)
      matrix.setPosition(p)
      mesh.setMatrixAt(i, matrix)
      nodeColor(i, color)
      mesh.setColorAt(i, color)

      const lit = !focusSet || focusSet.has(i)
      const hub = hubs.has(i) && model.nodes[i].degree >= 3
      glowSize[i] = visible[i] ? scales[i] * (hub ? 11 : 5) * (i === focus ? 1.6 : 1) : 0
      glowAlpha[i] = visible[i] ? (lit ? (hub ? 1 : 0.38) : 0.05) : 0
      color.toArray(glowTint, i * 3)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor.needsUpdate = true
    glowGeometry.attributes.size.needsUpdate = true
    glowGeometry.attributes.tint.needsUpdate = true
    glowGeometry.attributes.alpha.needsUpdate = true

    const sourceColor = new THREE.Color()
    for (let e = 0; e < edgeCount; e++) {
      const s = model.edges[e * 2]
      const t = model.edges[e * 2 + 1]
      // Spokes inside a cluster read as its structure; links between
      // clusters stay fainter so they do not veil it.
      const sameCluster = model.nodes[s].cluster === model.nodes[t].cluster
      let strength = visible[s] && visible[t] ? (sameCluster ? 1.1 : 0.28) : 0
      if (focusSet) strength = (s === focus || t === focus) && strength ? 1.6 : strength * 0.06
      nodeColor(s, sourceColor)
      if (focusSet && (s === focus || t === focus)) sourceColor.copy(heat ? heatColor(heat[focus], new THREE.Color()) : baseColor(focus))
      sourceColor.multiplyScalar(strength)
      sourceColor.toArray(edgeColors, e * 6)
      sourceColor.toArray(edgeColors, e * 6 + 3)
    }
    edgeGeometry.attributes.color.needsUpdate = true

    if (focus !== null) {
      ring.position.copy(at(focus))
      ring.scale.setScalar(scales[focus] * 1.35)
      ring.material.color.copy(heat ? heatColor(heat[focus], new THREE.Color()) : baseColor(focus))
      ring.visible = true
    } else {
      ring.visible = false
    }
    rebuildLabels()
  }

  // ── Labels (DOM) ───────────────────────────────────────────────────────
  let labels = []
  function label(text, className, index, anchor) {
    const element = document.createElement('div')
    element.className = className
    element.textContent = text
    labelsLayer.appendChild(element)
    labels.push({ element, index, anchor })
  }
  function rebuildLabels() {
    labels.forEach(({ element }) => element.remove())
    labels = []
    if (focusSet) {
      [...focusSet].filter((i) => visible[i]).sort((a, b) => (b === focus) - (a === focus) || model.nodes[b].degree - model.nodes[a].degree).slice(0, 24).forEach((i) => {
        label(model.nodes[i].label, i === focus ? 'holo-label holo-label-focus' : 'holo-label', i)
      })
      return
    }
    // Cluster names just above each cluster, then the biggest other nodes.
    // A cluster is named after its hub, so the hub is not labelled twice.
    const named = new Set()
    model.clusters.filter((cluster) => visible[cluster.hub]).slice(0, 10).forEach((cluster) => {
      const members = cluster.members.filter((m) => visible[m])
      if (members.length < 3) return
      const centre = new THREE.Vector3()
      members.forEach((m) => centre.add(at(m)))
      centre.divideScalar(members.length)
      const top = members.reduce((max, m) => Math.max(max, positions[m * 3 + 1]), -Infinity)
      label(cluster.name, 'holo-cluster', null, centre.setY(top + 1.2))
      named.add(cluster.hub)
    })
    model.nodes
      .filter((n) => visible[n.index] && !named.has(n.index))
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 14)
      .forEach((n) => label(n.label, 'holo-label', n.index))
  }

  const projected = new THREE.Vector3()
  function placeLabels() {
    const width = mount.clientWidth
    const height = mount.clientHeight
    for (const { element, index, anchor } of labels) {
      projected.copy(anchor || at(index)).project(camera)
      const onScreen = projected.z < 1 && Math.abs(projected.x) < 1.05 && Math.abs(projected.y) < 1.05
      element.style.display = onScreen ? 'block' : 'none'
      if (!onScreen) continue
      const depth = camera.position.distanceTo(anchor || at(index))
      element.style.opacity = String(Math.max(0.25, Math.min(1, (radius * 3.2) / depth - 0.6)))
      element.style.transform = `translate(-50%, -100%) translate(${(projected.x * 0.5 + 0.5) * width}px, ${(-projected.y * 0.5 + 0.5) * height - 10}px)`
    }
  }

  // ── Camera flights ─────────────────────────────────────────────────────
  let flight = null
  function flyTo(index) {
    const target = at(index)
    const away = camera.position.clone().sub(controls.target).normalize()
    const distance = Math.max(6, scales[index] * 14 + radius * 0.18)
    flight = {
      start: performance.now(), duration: 950,
      fromPos: camera.position.clone(), toPos: target.clone().add(away.multiplyScalar(distance)),
      fromTarget: controls.target.clone(), toTarget: target
    }
    controls.autoRotate = false
  }
  function resetCamera() {
    flight = {
      start: performance.now(), duration: 950,
      fromPos: camera.position.clone(), toPos: home.clone(),
      fromTarget: controls.target.clone(), toTarget: new THREE.Vector3()
    }
  }
  function stepFlight(now) {
    if (!flight) return
    const t = Math.min(1, (now - flight.start) / flight.duration)
    const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    camera.position.lerpVectors(flight.fromPos, flight.toPos, ease)
    controls.target.lerpVectors(flight.fromTarget, flight.toTarget, ease)
    if (t === 1) flight = null
  }

  // ── Picking ────────────────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  function pick(event) {
    const rect = renderer.domElement.getBoundingClientRect()
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObject(mesh, false)[0]
    return hit?.instanceId ?? -1
  }
  let pressed = null
  const onMove = (event) => {
    const index = pick(event)
    renderer.domElement.style.cursor = index >= 0 ? 'pointer' : 'grab'
    onHover?.(index, event)
  }
  const onDown = (event) => { pressed = { x: event.clientX, y: event.clientY } }
  const onUp = (event) => {
    // A drag that ends over a node is an orbit, not a click.
    if (!pressed || Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 5) return
    onSelect?.(pick(event))
  }
  const onLeave = () => onHover?.(-1)
  renderer.domElement.addEventListener('pointermove', onMove)
  renderer.domElement.addEventListener('pointerdown', onDown)
  renderer.domElement.addEventListener('pointerup', onUp)
  renderer.domElement.addEventListener('pointerleave', onLeave)

  const resize = () => {
    if (!mount.clientWidth || !mount.clientHeight) return
    camera.aspect = mount.clientWidth / mount.clientHeight
    camera.updateProjectionMatrix()
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    composer.setSize(mount.clientWidth, mount.clientHeight)
  }
  window.addEventListener('resize', resize)

  // ── Loop ───────────────────────────────────────────────────────────────
  let frame = 0
  renderer.setAnimationLoop((now) => {
    stepFlight(now)
    controls.update()
    starfield.rotation.y += 0.00006
    if (ring.visible) {
      ring.lookAt(camera.position)
      ring.material.opacity = 0.55 + Math.sin(now / 320) * 0.3
    }
    if (frame++ % 2 === 0) placeLabels()
    if (renderer.xr.isPresenting) renderer.render(scene, camera)
    else composer.render()
  })

  repaint()

  return {
    renderer,
    setVisible(mask) { visible = mask; if (focus !== null && !visible[focus]) { focus = null; focusSet = null } repaint() },
    setFocus(index) {
      focus = index === null || index < 0 ? null : index
      focusSet = focus === null ? null : neighborhood(model, focus)
      repaint()
    },
    setHeat(values) { heat = values; repaint() },
    flyTo,
    resetCamera,
    dispose() {
      renderer.setAnimationLoop(null)
      window.removeEventListener('resize', resize)
      renderer.domElement.removeEventListener('pointermove', onMove)
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      renderer.domElement.removeEventListener('pointerleave', onLeave)
      labels.forEach(({ element }) => element.remove())
      controls.dispose()
      scene.traverse((object) => {
        object.geometry?.dispose?.()
        if (Array.isArray(object.material)) object.material.forEach((m) => m.dispose?.())
        else object.material?.dispose?.()
      })
      composer.renderTarget1?.dispose?.()
      composer.renderTarget2?.dispose?.()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }
}
