export type CustomAIProtocol = "openai-responses" | "openai" | "claude";

export interface AIModelOption {
  id: string;
  label: string;
  description?: string;
}

export type AIReasoningLevel = "default" | "low" | "medium" | "high";

export interface AISettingsLike {
  enabled: boolean;
  selectedModelId: string | null;
  workspaceReasoningLevel: AIReasoningLevel;
  customProtocol: CustomAIProtocol;
  customOpenAIResponsesBaseURL: string;
  customOpenAIBaseURL: string;
  customClaudeBaseURL: string;
  customOpenAIResponsesApiKey: string;
  customOpenAIApiKey: string;
  customClaudeApiKey: string;
  customModelOptions: AIModelOption[];
}

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content?: string;
}

export type AIStreamPhase =
  | "connecting"
  | "thinking"
  | "generating"
  | "finishing";

export interface AIStreamUpdate {
  phase: AIStreamPhase;
  text: string;
  reasoningText: string;
}

export interface AIRequestOverrides {
  selectedModelId?: string | null;
  reasoningLevel?: AIReasoningLevel | null;
}

export interface RunAITextOptions {
  abortSignal?: AbortSignal;
  requestOverrides?: AIRequestOverrides;
}

export interface RunAITextStreamOptions extends RunAITextOptions {
  onUpdate?: (update: AIStreamUpdate) => void;
  streamIdleTimeoutMs?: number;
}
