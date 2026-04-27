import { timingSafeEqual } from "node:crypto";

export type AuthResult = { keyId: string };

export class ApiKeyAuth {
  private readonly entries: ReadonlyArray<readonly [string, Buffer]>;

  constructor(keys: Map<string, string>) {
    if (keys.size === 0) {
      throw new Error("ApiKeyAuth requires at least one key");
    }
    this.entries = Array.from(keys.entries(), ([keyId, secret]) => [keyId, Buffer.from(secret, "utf8")] as const);
  }

  authenticate(authHeader: string | undefined): AuthResult | null {
    if (!authHeader) return null;
    const match = authHeader.match(/^\s*Bearer\s+(\S.*)$/i);
    if (!match) return null;
    const presented = Buffer.from(match[1].trim(), "utf8");
    if (presented.length === 0) return null;

    let matched: string | null = null;
    for (const [keyId, expected] of this.entries) {
      if (presented.length !== expected.length) continue;
      if (timingSafeEqual(presented, expected)) {
        matched = keyId;
        // intentionally no break — keeps timing of compare loop independent of position
      }
    }
    return matched ? { keyId: matched } : null;
  }
}
