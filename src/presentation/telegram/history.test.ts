import { describe, test, expect } from "bun:test";
import { ChatHistoryStore } from "./history";

describe("ChatHistoryStore", () => {
  test("returns empty array for unknown chat", () => {
    const store = new ChatHistoryStore();
    expect(store.get(999)).toEqual([]);
  });

  test("appends turns in order", () => {
    const store = new ChatHistoryStore();
    store.append(1, "user", "привет");
    store.append(1, "assistant", "здоро́во");
    store.append(1, "user", "как дела");
    expect(store.get(1)).toEqual([
      { role: "user", content: "привет" },
      { role: "assistant", content: "здоро́во" },
      { role: "user", content: "как дела" },
    ]);
  });

  test("isolates history between chat_ids", () => {
    const store = new ChatHistoryStore();
    store.append(1, "user", "A1");
    store.append(2, "user", "B1");
    store.append(1, "assistant", "A2");
    expect(store.get(1)).toEqual([
      { role: "user", content: "A1" },
      { role: "assistant", content: "A2" },
    ]);
    expect(store.get(2)).toEqual([{ role: "user", content: "B1" }]);
  });

  test("clear removes only the target chat", () => {
    const store = new ChatHistoryStore();
    store.append(1, "user", "A");
    store.append(2, "user", "B");
    store.clear(1);
    expect(store.get(1)).toEqual([]);
    expect(store.get(2)).toEqual([{ role: "user", content: "B" }]);
  });

  test("get returns a defensive copy", () => {
    const store = new ChatHistoryStore();
    store.append(1, "user", "hi");
    const snapshot = store.get(1);
    snapshot.push({ role: "assistant", content: "should not leak" });
    expect(store.get(1)).toEqual([{ role: "user", content: "hi" }]);
  });

  test("truncates to maxTurnsPerChat when exceeded", () => {
    const store = new ChatHistoryStore({ maxTurnsPerChat: 3 });
    store.append(1, "user", "1");
    store.append(1, "assistant", "2");
    store.append(1, "user", "3");
    store.append(1, "assistant", "4");
    expect(store.get(1).map((t) => t.content)).toEqual(["2", "3", "4"]);
  });
});
