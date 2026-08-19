import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import type { PageSnapshot } from '../browser/browser.types';
import type { CheckDefinition } from '../common/check-catalog';
import type { TestCasePlan } from '../common/test-plan.types';
import {
  LLM_PROVIDER,
  LlmProvider,
  LlmProviderError,
} from './providers/llm-provider.interface';
import {
  TEST_PLAN_JSON_SCHEMA,
  TestPlanResponse,
  testPlanSchema,
} from './schemas/test-plan.schema';
import { TRIAGE_JSON_SCHEMA, TriageResponse, triageSchema } from './schemas/triage.schema';
import {
  TEST_PLAN_SYSTEM_PROMPT,
  buildRepairPrompt,
  buildTestPlanUserPrompt,
} from './prompts/test-plan.prompt';
import {
  TRIAGE_SYSTEM_PROMPT,
  TriagePromptInput,
  buildTriageUserPrompt,
} from './prompts/triage.prompt';

export interface GeneratedPlan {
  cases: TestCasePlan[];
  untestable: TestPlanResponse['untestable'];
  questions: string[];
  meta: { model: string; tokensIn: number; tokensOut: number; latencyMs: number };
}

/**
 * The only place in the codebase that talks to a model.
 *
 * Responsibilities:
 *  - build the prompt
 *  - call the provider
 *  - validate the response against zod
 *  - hand back typed data
 *
 * It does NOT decide anything. Policy checks happen in PolicyService and
 * PASS/FAIL is decided by Playwright assertions.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider,
    private readonly config: AppConfigService,
  ) {}

  /** LLM call #1: requirements + page scan -> structured test cases. */
  async generateTestPlan(args: {
    requirements: string;
    snapshot: PageSnapshot;
    hasCredentials: boolean;
    checks: CheckDefinition[];
  }): Promise<GeneratedPlan> {
    const maxCases = this.config.policy.maxTestCasesPerRun;
    const userPrompt = buildTestPlanUserPrompt({ ...args, maxCases });

    const first = await this.provider.completeJson({
      systemPrompt: TEST_PLAN_SYSTEM_PROMPT,
      userPrompt,
      jsonSchema: TEST_PLAN_JSON_SCHEMA as never,
    });

    let parsed = testPlanSchema.safeParse(first.raw);
    let tokensIn = first.tokensIn;
    let tokensOut = first.tokensOut;
    let latencyMs = first.latencyMs;
    let model = first.model;

    // ------------------------------------------------------- self-repair pass
    // Smaller models frequently nail the outer shape and get one nested field
    // wrong. Handing back the exact validation errors fixes most of those, and
    // is far cheaper than losing the run and regenerating from scratch.
    if (!parsed.success) {
      const issues = describeIssues(parsed.error.issues);
      this.logger.warn(`Test plan failed validation, asking the model to repair: ${issues.join('; ')}`);

      const repaired = await this.provider.completeJson({
        systemPrompt: TEST_PLAN_SYSTEM_PROMPT,
        userPrompt: buildRepairPrompt({
          originalUserPrompt: userPrompt,
          invalidOutput: first.raw,
          issues,
        }),
        jsonSchema: TEST_PLAN_JSON_SCHEMA as never,
      });

      parsed = testPlanSchema.safeParse(repaired.raw);
      tokensIn += repaired.tokensIn;
      tokensOut += repaired.tokensOut;
      latencyMs += repaired.latencyMs;
      model = repaired.model;

      if (!parsed.success) {
        throw new LlmProviderError(
          'The model returned JSON that does not match the required test-plan shape, ' +
            `even after one repair attempt. ${describeIssues(parsed.error.issues).join('; ')}. ` +
            'Try a different LLM_MODEL, or lower MAX_TEST_CASES_PER_RUN.',
        );
      }
      this.logger.log('Repair pass succeeded.');
    }

    this.logger.log(
      `Test plan generated: ${parsed.data.testCases.length} case(s), ` +
        `${tokensIn}+${tokensOut} tokens, ${latencyMs}ms`,
    );

    return {
      cases: parsed.data.testCases as TestCasePlan[],
      untestable: parsed.data.untestable,
      questions: parsed.data.questions,
      meta: { model, tokensIn, tokensOut, latencyMs },
    };
  }

  /**
   * LLM call #2: failure evidence -> suggested classification.
   *
   * Never throws into the caller's critical path: if triage fails, the finding
   * is still created, just without an AI suggestion. A failed AI call must
   * never lose a test result.
   */
  async triageFailure(input: TriagePromptInput): Promise<TriageResponse | null> {
    try {
      const res = await this.provider.completeJson({
        systemPrompt: TRIAGE_SYSTEM_PROMPT,
        userPrompt: buildTriageUserPrompt(input),
        jsonSchema: TRIAGE_JSON_SCHEMA as never,
        maxTokens: 2000,
      });

      const parsed = triageSchema.safeParse(res.raw);
      if (!parsed.success) {
        this.logger.warn(`Triage response failed validation: ${parsed.error.issues[0]?.message}`);
        return null;
      }
      return parsed.data;
    } catch (err) {
      this.logger.warn(`Triage call failed (finding will have no AI suggestion): ${String(err)}`);
      return null;
    }
  }

  listModels() {
    return this.provider.listModels();
  }

  get providerName() {
    return this.provider.name;
  }
}

/**
 * Turns zod issues into short lines a model can act on.
 * "testCases.0.steps.1: Expected object, received string" is far more useful to
 * the model than a stack trace, and it is what the repair prompt sends back.
 */
function describeIssues(issues: ReadonlyArray<{ path: (string | number)[]; message: string }>) {
  return issues.slice(0, 10).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}
