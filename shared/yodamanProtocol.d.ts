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
 * public API. See docs/dead-code.md.
 */
export type TaskEventType =
  | 'task_started'
  | 'tool_start'
  | 'tool_end'
  | 'awaiting_approval'
  | 'task_cancelled'
  | 'final_answer'
  | 'error';

export type TaskStatus =
  | 'running'
  | 'cancelling'
  | 'cancelled'
  | 'awaiting_approval'
  | 'rejected'
  | 'error'
  | 'completed';

export type PluginPermission =
  | 'read'
  | 'write'
  | 'command'
  | 'network'
  | 'search'
  | 'unrestricted';

export interface YodaManTaskEvent {
  type: TaskEventType;
  taskId?: string;
  timestamp?: string;
  message?: string;
  tool?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  answer?: string;
}

export interface YodaManTask {
  taskId: string;
  task?: string;
  projectId?: string;
  status: TaskStatus;
  createdAt?: string;
  updatedAt?: string;
  pendingApproval?: unknown;
  finalAnswer?: string | null;
  error?: string | null;
  events?: YodaManTaskEvent[];
}

export const TASK_EVENT_TYPES: Record<string, TaskEventType>;
export const TASK_STATUSES: Record<string, TaskStatus>;
export const PLUGIN_PERMISSIONS: Record<string, PluginPermission>;
export function isTaskEvent(event: unknown): event is YodaManTaskEvent;
export function assertTaskEvent(event: unknown): YodaManTaskEvent;
