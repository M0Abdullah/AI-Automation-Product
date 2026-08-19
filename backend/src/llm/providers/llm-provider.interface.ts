/**
 * Provider abstraction.
 *
 * Everything above this line in the stack knows only "give me JSON matching
 * this schema". Swapping Groq for OpenAI, Anthropic or a self-hosted model
 * means adding one file in this folder - no other code changes.
 */

export interface JsonSchemaSpec {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

export interface LlmJsonRequest {
  systemPrompt: string;
  userPrompt: string;
  jsonSchema: JsonSchemaSpec;
  /** Overrides the configured default when a call needs a different budget. */
  maxTokens?: number;
  temperature?: number;
}

export interface LlmJsonResponse<T = unknown> {
  /** Parsed JSON object as returned by the model. Not yet validated by zod. */
  raw: T;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

export interface LlmProvider {
  readonly name: string;
  /** Returns parsed JSON. Throws LlmProviderError on transport/parse failure. */
  completeJson<T = unknown>(req: LlmJsonRequest): Promise<LlmJsonResponse<T>>;
  /** Lists model ids the configured key can use. Used by `npm run check:llm`. */
  listModels(): Promise<string[]>;
}

export class LlmProviderError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'LlmProviderError';
  }
}
