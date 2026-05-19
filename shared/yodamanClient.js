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

async function requestJson(runtimeUrl, path, options = {}) {
    const baseUrl = normalizeBaseUrl(runtimeUrl);
    const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.pairingToken ? { 'X-YodaMan-Token': options.pairingToken } : {}),
            ...(options.headers || {})
        }
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Request failed with ${response.status}`);
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
        ask(question, projectId) {
            return request(API_PATHS.ask, {
                method: 'POST',
                body: JSON.stringify({ question, projectId })
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
        createPairing(runtimeUrlOverride) {
            return request(API_PATHS.pairing, {
                method: 'POST',
                body: JSON.stringify(runtimeUrlOverride ? { runtimeUrl: runtimeUrlOverride } : {})
            });
        },
        async runAgentTask(task, projectId, onEvent) {
            const response = await fetch(`${normalizeBaseUrl(runtimeUrl)}/api/agent/task`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(pairingToken ? { 'X-YodaMan-Token': pairingToken } : {})
                },
                body: JSON.stringify({ task, projectId })
            });

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
