const API_BASE = '/api';

export const api = {
    async getProjects() {
        const res = await fetch(`${API_BASE}/projects`);
        return res.json();
    },

    async addProject(path) {
        const res = await fetch(`${API_BASE}/projects`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path })
        });
        return res.json();
    },

    async removeProject(path) {
        const res = await fetch(`${API_BASE}/projects`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path })
        });
        return res.json();
    },

    async reindex(path) {
        const res = await fetch(`${API_BASE}/reindex`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path })
        });
        return res.json();
    },

    async search(query, project) {
        const url = new URL(`${API_BASE}/search`, window.location.origin);
        url.searchParams.append('query', query);
        if (project) url.searchParams.append('project', project);
        const res = await fetch(url);
        return res.json();
    },

    async getPlugins() {
        const res = await fetch(`${API_BASE}/plugins`);
        return res.json();
    },

    async uploadPlugin(file) {
        const formData = new FormData();
        formData.append('plugin', file);
        const res = await fetch(`${API_BASE}/plugins`, {
            method: 'POST',
            body: formData
        });
        return res.json();
    },

    async deletePlugin(name) {
        const res = await fetch(`${API_BASE}/plugins/${encodeURIComponent(name)}`, {
            method: 'DELETE'
        });
        return res.json();
    },

    async getSessions(projectId) {

        const res = await fetch(`${API_BASE}/sessions?projectId=${encodeURIComponent(projectId)}`);
        return res.json();
    },

    async clearSessions(projectId) {
        const res = await fetch(`${API_BASE}/sessions?projectId=${encodeURIComponent(projectId)}`, {
            method: 'DELETE'
        });
        return res.json();
    },

    async ask(question, projectId) {
        const res = await fetch(`${API_BASE}/ask`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question, projectId })
        });
        return res.json();
    },

    async checkHealth(path) {
        const res = await fetch(`${API_BASE}/check?path=${encodeURIComponent(path)}`);
        return res.json();
    },

    async getStatus() {
        const res = await fetch(`${API_BASE}/status`);
        return res.json();
    },

    async getDesktopDiagnostics() {
        const res = await fetch(`${API_BASE}/desktop/diagnostics`);
        return res.json();
    },

    async createPairing(runtimeUrl) {
        const res = await fetch(`${API_BASE}/pairing`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(runtimeUrl ? { runtimeUrl } : {})
        });
        return res.json();
    },

    async getTasks() {
        const res = await fetch(`${API_BASE}/agent/tasks`);
        return res.json();
    },

    async agentTask(task, projectId, onStep) {
        const response = await fetch(`${API_BASE}/agent/task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task, projectId })
        });


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
        const res = await fetch(`${API_BASE}/agent/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId, approved })
        });
        return res.json();
    },

    async cancelAgentTask(taskId) {
        const res = await fetch(`${API_BASE}/agent/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId })
        });
        return res.json();
    }
};
