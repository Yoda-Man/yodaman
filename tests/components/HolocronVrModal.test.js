const fs = require('fs')
const path = require('path')

describe('HolocronVrModal visual contract', () => {
  const componentPath = path.resolve(__dirname, '../../src/components/HolocronVrModal.jsx')

  test('renders a vivid clustered constellation with useful node context', () => {
    const text = fs.readFileSync(componentPath, 'utf8')

    expect(text).toContain('COMMUNITY_COLORS')
    expect(text).toContain('new THREE.MeshBasicMaterial({ vertexColors: true })')
    expect(text).toContain('Architecture clusters')
    expect(text).toContain('nodeDescription')
    expect(text).toContain('sourceLocation')
    expect(text).toContain('click a node to inspect')
    expect(text).toContain('v0.5.1')
    expect(text).not.toContain('setHSL(((Number(node.community)')
  })
})
