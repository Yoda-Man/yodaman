import type { YodaManTask, YodaManTaskEvent } from './yodamanProtocol';

export interface YodaManClient {
  status(): Promise<unknown>;
  diagnostics(): Promise<unknown>;
  projects(): Promise<unknown[]>;
  ask(question: string, projectId?: string): Promise<{ answer?: string } & Record<string, unknown>>;
  search(query: string, project?: string, top?: number): Promise<unknown>;
  reindex(path: string): Promise<unknown>;
  approve(taskId: string, approved: boolean): Promise<unknown>;
  cancel(taskId: string): Promise<unknown>;
  tasks(): Promise<YodaManTask[]>;
  pendingApprovals(): Promise<unknown[]>;
  taskEvents(taskId: string): Promise<YodaManTaskEvent[]>;
  policy(): Promise<unknown>;
  audit(limit?: number): Promise<unknown[]>;
  createPairing(runtimeUrlOverride?: string): Promise<unknown>;
  runAgentTask(task: string, projectId: string | undefined, onEvent: (event: YodaManTaskEvent) => void | Promise<void>): Promise<void>;
}

export function createYodaManClient(runtimeUrl: string, options?: { pairingToken?: string }): YodaManClient;
export function readEventStream(response: Response, onEvent: (event: YodaManTaskEvent) => void | Promise<void>): Promise<void>;
export function requestJson(runtimeUrl: string, path: string, options?: RequestInit & { pairingToken?: string }): Promise<unknown>;
