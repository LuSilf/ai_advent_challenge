import type { Profile, ProfilePreference } from "../../domain/models";
import type { ProfileRepository } from "../../domain/ports/profile-repository";
import { getDb } from "../../db";

type DbProfile = {
  id: number;
  name: string;
  user_name: string | null;
  language: string | null;
  style: string | null;
  format: string | null;
  restrictions: string | null;
  created_at: string;
  updated_at: string;
};

function toProfile(row: DbProfile): Profile {
  return {
    id: row.id,
    name: row.name,
    userName: row.user_name,
    language: row.language,
    style: row.style,
    format: row.format,
    restrictions: row.restrictions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteProfileRepository implements ProfileRepository {
  create(profile: Omit<Profile, "id" | "createdAt" | "updatedAt">): number {
    const db = getDb();
    const result = db.run(
      "INSERT INTO profiles (name, user_name, language, style, format, restrictions) VALUES (?, ?, ?, ?, ?, ?)",
      [profile.name, profile.userName, profile.language, profile.style, profile.format, profile.restrictions]
    );
    return Number(result.lastInsertRowid);
  }

  getById(id: number): Profile | null {
    const db = getDb();
    const row = db.query<DbProfile, [number]>(
      "SELECT * FROM profiles WHERE id = ?"
    ).get(id);
    return row ? toProfile(row) : null;
  }

  getAll(): Profile[] {
    const db = getDb();
    const rows = db.query<DbProfile, []>(
      "SELECT * FROM profiles ORDER BY id ASC"
    ).all();
    return rows.map(toProfile);
  }

  update(id: number, fields: Partial<Omit<Profile, "id" | "createdAt" | "updatedAt">>): void {
    const db = getDb();
    const mapping: Record<string, string> = {
      name: "name",
      userName: "user_name",
      language: "language",
      style: "style",
      format: "format",
      restrictions: "restrictions",
    };

    for (const [key, value] of Object.entries(fields)) {
      const column = mapping[key];
      if (column) {
        db.run(`UPDATE profiles SET ${column} = ?, updated_at = datetime('now') WHERE id = ?`, [value ?? null, id]);
      }
    }
  }

  delete(id: number): boolean {
    const db = getDb();
    const result = db.run("DELETE FROM profiles WHERE id = ?", [id]);
    return result.changes > 0;
  }

  getPreferences(profileId: number): ProfilePreference[] {
    const db = getDb();
    return db.query<ProfilePreference, [number]>(
      "SELECT key, value FROM profile_preferences WHERE profile_id = ? ORDER BY key ASC"
    ).all(profileId);
  }

  setPreference(profileId: number, key: string, value: string): void {
    const db = getDb();
    db.run(
      "INSERT INTO profile_preferences (profile_id, key, value) VALUES (?, ?, ?) ON CONFLICT(profile_id, key) DO UPDATE SET value = excluded.value",
      [profileId, key, value]
    );
  }

  deletePreference(profileId: number, key: string): boolean {
    const db = getDb();
    const result = db.run(
      "DELETE FROM profile_preferences WHERE profile_id = ? AND key = ?",
      [profileId, key]
    );
    return result.changes > 0;
  }
}
