/**
 * Holocron's view of a workspace graph: everything the constellation and its
 * panels need, derived once from GET /api/graphify/map. Pure; no DOM, no
 * three.js, so every rule here is tested directly.
 */

/** Vivid, distinguishable on near-black, largest cluster first. */
export const CLUSTER_COLORS = [
  '#38bdf8', '#4ade80', '#f59e0b', '#a78bfa', '#f472b6',
  '#22d3ee', '#facc15', '#fb7185', '#2dd4bf', '#818cf8',
  '#fb923c', '#e879f9', '#a3e635', '#60a5fa'
]

const LANGUAGES = {
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript',
  ts: 'TypeScript', tsx: 'TypeScript', py: 'Python', go: 'Go', rs: 'Rust',
  java: 'Java', kt: 'Kotlin', swift: 'Swift', rb: 'Ruby', php: 'PHP',
  cs: 'C#', c: 'C', h: 'C', cpp: 'C++', hpp: 'C++', cc: 'C++', dart: 'Dart',
  md: 'Markdown', mdx: 'Markdown', rst: 'Docs', txt: 'Text', adoc: 'Docs',
  json: 'JSON', yml: 'YAML', yaml: 'YAML', toml: 'TOML', css: 'CSS', scss: 'CSS',
  html: 'HTML', sql: 'SQL', sh: 'Shell', vue: 'Vue', svelte: 'Svelte'
}

const DOC_EXTENSIONS = new Set(['md', 'mdx', 'rst', 'txt', 'adoc'])
const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.(py|go)$/i
// Minified bundles count too: they are someone else's code, and their
// one-letter symbols would otherwise form clusters named "g", "A" and "C".
const THIRD_PARTY_PATH = /(^|\/)(node_modules|vendor|third_party|thirdparty|site-packages|\.venv|venv|dist|build)\/|\.min\.(js|css)$/i

function extensionOf(value) {
  const match = /\.([a-z0-9]+)$/i.exec(String(value || ''))
  return match ? match[1].toLowerCase() : ''
}

/** "L12" or "12" or "12:4" -> 12; anything else -> null. */
function lineOf(location) {
  const match = /(\d+)/.exec(String(location || ''))
  const line = match ? Number(match[1]) : NaN
  return Number.isFinite(line) && line > 0 ? line : null
}

function kindOf(node, ext) {
  const label = String(node.label || '')
  if (/\)\s*$/.test(label)) return 'function'
  if (DOC_EXTENSIONS.has(ext) || node.fileType === 'document') return 'doc'
  if (extensionOf(label)) return 'file'
  return 'symbol'
}

/**
 * @param {{nodes: object[], links: object[], totalNodes?: number, totalLinks?: number}} map
 */
export function buildModel(map) {
  const raw = Array.isArray(map?.nodes) ? map.nodes : []
  const index = new Map(raw.map((node, i) => [node.id, i]))

  const outgoing = raw.map(() => [])
  const incoming = raw.map(() => [])
  // One edge per pair. Graphify can record the same link several times (a
  // call and an import, say); drawn additively, repeats stacked into lines
  // far brighter than anything else on screen.
  const pairs = []
  const seen = new Set()
  for (const link of map?.links || []) {
    const s = index.get(link.source)
    const t = index.get(link.target)
    if (s === undefined || t === undefined || s === t) continue
    const key = s < t ? `${s}:${t}` : `${t}:${s}`
    if (seen.has(key)) continue
    seen.add(key)
    outgoing[s].push(t)
    incoming[t].push(s)
    pairs.push(s, t)
  }

  // Clusters are Graphify's communities, numbered by size so colours are
  // stable and the biggest gets the first colour.
  const byCommunity = new Map()
  raw.forEach((node, i) => {
    const key = String(node.community ?? 'unclustered')
    if (!byCommunity.has(key)) byCommunity.set(key, [])
    byCommunity.get(key).push(i)
  })
  const degree = raw.map((_n, i) => outgoing[i].length + incoming[i].length)
  const clusters = [...byCommunity.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([key, members], i) => {
      const hub = members.reduce((best, m) => (degree[m] > degree[best] ? m : best), members[0])
      const hubLabel = String(raw[hub].label || raw[hub].id).replace(/\(\)\s*$/, '')
      return { index: i, key, members, hub, name: hubLabel, color: CLUSTER_COLORS[i % CLUSTER_COLORS.length] }
    })
  const clusterOf = new Int32Array(raw.length)
  clusters.forEach((cluster) => cluster.members.forEach((m) => { clusterOf[m] = cluster.index }))

  const nodes = raw.map((node, i) => {
    const file = String(node.sourceFile || '')
    const ext = extensionOf(file) || extensionOf(node.label)
    return {
      index: i,
      id: node.id,
      label: String(node.label || node.id),
      file,
      line: lineOf(node.sourceLocation),
      kind: kindOf(node, ext),
      language: LANGUAGES[ext] || (ext ? ext.toUpperCase() : 'Other'),
      cluster: clusterOf[i],
      degree: degree[i],
      isTest: TEST_PATH.test(file),
      isDoc: DOC_EXTENSIONS.has(ext) || node.fileType === 'document',
      isThirdParty: THIRD_PARTY_PATH.test(file)
    }
  })

  const languageCounts = new Map()
  nodes.forEach((n) => languageCounts.set(n.language, (languageCounts.get(n.language) || 0) + 1))

  return {
    nodes,
    outgoing,
    incoming,
    edges: Int32Array.from(pairs),
    clusters,
    totalNodes: Number(map?.totalNodes) || nodes.length,
    totalLinks: Number(map?.totalLinks) || pairs.length / 2,
    languages: [...languageCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([language, count]) => ({ language, count }))
  }
}

/** The node and everything it links to or from. */
export function neighborhood(model, index) {
  return new Set([index, ...model.outgoing[index], ...model.incoming[index]])
}

/**
 * Which nodes the filters leave on screen.
 * @param {{hideTests?: boolean, hideDocs?: boolean, hideThirdParty?: boolean,
 *          languages?: Set<string>|null, recentOnly?: boolean}} filters
 * @param {Float32Array|null} heat  0..1 per node, from heatValues.
 */
export function visibleNodes(model, filters = {}, heat = null) {
  const visible = new Uint8Array(model.nodes.length)
  model.nodes.forEach((node, i) => {
    if (filters.hideTests && node.isTest) return
    if (filters.hideDocs && node.isDoc) return
    if (filters.hideThirdParty && node.isThirdParty) return
    if (filters.languages && filters.languages.size && !filters.languages.has(node.language)) return
    if (filters.recentOnly && !(heat && heat[i] > 0)) return
    visible[i] = 1
  })
  return visible
}

/**
 * Files matching a query, best first: exact name, name prefix, name contains,
 * path contains; more connected wins a tie.
 */
export function searchNodes(model, query, limit = 8) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return []
  const scored = []
  for (const node of model.nodes) {
    const label = node.label.toLowerCase()
    const score = label === q ? 4 : label.startsWith(q) ? 3 : label.includes(q) ? 2 : node.file.toLowerCase().includes(q) ? 1 : 0
    if (score) scored.push({ node, score })
  }
  return scored
    .sort((a, b) => b.score - a.score || b.node.degree - a.node.degree)
    .slice(0, limit)
    .map(({ node }) => node)
}

/**
 * Recent change per node, 0..1, from GET /api/git/heatmap.
 *
 * Git reports paths from the repository root and Graphify from the workspace
 * root; they differ when the workspace is a subfolder, so a git path matches
 * a node when either ends with the other. Log-scaled, so one hot file does
 * not wash out the rest.
 */
export function heatValues(model, files) {
  const heat = new Float32Array(model.nodes.length)
  const changes = new Array(model.nodes.length).fill(null)
  if (!Array.isArray(files) || !files.length) return { heat, changes }
  const entries = files.filter((f) => f?.filePath).map((f) => ({ ...f, path: f.filePath.replace(/^\.\//, '') }))
  let max = 0
  model.nodes.forEach((node, i) => {
    if (!node.file) return
    const file = node.file.replace(/^\.\//, '')
    const hit = entries.find((e) => e.path === file || e.path.endsWith(`/${file}`) || file.endsWith(`/${e.path}`))
    if (!hit) return
    changes[i] = { count: hit.changeCount, last: hit.lastChangeDate }
    heat[i] = Math.log1p(hit.changeCount)
    max = Math.max(max, heat[i])
  })
  if (max > 0) for (let i = 0; i < heat.length; i++) heat[i] /= max
  return { heat, changes }
}

/** "3h ago", "2 days ago". */
export function timeAgo(date, now = Date.now()) {
  const ms = now - new Date(date).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${Math.max(minutes, 1)}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)} days ago`
}
