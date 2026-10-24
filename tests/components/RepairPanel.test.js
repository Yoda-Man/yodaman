/**
 * The Dashboard's Repair: says exactly what it will run, then how it went.
 */
function render(props) {
    require('../helpers/browserStub').installBrowserStub();
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { RepairPanel } = require('../../src/components/HealthDashboard');
    return renderToStaticMarkup(React.createElement(RepairPanel, { onRepair() {}, ...props }));
}

const PLAN = { automatic: [{ name: 'ctx', command: 'npm install -g yodaman-ctx' }] };

test('before: names the tool and the exact command, with a Repair button', () => {
    const html = render({ plan: PLAN, repair: { state: 'idle' } });
    expect(html).toContain('Context Expert: <code class="text-slate-300">npm install -g yodaman-ctx</code>');
    expect(html).toContain('>Repair</button>');
});

test('while it runs: the button is disabled and says it can take minutes', () => {
    const html = render({ plan: PLAN, repair: { state: 'running' } });
    expect(html).toMatch(/disabled="".*Repairing… this can take a few minutes/s);
});

test('after: says what now works', () => {
    const html = render({ plan: { automatic: [] }, repair: { state: 'done', result: { installed: PLAN.automatic, failed: [], stillMissing: [] } } });
    expect(html).toContain('Repaired: Context Expert installed and working.');
    expect(html).not.toContain('>Repair</button>');
});

test('a partial repair names the failure and points at the terminal', () => {
    const html = render({ plan: PLAN, repair: { state: 'partial', result: { installed: PLAN.automatic, failed: [{ name: 'ctx', error: 'EACCES' }], stillMissing: ['ctx'] } } });
    expect(html).toContain('Repair did not finish: ctx (EACCES). Still missing: ctx.');
    expect(html).toContain('yodaman setup');
});

test('a repair that could not start says why', () => {
    expect(render({ plan: PLAN, repair: { state: 'failed', error: 'Repairs can only be started from this computer' } }))
        .toContain('Repair could not run: Repairs can only be started from this computer');
});
