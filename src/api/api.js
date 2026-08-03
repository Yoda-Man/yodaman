const API_BASE = import.meta.env.VITE_YODAMAN_API_BASE || '/api';
const DEFAULT_TIMEOUT_MS = Number(import.meta.env.VITE_YODAMAN_FETCH_TIMEOUT_MS || 30000);

async function parseResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
        ? await response.json()
        : await response.text();

    if (!response.ok) {
        const message = typeof payload === 'object' && payload?.error
            ? payload.error
            : payload || `Request failed with HTTP ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        error.payload = payload;
        throw error;
    }

    return payload;
}

async function request(url, options = {}) {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        return await parseResponse(response);
    } catch (err) {
        if (err.name === 'AbortError') {
            throw new Error(`Request timed out after ${timeoutMs}ms`);
        }
        if (err instanceof TypeError) {
            throw new Error('YodaMan runtime is not available. Start the desktop app or run "yodaman" from Terminal, then try again.');
        }
        throw err;
    } finally {
        clearTimeout(timeout);
    }
}

function jsonOptions(method, body) {
    return {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    };
}

export const api = {
    async reportClientError({ message, stack, userAction, component, severity = 'medium', context }) {
        try {
            return await request(`${API_BASE}/logs/client-error`, jsonOptions('POST', {
                message,
                stack,
                userAction,
                component,
                severity,
                context
            }));
        } catch {
            return null;
        }
    },

    async getProjects() {
        return request(`${API_BASE}/projects`);
    },

    async addProject(path) {
        return request(`${API_BASE}/projects`, jsonOptions('POST', { path }));
    },

    async removeProject(path) {
        return request(`${API_BASE}/projects`, jsonOptions('DELETE', { path }));
    },

    async updateProjectPath(path, nextPath) {
        return request(`${API_BASE}/projects`, jsonOptions('PUT', { path, nextPath }));
    },

    async reindex(path) {
        return request(`${API_BASE}/reindex`, jsonOptions('POST', { path }));
    },

    async search(query, project) {
        const url = new URL(`${API_BASE}/search`, window.location.origin);
        url.searchParams.append('query', query);
        if (project) url.searchParams.append('project', project);
        return request(url);
    },

    async getPlugins() {
        return request(`${API_BASE}/plugins`);
    },

    async openPlugin(name, project, diagnostics = {}) {
        return request(`${API_BASE}/plugins/${encodeURIComponent(name)}/open`, jsonOptions('POST', { project, diagnostics }));
    },

    async uploadPlugin(file) {
        const formData = new FormData();
        formData.append('plugin', file);
        return request(`${API_BASE}/plugins`, {
            method: 'POST',
            body: formData
        });
    },

    async deletePlugin(name) {
        return request(`${API_BASE}/plugins/${encodeURIComponent(name)}`, {
            method: 'DELETE'
        });
    },

    async getSessions(projectId) {
        return request(`${API_BASE}/sessions?projectId=${encodeURIComponent(projectId)}`);
    },

    async clearSessions(projectId) {
        return request(`${API_BASE}/sessions?projectId=${encodeURIComponent(projectId)}`, {
            method: 'DELETE'
        });
    },

    async ask(question, projectId, mode) {
        const body = { question, projectId };
        if (mode) body.mode = mode;
        return request(`${API_BASE}/ask`, jsonOptions('POST', body));
    },

    async checkHealth(path) {
        return request(`${API_BASE}/check?path=${encodeURIComponent(path)}`);
    },

    async getStatus() {
        return request(`${API_BASE}/status`);
    },

    async getDesktopDiagnostics() {
        return request(`${API_BASE}/desktop/diagnostics`);
    },

    async getGraphifyStatus(path) {
        return request(`${API_BASE}/graphify/status?path=${encodeURIComponent(path)}`);
    },

    async buildGraphify(path) {
        return request(`${API_BASE}/graphify/build`, {
            ...jsonOptions('POST', { path })
        });
    },

    async getGraphifyBuildStatus(path, jobId) {
        const url = new URL(`${API_BASE}/graphify/build/status`, window.location.origin);
        url.searchParams.append('path', path);
        if (jobId) url.searchParams.append('jobId', jobId);
        return request(url);
    },

    graphifyArtifactUrl(path, type) {
        const url = new URL(`${API_BASE}/graphify/artifact`, window.location.origin);
        url.searchParams.append('path', path);
        url.searchParams.append('type', type);
        return url.toString();
    },

    async getGraphifyReport(path) {
        return request(`${API_BASE}/graphify/report?path=${encodeURIComponent(path)}`);
    },

    async queryGraphify(path, query) {
        return request(`${API_BASE}/graphify/query`, jsonOptions('POST', { path, query }));
    },

    async explainGraphify(path, node) {
        return request(`${API_BASE}/graphify/explain`, jsonOptions('POST', { path, node }));
    },

    async pathGraphify(path, source, target) {
        return request(`${API_BASE}/graphify/path`, jsonOptions('POST', { path, source, target }));
    },

    async affectedGraphify(path, node, depth = 2, relations = []) {
        return request(`${API_BASE}/graphify/affected`, jsonOptions('POST', { path, node, depth, relations }));
    },

    async mapGraphify(path, limit = 80) {
        return request(`${API_BASE}/graphify/map?path=${encodeURIComponent(path)}&limit=${encodeURIComponent(limit)}`);
    },

    async getLogs(limit = 200, filters = {}) {
        const url = new URL(`${API_BASE}/logs`, window.location.origin);
        url.searchParams.append('limit', limit);
        Object.entries(filters).forEach(([key, value]) => {
            if (value) url.searchParams.append(key, value);
        });
        return request(url);
    },

    async createPairing(runtimeUrl) {
        return request(`${API_BASE}/pairing`, jsonOptions('POST', runtimeUrl ? { runtimeUrl } : {}));
    },

    async getTasks() {
        return request(`${API_BASE}/agent/tasks`);
    },

    async getGitContext(path) {
        return request(`${API_BASE}/git/context?path=${encodeURIComponent(path)}`);
    },

    async uploadTempFile(file) {
        const formData = new FormData();
        formData.append('file', file);
        return request(`${API_BASE}/upload/temp`, {
            method: 'POST',
            body: formData,
            timeoutMs: 60000
        });
    },

    async attachUploadFile(taskId, fileId) {
        return request(`${API_BASE}/upload/attach`, jsonOptions('POST', { taskId, fileId }));
    },

    async deleteTempUploadFile(fileId) {
        return request(`${API_BASE}/upload/temp/${encodeURIComponent(fileId)}`, {
            method: 'DELETE'
        });
    },

    async listTaskUploadFiles(taskId) {
        return request(`${API_BASE}/upload/task/${encodeURIComponent(taskId)}/files`);
    },

    async agentTask(task, projectId, onStep, context = {}) {
        let response;
        try {
            response = await fetch(`${API_BASE}/agent/task`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task, projectId, context, fileIds: context.fileIds || [] })
            });
        } catch (err) {
            if (err instanceof TypeError) {
                throw new Error('YodaMan runtime is not available. Start the desktop app or run "yodaman" from Terminal, then try again.');
            }
            throw err;
        }


        if (!response.ok) {
            await parseResponse(response);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = JSON.parse(line.slice(6));
                    onStep(data);
                }
            }
        }

        if (buffer.startsWith('data: ')) {
            const data = JSON.parse(buffer.slice(6));
            onStep(data);
        }
    },

    async approve(taskId, approved) {
        return request(`${API_BASE}/agent/approve`, jsonOptions('POST', { taskId, approved }));
    },

    async getReadiness(projectId) {
        const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
        return request(`${API_BASE}/readiness${query}`);
    },

    async cancelAgentTask(taskId) {
        return request(`${API_BASE}/agent/cancel`, jsonOptions('POST', { taskId }));
    },

    async setMode(mode, projectId) {
        return request(`${API_BASE}/mode`, jsonOptions('POST', { mode, projectId }));
    },

    // ── Stardust (OpenSpec wrapper) ──

    async stardustDiagnose(projectRoot) {
        const url = new URL(`${API_BASE}/stardust/diagnose`, window.location.origin);
        if (projectRoot) url.searchParams.append('projectRoot', projectRoot);
        return request(url);
    },

    async stardustRun({ action, changeId, title, description, specPath, projectRoot, dryRun, strict, specs, tools }) {
        return request(`${API_BASE}/stardust/run`, jsonOptions('POST', {
            action,
            changeId,
            title,
            description,
            specPath,
            projectRoot,
            dryRun,
            strict,
            specs,
            tools,
        }));
    },

    async stardustBoard(projectRoot) {
        const url = new URL(`${API_BASE}/stardust/board`, window.location.origin);
        if (projectRoot) url.searchParams.append('projectRoot', projectRoot);
        return request(url);
    },

    async stardustDeltas(changeName, projectRoot) {
        const url = new URL(`${API_BASE}/stardust/deltas/${encodeURIComponent(changeName)}`, window.location.origin);
        if (projectRoot) url.searchParams.append('projectRoot', projectRoot);
        return request(url);
    },

    async stardustSetValidation(changeName, status) {
        return request(`${API_BASE}/stardust/validation/${encodeURIComponent(changeName)}`, jsonOptions('PUT', { status }));
    },
};
