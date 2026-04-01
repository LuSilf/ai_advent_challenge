import { initDb } from "../src/db";
import { SqliteProfileRepository } from "../src/storage/sqlite/profile-repository";
import { SqliteOptionsRepository } from "../src/storage/sqlite/options-repository";
import { ProfileService } from "../src/domain/services/profile-service";

initDb("./data/history.db");

const profileRepo = new SqliteProfileRepository();
const optionsRepo = new SqliteOptionsRepository();
const profileService = new ProfileService(profileRepo, optionsRepo);

// Профиль 1: Строгий технический лид
const id1 = profileService.createProfile("tech-lead", {
  userName: "Сергей",
  language: "русский",
  style: "формальный, строгий, экспертный",
  format: "развёрнутый, с обоснованием решений, ссылками на паттерны и принципы",
  restrictions: "не упрощать объяснения, не использовать аналогии для новичков, избегать фреймворков без типизации",
});
profileRepo.setPreference(id1, "stack", "TypeScript, Go, PostgreSQL");
profileRepo.setPreference(id1, "principles", "SOLID, DDD, Clean Architecture");
profileRepo.setPreference(id1, "code_style", "функциональный, иммутабельный, без any");

// Профиль 2: Начинающий студент
const id2 = profileService.createProfile("student", {
  userName: "Маша",
  language: "русский",
  style: "дружелюбный, терпеливый, с аналогиями из реальной жизни",
  format: "краткий, пошаговый, с простыми примерами кода",
  restrictions: "не использовать сложную терминологию без объяснения, избегать абстракций высокого уровня",
});
profileRepo.setPreference(id2, "level", "новичок, первый год обучения");
profileRepo.setPreference(id2, "interests", "веб-разработка, Python, JavaScript");
profileRepo.setPreference(id2, "learning_style", "примеры важнее теории");

profileService.setActiveProfile(id1);

console.log(`Создан профиль #${id1}: tech-lead (Сергей)`);
console.log(`Создан профиль #${id2}: student (Маша)`);
console.log(`Активный: #${id1}`);
console.log("\nПромпт для tech-lead:");
console.log(profileService.buildProfileBlock(profileService.getProfile(id1)!));
console.log("\nПромпт для student:");
console.log(profileService.buildProfileBlock(profileService.getProfile(id2)!));
