/**
 * Holocron's time slider: the workspace's git history mapped onto the graph.
 *
 * indexTimeline() turns GET /api/git/timeline into per-node change times;
 * stateAt() says, for any moment, how active each node was around then and
 * whether its file existed yet. Pure, so every rule is tested.
 *
 * Paths match exactly: the timeline is fetched with `git log --relative`, so
 * it reports paths from the workspace, as the graph does. Every symbol in a
 * file shares that file's history.
 */
const DAY = 24 * 60 * 60 * 1000
export const ACTIVITY_WINDOW_MS = 14 * DAY
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const clean = (p) => String(p || '').replace(/^\.\//, '')

/**
 * @param {object} model   From buildModel.
 * @param {Array<{date: string, files: Array<{path: string, status: string}>}>} commits  Oldest first.
 * @param {number} now     The slider's right end ("Now").
 */
export function indexTimeline(model, commits, now = Date.now()) {
  const nodesByFile = new Map()
  model.nodes.forEach((node) => {
    if (!node.file) return
    const file = clean(node.file)
    if (!nodesByFile.has(file)) nodesByFile.set(file, [])
    nodesByFile.get(file).push(node.index)
  })

  const events = model.nodes.map(() => [])
  const added = new Float64Array(model.nodes.length).fill(NaN)
  const times = []
  for (const commit of Array.isArray(commits) ? commits : []) {
    const t = Date.parse(commit.date)
    if (!Number.isFinite(t)) continue
    times.push(t)
    for (const file of commit.files || []) {
      for (const index of nodesByFile.get(clean(file.path)) || []) {
        events[index].push(t)
        if (file.status === 'A' && !(added[index] <= t)) added[index] = t
      }
    }
  }
  events.forEach((list) => list.sort((a, b) => a - b))

  const start = times.length ? Math.min(...times) : now - 30 * DAY
  const end = Math.max(now, start + DAY)

  // Commits per bucket, for the density strip under the slider.
  const buckets = new Array(120).fill(0)
  for (const t of times) buckets[Math.min(buckets.length - 1, Math.floor(((t - start) / (end - start)) * buckets.length))]++

  const months = []
  const tick = new Date(start)
  tick.setUTCDate(1)
  tick.setUTCHours(0, 0, 0, 0)
  tick.setUTCMonth(tick.getUTCMonth() + 1)
  while (tick.getTime() <= end) {
    months.push({ t: tick.getTime(), label: `${MONTHS[tick.getUTCMonth()]} '${String(tick.getUTCFullYear()).slice(2)}` })
    tick.setUTCMonth(tick.getUTCMonth() + 1)
  }

  return { start, end, events, added, buckets, months, commitCount: times.length, matched: events.filter((e) => e.length).length }
}

/**
 * The graph at moment `t`.
 *   heat:   0..1, how much each node changed in the window before t, recent
 *           changes counting most.
 *   exists: 0 for nodes whose file was added after t.
 */
export function stateAt(timeline, t, windowMs = ACTIVITY_WINDOW_MS) {
  const count = timeline.events.length
  const heat = new Float32Array(count)
  const exists = new Uint8Array(count)
  let active = 0
  for (let i = 0; i < count; i++) {
    exists[i] = timeline.added[i] > t ? 0 : 1
    let sum = 0
    const list = timeline.events[i]
    for (let k = list.length - 1; k >= 0; k--) {
      const age = t - list[k]
      if (age < 0) continue
      if (age > windowMs) break
      sum += 1 - age / windowMs
    }
    heat[i] = Math.min(1, sum / 2)
    if (heat[i] > 0) active++
  }
  return { heat, exists, active }
}

export function formatDate(t) {
  const d = new Date(t)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}
