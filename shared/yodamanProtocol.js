const TASK_EVENT_TYPES = Object.freeze({
    TASK_STARTED: 'task_started',
    TOOL_START: 'tool_start',
    TOOL_END: 'tool_end',
    AWAITING_APPROVAL: 'awaiting_approval',
    TASK_CANCELLED: 'task_cancelled',
    FINAL_ANSWER: 'final_answer',
    ERROR: 'error'
});

const TASK_STATUSES = Object.freeze({
    RUNNING: 'running',
    CANCELLING: 'cancelling',
    CANCELLED: 'cancelled',
    AWAITING_APPROVAL: 'awaiting_approval',
    REJECTED: 'rejected',
    ERROR: 'error',
    COMPLETED: 'completed'
});

const PLUGIN_PERMISSIONS = Object.freeze({
    READ: 'read',
    WRITE: 'write',
    COMMAND: 'command',
    NETWORK: 'network',
    SEARCH: 'search',
    UNRESTRICTED: 'unrestricted'
});

function isTaskEvent(event) {
    return Boolean(
        event &&
        typeof event === 'object' &&
        typeof event.type === 'string' &&
        Object.values(TASK_EVENT_TYPES).includes(event.type)
    );
}

function assertTaskEvent(event) {
    if (!isTaskEvent(event)) {
        throw new Error(`Unsupported YodaMan task event: ${JSON.stringify(event)}`);
    }
    return event;
}

module.exports = {
    TASK_EVENT_TYPES,
    TASK_STATUSES,
    PLUGIN_PERMISSIONS,
    assertTaskEvent,
    isTaskEvent
};
