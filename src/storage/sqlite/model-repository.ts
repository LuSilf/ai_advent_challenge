import type { Model, ModelRole } from "../../domain/models";
import type { ModelRepository } from "../../domain/ports/model-repository";
import { getDb } from "../../db";

type DbModel = {
  id: string;
  name: string;
  input_price: number;
  output_price: number;
  context_size: number;
};

type DbModelRole = {
  role: string;
  model_id: string;
  model_name: string;
};

function toModel(row: DbModel): Model {
  return {
    id: row.id,
    name: row.name,
    inputPrice: row.input_price,
    outputPrice: row.output_price,
    contextSize: row.context_size,
  };
}

export class SqliteModelRepository implements ModelRepository {
  getAll(): Model[] {
    const db = getDb();
    const rows = db.query<DbModel, []>("SELECT * FROM models ORDER BY id ASC").all();
    return rows.map(toModel);
  }

  getById(id: string): Model | null {
    const db = getDb();
    const row = db.query<DbModel, [string]>("SELECT * FROM models WHERE id = ?").get(id);
    return row ? toModel(row) : null;
  }

  getRole(role: string): Model | null {
    const db = getDb();
    const row = db.query<DbModel, [string]>(
      "SELECT m.* FROM models m JOIN model_roles r ON r.model_id = m.id WHERE r.role = ?"
    ).get(role);
    return row ? toModel(row) : null;
  }

  getRoles(): (ModelRole & { modelName: string })[] {
    const db = getDb();
    const rows = db.query<DbModelRole, []>(
      "SELECT r.role, r.model_id, m.name as model_name FROM model_roles r JOIN models m ON r.model_id = m.id ORDER BY r.role ASC"
    ).all();
    return rows.map((r) => ({
      role: r.role,
      modelId: r.model_id,
      modelName: r.model_name,
    }));
  }

  setRole(role: string, modelId: string): void {
    const db = getDb();
    const model = this.getById(modelId);
    if (!model) {
      throw new Error(`Модель "${modelId}" не найдена`);
    }
    db.run(
      "INSERT INTO model_roles (role, model_id) VALUES (?, ?) ON CONFLICT(role) DO UPDATE SET model_id = excluded.model_id",
      [role, modelId]
    );
  }
}
