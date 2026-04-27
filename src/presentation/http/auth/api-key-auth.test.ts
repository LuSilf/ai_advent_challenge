import { describe, test, expect } from "bun:test";
import { ApiKeyAuth } from "./api-key-auth";

describe("ApiKeyAuth", () => {
  test("returns null for missing header", () => {
    const auth = new ApiKeyAuth(new Map([["alice", "sk-xxx"]]));
    expect(auth.authenticate(undefined)).toBeNull();
  });

  test("returns null for empty header", () => {
    const auth = new ApiKeyAuth(new Map([["alice", "sk-xxx"]]));
    expect(auth.authenticate("")).toBeNull();
  });

  test("returns null for non-Bearer scheme", () => {
    const auth = new ApiKeyAuth(new Map([["alice", "sk-xxx"]]));
    expect(auth.authenticate("Basic c2s=")).toBeNull();
    expect(auth.authenticate("sk-xxx")).toBeNull();
  });

  test("returns null for Bearer with empty secret", () => {
    const auth = new ApiKeyAuth(new Map([["alice", "sk-xxx"]]));
    expect(auth.authenticate("Bearer ")).toBeNull();
    expect(auth.authenticate("Bearer    ")).toBeNull();
  });

  test("returns null for unknown secret", () => {
    const auth = new ApiKeyAuth(new Map([["alice", "sk-xxx"]]));
    expect(auth.authenticate("Bearer wrong")).toBeNull();
  });

  test("returns matching keyId for known secret", () => {
    const auth = new ApiKeyAuth(new Map([["alice", "sk-aaa"], ["bob", "sk-bbb"]]));
    expect(auth.authenticate("Bearer sk-aaa")).toEqual({ keyId: "alice" });
    expect(auth.authenticate("Bearer sk-bbb")).toEqual({ keyId: "bob" });
  });

  test("Bearer scheme is case-insensitive", () => {
    const auth = new ApiKeyAuth(new Map([["alice", "sk-aaa"]]));
    expect(auth.authenticate("bearer sk-aaa")).toEqual({ keyId: "alice" });
    expect(auth.authenticate("BEARER sk-aaa")).toEqual({ keyId: "alice" });
  });

  test("does not confuse two keys with shared prefix", () => {
    const auth = new ApiKeyAuth(new Map([["a", "sk-prefix-aa"], ["b", "sk-prefix-bb"]]));
    expect(auth.authenticate("Bearer sk-prefix-aa")).toEqual({ keyId: "a" });
    expect(auth.authenticate("Bearer sk-prefix-bb")).toEqual({ keyId: "b" });
    expect(auth.authenticate("Bearer sk-prefix")).toBeNull();
    expect(auth.authenticate("Bearer sk-prefix-aax")).toBeNull();
  });

  test("constant-time comparison does not throw on length mismatch", () => {
    const auth = new ApiKeyAuth(new Map([["alice", "sk-long-secret"]]));
    expect(auth.authenticate("Bearer x")).toBeNull();
    expect(auth.authenticate("Bearer " + "x".repeat(1000))).toBeNull();
  });

  test("throws when constructed with empty key map", () => {
    expect(() => new ApiKeyAuth(new Map())).toThrow(/at least one/i);
  });
});
