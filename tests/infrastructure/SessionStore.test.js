const sessionStore = require('../../backend/infrastructure/SessionStore');

describe('SessionStore', () => {
    const testProjectId = 'test-project-id';
    
    beforeEach(() => {
        sessionStore.clearSession(testProjectId);
    });

    test('should save and retrieve messages', () => {
        const message = { role: 'user', content: 'Hello', timestamp: new Date() };
        sessionStore.saveMessage(testProjectId, message);
        
        const history = sessionStore.getMessages(testProjectId);
        expect(history.length).toBe(1);
        expect(history[0].content).toBe('Hello');
    });

    test('should persist steps for agent messages', () => {
        const agentMessage = { 
            role: 'ai', 
            content: 'Done', 
            isAgent: true, 
            steps: [{ type: 'tool', tool: 'test' }] 
        };
        sessionStore.saveMessage(testProjectId, agentMessage);
        
        const history = sessionStore.getMessages(testProjectId);
        expect(history[0].steps.length).toBe(1);
        expect(history[0].steps[0].tool).toBe('test');
    });

    test('should clear history for a project', () => {
        sessionStore.saveMessage(testProjectId, { content: 'one' });
        sessionStore.clearSession(testProjectId);
        expect(sessionStore.getMessages(testProjectId).length).toBe(0);
    });
});
