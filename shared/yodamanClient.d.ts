import type { YodaManTask, YodaManTaskEvent } from './yodamanProtocol';

export interface YodaManClient {
  status(): Promise<unknown>;
  diagnostics(): Promise<unknown>;
  projects(): Promise<unknown[]>;
  addProject(path: string): Promise<unknown>;
  removeProject(path: string): Promise<unknown>;
  updateProjectPath(path: string, nextPath: string): Promise<unknown>;
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
  graphifyStatus(path: string): Promise<unknown>;
  graphifyBuild(path: string): Promise<unknown>;
  graphifyQuery(path: string, query: string): Promise<unknown>;
  graphifyExplain(path: string, node: string): Promise<unknown>;
  graphifyPath(path: string, source: string, target: string): Promise<unknown>;
  graphifyAffected(path: string, node: string, depth?: number, relations?: string[]): Promise<unknown>;
  graphifyMap(path: string, limit?: number): Promise<unknown>;
  createPairing(runtimeUrlOverride?: string): Promise<unknown>;
  runAgentTask(task: string, projectId: string | undefined, onEvent: (event: YodaManTaskEvent) => void | Promise<void>): Promise<void>;
}

export function createYodaManClient(runtimeUrl: string, options?: { pairingToken?: string }): YodaManClient;
export function readEventStream(response: Response, onEvent: (event: YodaManTaskEvent) => void | Promise<void>): Promise<void>;
export function requestJson(runtimeUrl: string, path: string, options?: RequestInit & { pairingToken?: string }): Promise<unknown>;
