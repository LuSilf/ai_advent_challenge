import { describe, test, expect } from "bun:test";
import { detectRefusal, type RefusalQuestion } from "./refusal-detector";

const Q11: RefusalQuestion = {
  id: "q11_oos",
  topicalTerms: ["борщ", "рецепт", "свёкл", "свекл", "ингредиент", "варить", "бульон", "кастрюл", "мясо", "капуст"],
};

const Q12: RefusalQuestion = {
  id: "q12_oos",
  topicalTerms: ["мадагаскар", "антананариву", "столиц", "madagascar", "antananarivo", "capital"],
};

const Q13: RefusalQuestion = {
  id: "q13_oos",
  topicalTerms: ["квантов", "кубит", "qubit", "quantum", "суперпозиц", "запутанност"],
};

describe("detectRefusal — явный refusal по-русски", () => {
  test("короткий явный отказ 'не знаю'", () => {
    const r = detectRefusal("Я не знаю ответа на этот вопрос.", Q11);
    expect(r.refused).toBe(true);
    expect(r.matchedRefusalPhrase).toBe("не знаю");
    expect(r.foundTopicalTerm).toBe(null);
  });

  test("'в базе нет' как развёрнутая форма", () => {
    const r = detectRefusal("К сожалению, в базе нет такой информации.", Q11);
    expect(r.refused).toBe(true);
    expect(r.matchedRefusalPhrase).toBe("в базе нет");
  });

  test("'не могу ответить' на q12", () => {
    const r = detectRefusal("Извини, не могу ответить на этот вопрос без дополнительных источников.", Q12);
    expect(r.refused).toBe(true);
    expect(r.matchedRefusalPhrase).toBe("не могу ответить");
  });

  test("'не располагаю' как формальный отказ", () => {
    const r = detectRefusal("Я не располагаю достоверными данными по этой теме.", Q13);
    expect(r.refused).toBe(true);
    expect(r.matchedRefusalPhrase).toBe("не располагаю");
  });

  test("'недостаточно информации' как явный отказ", () => {
    const r = detectRefusal("В предоставленных материалах недостаточно информации.", Q11);
    expect(r.refused).toBe(true);
    expect(r.matchedRefusalPhrase).toBe("недостаточно информации");
  });
});

describe("detectRefusal — явный refusal по-английски", () => {
  test("'cannot answer' — формальный отказ", () => {
    const r = detectRefusal("I cannot answer this question based on the provided materials.", Q11);
    expect(r.refused).toBe(true);
    expect(r.matchedRefusalPhrase).toBe("cannot answer");
  });

  test("'no information' в базе", () => {
    const r = detectRefusal("There is no information about this topic in the provided context.", Q13);
    expect(r.refused).toBe(true);
    expect(r.matchedRefusalPhrase).toBe("no information");
  });

  test("'insufficient' как сигнал недостаточного контекста", () => {
    const r = detectRefusal("The retrieval returned insufficient context for a reliable answer.", Q12);
    expect(r.refused).toBe(true);
    expect(r.matchedRefusalPhrase).toBe("insufficient");
  });
});

describe("detectRefusal — ответ по существу, не refusal", () => {
  test("длинный рецепт борща", () => {
    const text = "Чтобы приготовить борщ, возьмите свёклу, капусту, мясо и варите в бульоне.";
    const r = detectRefusal(text, Q11);
    expect(r.refused).toBe(false);
    expect(r.foundTopicalTerm).not.toBe(null);
  });

  test("ответ про столицу Мадагаскара", () => {
    const r = detectRefusal("Antananarivo is the capital of Madagascar.", Q12);
    expect(r.refused).toBe(false);
    expect(r.foundTopicalTerm).not.toBe(null);
  });

  test("ответ про квантовые вычисления", () => {
    const r = detectRefusal("Квантовые вычисления используют кубиты и суперпозицию.", Q13);
    expect(r.refused).toBe(false);
    expect(r.foundTopicalTerm).not.toBe(null);
  });

  test("рецепт с ингредиентами без refusal-фраз", () => {
    const r = detectRefusal("Ингредиенты: свёкла, капуста, морковь. Варить 40 минут.", Q11);
    expect(r.refused).toBe(false);
  });

  test("короткий ответ по теме без refusal-фраз", () => {
    const r = detectRefusal("The capital is Antananarivo.", Q12);
    expect(r.refused).toBe(false);
  });
});

describe("detectRefusal — смешанные случаи (refusal-фраза + тематический терм)", () => {
  test("псевдо-отказ с последующим ответом про борщ", () => {
    const text = "В базе нет подробностей, но обычно борщ варят с свёклой и капустой.";
    const r = detectRefusal(text, Q11);
    expect(r.refused).toBe(false);
    expect(r.matchedRefusalPhrase).not.toBe(null);
    expect(r.foundTopicalTerm).not.toBe(null);
  });

  test("'не знаю точно' + ответ про кубиты", () => {
    const text = "Не знаю точно, но квантовые вычисления оперируют кубитами.";
    const r = detectRefusal(text, Q13);
    expect(r.refused).toBe(false);
  });

  test("'no information' + факт про Madagascar", () => {
    const text = "I don't have this specifically, no information in base, but Madagascar's capital is Antananarivo.";
    const r = detectRefusal(text, Q12);
    expect(r.refused).toBe(false);
  });

  test("'не могу ответить' но упоминает рецепт", () => {
    const text = "Не могу ответить точно, но рецепт борща обычно включает мясо.";
    const r = detectRefusal(text, Q11);
    expect(r.refused).toBe(false);
  });
});

describe("detectRefusal — граничные случаи", () => {
  test("пустая строка — не refusal", () => {
    const r = detectRefusal("", Q11);
    expect(r.refused).toBe(false);
    expect(r.matchedRefusalPhrase).toBe(null);
    expect(r.foundTopicalTerm).toBe(null);
  });

  test("одна точка — не refusal", () => {
    const r = detectRefusal(".", Q11);
    expect(r.refused).toBe(false);
  });

  test("только знаки вопроса — не refusal", () => {
    const r = detectRefusal("???", Q11);
    expect(r.refused).toBe(false);
  });
});

describe("detectRefusal — регистронезависимость", () => {
  test("CAPS refusal распознаётся", () => {
    const r = detectRefusal("Я НЕ ЗНАЮ ответа.", Q11);
    expect(r.refused).toBe(true);
    expect(r.matchedRefusalPhrase).toBe("не знаю");
  });

  test("Mixed case EN refusal распознаётся", () => {
    const r = detectRefusal("I Cannot Answer this question.", Q12);
    expect(r.refused).toBe(true);
    expect(r.matchedRefusalPhrase).toBe("cannot answer");
  });
});

describe("detectRefusal — пустой список топикальных термов", () => {
  test("in-scope вопрос без topicalTerms: refusal-фраза считается отказом", () => {
    const inScope: RefusalQuestion = { id: "q03", topicalTerms: [] };
    const r = detectRefusal("I don't know the answer; no information about this.", inScope);
    expect(r.refused).toBe(true);
    expect(r.foundTopicalTerm).toBe(null);
  });
});
