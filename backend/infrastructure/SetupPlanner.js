/**
 * Turn a dependency check into an ordered, safe installation plan.
 *
 * `yodaman setup` exists because the install friction was never `npm install -g
 * yodaman` — that part already worked. It was the four things YodaMan needs
 * afterwards: Ollama, Context Expert, Graphify, and OpenSpec. Users had to read
 * a doctor report and hand-run four commands from three package managers.
 *
 * REUSES `DependencyChecker.SERVICES` RATHER THAN RESTATING IT.
 *
 * Every install command already lived there, per platform, to be printed by the
 * doctor. A second copy inside an installer would drift from the first, which is
 * the failure that once split one ignore list into four and leaked file
 * descriptors until the process ran out. There is one list; this reads it.
 *
 * WHY NOT SIMPLY RUN `installHint`.
 *
 * Those strings were written to be READ, not executed, and two of them are
 * prose:
 *
 *     ollama/darwin: "brew install ollama  or  download from https://…"
 *     ollama/win32:  "winget install Ollama.Ollama  or  download from https://…"
 *
 * Passing that to a shell runs `brew install ollama or download from …` — which
 * at best fails and at worst installs something nobody asked for. So a hint is
 * only ever executed when it is unambiguously a single command, and anything
 * else is presented for the user to run themselves.
 *
 * WHAT IS DELIBERATELY NOT AUTOMATED.
 *
 * Ollama. It is a system service with a platform installer of its own, and on
 * Linux its official hint pipes a downloaded script into a shell. The other
 * three install into user space through npm and pip, are reversible with an
 * uninstall, and touch nothing outside the user's own directories. That is the
 * line: package installs are automated, system services are printed. A setup
 * command that silently installed a background service would be a worse product
 * than one that asks.
 *
 * Nothing here ever runs `sudo`, and a command that would is refused.
 */
const { SERVICES } = require('./DependencyChecker');

/**
 * Dependencies whose installation is a user-space package install.
 * Anything absent from this set is presented as a manual step.
 */
const AUTOMATABLE = new Set(['ctx', 'graphify', 'openspec']);

/**
 * A hint is only runnable when it is a single unambiguous command.
 *
 * ` or ` marks two alternatives, a bare URL is a destination rather than an
 * instruction, and `sudo` is refused outright — asking for a password from
 * inside an installer is how people get trained to type it without reading.
 */
function isRunnableCommand(hint) {
    if (typeof hint !== 'string') return false;
    const trimmed = hint.trim();
    if (!trimmed) return false;
    if (/^https?:\/\//i.test(trimmed)) return false;
    if (/\s+or\s+/i.test(trimmed)) return false;
    if (/\bsudo\b/.test(trimmed)) return false;
    if (/\bdownload from\b/i.test(trimmed)) return false;
    return true;
}

/**
 * The install command for a service on a platform, or null if there is none.
 *
 * Reads SERVICES directly so this cannot drift from what `yodaman doctor`
 * prints.
 */
function commandFor(name, platform) {
    const svc = SERVICES[name];
    if (!svc) return null;
    const hint = (svc.installHint && svc.installHint[platform]) || svc.installUrl;
    return isRunnableCommand(hint) ? hint.trim() : null;
}

/**
 * Build the plan.
 *
 * @param {object} options
 * @param {object} options.checks   Result of `DependencyChecker.checkAll()`.
 * @param {string} options.platform `process.platform`.
 * @returns {{satisfied: string[], automatic: object[], manual: object[], ok: boolean}}
 */
function buildSetupPlan({ checks = {}, platform = process.platform } = {}) {
    const satisfied = [];
    const automatic = [];
    const manual = [];

    // Object.keys(SERVICES) rather than Object.keys(checks): a dependency the
    // checker failed to report on is missing from setup too, and silently
    // skipping it is how a setup command reports success having done nothing.
    for (const name of Object.keys(SERVICES)) {
        const result = checks[name];

        if (result && result.found) {
            satisfied.push(name);
            continue;
        }

        const command = commandFor(name, platform);
        const hint = (SERVICES[name].installHint && SERVICES[name].installHint[platform])
            || SERVICES[name].installUrl
            || null;

        if (command && AUTOMATABLE.has(name)) {
            automatic.push({ name, command });
        } else {
            // Either a system service we decline to install, or a hint that is
            // prose. Both end up in front of the user rather than in a shell.
            manual.push({
                name,
                instruction: hint,
                reason: AUTOMATABLE.has(name)
                    ? 'no single command is defined for this platform'
                    : 'installs a system service, so it is left to you'
            });
        }
    }

    return { satisfied, automatic, manual, ok: automatic.length === 0 && manual.length === 0 };
}

/**
 * Human-readable plan. Kept separate from execution so `--dry-run` and the real
 * run print exactly the same thing.
 */
function formatSetupPlan(plan) {
    const lines = [];

    if (plan.satisfied.length) {
        lines.push('Already installed:');
        for (const name of plan.satisfied) lines.push(`  ✓ ${name}`);
        lines.push('');
    }

    if (plan.automatic.length) {
        lines.push('Will install:');
        for (const step of plan.automatic) lines.push(`  → ${step.name.padEnd(10)}${step.command}`);
        lines.push('');
    }

    if (plan.manual.length) {
        lines.push('You will need to install these yourself:');
        for (const step of plan.manual) {
            lines.push(`  • ${step.name} — ${step.reason}`);
            if (step.instruction) lines.push(`      ${step.instruction}`);
        }
        lines.push('');
    }

    if (plan.ok) lines.push('Everything YodaMan needs is already installed.');

    return lines.join('\n');
}

module.exports = { buildSetupPlan, formatSetupPlan, commandFor, isRunnableCommand, AUTOMATABLE };
