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

    async ask(question) {
        const res = await fetch(`${API_BASE}/ask`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question })
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
    }
};
