/**
 * Whether a file a graph or index mentions is still in the workspace.
 *
 * Context Expert's index and Graphify's graph both outlive the files they
 * describe: a deleted or moved file stays in them until a full rebuild. Search
 * and the graph map both drop such entries, through this one rule.
 */
const fs = require('fs');
const path = require('path');

function workspaceFileExists(project, file) {
    if (!file) return true;
    if (path.isAbsolute(file)) return fs.existsSync(file);
    return project ? fs.existsSync(path.join(project, file)) : true;
}

module.exports = { workspaceFileExists };
