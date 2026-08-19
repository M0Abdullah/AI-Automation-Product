import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { LLM_PROVIDER } from './providers/llm-provider.interface';
import { OpenAiCompatibleProvider } from './providers/openai-compatible.provider';
import { AppConfigService } from '../config/app-config.service';

/**
 * The provider is chosen here, once, from LLM_PROVIDER.
 *
 * groq and openai both speak the OpenAI protocol, so they share one class.
 * To add Anthropic later: write AnthropicProvider implementing LlmProvider and
 * add a case in this factory. Nothing else changes.
 */
@Module({
  providers: [
    {
      provide: LLM_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        switch (config.llm.provider) {
          case 'groq':
          case 'openai':
            return new OpenAiCompatibleProvider(config);
          default:
            throw new Error(`Unsupported LLM_PROVIDER: ${config.llm.provider}`);
        }
      },
    },
    LlmService,
  ],
  exports: [LlmService],
})
export class LlmModule {}
