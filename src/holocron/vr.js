/**
 * Holocron in a headset: the parts that are plain decisions, kept pure so they
 * are tested without one.
 *
 * Desktop units are arbitrary (a layout can be 60 units across); in WebXR one
 * unit is a metre. vrFit() shrinks the constellation to a few metres and puts
 * it in front of the user at chest height. panelContent() decides what the
 * floating detail panel says; drawPanel() paints it onto a canvas.
 */
export const VR_RADIUS_M = 1.6
export const VR_DISTANCE_M = 2.4
export const VR_HEIGHT_M = 1.35
// Where "fly to" brings a node: within reach, not across the room.
export const VR_FOCUS_DISTANCE_M = 1.2

export function vrFit(layoutRadius) {
  return {
    scale: VR_RADIUS_M / Math.max(layoutRadius, 1),
    position: [0, VR_HEIGHT_M, -VR_DISTANCE_M]
  }
}

/** Clamp a thumbstick-driven scale so the constellation stays usable. */
export function nextScale(scale, base, stick, dt) {
  const next = scale * (1 + -stick * dt * 0.9)
  return Math.min(base * 4, Math.max(base * 0.25, next))
}

/** What the floating panel shows for a node. */
export function panelContent(model, index, { changes } = {}) {
  const node = model.nodes[index]
  const cluster = model.clusters[node.cluster]
  const names = (list) => list.slice(0, 5).map((i) => model.nodes[i].label)
  return {
    title: node.label,
    subtitle: node.file ? `${node.file}${node.line ? `:${node.line}` : ''}` : node.kind,
    color: cluster.color,
    stats: [
      ['Links', node.degree],
      ['Uses', model.outgoing[index].length],
      ['Used by', model.incoming[index].length],
      // Only when the caller knows; a 0 that means "not loaded" would mislead.
      ...(changes === undefined ? [] : [['Changes', changes?.count ?? 0]])
    ],
    tags: [node.language, node.kind, cluster.name],
    uses: names(model.outgoing[index]),
    usedBy: names(model.incoming[index])
  }
}

function fit(ctx, text, width) {
  let value = String(text)
  if (ctx.measureText(value).width <= width) return value
  while (value.length > 1 && ctx.measureText(`${value}…`).width > width) value = value.slice(0, -1)
  return `${value}…`
}

/** Paint panelContent() onto a 1024 x 640 canvas context. */
export function drawPanel(ctx, content, width = 1024, height = 640) {
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = 'rgba(2, 6, 23, 0.9)'
  ctx.strokeStyle = content.color
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.roundRect ? ctx.roundRect(4, 4, width - 8, height - 8, 28) : ctx.rect(4, 4, width - 8, height - 8)
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = content.color
  ctx.beginPath()
  ctx.arc(56, 66, 14, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = '700 46px Inter, system-ui, sans-serif'
  ctx.fillText(fit(ctx, content.title, width - 120), 86, 82)
  ctx.fillStyle = '#94a3b8'
  ctx.font = '400 26px Inter, system-ui, sans-serif'
  ctx.fillText(fit(ctx, content.subtitle, width - 90), 48, 128)

  content.stats.forEach(([label, value], i) => {
    const x = 48 + i * 236
    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    ctx.fillRect(x, 156, 220, 96)
    ctx.fillStyle = '#ffffff'
    ctx.font = '800 40px Inter, system-ui, sans-serif'
    ctx.fillText(String(value), x + 18, 208)
    ctx.fillStyle = '#64748b'
    ctx.font = '600 20px Inter, system-ui, sans-serif'
    ctx.fillText(label.toUpperCase(), x + 18, 238)
  })

  ctx.font = '500 22px Inter, system-ui, sans-serif'
  ctx.fillStyle = '#67e8f9'
  ctx.fillText(fit(ctx, content.tags.filter(Boolean).join('  ·  '), width - 96), 48, 296)

  const column = (title, items, x) => {
    ctx.fillStyle = '#94a3b8'
    ctx.font = '700 20px Inter, system-ui, sans-serif'
    ctx.fillText(title.toUpperCase(), x, 348)
    ctx.fillStyle = '#e2e8f0'
    ctx.font = '400 26px Inter, system-ui, sans-serif'
    items.forEach((item, i) => ctx.fillText(fit(ctx, item, 420), x, 392 + i * 44))
    if (!items.length) { ctx.fillStyle = '#475569'; ctx.fillText('none', x, 392) }
  }
  column('Uses', content.uses, 48)
  column('Used by', content.usedBy, 536)
}
