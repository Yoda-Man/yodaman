/**
 * LOAD-BEARING — DO NOT DELETE BECAUSE "NOTHING IMPORTS IT".
 *
 * Published API surface. Shipped in the npm tarball via package.json "files",
 * and consumed from outside this package:
 *   - extensions/vscode-yodaman/src/extension.js (via ../../../shared/)
 *   - apps/mobile/src/api/yodamanClient.js
 *   - third-party consumers of the published package
 * Exports that look unused in-repo (API_PATHS, readEventStream, requestJson)
 * are deliberate public API. Removing one is a breaking change, not a cleanup.
 * scripts/release-smoke.js gates the release on this file being present.
 *
 */
const API_PATHS = {
    status: '/api/status',
    diagnostics: '/api/desktop/diagnostics',
    pairing: '/api/pairing',
    projects: '/api/projects',
    ask: '/api/ask',
    search: '/api/search',
    reindex: '/api/reindex',
    approve: '/api/agent/approve',
    cancel: '/api/agent/cancel',
    tasks: '/api/agent/tasks',
    pendingApprovals: '/api/agent/pending-approvals',
    policy: '/api/policy',
    audit: '/api/audit'
};

function normalizeBaseUrl(runtimeUrl) {
    return String(runtimeUrl || '').replace(/\/$/, '');
}

function runtimeUnavailableMessage(baseUrl, reason) {
    return [
        `YodaMan runtime is not available at ${baseUrl || 'the configured URL'}.`,
        'Start the YodaMan desktop app or run "yodaman" from Terminal, then try again.',
        reason ? `Details: ${reason}` : ''
    ].filter(Boolean).join(' ');
}

async function requestJson(runtimeUrl, path, options = {}) {
    const baseUrl = normalizeBaseUrl(runtimeUrl);
    let response;
    try {
        response = await fetch(`${baseUrl}${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(options.pairingToken ? { 'X-YodaMan-Token': options.pairingToken } : {}),
                ...(options.headers || {})
            }
        });
    } catch (error) {
        throw new Error(runtimeUnavailableMessage(baseUrl, error.message));
    }

    if (!response.ok) {
        const contentType = response.headers.get('content-type') || '';
        const payload = contentType.includes('application/json') ? await response.json() : await response.text();
        const message = typeof payload === 'object' && payload?.error ? payload.error : payload;
        throw new Error(message || `YodaMan request failed with HTTP ${response.status}`);
    }

    return response.json();
}

async function readEventStream(response, onEvent) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';

        for (const frame of frames) {
            const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
            if (dataLine) {
                await onEvent(assertTaskEvent(JSON.parse(dataLine.slice(6))));
            }
        }
    }

    if (buffer.startsWith('data: ')) {
        await onEvent(assertTaskEvent(JSON.parse(buffer.slice(6))));
    }
}

function createYodaManClient(runtimeUrl, options = {}) {
    const pairingToken = options.pairingToken || '';

    function request(path, requestOptions = {}) {
        return requestJson(runtimeUrl, path, {
            ...requestOptions,
            pairingToken
        });
    }

    return {
        status() {
            return request(API_PATHS.status);
        },
        diagnostics() {
            return request(API_PATHS.diagnostics);
        },
        projects() {
            return request(API_PATHS.projects);
        },
        addProject(path) {
            return request(API_PATHS.projects, {
                method: 'POST',
                body: JSON.stringify({ path })
            });
        },
        removeProject(path) {
            return request(API_PATHS.projects, {
                method: 'DELETE',
                body: JSON.stringify({ path })
            });
        },
        updateProjectPath(path, nextPath) {
            return request(API_PATHS.projects, {
                method: 'PUT',
                body: JSON.stringify({ path, nextPath })
            });
        },
        ask(question, projectId, mode) {
            const body = { question, projectId };
            if (mode) body.mode = mode;
            return request(API_PATHS.ask, {
                method: 'POST',
                body: JSON.stringify(body)
            });
        },
        search(query, project, top) {
            const params = new URLSearchParams({ query });
            if (project) params.set('project', project);
            if (top) params.set('top', top);
            return request(`${API_PATHS.search}?${params.toString()}`);
        },
        reindex(path) {
            return request(API_PATHS.reindex, {
                method: 'POST',
                body: JSON.stringify({ path })
            });
        },
        approve(taskId, approved) {
            return request(API_PATHS.approve, {
                method: 'POST',
                body: JSON.stringify({ taskId, approved })
            });
        },
        cancel(taskId) {
            return request(API_PATHS.cancel, {
                method: 'POST',
                body: JSON.stringify({ taskId })
            });
        },
        tasks() {
            return request(API_PATHS.tasks);
        },
        pendingApprovals() {
            return request(API_PATHS.pendingApprovals);
        },
        taskEvents(taskId) {
            return request(`/api/agent/tasks/${encodeURIComponent(taskId)}/events`);
        },
        policy() {
            return request(API_PATHS.policy);
        },
        audit(limit = 25) {
            return request(`${API_PATHS.audit}?limit=${encodeURIComponent(limit)}`);
        },
        logs(limit = 200) {
            return request(`/api/logs?limit=${encodeURIComponent(limit)}`);
        },
        graphifyStatus(path) {
            return request(`/api/graphify/status?path=${encodeURIComponent(path)}`);
        },
        graphifyBuild(path) {
            return request('/api/graphify/build', {
                method: 'POST',
                body: JSON.stringify({ path })
            });
        },
        graphifyBuildStatus(path, jobId) {
            const params = new URLSearchParams({ path });
            if (jobId) params.set('jobId', jobId);
            return request(`/api/graphify/build/status?${params.toString()}`);
        },
        graphifyArtifact(path, type) {
            const params = new URLSearchParams({ path, type });
            return request(`/api/graphify/artifact?${params.toString()}`);
        },
        graphifyReport(path) {
            return request(`/api/graphify/report?path=${encodeURIComponent(path)}`);
        },
        graphifyQuery(path, query) {
            return request('/api/graphify/query', {
                method: 'POST',
                body: JSON.stringify({ path, query })
            });
        },
        graphifyExplain(path, node) {
            return request('/api/graphify/explain', {
                method: 'POST',
                body: JSON.stringify({ path, node })
            });
        },
        graphifyPath(path, source, target) {
            return request('/api/graphify/path', {
                method: 'POST',
                body: JSON.stringify({ path, source, target })
            });
        },
        graphifyAffected(path, node, depth = 2, relations = []) {
            return request('/api/graphify/affected', {
                method: 'POST',
                body: JSON.stringify({ path, node, depth, relations })
            });
        },
        graphifyMap(path, limit = 80) {
            const params = new URLSearchParams({ path, limit: String(limit) });
            return request(`/api/graphify/map?${params.toString()}`);
        },
        clearTasks() {
            return request(API_PATHS.tasks, {
                method: 'DELETE'
            });
        },
        clearAudit() {
            return request(API_PATHS.audit, {
                method: 'DELETE'
            });
        },
        createPairing(runtimeUrlOverride) {
            return request(API_PATHS.pairing, {
                method: 'POST',
                body: JSON.stringify(runtimeUrlOverride ? { runtimeUrl: runtimeUrlOverride } : {})
            });
        },
        async runAgentTask(task, projectId, onEvent) {
            const baseUrl = normalizeBaseUrl(runtimeUrl);
            let response;
            try {
                response = await fetch(`${baseUrl}/api/agent/task`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(pairingToken ? { 'X-YodaMan-Token': pairingToken } : {})
                    },
                    body: JSON.stringify({ task, projectId })
                });
            } catch (error) {
                throw new Error(runtimeUnavailableMessage(baseUrl, error.message));
            }

            if (!response.ok) {
                throw new Error(await response.text());
            }

            await readEventStream(response, onEvent);
        }
    };
}

module.exports = {
    API_PATHS,
    createYodaManClient,
    readEventStream,
    requestJson
};
const { assertTaskEvent } = require('./yodamanProtocol');
