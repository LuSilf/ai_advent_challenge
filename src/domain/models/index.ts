export type Message = {
  id: number;
  sessionId: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type Session = {
  id: number;
  title: string | null;
  contextStrategy: string;
  parentSessionId: number | null;
  branchPointMessageId: number | null;
  createdAt: string;
  updatedAt: string;
};

export type SessionWithCount = Session & { messageCount: number };

export type Fact = {
  key: string;
  value: string;
};

export type Model = {
  id: string;
  name: string;
  inputPrice: number;
  outputPrice: number;
  contextSize: number;
};

export type ModelRole = {
  role: string;
  modelId: string;
};

export type Option = {
  key: string;
  value: string;
};

export type CostInfo = {
  cost: number;
  inputTokens: number;
  outputTokens: number;
};

export type LLMToolDefinition = {
  name: string;
  description: string;
  parameters: unknown;
};

export type LLMRequest = {
  messages: Message[];
  instructions: string;
  model: string;
  params: GenerationParams;
  tools?: LLMToolDefinition[];
};

export type LLMToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type LLMResponse = {
  content: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls?: LLMToolCall[];
};

export type Profile = {
  id: number;
  name: string;
  userName: string | null;
  language: string | null;
  style: string | null;
  format: string | null;
  restrictions: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProfilePreference = {
  key: string;
  value: string;
};

export type TaskPhase = "planning" | "execution" | "validation" | "done" | "paused" | "cancelled";

export type Task = {
  id: number;
  sessionId: number;
  title: string;
  phase: TaskPhase;
  previousPhase: TaskPhase | null;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskTransition = {
  id: number;
  taskId: number;
  fromPhase: TaskPhase | null;
  toPhase: TaskPhase;
  triggeredBy: "llm" | "system" | "user";
  createdAt: string;
};

export type McpServerConfig = {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
};

export type McpTool = {
  name: string;
  description: string;
  inputSchema: unknown;
};

export type ToolWithServer = McpTool & {
  serverName: string;
};

export type ConnectionStatus = {
  serverName: string;
  status: "connected" | "error" | "disconnected";
  error?: string;
  toolCount?: number;
};

export type ToolCall = {
  id: string;
  serverName: string;
  toolName: string;
  arguments: Record<string, unknown>;
};

export type ToolResult = {
  callId: string;
  content: string;
  isError: boolean;
};

export type GenerationParams = {
  temperature?: number;
  topP?: number;
  maxCompletionTokens?: number;
  reasoningEffort?: string;
  reasoningSummary?: string;
  stream?: boolean;
};
