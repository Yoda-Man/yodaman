const path = require('path');
const simpleGit = require('simple-git');

function gitFor(workspacePath) {
    return simpleGit({ baseDir: resolveWorkspacePath(workspacePath), trimmed: false });
}

function resolveWorkspacePath(workspacePath) {
    if (!workspacePath || typeof workspacePath !== 'string') {
        const err = new Error('workspacePath is required');
        err.status = 400;
        throw err;
    }
    return path.resolve(workspacePath);
}

function relativeFile(workspacePath, filePath) {
    if (!filePath) return undefined;
    const workspace = resolveWorkspacePath(workspacePath);
    const resolved = path.isAbsolute(filePath)
        ? path.resolve(filePath)
        : path.resolve(workspace, filePath);
    const relative = path.relative(workspace, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        const err = new Error('filePath must be inside workspacePath');
        err.status = 400;
        throw err;
    }
    return relative.split(path.sep).join('/');
}

function parseIsoDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

async function countFilesChanged(git, hash) {
    const output = await git.raw(['show', '--name-only', '--format=', '--no-renames', hash]);
    return output.split('\n').map(line => line.trim()).filter(Boolean).length;
}

async function getCommitHistory(workspacePath, filePath, limit = 100) {
    const git = gitFor(workspacePath);
    const relative = relativeFile(workspacePath, filePath);
    const maxCount = Math.max(1, Math.min(Number(limit) || 100, 500));
    const args = [
        'log',
        `--max-count=${maxCount}`,
        '--date=iso-strict',
        '--pretty=format:%H%x09%an%x09%ad%x09%s'
    ];
    if (relative) args.push('--', relative);

    const output = await git.raw(args);
    const commits = output.split('\n')
        .filter(Boolean)
        .map(line => {
            const [hash, author, date, ...messageParts] = line.split('\t');
            return {
                hash,
                author,
                date: parseIsoDate(date),
                message: messageParts.join('\t')
            };
        });

    return Promise.all(commits.map(async commit => ({
        ...commit,
        filesChanged: await countFilesChanged(git, commit.hash)
    })));
}

async function getFileBlame(workspacePath, filePath) {
    const git = gitFor(workspacePath);
    const relative = relativeFile(workspacePath, filePath);
    if (!relative) {
        const err = new Error('filePath is required');
        err.status = 400;
        throw err;
    }

    const output = await git.raw(['blame', '--line-porcelain', '--', relative]);
    const lines = [];
    let current = null;
    let lineNumber = 0;

    for (const rawLine of output.split('\n')) {
        if (/^[0-9a-f]{40}\s/.test(rawLine)) {
            const [hash] = rawLine.split(/\s+/);
            current = { hash };
        } else if (current && rawLine.startsWith('author ')) {
            current.author = rawLine.slice('author '.length);
        } else if (current && rawLine.startsWith('author-time ')) {
            current.date = new Date(Number(rawLine.slice('author-time '.length)) * 1000).toISOString();
        } else if (current && rawLine.startsWith('summary ')) {
            current.summary = rawLine.slice('summary '.length);
        } else if (current && rawLine.startsWith('\t')) {
            lineNumber += 1;
            lines.push({
                line: lineNumber,
                hash: current.hash,
                author: current.author || '',
                date: current.date || '',
                summary: current.summary || '',
                content: rawLine.slice(1)
            });
            current = null;
        }
    }

    return lines;
}

async function getChangeFrequency(workspacePath, filePath, days = 30) {
    const git = gitFor(workspacePath);
    const relative = relativeFile(workspacePath, filePath);
    const sinceDays = Math.max(1, Math.min(Number(days) || 30, 3650));
    const args = ['log', `--since=${sinceDays} days ago`, '--pretty=format:%H'];
    if (relative) args.push('--', relative);
    const output = await git.raw(args);
    return output.split('\n').filter(Boolean).length;
}

async function getHeatmapData(workspacePath) {
    const git = gitFor(workspacePath);
    const output = await git.raw([
        'log',
        '--since=30 days ago',
        '--date=iso-strict',
        '--pretty=format:commit%x09%H%x09%an%x09%ad',
        '--name-only'
    ]);
    const byFile = new Map();
    let current = null;

    for (const rawLine of output.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith('commit\t')) {
            const [, hash, author, date] = line.split('\t');
            current = { hash, author, date: parseIsoDate(date) };
            continue;
        }
        if (!current) continue;
        const entry = byFile.get(line) || {
            filePath: line,
            changeCount: 0,
            lastChangeDate: current.date,
            authors: new Set()
        };
        entry.changeCount += 1;
        entry.authors.add(current.author);
        if (new Date(current.date) > new Date(entry.lastChangeDate)) {
            entry.lastChangeDate = current.date;
        }
        byFile.set(line, entry);
    }

    return Array.from(byFile.values())
        .map(entry => ({
            filePath: entry.filePath,
            changeCount: entry.changeCount,
            lastChangeDate: entry.lastChangeDate,
            authorCount: entry.authors.size
        }))
        .sort((a, b) => b.changeCount - a.changeCount || a.filePath.localeCompare(b.filePath));
}

async function getCommitDiff(workspacePath, commitHash) {
    if (!commitHash || !/^[0-9a-fA-F]{7,40}$/.test(commitHash)) {
        const err = new Error('commitHash must be a git hash');
        err.status = 400;
        throw err;
    }

    const git = gitFor(workspacePath);
    const [summary, meta] = await Promise.all([
        git.raw(['show', '--numstat', '--format=', '--no-renames', commitHash]),
        git.raw(['show', '-s', '--date=iso-strict', '--pretty=format:%H%x09%an%x09%ad%x09%s', commitHash])
    ]);
    const [hash, author, date, ...messageParts] = meta.trim().split('\t');
    const files = summary.split('\n')
        .filter(Boolean)
        .map(line => {
            const [additions, deletions, filePath] = line.split('\t');
            return {
                filePath,
                additions: additions === '-' ? null : Number(additions),
                deletions: deletions === '-' ? null : Number(deletions)
            };
        });

    return {
        hash,
        author,
        date: parseIsoDate(date),
        message: messageParts.join('\t'),
        files
    };
}

async function getBranchInfo(workspacePath) {
    const git = gitFor(workspacePath);
    const [branchSummary, latest] = await Promise.all([
        git.branchLocal(),
        git.raw(['log', '-1', '--date=iso-strict', '--pretty=format:%H%x09%an%x09%ad%x09%s']).catch(() => '')
    ]);
    const currentBranch = branchSummary.current;
    const current = branchSummary.branches[currentBranch] || {};
    const [hash, author, date, ...messageParts] = latest.trim().split('\t');

    return {
        currentBranch,
        branches: branchSummary.all,
        ahead: Number(current.ahead || 0),
        behind: Number(current.behind || 0),
        latestCommit: hash ? {
            hash,
            author,
            date: parseIsoDate(date),
            message: messageParts.join('\t')
        } : null
    };
}

module.exports = {
    getCommitHistory,
    getFileBlame,
    getChangeFrequency,
    getHeatmapData,
    getCommitDiff,
    getBranchInfo
};
