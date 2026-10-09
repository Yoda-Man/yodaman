/**
 * The Holocron constellation: three.js scene, camera, post-processing and
 * interaction, behind a small imperative API the React modal drives.
 *
 *   createConstellation({ mount, labelsLayer, model, positions, onHover, onSelect })
 *     -> { renderer, setState, setFocus, setPath, flyTo, resetCamera, dispose }
 *
 * Look: shaded spheres sized by how connected a node is, an additive glow
 * halo per node (larger and brighter for hubs) fed through a bloom pass, edges
 * in their cluster's colour, a deep starfield, and named clusters. Selecting a
 * node lights its neighbourhood and dims everything else.
 *
 * Bloom runs on the desktop only. In a headset the scene renders directly:
 * EffectComposer does not render stereo, and frame rate matters more there.
 *
 * In a headset the constellation is shrunk to a few metres in front of the
 * user (holocron/vr.js decides how). Either controller's ray points at a
 * node, the trigger selects it, the grip turns the constellation, and the
 * right thumbstick scales it. The selected node's details float beside the
 * user on a panel, and labels become sprites, since the page's DOM is not in
 * the headset. Controllers are drawn as plain rays, so no model files are
 * fetched from anywhere.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { neighborhood, isReadableLabel } from './graphModel'
import { vrFit, nextScale, panelContent, drawPanel, VR_RADIUS_M, VR_FOCUS_DISTANCE_M } from './vr'

const BACKGROUND = 0x02030a
const DIM = 0.1
const HEAT_COLD = new THREE.Color('#1e3a8a')
const HEAT_WARM = new THREE.Color('#f59e0b')
const HEAT_HOT = new THREE.Color('#ef4444')
const PATH_COLOR = 0xa5f3fc
const PATH_MS = 6000
const RAY_LENGTH_M = 5

const GLOW_VERTEX = `
  attribute float size;
  attribute vec3 tint;
  attribute float alpha;
  uniform float scale;
  varying vec3 vTint;
  varying float vAlpha;
  void main() {
    vTint = tint;
    vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * scale * (320.0 / -mv.z);
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

function sameMask(a, b) {
  if (a === b) return true
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function textSprite(text, colour, height) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const font = '600 44px Inter, system-ui, sans-serif'
  ctx.font = font
  canvas.width = Math.ceil(ctx.measureText(text).width) + 24
  canvas.height = 64
  ctx.font = font
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)'
  ctx.shadowBlur = 8
  ctx.fillStyle = colour
  ctx.fillText(text, 12, 34)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false, fog: false }))
  sprite.scale.set((height * canvas.width) / canvas.height, height, 1)
  return sprite
}

function disposeObject(object) {
  object.geometry?.dispose?.()
  for (const material of [].concat(object.material || [])) {
    material.map?.dispose?.()
    material.dispose?.()
  }
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
  // three r128 culls an instanced mesh by its base sphere at the origin, so
  // every node would vanish whenever the origin left the view.
  mesh.frustumCulled = false
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
    uniforms: { scale: { value: 1 } },
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

  // Everything that belongs to the constellation moves together: on the
  // desktop this group never moves; in a headset it is scaled and placed.
  const world = new THREE.Group()
  const vrLabels = new THREE.Group()
  world.add(edges, mesh, glow, ring, vrLabels)
  scene.add(starfield, world)

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
  let path = null

  function nodeColor(i, target) {
    if (heat) heatColor(heat[i], target)
    else target.copy(baseColor(i))
    if (focusSet && !focusSet.has(i) && !path?.members.has(i)) target.multiplyScalar(DIM)
    return target
  }

  function repaint(labelsChanged = true) {
    for (let i = 0; i < count; i++) {
      const s = visible[i] ? scales[i] * (i === focus ? 1.35 : 1) : 0
      const p = at(i)
      matrix.makeScale(s, s, s)
      matrix.setPosition(p)
      mesh.setMatrixAt(i, matrix)
      nodeColor(i, color)
      mesh.setColorAt(i, color)

      const lit = !focusSet || focusSet.has(i) || path?.members.has(i)
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

    if (focus !== null && visible[focus]) {
      ring.position.copy(at(focus))
      ring.scale.setScalar(scales[focus] * 1.35)
      ring.material.color.copy(heat ? heatColor(heat[focus], new THREE.Color()) : baseColor(focus))
      ring.visible = true
    } else {
      ring.visible = false
    }
    if (labelsChanged) rebuildLabels()
    showPanel()
  }

  // ── Labels: DOM on the desktop, sprites in a headset ──────────────────
  // Which labels to show is one decision; how to draw them depends on where
  // the user is looking from.
  function labelSpecs() {
    const specs = []
    if (focusSet) {
      const lit = new Set([...(path?.indices || []), ...focusSet])
      ;[...lit].filter((i) => visible[i]).sort((a, b) => (b === focus) - (a === focus) || model.nodes[b].degree - model.nodes[a].degree).slice(0, 24).forEach((i) => {
        specs.push({ text: model.nodes[i].label, kind: i === focus ? 'focus' : 'node', index: i })
      })
      return specs
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
      specs.push({ text: cluster.name, kind: 'cluster', anchor: centre.setY(top + 1.2), colour: cluster.color })
      named.add(cluster.hub)
    })
    model.nodes
      .filter((n) => visible[n.index] && !named.has(n.index) && isReadableLabel(n.label))
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 14)
      .forEach((n) => specs.push({ text: n.label, kind: 'node', index: n.index }))
    return specs
  }

  const LABEL_CLASS = { focus: 'holo-label holo-label-focus', node: 'holo-label', cluster: 'holo-cluster' }
  const SPRITE_HEIGHT_M = { focus: 0.07, node: 0.045, cluster: 0.075 }
  let labels = []
  function rebuildLabels() {
    labels.forEach(({ element }) => element.remove())
    labels = []
    vrLabels.children.slice().forEach((sprite) => { vrLabels.remove(sprite); disposeObject(sprite) })
    const presenting = renderer.xr.isPresenting
    for (const spec of labelSpecs()) {
      if (presenting) {
        const sprite = textSprite(spec.text, spec.kind === 'cluster' ? spec.colour : spec.kind === 'focus' ? '#ffffff' : '#cbd5e1', SPRITE_HEIGHT_M[spec.kind] / world.scale.x)
        sprite.position.copy(spec.anchor || at(spec.index).setY(positions[spec.index * 3 + 1] + scales[spec.index] * 1.8))
        vrLabels.add(sprite)
        continue
      }
      const element = document.createElement('div')
      element.className = LABEL_CLASS[spec.kind]
      element.textContent = spec.text
      labelsLayer.appendChild(element)
      labels.push({ element, index: spec.index, anchor: spec.anchor })
    }
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

  // ── Path: the chain of links between two nodes, glowing, then fading ──
  function setPath(indices) {
    if (path) {
      world.remove(path.mesh)
      disposeObject(path.mesh)
      path = null
    }
    if (!indices || indices.length < 2) return repaint()
    const curve = new THREE.CatmullRomCurve3(indices.map(at), false, 'centripetal')
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(curve, Math.min(400, indices.length * 24), 0.07, 6, false),
      new THREE.MeshBasicMaterial({ color: PATH_COLOR, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
    )
    world.add(mesh)
    path = { mesh, indices, members: new Set(indices), start: performance.now() }
    repaint()
  }
  function stepPath(now) {
    if (!path) return
    const age = now - path.start
    if (age > PATH_MS) setPath(null)
    else path.mesh.material.opacity = Math.min(1, age / 250) * Math.min(1, (PATH_MS - age) / 1500)
  }

  // ── Flights: the camera on the desktop, the constellation in a headset ─
  let flight = null
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2 }
  function flyTo(index) {
    if (renderer.xr.isPresenting) {
      // The user cannot be moved, so the node comes to them.
      const offset = at(index).multiplyScalar(world.scale.x).applyEuler(world.rotation)
      const to = new THREE.Vector3(0, vrFit(radius).position[1], -VR_FOCUS_DISTANCE_M).sub(offset)
      flight = { start: performance.now(), duration: 950, world: { from: world.position.clone(), to } }
      return
    }
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
    if (renderer.xr.isPresenting) {
      const fit = vrFit(radius)
      world.rotation.set(0, 0, 0)
      setWorldScale(fit.scale)
      flight = { start: performance.now(), duration: 950, world: { from: world.position.clone(), to: new THREE.Vector3().fromArray(fit.position) } }
      return
    }
    flight = {
      start: performance.now(), duration: 950,
      fromPos: camera.position.clone(), toPos: home.clone(),
      fromTarget: controls.target.clone(), toTarget: new THREE.Vector3()
    }
  }
  function stepFlight(now) {
    if (!flight) return
    const t = Math.min(1, (now - flight.start) / flight.duration)
    if (flight.world) {
      world.position.lerpVectors(flight.world.from, flight.world.to, ease(t))
    } else {
      camera.position.lerpVectors(flight.fromPos, flight.toPos, ease(t))
      controls.target.lerpVectors(flight.fromTarget, flight.toTarget, ease(t))
    }
    if (t === 1) flight = null
  }

  // ── Picking ────────────────────────────────────────────────────────────
  // A ray against each visible node's sphere, worked out directly: the
  // generic instanced-mesh raycast tests every triangle of every sphere,
  // too slow to run for two controllers on every headset frame.
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const toLocal = new THREE.Matrix4()
  const localRay = new THREE.Ray()
  function pickRay(ray, reach) {
    world.updateMatrixWorld()
    localRay.copy(ray).applyMatrix4(toLocal.copy(world.matrixWorld).invert())
    const { origin, direction } = localRay
    let index = -1
    let distance = Infinity
    for (let i = 0; i < count; i++) {
      if (!visible[i]) continue
      const x = positions[i * 3] - origin.x
      const y = positions[i * 3 + 1] - origin.y
      const z = positions[i * 3 + 2] - origin.z
      const along = x * direction.x + y * direction.y + z * direction.z
      if (along <= 0 || along >= distance) continue
      const r = scales[i] * reach
      if (x * x + y * y + z * z - along * along <= r * r) { index = i; distance = along }
    }
    return { index, distance }
  }
  function pick(event) {
    const rect = renderer.domElement.getBoundingClientRect()
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
    return pickRay(raycaster.ray, 1.15).index
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

  // ── Headset ────────────────────────────────────────────────────────────
  const xr = renderer.xr
  const desktopFog = scene.fog.density
  let vrBase = 1
  function setWorldScale(value) {
    world.scale.setScalar(value)
    glow.material.uniforms.scale.value = value
  }

  const panelCanvas = document.createElement('canvas')
  panelCanvas.width = 1024
  panelCanvas.height = 640
  const panelTexture = new THREE.CanvasTexture(panelCanvas)
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshBasicMaterial({ map: panelTexture, transparent: true, depthWrite: false, fog: false }))
  panel.visible = false
  scene.add(panel)
  const head = new THREE.Vector3()
  const facing = new THREE.Vector3()
  let panelFor = null
  let headsetFrames = 0
  // Drawn and placed when the selection changes, not on every repaint: the
  // history slider repaints often, and the panel must not chase the user's
  // gaze. The camera holds the head pose only once a headset frame has
  // rendered, so until then the panel waits.
  function showPanel() {
    const wanted = xr.isPresenting && focus !== null && headsetFrames > 1 ? focus : null
    if (wanted === panelFor) return
    panelFor = wanted
    panel.visible = wanted !== null
    if (wanted === null) return
    drawPanel(panelCanvas.getContext('2d'), panelContent(model, wanted))
    panelTexture.needsUpdate = true
    // Beside the user's line of sight, a little low and to the left, facing them.
    camera.getWorldPosition(head)
    camera.getWorldDirection(facing)
    facing.setY(0).normalize()
    panel.position.copy(head).addScaledVector(facing, 1).add(new THREE.Vector3(facing.z * 0.55, -0.25, -facing.x * 0.55))
    panel.lookAt(head)
  }

  let hoverSprite = null
  function setVrHover(index) {
    if (hoverSprite?.userData.index === index) return
    if (hoverSprite) { world.remove(hoverSprite); disposeObject(hoverSprite); hoverSprite = null }
    if (index < 0) return
    hoverSprite = textSprite(model.nodes[index].label, '#ffffff', 0.055 / world.scale.x)
    hoverSprite.userData.index = index
    hoverSprite.position.copy(at(index)).setY(positions[index * 3 + 1] + scales[index] * 1.8)
    world.add(hoverSprite)
  }

  const rayGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)])
  const rayMatrix = new THREE.Matrix4()
  function controllerRay(controller) {
    rayMatrix.identity().extractRotation(controller.matrixWorld)
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld)
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(rayMatrix)
    return raycaster.ray
  }
  let grab = null
  const hands = [0, 1].map((slot) => {
    const controller = xr.getController(slot)
    const beam = new THREE.Line(rayGeometry, new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.65, fog: false }))
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }))
    controller.add(beam, tip)
    scene.add(controller)
    const hand = { controller, beam, tip }
    hand.listeners = {
      selectstart: () => onSelect?.(pickRay(controllerRay(controller), 1.6).index),
      squeezestart: () => {
        grab = { controller, from: new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld), rotation: world.rotation.clone() }
      },
      squeezeend: () => { if (grab?.controller === controller) grab = null }
    }
    Object.entries(hand.listeners).forEach(([type, listener]) => controller.addEventListener(type, listener))
    return hand
  })

  const grabbed = new THREE.Vector3()
  let lastFrame = 0
  function stepHeadset(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000)
    lastFrame = now
    headsetFrames++
    showPanel()
    let hovered = -1
    for (const hand of hands) {
      if (!hand.controller.visible) continue
      const { index, distance } = pickRay(controllerRay(hand.controller), 1.6)
      const length = index >= 0 ? distance * world.scale.x : RAY_LENGTH_M
      hand.beam.scale.z = length
      hand.tip.position.z = -length
      if (hovered < 0) hovered = index
    }
    setVrHover(hovered)

    // Grip and move the hand: sideways turns the constellation, up and down tilts it.
    if (grab) {
      grabbed.setFromMatrixPosition(grab.controller.matrixWorld)
      world.rotation.y = grab.rotation.y + (grabbed.x - grab.from.x) * 3
      world.rotation.x = Math.max(-1.2, Math.min(1.2, grab.rotation.x - (grabbed.y - grab.from.y) * 3))
    }
    for (const source of xr.getSession()?.inputSources || []) {
      const axes = source.gamepad?.axes
      if (source.handedness !== 'right' || !axes?.length) continue
      const stick = axes.length >= 4 ? axes[3] : axes[1]
      if (Math.abs(stick) > 0.15) setWorldScale(nextScale(world.scale.x, vrBase, stick, dt))
    }
  }

  const onSessionStart = () => {
    const fit = vrFit(radius)
    vrBase = fit.scale
    setWorldScale(fit.scale)
    world.position.fromArray(fit.position)
    world.rotation.set(0, 0, 0)
    scene.fog.density = 0.25 / VR_RADIUS_M
    controls.enabled = false
    flight = null
    headsetFrames = 0
    rebuildLabels()
  }
  const onSessionEnd = () => {
    setWorldScale(1)
    world.position.set(0, 0, 0)
    world.rotation.set(0, 0, 0)
    scene.fog.density = desktopFog
    controls.enabled = true
    grab = null
    headsetFrames = 0
    setVrHover(-1)
    rebuildLabels()
    showPanel()
    resetCamera()
  }
  xr.addEventListener('sessionstart', onSessionStart)
  xr.addEventListener('sessionend', onSessionEnd)

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
    stepPath(now)
    starfield.rotation.y += 0.00006
    if (ring.visible) {
      ring.lookAt(camera.position)
      ring.material.opacity = 0.55 + Math.sin(now / 320) * 0.3
    }
    if (xr.isPresenting) {
      stepHeadset(now)
      renderer.render(scene, camera)
      return
    }
    controls.update()
    if (frame++ % 2 === 0) placeLabels()
    composer.render()
  })

  repaint()

  return {
    renderer,
    /**
     * One repaint for any mix of { visible, heat }. Labels are rebuilt only
     * when what is visible changed: the time slider repaints heat many times
     * a second, and recreating labels each time would flicker.
     */
    setState(patch) {
      let labelsChanged = false
      // A hidden selection stays selected (the modal still shows it) and
      // reappears with its node, for instance when history reaches its file.
      if (patch.visible && !sameMask(patch.visible, visible)) {
        visible = patch.visible
        labelsChanged = true
      }
      if (patch.heat !== undefined) heat = patch.heat
      repaint(labelsChanged)
    },
    setFocus(index) {
      focus = index === null || index < 0 ? null : index
      focusSet = focus === null ? null : neighborhood(model, focus)
      repaint()
    },
    setPath,
    flyTo,
    resetCamera,
    dispose() {
      renderer.setAnimationLoop(null)
      window.removeEventListener('resize', resize)
      renderer.domElement.removeEventListener('pointermove', onMove)
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      renderer.domElement.removeEventListener('pointerleave', onLeave)
      xr.removeEventListener('sessionstart', onSessionStart)
      xr.removeEventListener('sessionend', onSessionEnd)
      hands.forEach(({ controller, listeners }) => Object.entries(listeners).forEach(([type, listener]) => controller.removeEventListener(type, listener)))
      labels.forEach(({ element }) => element.remove())
      controls.dispose()
      scene.traverse(disposeObject)
      composer.renderTarget1?.dispose?.()
      composer.renderTarget2?.dispose?.()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }
}
