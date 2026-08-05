/**
 * LOAD-BEARING — GENERATED FILE. DO NOT EDIT, AND DO NOT DELETE.
 *
 * Produced by scripts/generate-protocol.js from shared/protocol.schema.json
 * (npm run generate:protocol). Hand edits are silently overwritten on the next
 * run, and tests/infrastructure/Protocol.test.js fails if this file drifts from
 * what the generator produces.
 *
 * It is also part of the published package (package.json "files") and is
 * required by shared/yodamanClient.js, so exports that look unused in-repo are
 */
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
