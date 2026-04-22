import { describe, test, expect } from "bun:test";
import { explainError } from "./index";

describe("explainError", () => {
  test("timeout via AbortError", () => {
    expect(explainError({ name: "AbortError", message: "aborted" })).toMatch(/слишком долго/);
  });

  test("timeout via message regex", () => {
    expect(explainError({ name: "Error", message: "request timeout" })).toMatch(/слишком долго/);
  });

  test("timeout via ETIMEDOUT", () => {
    expect(explainError({ code: "ETIMEDOUT", message: "timed out" })).toMatch(/слишком долго/);
  });

  test("ECONNREFUSED maps to ollama-down", () => {
    expect(explainError({ code: "ECONNREFUSED", message: "refused" })).toMatch(/Ollama/);
  });

  test("APIConnectionError from openai SDK maps to ollama-down", () => {
    expect(explainError({ name: "APIConnectionError", message: "Connection error." })).toMatch(/Ollama/);
  });

  test("fetch failed message maps to ollama-down", () => {
    expect(explainError({ name: "TypeError", message: "fetch failed" })).toMatch(/Ollama/);
  });

  test("404 status maps to model-not-found", () => {
    expect(explainError({ status: 404, message: "not found" })).toMatch(/TELEGRAM_MODEL/);
  });

  test("unknown error falls back to raw message", () => {
    expect(explainError({ message: "some other weirdness" })).toBe("Ошибка: some other weirdness");
  });

  test("non-object error stringifies", () => {
    expect(explainError("bare string")).toBe("Ошибка: bare string");
  });
});
