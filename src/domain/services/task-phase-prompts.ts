import type { Task, TaskPhase } from "../models";
import { TaskStateMachine } from "./task-state-machine";

export type TaskUpdateMarker = {
  transition: TaskPhase | null;
  summary: string | null;
};

export type TaskDetectMarker = {
  title: string;
};

const MARKER_RE = /<!--(task-update|task-detect)\n([\s\S]*?)\n-->/;
const SIMPLE_TRANSITION_RE = /\[TRANSITION:\s*(planning|execution|validation|done)\]/i;
const SIMPLE_SUMMARY_RE = /\[SUMMARY:\s*(.+?)\]/i;

export class TaskPhasePrompts {
  static buildPhasePrompt(task: Task): string | null {
    const allowed = TaskStateMachine.getAllowedTransitions(task.phase);
    const allowedStr = allowed.length > 0 ? allowed.join(", ") : "(нет — терминальное состояние)";

    const phasePrompts: Record<string, string> = {
      planning: `[ЗАДАЧА: "${task.title}" | ФАЗА: ПЛАНИРОВАНИЕ]

Задавай вопросы, предложи план. НЕ пиши код. Переходи к execution ТОЛЬКО если пользователь явно подтвердил план ("да", "ок", "давай").

Допустимые переходы из текущей фазы: ${allowedStr}

Граф переходов:
${TaskStateMachine.describeTransitions()}

В конце КАЖДОГО ответа ОБЯЗАТЕЛЬНО добавь блок:
<!--task-update
{"transition": null, "summary": "краткое резюме текущего состояния"}
-->
Если пользователь подтвердил план, укажи "transition": "execution".`,

      execution: `[ЗАДАЧА: "${task.title}" | ФАЗА: ВЫПОЛНЕНИЕ]

Пиши код. Реализуй план. Давай ГОТОВУЮ реализацию. Переходи к validation ТОЛЬКО когда ВЕСЬ код написан.

Допустимые переходы из текущей фазы: ${allowedStr}

Граф переходов:
${TaskStateMachine.describeTransitions()}

В конце КАЖДОГО ответа ОБЯЗАТЕЛЬНО добавь блок:
<!--task-update
{"transition": null, "summary": "краткое резюме что сделано"}
-->
Если ВСЯ реализация готова, укажи "transition": "validation".
Если нужно вернуться к планированию, укажи "transition": "planning".`,

      validation: `[ЗАДАЧА: "${task.title}" | ФАЗА: ПРОВЕРКА]

Проверь код. Приведи примеры вызовов. Переходи к done ТОЛЬКО если пользователь подтвердил результат.

Допустимые переходы из текущей фазы: ${allowedStr}

Граф переходов:
${TaskStateMachine.describeTransitions()}

В конце КАЖДОГО ответа ОБЯЗАТЕЛЬНО добавь блок:
<!--task-update
{"transition": null, "summary": "результат проверки"}
-->
Если пользователь подтвердил, укажи "transition": "done".
Если найдены баги, укажи "transition": "execution".`,
    };

    return phasePrompts[task.phase] ?? null;
  }

  static buildAutoDetectPrompt(): string {
    return `У пользователя нет активной задачи. Если пользователь описывает задачу или просит что-то реализовать/исправить/сделать, добавь в конец ответа:
<!--task-detect
{"title": "краткое название задачи"}
-->
Если это просто вопрос или беседа — не добавляй.`;
  }

  static buildInvalidTransitionMessage(task: Task, attemptedPhase: TaskPhase): string {
    const allowed = TaskStateMachine.getAllowedTransitions(task.phase);
    return `[Система] Переход ${task.phase} → ${attemptedPhase} запрещён. Допустимые переходы из ${task.phase}: ${allowed.join(", ")}.

Граф переходов:
${TaskStateMachine.describeTransitions()}

Продолжай работу в фазе ${task.phase}. Если нужен переход — используй только допустимые.`;
  }

  static parseTaskUpdate(text: string): TaskUpdateMarker | null {
    // Формат 1: JSON в HTML-комментарии <!--task-update\n{...}\n-->
    const match = text.match(MARKER_RE);
    if (match && match[1] === "task-update") {
      try {
        const data = JSON.parse(match[2]);
        return {
          transition: data.transition ?? null,
          summary: data.summary ?? null,
        };
      } catch {
        // fallthrough to simple format
      }
    }

    // Формат 2: простые текстовые маркеры [TRANSITION: ...] [SUMMARY: ...]
    const transitionMatch = text.match(SIMPLE_TRANSITION_RE);
    const summaryMatch = text.match(SIMPLE_SUMMARY_RE);

    if (transitionMatch || summaryMatch) {
      return {
        transition: transitionMatch?.[1]?.toLowerCase() as TaskPhase ?? null,
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
    const allowed = TaskStateMachine.getAllowedTransitions(task.phase);
    const phaseHint: Record<string, string> = {
      planning: `НЕ пиши код. Допустимые переходы: ${allowed.join(", ")}. Добавь <!--task-update\\n{"transition": null|"execution", "summary": "..."}\\n-->`,
      execution: `Пиши код. Допустимые переходы: ${allowed.join(", ")}. Добавь <!--task-update\\n{"transition": null|"validation"|"planning", "summary": "..."}\\n-->`,
      validation: `Проверяй. Допустимые переходы: ${allowed.join(", ")}. Добавь <!--task-update\\n{"transition": null|"done"|"execution", "summary": "..."}\\n-->`,
    };
    return `[Система: задача "${task.title}", фаза: ${task.phase}. ${phaseHint[task.phase] ?? ""}]`;
  }

  static stripTaskMarkers(text: string): string {
    return text
      .replace(/\n?<!--task-(update|detect)\n[\s\S]*?-->/g, "")
      .replace(/\[TRANSITION:\s*(?:planning|execution|validation|done)\]/gi, "")
      .replace(/\[SUMMARY:\s*.+?\]/gi, "")
      .replace(/\[TASK-DETECT:\s*.+?\]/gi, "")
      .trim();
  }
}
