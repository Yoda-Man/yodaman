/**
 * What Holocron shows before its scene loads: the chrome a user navigates by.
 *
 * This file used to assert source text from the previous viewer, including a
 * hardcoded "v0.5.1" that tests/plugins/BundledHolocron.test.js forbids, so
 * the two tests contradicted each other. It now renders the component
 * (server-side; effects, and therefore the WebGL scene, do not run) and checks
 * what is on screen. The scene and data rules are tested in
 * tests/frontend/HolocronLayout.test.js and HolocronGraphModel.test.js.
 */
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

beforeAll(() => {
  require('../helpers/browserStub').installBrowserStub()
})

function render() {
  const HolocronVrModal = require('../../src/components/HolocronVrModal').default
  return renderToStaticMarkup(React.createElement(HolocronVrModal, {
    project: { name: 'coruscant', path: '/tmp/coruscant' },
    diagnostics: {},
    onClose: () => {}
  }))
}

describe('Holocron before its scene loads', () => {
  test('names the workspace and the bundled version', () => {
    const html = render()
    const { version } = require('../../plugins/plugin.json')
    expect(html).toContain('coruscant')
    expect(html).toContain(`v${version}`)
  })

  test('says it is mapping, rather than showing an empty void', () => {
    expect(render()).toContain('Mapping workspace constellation')
  })

  test('offers search, filters, the heatmap, the node limit, VR and close', () => {
    const html = render()
    for (const label of ['Search the constellation', 'Filters', 'Change heatmap', 'Maximum nodes', 'Close Holocron']) {
      expect(html).toContain(`aria-label="${label}"`)
    }
    expect(html).toMatch(/1,500 nodes/)
    expect(html).toMatch(/4,000 nodes/)
  })

  test('explains the controls', () => {
    const html = render()
    for (const hint of ['orbit', 'pan', 'zoom', 'inspect', 'search', 'reset camera']) expect(html).toContain(hint)
  })
})
