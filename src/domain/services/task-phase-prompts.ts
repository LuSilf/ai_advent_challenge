import type { Task, TaskPhase } from "../models";

export type TaskUpdateMarker = {
  transition: TaskPhase | null;
  currentStep: string | null;
  expectedAction: string | null;
  summary: string | null;
};

export type TaskDetectMarker = {
  title: string;
};

const MARKER_RE = /<!--(task-update|task-detect)\n([\s\S]*?)\n-->/;

export class TaskPhasePrompts {
  static buildPhasePrompt(task: Task): string | null {
    const stepInfo = [
      task.currentStep ? `Шаг: ${task.currentStep}` : null,
      task.expectedAction ? `Ожидается: ${task.expectedAction}` : null,
    ].filter(Boolean).join("\n");

    const phasePrompts: Record<string, string> = {
      planning: `[ЗАДАЧА: "${task.title}" | ФАЗА: ПЛАНИРОВАНИЕ]
${stepInfo}

ПРАВИЛА:
1. Задавай уточняющие вопросы. НЕ пиши код.
2. Предложи план по шагам.
3. Переход к execution ТОЛЬКО когда пользователь ЯВНО подтвердил план ("да", "ок", "давай").
4. Если ты задал вопросы — НЕ переходи, жди ответы.

ОБЯЗАТЕЛЬНО добавь в конец КАЖДОГО ответа блок:
<!--task-update
{"transition": null или "execution", "currentStep": "что сейчас делаем", "expectedAction": "что ждём от пользователя", "summary": "резюме"}
-->
Используй "transition": "execution" ТОЛЬКО если пользователь подтвердил план. Иначе null.`,

      execution: `[ЗАДАЧА: "${task.title}" | ФАЗА: ВЫПОЛНЕНИЕ]
${stepInfo}

ПРАВИЛА:
1. Пиши код. Реализуй план. Давай ГОТОВУЮ реализацию, не описания.
2. Переход к validation ТОЛЬКО когда ВЕСЬ код написан и ВСЕ шаги плана реализованы.
3. Если код написан частично — НЕ переходи.
4. Если подход не работает — откат к planning.

ОБЯЗАТЕЛЬНО добавь в конец КАЖДОГО ответа блок:
<!--task-update
{"transition": null или "validation" или "planning", "currentStep": "текущий шаг", "expectedAction": "что дальше", "summary": "что сделано"}
-->
Используй "transition": "validation" ТОЛЬКО если вся реализация готова. Иначе null.`,

      validation: `[ЗАДАЧА: "${task.title}" | ФАЗА: ПРОВЕРКА]
${stepInfo}

ПРАВИЛА:
1. Проверь код: соответствует ли плану? Есть ли баги?
2. Приведи примеры вызовов и ожидаемые результаты.
3. Переход к done ТОЛЬКО когда пользователь ЯВНО подтвердил результат ("да", "ок", "всё верно").
4. Если найдены проблемы — откат к execution.

ОБЯЗАТЕЛЬНО добавь в конец КАЖДОГО ответа блок:
<!--task-update
{"transition": null или "done" или "execution", "currentStep": "что проверяем", "expectedAction": "что ждём", "summary": "результат проверки"}
-->
Используй "transition": "done" ТОЛЬКО если пользователь подтвердил. Иначе null.`,
    };

    return phasePrompts[task.phase] ?? null;
  }

  static buildAutoDetectPrompt(): string {
    return `У пользователя нет активной задачи. Если пользователь описывает задачу или просит что-то реализовать/исправить/сделать, предложи создать задачу, добавив в конец ответа блок:
<!--task-detect
{"title": "краткое название задачи"}
-->
Если это просто вопрос или беседа — не добавляй блок.`;
  }

  static parseTaskUpdate(text: string): TaskUpdateMarker | null {
    const match = text.match(MARKER_RE);
    if (!match || match[1] !== "task-update") return null;

    try {
      const data = JSON.parse(match[2]);
      return {
        transition: data.transition ?? null,
        currentStep: data.currentStep ?? null,
        expectedAction: data.expectedAction ?? null,
        summary: data.summary ?? null,
      };
    } catch {
      return null;
    }
  }

  static parseTaskDetect(text: string): TaskDetectMarker | null {
    const match = text.match(MARKER_RE);
    if (!match || match[1] !== "task-detect") return null;

    try {
      const data = JSON.parse(match[2]);
      return data.title ? { title: data.title } : null;
    } catch {
      return null;
    }
  }

  static stripTaskMarkers(text: string): string {
    return text.replace(/\n?<!--task-(update|detect)\n[\s\S]*?-->/g, "").trim();
  }
}
