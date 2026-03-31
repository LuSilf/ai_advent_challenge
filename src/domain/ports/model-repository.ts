import type { Model, ModelRole } from "../models";

export interface ModelRepository {
  getAll(): Model[];
  getById(id: string): Model | null;
  getRole(role: string): Model | null;
  getRoles(): (ModelRole & { modelName: string })[];
  setRole(role: string, modelId: string): void;
}
