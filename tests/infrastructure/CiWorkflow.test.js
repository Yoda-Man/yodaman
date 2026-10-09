/**
 * The CI workflows must be files GitHub can actually run.
 *
 * WHY THIS EXISTS:
 *
 * Holocron's `ci.yml` contained a `run:` step whose value held an unquoted
 * `: ` — `console.log('plugin.json: valid')`. YAML read that as a nested
 * mapping and rejected the whole file, so GitHub could not construct a
 * workflow from it. Every run failed in **0 seconds without executing a single
 * step**, for over a month.
 *
 * Nothing announced it. The Actions tab showed runs, each one red, and the
 * only real consequence was silent: that workflow was the sole place a C++
 * source got compiled, so it stopped compiling and kept shipping a stale
 * binary. A broken pipeline is worse than no pipeline, because it looks like
 * coverage you do not have.
 *
 * Core's workflows were fine, but nothing was stopping the same thing
 * happening here — and a workflow cannot report its own failure to parse.
 *
 * The second block is about a different hole found at the same time: CI
 * triggered only on pushes to `main`, while all work happens on `dev`. Every
 * commit on the branch people actually use was untested until PR time.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const WORKFLOW_DIR = path.join(__dirname, '..', '..', '.github', 'workflows');

const workflowFiles = fs.existsSync(WORKFLOW_DIR)
    ? fs.readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f))
    : [];

/** Parsed defensively: a throw at module scope would take the suite down with
 *  "0 tests", which names nothing — the same silence this file exists to end. */
function parse(file) {
    try {
        return { doc: yaml.load(fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf8')), error: null };
    } catch (err) {
        return { doc: null, error: err.message.split('\n')[0] };
    }
}

describe('CI workflows are runnable', () => {
    it('there are workflows to check', () => {
        // Without this, every assertion below passes vacuously if the
        // directory is emptied or renamed.
        expect(workflowFiles.length).toBeGreaterThan(0);
    });

    it.each(workflowFiles)('%s is valid YAML', (file) => {
        const { error } = parse(file);
        // The exact assertion that would have caught a month of dead CI.
        expect(error).toBeNull();
    });

    it.each(workflowFiles)('%s defines jobs that can actually run', (file) => {
        const { doc } = parse(file);
        expect(doc).not.toBeNull();
        const jobs = Object.values(doc.jobs || {});
        expect(jobs.length).toBeGreaterThan(0);
        for (const job of jobs) {
            const steps = Array.isArray(job.steps) ? job.steps.length : 0;
            expect(steps + (job.uses ? 1 : 0)).toBeGreaterThan(0);
        }
    });
});

describe('CI runs on the branch the work happens on', () => {
    const ci = parse('ci.yml').doc;

    it('ci.yml exists and parses', () => {
        expect(ci).not.toBeNull();
    });

    it('triggers on dev, not only main', () => {
        // The rule is: work on dev, and the maintainer merges to main once a
        // release is judged stable (see CONTRIBUTING.md). A main-only trigger
        // therefore tests only what has already been accepted.
        const branches = (ci.on && ci.on.push && ci.on.push.branches) || [];
        const wildcard = branches.includes('**');
        expect(wildcard || branches.includes('dev')).toBe(true);
    });

    it('still runs the test suite and the production audit', () => {
        // These are the two that matter most: one catches regressions, the
        // other catches a dependency advisory published overnight.
        const text = JSON.stringify(ci);
        expect(text).toMatch(/npm test|release:verify/);
        expect(text).toMatch(/npm audit/);
    });

    it('does not let those steps fail silently', () => {
        for (const job of Object.values(ci.jobs || {})) {
            for (const step of job.steps || []) {
                const body = JSON.stringify(step);
                if (/npm test|npm audit|release:verify/.test(body)) {
                    expect(step['continue-on-error']).toBeFalsy();
                }
            }
        }
    });
});
