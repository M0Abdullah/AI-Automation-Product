import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { AppConfigService } from '../../config/app-config.service';
import {
  LlmJsonRequest,
  LlmJsonResponse,
  LlmProvider,
  LlmProviderError,
} from './llm-provider.interface';

/**
 * One provider for every OpenAI-compatible endpoint: Groq, OpenAI, Together,
 * vLLM, Ollama. Only LLM_BASE_URL changes.
 *
 * Robustness notes, learned the hard way with JSON-returning models:
 *  - Not every model supports response_format json_schema. We try it, and on a
 *    400 we retry with the looser json_object mode and the schema inlined in
 *    the prompt. Both paths return parsed JSON, so callers never care.
 *  - Some models wrap JSON in markdown fences even when told not to, so we
 *    strip fences before parsing.
 *  - Reasoning models emit a preamble; we extract the outermost JSON object.
 */
@Injectable()
export class OpenAiCompatibleProvider implements LlmProvider {
  private readonly logger = new Logger(OpenAiCompatibleProvider.name);
  private readonly client: OpenAI;

  /** Set to true once a json_schema request has been rejected by this model. */
  private jsonSchemaUnsupported = false;

  constructor(private readonly config: AppConfigService) {
    const { apiKey, baseUrl, timeoutMs } = this.config.llm;
    this.client = new OpenAI({
      apiKey,
      baseURL: baseUrl,
      timeout: timeoutMs,
      maxRetries: 2, // network / 429 / 5xx are retried by the SDK
    });
  }

  get name() {
    return `${this.config.llm.provider}:${this.config.llm.model}`;
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await this.client.models.list();
      return res.data.map((m) => m.id).sort();
    } catch (err) {
      throw this.wrap(err, 'Could not list models');
    }
  }

  async completeJson<T = unknown>(req: LlmJsonRequest): Promise<LlmJsonResponse<T>> {
    const { model } = this.config.llm;
    const started = Date.now();

    const useSchema = !this.jsonSchemaUnsupported;
    let completion: OpenAI.Chat.Completions.ChatCompletion;

    try {
      completion = await this.request(req, useSchema);
    } catch (err) {
      if (useSchema && this.looksLikeSchemaUnsupported(err)) {
        // Strict json_schema is not supported by this model - fall back once.
        this.logger.warn(
          `Model ${model} rejected response_format=json_schema. Falling back to json_object mode.`,
        );
        this.jsonSchemaUnsupported = true;
        completion = await this.request(req, false);
      } else if (this.isTokenBudgetError(err)) {
        // Providers on free tiers (Groq in particular) count the max_tokens
        // reservation against the per-minute allowance, so a generous
        // LLM_MAX_TOKENS can fail before a single token is generated.
        // Halving it once is almost always enough and beats losing the run.
        const reduced = Math.max(1024, Math.floor(this.effectiveMaxTokens(req) / 2));
        this.logger.warn(
          `Provider rejected the request as too large for its per-minute token limit. ` +
            `Retrying once with max_tokens=${reduced}. Set LLM_MAX_TOKENS=${reduced} in .env to avoid this.`,
        );
        completion = await this.request({ ...req, maxTokens: reduced }, useSchema);
      } else {
        throw this.wrap(err, 'LLM request failed');
      }
    }

    const choice = completion.choices?.[0];
    const content = choice?.message?.content ?? '';

    if (!content.trim()) {
      throw new LlmProviderError(
        `Model returned an empty response (finish_reason=${choice?.finish_reason}). ` +
          (choice?.finish_reason === 'length'
            ? 'Increase LLM_MAX_TOKENS.'
            : 'Try a different LLM_MODEL.'),
      );
    }

    let raw: T;
    try {
      raw = JSON.parse(extractJson(content)) as T;
    } catch (err) {
      throw new LlmProviderError(
        `Model did not return valid JSON. First 400 chars: ${content.slice(0, 400)}`,
        err,
      );
    }

    return {
      raw,
      model: completion.model ?? model,
      tokensIn: completion.usage?.prompt_tokens ?? 0,
      tokensOut: completion.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - started,
    };
  }

  // ------------------------------------------------------------------ internals

  private request(req: LlmJsonRequest, useJsonSchema: boolean) {
    const { model, maxTokens, temperature } = this.config.llm;

    const responseFormat: OpenAI.Chat.Completions.ChatCompletionCreateParams['response_format'] =
      useJsonSchema
        ? {
            type: 'json_schema',
            json_schema: {
              name: req.jsonSchema.name,
              strict: req.jsonSchema.strict ?? false,
              schema: req.jsonSchema.schema as Record<string, unknown>,
            },
          }
        : { type: 'json_object' };

    // In json_object mode the model has no schema, so we inline it.
    const userContent = useJsonSchema
      ? req.userPrompt
      : [
          req.userPrompt,
          '',
          'Return a single JSON object matching exactly this JSON Schema:',
          JSON.stringify(req.jsonSchema.schema),
        ].join('\n');

    return this.client.chat.completions.create({
      model,
      max_tokens: req.maxTokens ?? maxTokens,
      temperature: req.temperature ?? temperature,
      response_format: responseFormat,
      messages: [
        { role: 'system', content: req.systemPrompt },
        { role: 'user', content: userContent },
      ],
    });
  }

  private effectiveMaxTokens(req: LlmJsonRequest): number {
    return req.maxTokens ?? this.config.llm.maxTokens;
  }

  /**
   * True for "your request is bigger than my per-minute allowance".
   * Groq returns 413 for this; some gateways use 429 with a size message.
   */
  private isTokenBudgetError(err: unknown): boolean {
    const status = (err as { status?: number })?.status;
    const msg = String((err as Error)?.message ?? '').toLowerCase();
    if (status === 413) return true;
    return (
      status === 429 &&
      (msg.includes('request too large') ||
        msg.includes('tokens per minute') ||
        msg.includes('reduce your message size'))
    );
  }

  private looksLikeSchemaUnsupported(err: unknown): boolean {
    const status = (err as { status?: number })?.status;
    const msg = String((err as Error)?.message ?? '').toLowerCase();
    return (
      status === 400 &&
      (msg.includes('response_format') ||
        msg.includes('json_schema') ||
        msg.includes('not supported'))
    );
  }

  private wrap(err: unknown, prefix: string): LlmProviderError {
    const status = (err as { status?: number })?.status;
    const base = (err as Error)?.message ?? String(err);

    let hint = '';
    if (status === 401) {
      hint = ' Check LLM_API_KEY in backend/.env.';
    } else if (status === 404) {
      hint = ` Model "${this.config.llm.model}" not found. Run: npm run check:llm`;
    } else if (status === 413) {
      // Groq counts max_tokens against the tokens-per-minute allowance, so the
      // usual cause is LLM_MAX_TOKENS being larger than the whole TPM budget -
      // not an oversized prompt.
      hint =
        ` Request exceeded the provider's per-minute token allowance. LLM_MAX_TOKENS is currently` +
        ` ${this.config.llm.maxTokens}, and providers such as Groq count that reservation toward` +
        ' the limit. Lower LLM_MAX_TOKENS (try 4000), lower MAX_TEST_CASES_PER_RUN, or lower' +
        ' SCAN_MAX_ELEMENTS to shrink the prompt.';
    } else if (status === 429) {
      hint = ' Rate limited by the provider. Wait a minute, or use a smaller model.';
    } else if (status && status >= 500) {
      hint = ' Provider outage - retry later.';
    }

    return new LlmProviderError(
      `${prefix}: ${base}${hint}`,
      err,
      status === 429 || (status ?? 0) >= 500,
    );
  }
}

/**
 * Pulls the outermost JSON object out of a response that may contain markdown
 * fences or a reasoning preamble.
 */
export function extractJson(text: string): string {
  let t = text.trim();

  // Strip ```json ... ``` fences.
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) t = fence[1].trim();

  if (t.startsWith('{') && t.endsWith('}')) return t;

  // Otherwise find the first balanced {...} block.
  const start = t.indexOf('{');
  if (start === -1) return t;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return t.slice(start, i + 1);
    }
  }
  return t.slice(start);
}
