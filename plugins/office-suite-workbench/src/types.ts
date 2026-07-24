export type ViewId = "home" | "word" | "excel" | "powerpoint" | "console" | "mcp";
export type OfficeFormat = "word" | "excel" | "powerpoint";

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

export interface OfficeCliStatus {
  installed: boolean;
  binaryPath?: string;
  version?: string;
}

export interface OfficeCliRunOutput {
  command?: string;
  args?: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  json?: unknown;
  durationMs?: number;
}

export interface McpProbe {
  serverInfo?: { name?: string; version?: string };
  protocolVersion?: string;
  toolNames?: string[];
}

export interface McpConfigurations {
  binaryPath?: string;
  configs: Record<string, unknown>;
}

export interface OfficeSuiteApi {
  getStatus(): Promise<ApiResult<OfficeCliStatus>>;
  run(
    command: string | string[],
    options?: { timeoutMs?: number }
  ): Promise<ApiResult<OfficeCliRunOutput>>;
  getMcpStatus(): Promise<ApiResult<unknown>>;
  registerMcp(
    target: "lms" | "claude" | "cursor" | "vscode"
  ): Promise<ApiResult<unknown>>;
  unregisterMcp(
    target: "lms" | "claude" | "cursor" | "vscode"
  ): Promise<ApiResult<unknown>>;
  probeMcp(): Promise<ApiResult<McpProbe>>;
  getMcpConfigs(): Promise<ApiResult<McpConfigurations>>;
}

export interface ZToolsApi {
  onPluginEnter?(callback: (payload: unknown) => void): void;
  showOpenDialog?(options: Record<string, unknown>): Promise<unknown> | unknown;
  showSaveDialog?(options: Record<string, unknown>): Promise<unknown> | unknown;
  copyText?(text: string): void;
  shellOpenExternal?(url: string): Promise<unknown> | unknown;
  shellOpenPath?(path: string): Promise<unknown> | unknown;
}

declare global {
  interface Window {
    officeSuite?: OfficeSuiteApi;
    ztools?: ZToolsApi;
  }
}
