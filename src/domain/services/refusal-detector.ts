export type RefusalQuestion = {
  id: string;
  topicalTerms: string[];
};

export type RefusalResult = {
  refused: boolean;
  matchedRefusalPhrase: string | null;
  foundTopicalTerm: string | null;
};

const REFUSAL_PHRASES: readonly string[] = [
  "не знаю",
  "в базе нет",
  "нет информации",
  "не содержится",
  "не могу ответить",
  "не располагаю",
  "недостаточно информации",
  "out of scope",
  "cannot answer",
  "no information",
  "not in the knowledge base",
  "insufficient",
];

export function detectRefusal(text: string, question: RefusalQuestion): RefusalResult {
  const lower = text.toLowerCase();
  const matchedPhrase = REFUSAL_PHRASES.find((phrase) => lower.includes(phrase)) ?? null;
  const foundTerm =
    question.topicalTerms.find((term) => term.length > 0 && lower.includes(term.toLowerCase())) ?? null;
  const refused = matchedPhrase !== null && foundTerm === null;
  return {
    refused,
    matchedRefusalPhrase: matchedPhrase,
    foundTopicalTerm: foundTerm,
  };
}
