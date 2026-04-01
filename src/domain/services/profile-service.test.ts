import { describe, test, expect, beforeEach } from "bun:test";
import { ProfileService } from "./profile-service";
import type { ProfileRepository } from "../ports/profile-repository";
import type { OptionsRepository } from "../ports/options-repository";
import type { Profile, ProfilePreference } from "../models";

function createMockProfileRepo(): ProfileRepository {
  const profiles = new Map<number, Profile>();
  const preferences = new Map<number, Map<string, string>>();
  let nextId = 1;

  return {
    create(data) {
      const id = nextId++;
      const now = new Date().toISOString();
      profiles.set(id, { id, ...data, createdAt: now, updatedAt: now });
      return id;
    },
    getById: (id) => profiles.get(id) ?? null,
    getAll: () => [...profiles.values()],
    update(id, fields) {
      const p = profiles.get(id);
      if (p) {
        Object.assign(p, fields, { updatedAt: new Date().toISOString() });
      }
    },
    delete(id) {
      preferences.delete(id);
      return profiles.delete(id);
    },
    getPreferences(profileId) {
      const map = preferences.get(profileId);
      if (!map) return [];
      return [...map.entries()].map(([key, value]) => ({ key, value }));
    },
    setPreference(profileId, key, value) {
      if (!preferences.has(profileId)) preferences.set(profileId, new Map());
      preferences.get(profileId)!.set(key, value);
    },
    deletePreference(profileId, key) {
      const map = preferences.get(profileId);
      if (!map) return false;
      return map.delete(key);
    },
  };
}

function createMockOptionsRepo(): OptionsRepository {
  const options = new Map<string, string>();
  return {
    get: (key) => options.get(key) ?? null,
    set: (key, value) => { options.set(key, value); },
    getAll: () => [...options.entries()].map(([key, value]) => ({ key, value })),
  };
}

describe("ProfileService", () => {
  let service: ProfileService;
  let profileRepo: ProfileRepository;
  let optionsRepo: OptionsRepository;

  beforeEach(() => {
    profileRepo = createMockProfileRepo();
    optionsRepo = createMockOptionsRepo();
    service = new ProfileService(profileRepo, optionsRepo);
  });

  test("createProfile creates and returns id", () => {
    const id = service.createProfile("dev", { userName: "Алексей", language: "русский" });
    expect(id).toBeGreaterThan(0);

    const profile = profileRepo.getById(id);
    expect(profile!.name).toBe("dev");
    expect(profile!.userName).toBe("Алексей");
    expect(profile!.language).toBe("русский");
  });

  test("getActiveProfile returns null when no active profile", () => {
    expect(service.getActiveProfile()).toBeNull();
  });

  test("setActiveProfile and getActiveProfile", () => {
    const id = service.createProfile("test");
    service.setActiveProfile(id);
    const active = service.getActiveProfile();
    expect(active).not.toBeNull();
    expect(active!.id).toBe(id);
  });

  test("getActiveProfile returns null for deleted profile", () => {
    const id = service.createProfile("test");
    service.setActiveProfile(id);
    profileRepo.delete(id);
    expect(service.getActiveProfile()).toBeNull();
  });

  test("clearActiveProfile clears active profile", () => {
    const id = service.createProfile("test");
    service.setActiveProfile(id);
    service.clearActiveProfile();
    expect(service.getActiveProfile()).toBeNull();
  });

  test("buildProfileBlock formats profile correctly", () => {
    const id = service.createProfile("dev", {
      userName: "Алексей",
      language: "русский",
      style: "неформальный",
      format: "краткий",
      restrictions: "не использовать Java-примеры",
    });

    profileRepo.setPreference(id, "editor", "VSCode");
    profileRepo.setPreference(id, "framework", "React");

    const profile = profileRepo.getById(id)!;
    const block = service.buildProfileBlock(profile);

    expect(block).toContain("Профиль пользователя");
    expect(block).toContain("Имя: Алексей");
    expect(block).toContain("Язык: русский");
    expect(block).toContain("Стиль: неформальный");
    expect(block).toContain("Формат: краткий");
    expect(block).toContain("Ограничения: не использовать Java-примеры");
    expect(block).toContain("editor: VSCode");
    expect(block).toContain("framework: React");
  });

  test("buildProfileBlock omits null fields", () => {
    const id = service.createProfile("minimal");
    const profile = profileRepo.getById(id)!;
    const block = service.buildProfileBlock(profile);

    expect(block).toContain("Профиль пользователя");
    expect(block).not.toContain("Имя:");
    expect(block).not.toContain("Язык:");
    expect(block).not.toContain("Предпочтения:");
  });

  test("getAllProfiles returns all", () => {
    service.createProfile("first");
    service.createProfile("second");
    expect(service.getAllProfiles()).toHaveLength(2);
  });

  test("getProfile returns by id", () => {
    const id = service.createProfile("test", { userName: "Иван" });
    const profile = service.getProfile(id);
    expect(profile!.userName).toBe("Иван");
  });

  test("updateProfile updates fields", () => {
    const id = service.createProfile("test");
    service.updateProfile(id, { style: "формальный" });
    expect(profileRepo.getById(id)!.style).toBe("формальный");
  });

  test("deleteProfile removes and clears active if needed", () => {
    const id = service.createProfile("test");
    service.setActiveProfile(id);
    service.deleteProfile(id);
    expect(profileRepo.getById(id)).toBeNull();
    expect(service.getActiveProfile()).toBeNull();
  });

  test("deleteProfile does not clear active for other profile", () => {
    const id1 = service.createProfile("one");
    const id2 = service.createProfile("two");
    service.setActiveProfile(id1);
    service.deleteProfile(id2);
    expect(service.getActiveProfile()!.id).toBe(id1);
  });
});
