import type { Profile } from "../models";
import type { ProfileRepository } from "../ports/profile-repository";
import type { OptionsRepository } from "../ports/options-repository";

const ACTIVE_PROFILE_KEY = "active_profile_id";

export class ProfileService {
  constructor(
    private readonly profileRepo: ProfileRepository,
    private readonly optionsRepo: OptionsRepository,
  ) {}

  createProfile(name: string, fields?: Partial<Omit<Profile, "id" | "name" | "createdAt" | "updatedAt">>): number {
    return this.profileRepo.create({
      name,
      userName: fields?.userName ?? null,
      language: fields?.language ?? null,
      style: fields?.style ?? null,
      format: fields?.format ?? null,
      restrictions: fields?.restrictions ?? null,
    });
  }

  getProfile(id: number): Profile | null {
    return this.profileRepo.getById(id);
  }

  getAllProfiles(): Profile[] {
    return this.profileRepo.getAll();
  }

  updateProfile(id: number, fields: Partial<Omit<Profile, "id" | "createdAt" | "updatedAt">>): void {
    this.profileRepo.update(id, fields);
  }

  getPreferences(profileId: number): { key: string; value: string }[] {
    return this.profileRepo.getPreferences(profileId);
  }

  setPreference(profileId: number, key: string, value: string): void {
    this.profileRepo.setPreference(profileId, key, value);
  }

  replacePreferences(profileId: number, preferences: { key: string; value: string }[]): void {
    const existing = this.profileRepo.getPreferences(profileId);
    for (const p of existing) {
      this.profileRepo.deletePreference(profileId, p.key);
    }
    for (const p of preferences) {
      this.profileRepo.setPreference(profileId, p.key, p.value);
    }
  }

  deleteProfile(id: number): void {
    const activeId = this.optionsRepo.get(ACTIVE_PROFILE_KEY);
    this.profileRepo.delete(id);
    if (activeId === String(id)) {
      this.optionsRepo.set(ACTIVE_PROFILE_KEY, "");
    }
  }

  getActiveProfile(): Profile | null {
    const activeId = this.optionsRepo.get(ACTIVE_PROFILE_KEY);
    if (!activeId) return null;
    return this.profileRepo.getById(Number(activeId));
  }

  setActiveProfile(id: number): void {
    this.optionsRepo.set(ACTIVE_PROFILE_KEY, String(id));
  }

  clearActiveProfile(): void {
    this.optionsRepo.set(ACTIVE_PROFILE_KEY, "");
  }

  buildProfileBlock(profile: Profile): string {
    const lines: string[] = ["=== Профиль пользователя ==="];

    if (profile.userName) lines.push(`Имя: ${profile.userName}`);
    if (profile.language) lines.push(`Язык: ${profile.language}`);
    if (profile.style) lines.push(`Стиль: ${profile.style}`);
    if (profile.format) lines.push(`Формат: ${profile.format}`);
    if (profile.restrictions) lines.push(`Ограничения: ${profile.restrictions}`);

    const prefs = this.profileRepo.getPreferences(profile.id);
    if (prefs.length > 0) {
      lines.push("Предпочтения:");
      for (const p of prefs) {
        lines.push(`- ${p.key}: ${p.value}`);
      }
    }

    lines.push("===========================");
    return lines.join("\n");
  }
}
