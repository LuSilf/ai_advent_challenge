import type { Profile, ProfilePreference } from "../models";

export interface ProfileRepository {
  create(profile: Omit<Profile, "id" | "createdAt" | "updatedAt">): number;
  getById(id: number): Profile | null;
  getAll(): Profile[];
  update(id: number, fields: Partial<Omit<Profile, "id" | "createdAt" | "updatedAt">>): void;
  delete(id: number): boolean;
  getPreferences(profileId: number): ProfilePreference[];
  setPreference(profileId: number, key: string, value: string): void;
  deletePreference(profileId: number, key: string): boolean;
}
