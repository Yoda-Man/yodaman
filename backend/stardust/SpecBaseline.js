/**
 * SpecBaseline — first-draft OpenSpec specs for a workspace that has none.
 *
 * Drift already tells a new user that nothing describes their load-bearing
 * modules; this is the step that acts on it. It only DRAFTS: nothing here
 * writes a file. Callers hand each draft to the approval gate, so the user sees
 * every spec as a diff before it lands.
 *
 * Built from the three mandatory tools, none bypassed:
 *   Graphify       groups the code into capabilities (top-level modules, ranked
 *                  by how much of the codebase depends on them)
 *   Context Expert retrieves each capability's key code, through SearchPipeline
 *   OpenSpec       is the output format, and existing specs are never replaced
 *
 * The model is the local one ctx serves (Ollama). It writes requirement blocks
 * only; the header, the DRAFT marker and the structure are ours, so a sloppy
 * answer cannot produce a file `openspec validate` rejects.
 */

const fs = require('fs');
const path = require('path');
const graphFacts = require('../infrastructure/GraphFacts');
const { isTestFile } = require('../infrastructure/ImpactAnalyzer');
const contextEngine = require('../infrastructure/ContextEngine');
const { stripCliNoise } = require('../infrastructure/CliOutput');
const searchPipeline = require('../core/SearchPipeline');
const { hitPath, hitText } = require('../../shared/searchHits');
const specDrift = require('./SpecDrift');
const logger = require('../infrastructure/Logger');

const CODE_FILE = /\.(?:js|jsx|ts|tsx|mjs|cjs|py|go|rs|java|rb|php|swift|kt|cs)$/i;
const MAX_CAPABILITIES = 12;
const FILES_PER_CAPABILITY = 5;
const MAX_REQUIREMENTS = 8;
const EXCERPT_CHARS = 1200;

/** `backend/core/X.js` → `backend/core`; `src/App.jsx` → `src`; root files → null. */
function moduleOf(file) {
    const parts = file.split('/');
    if (parts.length < 2) return null;
    return parts.slice(0, Math.min(2, parts.length - 1)).join('/');
}

/** OpenSpec capability ids are kebab-case directory names. */
function capabilityName(module) {
    return module.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Group the graph's source files into capabilities, most depended-on first.
 *
 * A module's weight is how many files depend on its files, so the modules that
 * carry the codebase get a spec before the leaf folders do. Tests and non-code
 * files describe nothing a spec should promise, so they are left out.
 */
function groupCapabilities(facts, { maxGroups = 6 } = {}) {
    if (!facts?.files) return [];
    const groups = new Map();

    for (const file of facts.files) {
        if (!CODE_FILE.test(file) || isTestFile(file)) continue;
        const module = moduleOf(file);
        const capability = module && capabilityName(module);
        if (!capability) continue;

        const dependents = facts.dependedOnBy.get(file)?.size || 0;
        if (!groups.has(capability)) groups.set(capability, { capability, module, files: [], weight: 0 });
        const group = groups.get(capability);
        group.files.push({ file, dependents });
        group.weight += dependents;
    }

    return [...groups.values()]
        .sort((a, b) => b.weight - a.weight || a.capability.localeCompare(b.capability))
        .slice(0, maxGroups)
        .map(group => ({
            ...group,
            files: group.files
                .sort((a, b) => b.dependents - a.dependents || a.file.localeCompare(b.file))
                .slice(0, FILES_PER_CAPABILITY)
                .map(entry => entry.file),
        }));
}

function buildPrompt(group, excerpts) {
    // Format last: a prompt ending in code gets code back, and ctx's request
    // timeout cuts a long answer off, so ask for a short one with no code.
    return [
        `Code excerpts from ${group.module}/, for reference only:`,
        excerpts || '(none retrieved; use the file names)',
        '',
        `Write OpenSpec requirements for the "${group.capability}" capability (key files: ${group.files.join(', ')}).`,
        'Describe only behaviour the code shows. Do not invent features. Do not include any code.',
        'Output ONLY 3 to 5 requirement blocks, each in exactly this format, and nothing else:',
        '',
        '### Requirement: <short name>',
        'The system SHALL <one observable behaviour>.',
        '',
        '#### Scenario: <short name>',
        '- **WHEN** <trigger>',
        '- **THEN** <outcome>',
    ].join('\n');
}

/**
 * The model's requirement blocks that OpenSpec will accept, or [] if none.
 *
 * A block is kept only when it states a SHALL/MUST and has a scenario — the two
 * things `openspec validate` checks. Anything after a higher-level heading or
 * a code section is cut, so stray output cannot land inside the spec. A block
 * the model was cut off in (ctx's request timeout) fails the check and is dropped.
 */
function parseRequirements(text) {
    return String(text || '').split(/^###\s+Requirement:\s*/m).slice(1)
        // Models echo a "Code:" section or a fence after the scenario; none of it belongs in a spec.
        .map(block => block.split(/^(?:#{1,3}\s|```|Code:)/m)[0].trim())
        .map(block => `### Requirement: ${block.replace(/^####\s+Scenario:\s*/gm, '#### Scenario: ')}`)
        .filter(block => /\b(?:SHALL|MUST)\b/.test(block) && /^####\s+Scenario:/m.test(block))
        .slice(0, MAX_REQUIREMENTS);
}

function formatSpec(group, requirements) {
    return [
        `# ${group.capability} Specification`,
        '',
        '## Purpose',
        `DRAFT, generated by YodaMan's local model from the code in \`${group.module}/\` `
            + `(${group.files.map(file => `\`${file}\``).join(', ')}). Review and edit before relying on it.`,
        '',
        '## Requirements',
        requirements.join('\n\n'),
        '',
    ].join('\n');
}

/**
 * Draft one spec per capability. Writes nothing.
 *
 * @returns {Promise<{available: boolean, reason?: string, openSpecInitialized: boolean,
 *   drafts: {capability, module, filePath, relativePath, content, sources}[],
 *   skipped: {capability, reason}[]}>}
 */
async function draftSpecs(projectRoot, { maxCapabilities = 6 } = {}) {
    const openSpecInitialized = Boolean(specDrift.findOpenSpecRoot(projectRoot));
    const facts = graphFacts.load(projectRoot);
    if (!facts) {
        return {
            available: false,
            reason: 'no knowledge graph has been built for this workspace yet. Run Sync Repository, then try again',
            openSpecInitialized, drafts: [], skipped: [],
        };
    }

    const limit = Math.min(MAX_CAPABILITIES, Math.max(1, Number(maxCapabilities) || 6));
    const drafts = [];
    const skipped = [];

    for (const group of groupCapabilities(facts, { maxGroups: limit })) {
        const relativePath = `openspec/specs/${group.capability}/spec.md`;
        const filePath = path.join(projectRoot, ...relativePath.split('/'));
        // A spec someone already wrote is never replaced by a draft.
        if (fs.existsSync(filePath)) {
            skipped.push({ capability: group.capability, reason: 'a spec already exists' });
            continue;
        }

        try {
            const query = [group.module, ...group.files.map(file => path.basename(file).replace(/\.[^.]+$/, ''))].join(' ');
            const { results } = await searchPipeline.search({ query, project: projectRoot, mode: 'code', top: 6 });
            const excerpts = results
                .map(hit => `--- ${hitPath(hit)}\n${hitText(hit).slice(0, EXCERPT_CHARS)}`)
                .join('\n');

            const raw = await contextEngine.ask(buildPrompt(group, excerpts), { project: projectRoot, topK: 2 });
            const requirements = parseRequirements(stripCliNoise(raw?.output));
            if (requirements.length === 0) {
                skipped.push({ capability: group.capability, reason: 'the local model returned no usable requirements' });
                continue;
            }

            drafts.push({
                capability: group.capability,
                module: group.module,
                filePath,
                relativePath,
                content: formatSpec(group, requirements),
                sources: [...new Set(results.map(hitPath).filter(Boolean))],
            });
        } catch (err) {
            logger.warn('spec_baseline_draft_failed', { path: projectRoot, capability: group.capability, reason: err.message });
            skipped.push({ capability: group.capability, reason: err.message });
        }
    }

    logger.info('spec_baseline_drafted', { path: projectRoot, drafts: drafts.length, skipped: skipped.length });
    return { available: true, openSpecInitialized, drafts, skipped };
}

module.exports = { groupCapabilities, parseRequirements, formatSpec, draftSpecs };
