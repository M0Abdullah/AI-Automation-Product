/**
 * Verifies the LLM key works and prints the exact model ids you can use.
 *
 *   npm run check:llm
 *
 * Run this FIRST if a run fails at the planning stage. It separates "my key is
 * wrong" from "my model id is wrong" from "my prompt is wrong".
 */
import 'dotenv/config';
import OpenAI from 'openai';

async function main() {
  const apiKey = process.env.LLM_API_KEY;
  const baseURL = process.env.LLM_BASE_URL ?? 'https://api.groq.com/openai/v1';
  const model = process.env.LLM_MODEL ?? 'openai/gpt-oss-120b';

  if (!apiKey) {
    console.error('LLM_API_KEY is not set. Copy .env.example to .env and add your key.');
    process.exit(1);
  }

  console.log(`Provider : ${process.env.LLM_PROVIDER ?? 'groq'}`);
  console.log(`Base URL : ${baseURL}`);
  console.log(`Model    : ${model}`);
  console.log(`Key      : ${apiKey.slice(0, 7)}...${apiKey.slice(-4)}\n`);

  const client = new OpenAI({ apiKey, baseURL, timeout: 60000 });

  // 1. Can we authenticate at all?
  console.log('1) Listing models...');
  try {
    const list = await client.models.list();
    const ids = list.data.map((m) => m.id).sort();
    console.log(`   OK - ${ids.length} model(s) available:\n`);
    for (const id of ids) console.log(`     ${id === model ? '->' : '  '} ${id}`);
    if (!ids.includes(model)) {
      console.warn(
        `\n   WARNING: LLM_MODEL="${model}" is not in the list above. Copy one of those ids into .env.`,
      );
    }
  } catch (err) {
    console.error(`   FAILED: ${(err as Error).message}`);
    console.error('   401 => wrong key.  403 => key disabled.  network => check connectivity.');
    process.exit(1);
  }

  // 2. Can the model return structured JSON? This is the capability the whole
  //    product depends on, so test it explicitly rather than assuming.
  console.log('\n2) Asking for structured JSON...');
  try {
    const res = await client.chat.completions.create({
      model,
      max_tokens: 300,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Return JSON only.' },
        {
          role: 'user',
          content:
            'Return {"ok": true, "steps": [{"action":"fill","target":"Email"}]} exactly, as JSON.',
        },
      ],
    });
    const content = res.choices[0]?.message?.content ?? '';
    console.log(`   Raw: ${content.trim().slice(0, 200)}`);
    JSON.parse(content);
    console.log('   OK - valid JSON parsed.');
    console.log(
      `   Tokens: ${res.usage?.prompt_tokens ?? '?'} in / ${res.usage?.completion_tokens ?? '?'} out`,
    );
  } catch (err) {
    console.error(`   FAILED: ${(err as Error).message}`);
    console.error('   Try a different LLM_MODEL - not every model supports JSON mode.');
    process.exit(1);
  }

  console.log('\nLLM is ready.');
}

void main();
