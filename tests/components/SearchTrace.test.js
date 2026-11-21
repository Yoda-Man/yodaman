/**
 * The Search Trace legend must show every term GraphRanker weighs.
 *
 * It listed semantic, proximity and centrality and left out specCoverage × 0.15,
 * so the formula on screen did not add up to the score beside it.
 */
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { DEFAULT_WEIGHTS: RANKER_WEIGHTS } = require('../../backend/infrastructure/GraphRanker');

beforeAll(() => require('../helpers/browserStub').installBrowserStub());

const trace = () => require('../../src/components/SearchTrace');

test('the UI fallback weights are the ranker weights', () => {
    expect(trace().DEFAULT_WEIGHTS).toEqual(RANKER_WEIGHTS);
});

test('the legend names every weighted term with its weight', () => {
    const { FormulaLegend } = trace();
    const html = renderToStaticMarkup(React.createElement(FormulaLegend, { weights: RANKER_WEIGHTS, graphRanked: true }));

    expect(Object.keys(RANKER_WEIGHTS).length).toBeGreaterThanOrEqual(4);
    for (const [term, weight] of Object.entries(RANKER_WEIGHTS)) {
        expect(html).toContain(`${term} × ${weight}`);
    }
});
