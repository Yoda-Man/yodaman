/**
 * The Settings dialog must be able to reach its own bottom.
 *
 * Expanding the MCP section made the footer — and the dismiss button —
 * unreachable. Three faults, and the first fix found only one:
 *
 *   1. `overflow-hidden` with no max-height: the dialog grew past the viewport
 *      and clipped, with nothing scrollable.
 *   2. The MCP panel sat in a SIBLING of the content area. The scroll region
 *      was 64px holding "Add Workspace" while an 869px sibling carried
 *      Developer Settings and pushed the footer to y=1062 in a 720px window.
 *   3. A nested `max-h-60` scroll area, so the wheel behaved differently
 *      depending on where the pointer sat.
 *
 * It was fixed by measuring in a browser by hand — and one of those passes
 * reported confident nonsense because the browser pane was collapsed, so
 * `window.innerHeight` was 0 and `88vh` computed to `0px`. A measurement that
 * returns a number while measuring nothing is the same failure as a test
 * comparing `undefined` to `undefined` and passing.
 *
 * So the invariants are asserted here instead, from a real render. These are
 * structural rather than pixel-based — server rendering has no layout — but
 * structure is exactly what broke, and structure is what a reviewer cannot
 * eyeball in a 400-line component.
 */
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

beforeAll(() => {
    require('../helpers/browserStub').installBrowserStub();
    // This dialog polls /api/mcp/clients on mount. SSR never runs effects, but
    // being explicit costs nothing and documents the dependency.
    global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ clients: [] }) });
});

/**
 * Inner HTML of the first element carrying `marker`, by depth-matching tags.
 *
 * A regex cannot do this: the dialog nests divs many levels deep, and a lazy
 * match would stop at the first `</div>` rather than the matching one.
 */
function innerHtmlOf(html, marker) {
    const at = html.indexOf(marker);
    if (at === -1) return null;

    const openEnd = html.indexOf('>', at);
    let depth = 1;
    let i = openEnd + 1;
    const start = i;

    while (i < html.length && depth > 0) {
        const nextOpen = html.indexOf('<div', i);
        const nextClose = html.indexOf('</div>', i);
        if (nextClose === -1) break;
        if (nextOpen !== -1 && nextOpen < nextClose) {
            depth += 1;
            i = nextOpen + 4;
        } else {
            depth -= 1;
            if (depth === 0) return html.slice(start, nextClose);
            i = nextClose + 6;
        }
    }
    return null;
}

const render = () => renderToStaticMarkup(
    React.createElement(require('../../src/components/SettingsModal').default, {
        onClose: () => {},
        watchedDirs: ['/Users/someone/Documents/project-a', '/Users/someone/Documents/project-b'],
        refresh: () => {}
    })
);

describe('Settings dialog layout', () => {
    // Rendered in beforeAll, not in the describe body. A describe body runs at
    // COLLECTION time — before any beforeAll — so requiring the component there
    // executed src/api/api.js against a browser stub that did not exist yet.
    let html;
    beforeAll(() => { html = render(); });

    it('renders the sections these invariants are about', () => {
        // The guard against measuring nothing. Every assertion below is about
        // where the MCP panel sits; if it never rendered, they would all pass
        // vacuously — which is precisely how the manual measurement misled.
        expect(html).toContain('Connect other agents');
        expect(html).toContain('Tracked Locations');
        expect(html.length).toBeGreaterThan(2000);
    });

    it('is bounded by the viewport', () => {
        // Without this, `overflow-hidden` just clips the bottom off-screen.
        expect(html).toMatch(/max-h-\[\d+vh\]/);
    });

    it('has exactly one scroll region', () => {
        // Two scrollbars in one dialog means the wheel does different things
        // depending on where the pointer is, and the inner one eats the gesture.
        const scrollAreas = (html.match(/overflow-y-auto/g) || []).length;
        expect(scrollAreas).toBe(1);
    });

    it('lets the scroll region actually shrink', () => {
        // A flex child defaults to min-height:auto and refuses to shrink, so
        // without min-h-0 the body pushes the footer out instead of scrolling.
        expect(html).toMatch(/flex-1[^"]*min-h-0[^"]*overflow-y-auto|min-h-0[^"]*flex-1[^"]*overflow-y-auto/);
    });

    it('pins the header and footer so they cannot be scrolled away', () => {
        expect((html.match(/shrink-0/g) || []).length).toBeGreaterThanOrEqual(2);
    });

    it('puts EVERY section inside the scroll region', () => {
        // The fault the first fix missed. Developer Settings and the MCP panel
        // lived in a sibling of the content area, so no amount of scrolling
        // reached them and the footer was pushed off-screen.
        const scrollBody = innerHtmlOf(html, 'overflow-y-auto');
        expect(scrollBody).toBeTruthy();

        for (const section of ['Tracked Locations', 'Developer Settings', 'Connect other agents']) {
            expect(scrollBody).toContain(section);
        }
    });

    it('keeps the dismiss control outside the scroll region', () => {
        // It is pinned on purpose: a user who cannot find the way out of a
        // dialog is the failure this whole file is about.
        const scrollBody = innerHtmlOf(html, 'overflow-y-auto');
        expect(scrollBody).not.toContain('DISMISS');
        expect(html).toContain('DISMISS');
    });

    it('stops scroll chaining to the page behind', () => {
        expect(html).toMatch(/overscroll-contain/);
    });

    it('does not give each config snippet its own horizontal scrollbar', () => {
        // Three stacked scrollbars, on text whose only purpose is to be copied.
        expect(html).not.toMatch(/<pre[^>]*overflow-x-auto/);
        expect(html).toMatch(/<pre[^>]*whitespace-pre-wrap/);
    });

    it('is announced as a dialog', () => {
        expect(html).toMatch(/role="dialog"/);
        expect(html).toMatch(/aria-modal="true"/);
    });
});
