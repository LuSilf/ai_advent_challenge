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
    const phasePrompts: Record<string, string> = {
      planning: `Ты на этапе ПЛАНИРОВАНИЯ задачи: "${task.title}".
${task.currentStep ? `Текущий шаг: ${task.currentStep}` : ""}
${task.expectedAction ? `Ожидаемое действие: ${task.expectedAction}` : ""}

Твои обязанности на этом этапе:
- Задавай уточняющие вопросы, пока не будет полной ясности
- Предложи план реализации по шагам
- НЕ пиши код и НЕ реализуй ничего на этом этапе
- Когда план согласован с пользователем — переходи к execution

Когда готов перейти к следующему этапу или нужно обновить шаг, добавь в конец ответа блок:
<!--task-update
{"transition": "execution"|null, "currentStep": "новый шаг", "expectedAction": "что дальше", "summary": "краткое резюме"}
-->`,

      execution: `Ты на этапе ВЫПОЛНЕНИЯ задачи: "${task.title}".
${task.currentStep ? `Текущий шаг: ${task.currentStep}` : ""}
${task.expectedAction ? `Ожидаемое действие: ${task.expectedAction}` : ""}

Твои обязанности на этом этапе:
- Следуй согласованному плану
- Реализуй текущий шаг
- Если подход не работает — можешь вернуться к planning
- Когда реализация завершена — переходи к validation

Когда готов перейти к следующему этапу или нужно обновить шаг, добавь в конец ответа блок:
<!--task-update
{"transition": "validation"|"planning"|null, "currentStep": "новый шаг", "expectedAction": "что дальше", "summary": "краткое резюме"}
-->`,

      validation: `Ты на этапе ПРОВЕРКИ задачи: "${task.title}".
${task.currentStep ? `Текущий шаг: ${task.currentStep}` : ""}
${task.expectedAction ? `Ожидаемое действие: ${task.expectedAction}` : ""}

Твои обязанности на этом этапе:
- Проверь результат: соответствует ли он плану?
- Выяви проблемы, баги, несоответствия
- Если есть проблемы — вернись к execution с описанием что исправить
- Если всё хорошо — переходи к done

Когда готов перейти к следующему этапу или нужно обновить шаг, добавь в конец ответа блок:
<!--task-update
{"transition": "done"|"execution"|null, "currentStep": "новый шаг", "expectedAction": "что дальше", "summary": "краткое резюме"}
-->`,
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
