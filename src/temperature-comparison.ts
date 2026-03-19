import OpenAI from "openai";

import { loadConfig } from "./config";
import { buildResponseRequest } from "./request";

const TEMPERATURES = [0, 0.5, 1, 1.5, 2];
const RUNS_PER_TEMP = 1;

const SYSTEM_PROMPT = `You are a professional literary translator. Translate the following Russian song lyrics into English. Preserve the poetic structure, rhyme scheme, and emotional tone as closely as possible. Output only the translation, no commentary.`;

const USER_PROMPT = `Проклятый старый дом — Король и Шут

В заросшем парке
Стоит старинный дом.
Забиты окна,
И мрак царит извечно в нем.
Сказать я пытался:
"Чудовищ нет на земле".
Но тут же раздался
Ужасный голос во мгле.
Голос во мгле...

Припев:

"Мне больно видеть белый свет,
Мне лучше в полной темноте.
Я очень много-много лет
Мечтаю только о еде.
Мне слишком тесно взаперти,
И я мечтаю об одном —
Скорей свободу обрести,
Прогрызть свой ветхий старый дом.
Проклятый старый дом!.."

Был дед да помер.
Слепой и жутко злой.
Никто не вспомнил
О нем с зимы холодной той.
Соседи не стали
Его тогда хоронить.
Лишь доски достали,
Решили заколотить
Дверь и окна...

(Припев)

И это место стороной
Обходит сельский люд.
И суеверные твердят:
"Там призраки живут".`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function divider(): void {
  console.log("=".repeat(70));
}

function header(title: string): void {
  console.log();
  divider();
  console.log(`  ${title}`);
  divider();
}

const baseConfig = loadConfig(USER_PROMPT, fail);

const client = new OpenAI({
  apiKey: baseConfig.apiKey,
  baseURL: baseConfig.baseUrl,
  timeout: baseConfig.effectiveTimeoutMs,
  maxRetries: 0,
});

for (const temp of TEMPERATURES) {
  header(`TEMPERATURE = ${temp}`);

  for (let run = 1; run <= RUNS_PER_TEMP; run++) {
    console.log(`\n--- Run ${run} / ${RUNS_PER_TEMP} (temperature=${temp}) ---\n`);

    const config = {
      ...baseConfig,
      systemPrompt: SYSTEM_PROMPT,
      temperature: temp,
      maxCompletionTokens: 1024,
      useStreaming: false,
    };

    const request = buildResponseRequest(config);
    const response = await client.responses.create({ ...request, stream: false });

    const content = response.output_text;
    if (!content) {
      fail("No text content in response");
    }

    console.log(content);
  }
}

header("DONE");
