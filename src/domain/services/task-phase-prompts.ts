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
const SIMPLE_TRANSITION_RE = /\[TRANSITION:\s*(planning|execution|validation|done)\]/i;
const SIMPLE_STEP_RE = /\[STEP:\s*(.+?)\]/i;
const SIMPLE_SUMMARY_RE = /\[SUMMARY:\s*(.+?)\]/i;

export class TaskPhasePrompts {
  static buildPhasePrompt(task: Task): string | null {
    const stepInfo = [
      task.currentStep ? `Шаг: ${task.currentStep}` : null,
      task.expectedAction ? `Ожидается: ${task.expectedAction}` : null,
    ].filter(Boolean).join("\n");

    const phasePrompts: Record<string, string> = {
      planning: `[ЗАДАЧА: "${task.title}" | ФАЗА: ПЛАНИРОВАНИЕ]
${stepInfo}

Задавай вопросы, предложи план. НЕ пиши код. Переходи к execution ТОЛЬКО если пользователь явно подтвердил план ("да", "ок", "давай").

В конце КАЖДОГО ответа ОБЯЗАТЕЛЬНО добавь строку:
[SUMMARY: краткое резюме текущего состояния]
Если пользователь подтвердил план, ТАКЖЕ добавь:
[TRANSITION: execution]`,

      execution: `[ЗАДАЧА: "${task.title}" | ФАЗА: ВЫПОЛНЕНИЕ]
${stepInfo}

Пиши код. Реализуй план. Давай ГОТОВУЮ реализацию. Переходи к validation ТОЛЬКО когда ВЕСЬ код написан.

В конце КАЖДОГО ответа ОБЯЗАТЕЛЬНО добавь строку:
[SUMMARY: краткое резюме что сделано]
[STEP: текущий шаг]
Если ВСЯ реализация готова, ТАКЖЕ добавь:
[TRANSITION: validation]`,

      validation: `[ЗАДАЧА: "${task.title}" | ФАЗА: ПРОВЕРКА]
${stepInfo}

Проверь код. Приведи примеры вызовов. Переходи к done ТОЛЬКО если пользователь подтвердил результат.

В конце КАЖДОГО ответа ОБЯЗАТЕЛЬНО добавь строку:
[SUMMARY: результат проверки]
Если пользователь подтвердил, ТАКЖЕ добавь:
[TRANSITION: done]
Если найдены баги:
[TRANSITION: execution]`,
    };

    return phasePrompts[task.phase] ?? null;
  }

  static buildAutoDetectPrompt(): string {
    return `У пользователя нет активной задачи. Если пользователь описывает задачу или просит что-то реализовать/исправить/сделать, добавь в конец ответа:
[TASK-DETECT: краткое название задачи]
Если это просто вопрос или беседа — не добавляй.`;
  }

  static parseTaskUpdate(text: string): TaskUpdateMarker | null {
    // Формат 1: JSON в HTML-комментарии <!--task-update\n{...}\n-->
    const match = text.match(MARKER_RE);
    if (match && match[1] === "task-update") {
      try {
        const data = JSON.parse(match[2]);
        return {
          transition: data.transition ?? null,
          currentStep: data.currentStep ?? null,
          expectedAction: data.expectedAction ?? null,
          summary: data.summary ?? null,
        };
      } catch {
        // fallthrough to simple format
      }
    }

    // Формат 2: простые текстовые маркеры [TRANSITION: ...] [STEP: ...] [SUMMARY: ...]
    const transitionMatch = text.match(SIMPLE_TRANSITION_RE);
    const stepMatch = text.match(SIMPLE_STEP_RE);
    const summaryMatch = text.match(SIMPLE_SUMMARY_RE);

    if (transitionMatch || stepMatch || summaryMatch) {
      return {
        transition: transitionMatch?.[1]?.toLowerCase() as TaskPhase ?? null,
        currentStep: stepMatch?.[1] ?? null,
        expectedAction: null,
        summary: summaryMatch?.[1] ?? null,
      };
    }

    return null;
  }

  static parseTaskDetect(text: string): TaskDetectMarker | null {
    // Формат 1: JSON <!--task-detect\n{...}\n-->
    const match = text.match(MARKER_RE);
    if (match && match[1] === "task-detect") {
      try {
        const data = JSON.parse(match[2]);
        return data.title ? { title: data.title } : null;
      } catch { /* fallthrough */ }
    }

    // Формат 2: [TASK-DETECT: название]
    const simple = text.match(/\[TASK-DETECT:\s*(.+?)\]/i);
    if (simple) {
      return { title: simple[1].trim() };
    }

    return null;
  }

  static buildTaskReminder(task: Task): string {
    const phaseHint: Record<string, string> = {
      planning: "НЕ пиши код. В конце ответа ОБЯЗАТЕЛЬНО напиши [SUMMARY: ...]. Если я подтвердил план — также [TRANSITION: execution].",
      execution: "Пиши код. В конце ответа ОБЯЗАТЕЛЬНО напиши [SUMMARY: ...] и [STEP: ...]. Если всё готово — также [TRANSITION: validation].",
      validation: "Проверяй. В конце ответа ОБЯЗАТЕЛЬНО напиши [SUMMARY: ...]. Если я подтвердил — также [TRANSITION: done].",
    };
    return `[Система: задача "${task.title}", фаза: ${task.phase}. ${phaseHint[task.phase] ?? ""}]`;
  }

  /**
   * Промпт для отдельного LLM-вызова — "судья" определяет состояние задачи
   * по последнему обмену сообщениями.
   */
  static buildJudgePrompt(task: Task, userMessage: string, assistantResponse: string): string {
    return `Ты судья задачи. Проанализируй диалог и определи текущее состояние задачи.

Задача: "${task.title}"
Текущая фаза: ${task.phase}

Допустимые переходы:
- planning → execution (план подтверждён пользователем)
- execution → validation (код полностью написан)
- execution → planning (нужно переосмыслить подход)
- validation → done (пользователь подтвердил результат)
- validation → execution (найдены баги или нужны изменения)

Последнее сообщение пользователя:
${userMessage}

Ответ ассистента:
${assistantResponse.slice(0, 500)}

Ответь СТРОГО в формате (одна строка, ничего больше):
PHASE: ${task.phase} | STEP: описание шага | SUMMARY: краткое резюме

Если нужен переход фазы, замени ${task.phase} на новую фазу.
Если переход НЕ нужен, оставь текущую фазу.`;
  }

  /**
   * Парсит ответ судьи.
   */
  static parseJudgeResponse(text: string): TaskUpdateMarker | null {
    const match = text.match(/PHASE:\s*(planning|execution|validation|done)\s*\|\s*STEP:\s*(.+?)\s*\|\s*SUMMARY:\s*(.+)/i);
    if (!match) return null;

    return {
      transition: match[1].toLowerCase() as TaskPhase,
      currentStep: match[2].trim(),
      expectedAction: null,
      summary: match[3].trim(),
    };
  }

  static stripTaskMarkers(text: string): string {
    return text
      .replace(/\n?<!--task-(update|detect)\n[\s\S]*?-->/g, "")
      .replace(/\[TRANSITION:\s*(?:planning|execution|validation|done)\]/gi, "")
      .replace(/\[STEP:\s*.+?\]/gi, "")
      .replace(/\[SUMMARY:\s*.+?\]/gi, "")
      .replace(/\[TASK-DETECT:\s*.+?\]/gi, "")
      .trim();
  }
}
