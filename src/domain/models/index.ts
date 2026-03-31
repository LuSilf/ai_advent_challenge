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

export type LLMRequest = {
  messages: Message[];
  instructions: string;
  model: string;
  params: GenerationParams;
};

export type LLMResponse = {
  content: string;
  inputTokens: number;
  outputTokens: number;
};

export type GenerationParams = {
  temperature?: number;
  topP?: number;
  maxCompletionTokens?: number;
  reasoningEffort?: string;
  reasoningSummary?: string;
  stream?: boolean;
};
