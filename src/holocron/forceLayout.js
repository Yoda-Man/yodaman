/**
 * Where each node of the constellation sits.
 *
 * Holocron's WASM engine lays the graph out by force: connected files pull
 * together, everything repels, and each architecture cluster stays in its own
 * sphere. Measured on real workspaces, connected files end up about 3.5 times
 * closer than random pairs (5,000 nodes in 2.3 s, 500 in under 0.2 s).
 *
 * Before 0.5.8 the viewer only placed nodes on a spiral per cluster, ignoring
 * the relationships entirely, and the engine was never called. The spiral is
 * kept, for two jobs:
 *   - the engine's starting positions, so a workspace looks the same every
 *     time it is opened rather than depending on a random seed;
 *   - the fallback, whenever the engine cannot run, fails, times out or
 *     returns positions that are not usable.
 */
import { NODE_STRIDE, EDGE_STRIDE } from './engineRunner.mjs'

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
export const LAYOUT_TIMEOUT_MS = 15000

/**
 * The sphere the engine spreads clusters over, grown with the cluster count.
 *
 * The engine's default (20) is fixed, and nodes repel only inside their own
 * cluster, so different clusters overlapped into one ball. Measured as the
 * gap between neighbouring clusters over a cluster's own spread: 1.8 for a
 * 56-cluster workspace and 0.97 (overlapping) for a 335-cluster one. This
 * gives about 3.5 to 5: distinct clusters with space between them.
 */
export function sceneRadiusFor(clusterCount) {
  return 3.5 * Math.sqrt(Math.max(clusterCount, 1)) + 8
}

/**
 * Clusters on a golden-angle spiral, members on a smaller spiral around each
 * centre. Deterministic.
 * @param {number} nodeCount
 * @param {Array<[string, number[]]>} groups  Cluster key and member indices, largest first.
 * @returns {Float32Array} nodeCount × (x, y, z)
 */
export function spiralLayout(nodeCount, groups) {
  const positions = new Float32Array(nodeCount * 3)
  groups.forEach(([_key, members], groupIndex) => {
    const groupAngle = groupIndex * GOLDEN_ANGLE
    const groupRadius = groupIndex === 0 ? 0 : 5.2 + Math.sqrt(groupIndex) * 3.1
    const cx = Math.cos(groupAngle) * groupRadius
    const cy = Math.sin(groupAngle * 1.7) * Math.min(7, groupRadius * 0.42)
    const cz = Math.sin(groupAngle) * groupRadius * 0.62
    members.forEach((node, memberIndex) => {
      const localAngle = memberIndex * GOLDEN_ANGLE
      const localRadius = 0.7 + Math.sqrt(memberIndex) * 0.66
      positions[node * 3] = cx + Math.cos(localAngle) * localRadius
      positions[node * 3 + 1] = cy + Math.sin(localAngle * 1.31) * localRadius * 0.7
      positions[node * 3 + 2] = cz + Math.sin(localAngle) * localRadius * 0.58
    })
  })
  return positions
}

/**
 * The engine's input buffers. Clusters are numbered by group order, so ids are
 * dense (Graphify's community ids run into the thousands), and links whose
 * ends are not both in view, or that point at themselves, are dropped.
 */
export function engineInput({ nodeCount, links, nodeIndex, groups, seed }) {
  const cluster = new Float32Array(nodeCount)
  groups.forEach(([_key, members], groupIndex) => members.forEach((node) => { cluster[node] = groupIndex }))

  const nodes = new Float32Array(nodeCount * NODE_STRIDE)
  for (let i = 0; i < nodeCount; i++) {
    nodes.set([seed[i * 3], seed[i * 3 + 1], seed[i * 3 + 2], 1, cluster[i], 0, 0], i * NODE_STRIDE)
  }

  const pairs = []
  for (const link of links) {
    const source = nodeIndex.get(link.source)
    const target = nodeIndex.get(link.target)
    if (source !== undefined && target !== undefined && source !== target) pairs.push(source, target, 1)
  }
  return { nodes, edges: Int32Array.from(pairs), nodeCount, edgeCount: pairs.length / EDGE_STRIDE }
}

function extent(positions) {
  let cx = 0; let cy = 0; let cz = 0
  const count = positions.length / 3
  for (let i = 0; i < positions.length; i += 3) { cx += positions[i]; cy += positions[i + 1]; cz += positions[i + 2] }
  cx /= count || 1; cy /= count || 1; cz /= count || 1
  let radius = 0
  for (let i = 0; i < positions.length; i += 3) {
    radius = Math.max(radius, Math.hypot(positions[i] - cx, positions[i + 1] - cy, positions[i + 2] - cz))
  }
  return { cx, cy, cz, radius }
}

/** Every coordinate finite, and the nodes actually spread out. */
export function isUsableLayout(positions, nodeCount) {
  if (!positions || positions.length !== nodeCount * 3) return false
  for (const value of positions) if (!Number.isFinite(value)) return false
  return nodeCount < 2 || extent(positions).radius > 1e-3
}

/** Centre on the origin and scale to `radius`, so the camera frames any layout the same way. */
export function fitToRadius(positions, radius) {
  const { cx, cy, cz, radius: current } = extent(positions)
  const scale = current > 0 ? radius / current : 1
  const fitted = new Float32Array(positions.length)
  for (let i = 0; i < positions.length; i += 3) {
    fitted[i] = (positions[i] - cx) * scale
    fitted[i + 1] = (positions[i + 1] - cy) * scale
    fitted[i + 2] = (positions[i + 2] - cz) * scale
  }
  return fitted
}

/**
 * Place whole clusters on a wide disc, keeping each cluster's internal shape.
 *
 * The engine lays out the inside of a cluster well (hub at the centre,
 * members around it) but stacks its biggest clusters together near one pole
 * of its sphere, so they overlapped on screen. This keeps the engine's shape
 * per cluster and decides only where each cluster sits:
 *
 *   - slots on a sunflower spiral, spaced by area so clusters never overlap;
 *   - the biggest cluster at the centre, then greedily the cluster with the
 *     most links to those already placed, so related clusters sit together;
 *   - a gentle wave in height, so the disc reads as 3D from any angle.
 *
 * Deterministic: the same graph always looks the same.
 *
 * @param {Float32Array} positions  Engine output, nodeCount x 3.
 * @param {Array<[string, number[]]>} groups  Largest first.
 * @param {Int32Array} edges  source, target, weight triples (engine input).
 * @returns {Float32Array}
 */
export function arrangeClusters(positions, groups, edges, { spacing = 1.5, spread = 2.2 } = {}) {
  const count = groups.length
  if (count < 2) return positions
  const clusterOf = new Int32Array(positions.length / 3)
  groups.forEach(([_k, members], c) => members.forEach((m) => { clusterOf[m] = c }))
  const degree = new Int32Array(positions.length / 3)
  for (let e = 0; e < edges.length; e += 3) { degree[edges[e]]++; degree[edges[e + 1]]++ }

  // Each cluster is anchored on its hub (most connected member), so spokes
  // radiate from the middle, and opened up by `spread`: the engine packs a
  // cluster tightly enough that its structure reads as a single blob.
  const centre = groups.map(([_k, members]) => {
    const hub = members.reduce((best, m) => (degree[m] > degree[best] ? m : best), members[0])
    return [positions[hub * 3], positions[hub * 3 + 1], positions[hub * 3 + 2]]
  })
  const radius = groups.map(([_k, members], c) => {
    const d = members.map((m) => Math.hypot(positions[m * 3] - centre[c][0], positions[m * 3 + 1] - centre[c][1], positions[m * 3 + 2] - centre[c][2])).sort((a, b) => a - b)
    return Math.max(1, d[Math.floor(d.length * 0.9)] || 0) * spread
  })

  // Links between clusters, for placing related clusters side by side.
  const weight = new Map()
  for (let e = 0; e < edges.length; e += 3) {
    const a = clusterOf[edges[e]]
    const b = clusterOf[edges[e + 1]]
    if (a === b) continue
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    weight.set(key, (weight.get(key) || 0) + 1)
  }
  const linked = (a, b) => weight.get(a < b ? `${a}:${b}` : `${b}:${a}`) || 0

  const order = [0]
  const placed = new Set([0])
  while (order.length < count) {
    let best = -1
    let bestScore = -1
    for (let c = 1; c < count; c++) {
      if (placed.has(c)) continue
      let score = 0
      for (const p of placed) score += linked(c, p)
      // Ties (often zero links) go to the bigger cluster: groups are largest first.
      if (score > bestScore) { bestScore = score; best = c }
    }
    order.push(best)
    placed.add(best)
  }

  const out = new Float32Array(positions.length)
  let area = 0
  order.forEach((c, slot) => {
    const footprint = radius[c] * spacing
    const r = slot === 0 ? 0 : Math.sqrt(area + footprint * footprint)
    area += (footprint * 2) * (footprint * 2)
    const angle = slot * GOLDEN_ANGLE
    const target = [Math.cos(angle) * r, Math.sin(angle * 1.7) * r * 0.12, Math.sin(angle) * r]
    for (const m of groups[c][1]) {
      for (let k = 0; k < 3; k++) out[m * 3 + k] = target[k] + (positions[m * 3 + k] - centre[c][k]) * spread
    }
  })
  return out
}

/** Ask the worker once; resolve with positions or reject with the reason. */
function requestLayout(worker, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`layout engine took longer than ${timeoutMs / 1000}s`)), timeoutMs)
    worker.onmessage = ({ data }) => {
      clearTimeout(timer)
      if (data?.ok) resolve(data.positions)
      else reject(new Error(data?.error || 'layout engine failed'))
    }
    worker.onerror = (event) => {
      clearTimeout(timer)
      reject(new Error(event?.message || 'layout worker could not start'))
    }
    worker.postMessage(input, [input.nodes.buffer, input.edges.buffer])
  })
}

function defaultWorker() {
  return new Worker(new URL('./layoutWorker.js', import.meta.url), { type: 'module' })
}

/**
 * Lay out the constellation, by force if the engine can, by spiral if not.
 * Never rejects: a viewer with a basic layout beats no viewer.
 *
 * @returns {Promise<{positions: Float32Array, engine: 'wasm'|'fallback', reason?: string, ms: number}>}
 */
export async function arrangeConstellation({ nodes, links, nodeIndex, groups, createWorker = defaultWorker, timeoutMs = LAYOUT_TIMEOUT_MS }) {
  const started = Date.now()
  const spiral = spiralLayout(nodes.length, groups)
  const radius = Math.max(8, extent(spiral).radius)
  const fallback = (reason) => ({ positions: spiral, engine: 'fallback', reason, ms: Date.now() - started })
  if (nodes.length < 2) return fallback('nothing to arrange')

  let worker
  try {
    worker = createWorker()
    const input = engineInput({ nodeCount: nodes.length, links, nodeIndex, groups, seed: spiral })
    input.config = { sceneRadius: sceneRadiusFor(groups.length) }
    // The buffers are transferred to the worker and empty afterwards; cluster
    // placement still needs the links.
    const edges = input.edges.slice()
    const positions = await requestLayout(worker, input, timeoutMs)
    if (!isUsableLayout(positions, nodes.length)) return fallback('layout engine returned unusable positions')
    const arranged = arrangeClusters(positions, groups, edges)
    return { positions: fitToRadius(arranged, radius), engine: 'wasm', ms: Date.now() - started }
  } catch (err) {
    return fallback(err?.message || String(err))
  } finally {
    worker?.terminate?.()
  }
}
