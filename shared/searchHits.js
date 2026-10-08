/**
 * Reading a search hit, once, for every consumer.
 *
 * Hits arrive in two shapes: ctx's `{ filePath, lineStart }` and the
 * filesystem fallback's `{ metadata: { path, line } }`. Each consumer used to
 * read them its own way, and they disagreed: the Search view read only
 * `metadata.path`, so every ctx hit was labelled "Source File" with nothing to
 * open. The pipeline, the agent and the Search view now all read hits here.
 *
 * Shared by the backend (require) and the frontend (Vite import), so plain
 * CommonJS with no dependencies.
 */

/** Workspace-relative (or absolute) path of the hit's file, or ''. */
function hitPath(hit) {
    return String(hit?.metadata?.path || hit?.filePath || hit?.path || hit?.file || '');
}

/** 1-based line where the hit starts, or null. */
function hitLine(hit) {
    const line = Number(hit?.metadata?.line || hit?.lineStart || hit?.line);
    return Number.isFinite(line) && line > 0 ? line : null;
}

function hitText(hit) {
    return String(hit?.content || hit?.text || hit?.snippet || '');
}

/** First meaningful line of the hit, for a one-line preview. */
function hitPreview(hit, max = 140) {
    const line = hitText(hit).split('\n').map((l) => l.trim()).find((l) => l && !/^[-=~#*"'`/]+$/.test(l));
    return line ? line.slice(0, max) : '';
}

/**
 * One entry per location. ctx returns the same chunk more than once. Without a
 * line number the text distinguishes two hits in one file.
 */
function dedupeHits(hits) {
    const seen = new Set();
    return (Array.isArray(hits) ? hits : []).filter((hit) => {
        const file = hitPath(hit);
        if (!file) return false;
        const line = hitLine(hit);
        const key = `${file}:${line || ''}:${line ? '' : hitText(hit).slice(0, 80)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * A path the chat renders as a clickable file reference. Root-level files need
 * a "./" because the reference pattern requires a directory part; the editor
 * route strips it again.
 */
function chipPath(filePath) {
    const value = String(filePath || '').replace(/\\/g, '/');
    if (!value) return '';
    if (value.startsWith('/') || /^[A-Za-z]:\//.test(value) || value.includes('/')) return value;
    return `./${value}`;
}

module.exports = { hitPath, hitLine, hitText, hitPreview, dedupeHits, chipPath };
