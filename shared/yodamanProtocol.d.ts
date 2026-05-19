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
