export function createYodaManClient(runtimeUrl, pairingToken) {
  const baseUrl = runtimeUrl.replace(/\/$/, '');

  async function request(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(pairingToken ? { 'X-YodaMan-Token': pairingToken } : {}),
        ...(options.headers || {})
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Request failed with ${response.status}`);
    }

    return response.json();
  }

  return {
    status() {
      return request('/api/status');
    },

    projects() {
      return request('/api/projects');
    },

    ask(question, projectId) {
      return request('/api/ask', {
        method: 'POST',
        body: JSON.stringify({ question, projectId })
      });
    },

    search(query, project) {
      const params = new URLSearchParams({ query });
      if (project) params.set('project', project);
      return request(`/api/search?${params.toString()}`);
    },

    approve(taskId, approved) {
      return request('/api/agent/approve', {
        method: 'POST',
        body: JSON.stringify({ taskId, approved })
      });
    },

    tasks() {
      return request('/api/agent/tasks');
    },

    pendingApprovals() {
      return request('/api/agent/pending-approvals');
    },

    taskEvents(taskId) {
      return request(`/api/agent/tasks/${encodeURIComponent(taskId)}/events`);
    },

    policy() {
      return request('/api/policy');
    },

    audit(limit = 25) {
      return request(`/api/audit?limit=${encodeURIComponent(limit)}`);
    },

    createPairing(runtimeUrlOverride) {
      return request('/api/pairing', {
        method: 'POST',
        body: JSON.stringify(runtimeUrlOverride ? { runtimeUrl: runtimeUrlOverride } : {})
      });
    },

    cancel(taskId) {
      return request('/api/agent/cancel', {
        method: 'POST',
        body: JSON.stringify({ taskId })
      });
    }
  };
}
