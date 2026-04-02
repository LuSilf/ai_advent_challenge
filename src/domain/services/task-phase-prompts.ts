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

УСЛОВИЯ ПЕРЕХОДА к execution (ВСЕ должны быть выполнены):
1. Ты задал все уточняющие вопросы И получил на них ответы от пользователя
2. Ты предложил план И пользователь его ЯВНО подтвердил (сказал "да", "ок", "согласен", "давай" и т.п.)
3. НЕ переходи к execution если ты только что задал вопросы — жди ответа
4. НЕ переходи к execution если пользователь не подтвердил план

Если условия перехода выполнены, добавь в конец ответа РОВНО ОДИН блок:
<!--task-update
{"transition": "execution", "currentStep": "описание первого шага", "expectedAction": "что нужно сделать", "summary": "краткое резюме согласованного плана"}
-->

Если условия НЕ выполнены, но нужно обновить шаг/резюме, используй transition: null:
<!--task-update
{"transition": null, "currentStep": "текущий шаг", "expectedAction": "что ожидаем от пользователя", "summary": "резюме текущего состояния"}
-->`,

      execution: `Ты на этапе ВЫПОЛНЕНИЯ задачи: "${task.title}".
${task.currentStep ? `Текущий шаг: ${task.currentStep}` : ""}
${task.expectedAction ? `Ожидаемое действие: ${task.expectedAction}` : ""}

Твои обязанности на этом этапе:
- Следуй согласованному плану
- Реализуй текущий шаг: пиши код, давай конкретную реализацию
- Если подход не работает — можешь вернуться к planning

УСЛОВИЯ ПЕРЕХОДА к validation (ВСЕ должны быть выполнены):
1. Ты НАПИСАЛ весь код, который был запланирован — не просто описал, а дал готовую реализацию
2. Все шаги плана реализованы
3. НЕ переходи к validation если ты только описал что нужно сделать, но не написал код
4. НЕ переходи к validation если реализация частичная

УСЛОВИЕ ОТКАТА к planning:
- Подход не работает, нужно переосмыслить план

Если условия перехода выполнены, добавь в конец ответа блок:
<!--task-update
{"transition": "validation", "currentStep": "проверка реализации", "expectedAction": "проверить код", "summary": "краткое резюме что реализовано"}
-->

Если нужно обновить шаг без перехода:
<!--task-update
{"transition": null, "currentStep": "текущий шаг", "expectedAction": "что делаем дальше", "summary": "резюме прогресса"}
-->`,

      validation: `Ты на этапе ПРОВЕРКИ задачи: "${task.title}".
${task.currentStep ? `Текущий шаг: ${task.currentStep}` : ""}
${task.expectedAction ? `Ожидаемое действие: ${task.expectedAction}` : ""}

Твои обязанности на этом этапе:
- Проверь результат: соответствует ли он плану?
- Выяви проблемы, баги, несоответствия
- Приведи конкретные примеры проверки (вызовы функции, ожидаемые результаты)

УСЛОВИЯ ПЕРЕХОДА к done (ВСЕ должны быть выполнены):
1. Код проверен и работает корректно
2. Пользователь ЯВНО подтвердил что результат его устраивает
3. НЕ переходи к done если пользователь не подтвердил результат

УСЛОВИЕ ОТКАТА к execution:
- Найдены баги, проблемы, несоответствия плану — нужно исправить

Если условия перехода к done выполнены:
<!--task-update
{"transition": "done", "currentStep": "задача завершена", "expectedAction": null, "summary": "итоговое резюме выполненной работы"}
-->

Если нужен откат к execution:
<!--task-update
{"transition": "execution", "currentStep": "описание что исправить", "expectedAction": "исправить проблему", "summary": "что найдено при проверке"}
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
