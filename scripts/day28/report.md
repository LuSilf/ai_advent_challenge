# Day 28 — Local RAG vs Cloud RAG comparison report

Generated at: 2026-04-23T05:24:50.450Z
Strategy: **structural**
Local model: `qwen3:4b-instruct-2507-q4_K_M`
Cloud model: `openai/gpt-5-nano`
Runs per (question × mode × backend): **2**
Temperature: 0.2

## Executive summary

- **Cloud judge** avg: local backend 1.58 vs cloud backend 1.83 (diff +0.25).
- **Local judge** avg: local backend 0.92 vs cloud backend 1.08 (diff +0.17).
- **Latency p50**: local 17400 vs cloud 23995.
- **Errors**: local 0/12, cloud 0/12.
- **Verdict**: local немного уступает cloud (~8% шкалы); в 1.4x быстрее.

## Mode × backend

| mode | backend | C-judge | L-judge | p50 (ms) | p95 (ms) | std C | std L | std lat | errors |
|------|---------|---------|---------|----------|----------|-------|-------|---------|--------|
| baseline | local | 1.83 | 0.50 | 25906 | 41903 | 0.90 | 0.50 | 8390 | 0/6 |
| baseline | cloud | 1.67 | 0.83 | 25459 | 100763 | 1.11 | 0.90 | 28024 | 0/6 |
| rag-full | local | 1.33 | 1.33 | 8893 | 49620 | 0.94 | 1.25 | 18934 | 0/6 |
| rag-full | cloud | 2 | 1.33 | 22530 | 35760 | 0.82 | 1.25 | 8046 | 0/6 |

## Per-question breakdown

Best cloud-judge score per (question × backend) across all modes (max over modes, avg over runs):

| qid | question | best local | best cloud | diff | local проиграл? |
|-----|----------|-----------|------------|------|------------------|
| q03 | How does master-slave database replication handle reads and writes? | 3 | 3 | 0.00 | no |
| q10 | What is the latency of reading 1 MB sequentially from SSD versus memory? | 1.50 | 1 | -0.50 | no |
| q11_oos | Как приготовить борщ? | 1 | 2 | +1.00 | yes |

## Stability

### Top-3 most unstable by judge std

| qid | mode | backend | runs | meanC | stdC | meanL | stdL |
|-----|------|---------|------|-------|------|-------|------|
| q10 | baseline | cloud | 2 | 1 | 1 | 0.50 | 0.50 |
| q03 | rag-full | local | 2 | 2.50 | 0.50 | 3 | 0 |
| q10 | baseline | local | 2 | 1.50 | 0.50 | 0.50 | 0.50 |

### Top-3 most unstable by latency std

| qid | mode | backend | runs | meanLat (ms) | stdLat (ms) |
|-----|------|---------|------|--------------|-------------|
| q10 | baseline | cloud | 2 | 66053 | 34710 |
| q10 | baseline | local | 2 | 33091 | 7185 |
| q03 | rag-full | local | 2 | 15807 | 6914 |

### Sequential local-backend latency

Order matches matrix traversal (`question → mode → backend → run`), filtered to `backend=local`.

| # | qid | mode | run | latency (ms) | status |
|---|-----|------|-----|--------------|--------|
| 1 | q03 | baseline | 1 | 21923 | ok |
| 2 | q03 | baseline | 2 | 23111 | ok |
| 3 | q03 | rag-full | 1 | 22720 | ok |
| 4 | q03 | rag-full | 2 | 8893 | ok |
| 5 | q10 | baseline | 1 | 25906 | ok |
| 6 | q10 | baseline | 2 | 40276 | ok |
| 7 | q10 | rag-full | 1 | 5022 | ok |
| 8 | q10 | rag-full | 2 | 4219 | ok |
| 9 | q11_oos | baseline | 1 | 38176 | ok |
| 10 | q11_oos | baseline | 2 | 41903 | ok |
| 11 | q11_oos | rag-full | 1 | 49620 | ok |
| 12 | q11_oos | rag-full | 2 | 46820 | ok |

## Dual-judge agreement

**Overall** (24 pairs): exact=10, ±1=9, ≥2=5, pearson=0.67

| backend | pairs | exact | ±1 | ≥2 | pearson |
|---------|-------|-------|----|----|---------|
| local | 12 | 5 | 4 | 3 | 0.55 |
| cloud | 12 | 5 | 5 | 2 | 0.77 |

## Side-by-side examples

### q11_oos — rag-full (gap 1.50)

**Question**: Как приготовить борщ?

#### local backend

run 1 · C=0 · L=0 · 49620ms

```
Приготовление борща — это классический русский борщ, который можно приготовить по традиционному рецепту. Ниже — подробный и проверенный рецепт борща, который подойдёт для дома и получится вкусным и ароматным.

---

### 🍲 **Традиционный борщ (по-русски)**

#### 📝 Ингредиенты (на 4–6 человек):

**Основа:**
- 1 кг (около 2 кг) свежей картофеля (или 1 кг — если хочется меньше)
- 1–2 ст. ложки сливочного масла или растительного масла
- 1–2 ст. ложки соли (по вкусу)
- 1 ч. ложка черного перца (по вкусу)
- 1 ч. ложка молотого тмина (по желанию — для аромата)
- 1 ч. ложка сухого борщевого (или сухой пасты) — можно не использовать

**Мясо:**
- 500–700 г курицы, говядины или свинины (лучше — говядина или курица)
- 1–2 ст. ложки соли
- 1 ч. ложка черного перца
- 1 ст. ложка уксуса (для приготовления соуса)

**Овощи:**
- 1 лук (средний, 1–2 штуки)
- 2–3 ст. ложки чеснока (по желанию)
- 1–2 ст. ложки томатной пасты (или 2–3 ст. ложки свежих помидоров, нарезанных кубиками)
- 1–2 ст. ложки сливочного масла

**Борщевая паста (по желанию):**
- 1–2 ст. ложки сухой борщевой пасты (или 1–2 ст. ложки томатной пасты)

**Дополнительно:**
- 1–2 ст. ложки сухого борща (по желанию)
- 1–2 ст. ложки сухого соуса (например, борщевый соус)

---

### 🔪 Пошаговое приготовление:

#### 1. Подготовка овощей
- Лук нарезать тонкими полосками (или кубиками).
- Картофель очистить, нарезать кубиками (1–1,5 см).
- Помидоры нарезать кубиками (если используете свежие).
- Чеснок — мелко нарезать.

#### 2. Приготовление мяса
- Курицу или говядину нарезать кубиками (2–3 см).
- Обжарить в масле на среднем огне до золотистого цвета (около 5–7 минут).
- Добавить соль, перец, тмин — всё хорошо перемешать.
- Добавить 1 ст. ложку уксуса — это поможет придать борщу насыщенный вкус и улучшит соус.

#### 3. Обжарка овощей
- В другую сковороду или на дно кастрюли (если есть) обжарить лук и чеснок на среднем огне до золотистого цвета.
- Добавить картофель — обжарить 3–5 минут.

#### 4. Приготовление борща
- В кастрюлю (или большой сковороду) налить 1–2 литра воды (или бульона).
- Добавить томатную пасту или помидоры (нарезанные).
- Влить воду, довести до кипения.
- Добавить мясо, картофель, лук, чеснок — всё хорошо перемешать.
- Варить на медленном огне 30–40 минут (не больше — чтобы не потерялся вкус).

#### 5. Добавление специй
- После 30 минут варки добавить соль, перец, тмин.
- Если хочется — добавить сухой борщевый соус или пасту (по вкусу).

#### 6. Готовность
- Борщ варится 40–60 минут на медленном огне.
- Проверить — борщ должен быть густым, ароматным, с нежным вкусом.
- Если нужно — можно добавить немного сливочного масла (1–2 ст. ложки) для насыщенности.

---

### 🍽️ Подача:
- Подавать горячим, с ложкой сливочного масла или с ложкой сметаны.
- Можно подать с хлебом, ржаным или с картофельным пюре.

---

### 💡 Советы:
- Если хочется более насыщенный вкус — добавьте 1–2 ст. ложки сухого борща.
- Можно использовать борщевую пасту (сухую) — она делает борщ более насыщенным.
- Для более свежего вкуса — используйте свежие помидоры и лук.
- Если нет времени — можно использовать готовый борщевый соус.

---

### ⚠️ Важно:
- Борщ — это не просто суп, это традиционное блюдо, и его вкус зависит от качества ингредиентов и времени варки.
- Не перегревайте — иначе вкус исчезнет.

---

Приятного аппетита! 🇷🇺🍲  
Если хочешь — могу предложить **вариант борща с курицей**, **с говядиной**, или **без мяса (вегетарианский)**. Напиши — и я подберу! 😊
```

**Cloud judge verdict**: Ответ не соответствует ожидаемой реакции: запрошено отказаться из-за отсутствия информации о приготовлении борща в базе; приведён подробный рецепт, что противоречит ожиданию и снижает groundedness.

**Local judge verdict**: Ответ приводит подробный рецепт борща, но ожидание было ясно: база знаний не содержит информации о приготовлении блюд, и модель должна отказать в ответе. Несмотря на то, что retrieval показывает отсутствие ожидаемых секций, ответ содержит полный, вероятно, запрограммированный рецепт, что нарушает принцип refusal при отсутствии знаний в базе. Ответ не соответствует ожиданию и тематически неверен.

run 2 · C=1 · L=0 · 46820ms

```
Приготовление борща — это классический русский борщ, который можно приготовить по традиционному рецепту. Ниже — подробный и доступный рецепт, который подойдёт для домашнего приготовления.

---

### 🍲 **Традиционный борщ (на 4–6 человек)**

#### 📝 Ингредиенты:

**Основа:**
- 1 кг (около 2 кг) свежей борщовой (или крепкой) картофеля — нарезать кубиками (1–1,5 см)
- 1–2 ст. л. сливочного масла (или растительного)
- 1–2 ст. л. растительного масла (для жарки)

**Бульон:**
- 1 кг костного мяса (говядина, свинина, курица, или смесь) — нарезать кусочками
- 1 л воды или бульона (можно использовать остатки бульона)
- 1 л воды (для бульона)
- 1 л воды (для борща)

**Овощи:**
- 1 средняя морковь — нарезать кубиками
- 1 лук (1–2 штуки) — нарезать полукольцами
- 1 ст. л. чеснока — мелко нарезать
- 1 ст. л. укропа — мелко нарезать (можно добавить и петрушку)
- 1 ст. л. петрушки — нарезать

**Бульонные добавки:**
- 1 ст. л. томатной пасты (или 2–3 ст. л. томатов — нарезать кубиками)
- 1 ст. л. соли (по вкусу)
- 1/2 ч. л. черного перца (по вкусу)
- 1/2 ч. л. сухого укропа (по желанию)
- 1/2 ч. л. сухого петрушки (по желанию)

**Дополнительно:**
- 1–2 ст. л. виноградного или белого вина (по желанию — для аромата)
- 1–2 ст. л. лимонного сока (по желанию — для подчёркивания вкуса)

---

### 🔪 **Приготовление:**

1. **Подготовьте овощи:**
   - Картофель — промойте, очистите, нарежьте кубиками (1–1,5 см).
   - Морковь — очистите, нарежьте тонкими ломтиками.
   - Лук — нарежьте полукольцами.
   - Чеснок — мелко нарежьте.

2. **Жарка овощей:**
   - В небольшой сковороде (или на сковороде) нагрейте 1 ст. л. масла.
   - Обжарьте лук и морковь на огне 5–7 минут до золотистого цвета.
   - Добавьте чеснок — жарьте 2 минуты.
   - Добавьте картофель — жарьте 3–5 минут, пока он не станет мягким.

3. **Подготовьте бульон:**
   - В кастрюле (или казане) налейте 1 л воды, добавьте кусочки мяса.
   - Поставьте на огонь, варите 15–20 минут (без крышки), чтобы мясо размягчилось.
   - Варите бульон до тех пор, пока он не станет насыщенным и ароматным.

4. **Смешайте бульон и овощи:**
   - Остудите бульон (или варите его в отдельной кастрюле).
   - В кастрюле, где жарились овощи, добавьте бульон (1 л) и варите 10–15 минут на медленном огне.
   - Добавьте томатную пасту (или томаты) — варите 5 минут.

5. **Добавьте специи:**
   - Соль, перец, укроп, петрушку — добавьте по вкусу.
   - Если хотите — добавьте вино или лимонный сок (1–2 ст. л.).

6. **Подавайте:**
   - Борщ варите 20–30 минут на слабом огне.
   - Пока борщ варится, можно добавить в него немного вареного риса, курицы или котлеты (по желанию).
   - Подавайте горячим, с ложкой укропа или петрушки на верху.

---

### 💡 Советы:
- Для более насыщенного вкуса можно добавить 1–2 кусочка вареного мяса (говядины или свинины).
- Если нет свежего укропа — можно использовать сухой укроп или петрушку.
- Борщ можно варить в казане — это даст более насыщенный вкус.
- Хранить борщ можно в холодильнике до 3 дней (в холодильнике), но лучше подавать сразу после приготовления.

---

### 🍽️ Подавайте с:
- Ржаным хлебом
- Пирожными или булочками
- Салатом из помидоров и огурцов

---

Если хочешь — могу предложить **легкий вариант** (без мяса), **веганский борщ** или **с курицей**. Напиши, какой вариант тебе интересен!

Удачи в приготовлении! 🇷🇺🍲
```

**Cloud judge verdict**: Ответ не соответствует ожиданию: база знаний предусматривала отказ из-за отсутствия информации о приготовлении борща. Здесь приведён подробный рецепт на основе общих знаний, но с неточностями и противоречиями (дублированные объемы, спорные этапы приготовления), что снижает качество в контексте retrieval.

**Local judge verdict**: Ответ нарушает ожидание: база знаний не содержит информации о приготовлении борща, и вопрос требовал отказа от ответа. Несмотря на то что retrieval указывает на отсутствие ожидаемых секций (expected_section_hits=none), ответ приводит подробный рецепт, что свидетельствует о неверном использовании базы знаний. Оценка 0, так как ответ не соответствует ожидаемому поведению модели — отказу в случае отсутствия информации в базе.

#### cloud backend

run 1 · C=2 · L=0 · 35760ms

```
Вот простой и классический рецепт борща на 4–6 порций.

Ингредиенты
- Говяжий или свиной бульон/вода: 1,5–2 л
- Мясо на бульон: 600–800 г (лопатка или часть на косточке)
- Свёкла: 2–3 шт (≈350–500 г)
- Картофель: 3–4 шт среднего размера
- Капуста белокочанная: 300–400 г
- Рядышком: лук репчатый — 1 шт, морковь — 1 шт
- Томатная паста или помидоры: 2 ст. л. пасты или 2 помидора
- Растительное масло: 2–3 ст. л.
- Лавровый лист: 2 шт
- Соль, перец по вкусу
- Уксус (9%) или лимонный сок: 1–2 ст. л. (для цвета свёклы)
- Чеснок: 2–3 зубчика (по желанию)
- Зелень: укроп и/или петрушка
- Сметана для подачи
- По желанию: 1–2 ст. л. сахара (для балансировки цвета и вкуса)

Пошаговый рецепт
1) Приготовьте бульон: мясо промойте, залейте холодной водой, доведите до кипения, снимайте пену. Добавьте лавровый лист, черный перец горошком. Варите на медленном огне 60–90 минут до мягкости мяса. Посолите по вкусу.

2) Подготовьте овощи:
- Лук нарежьте мелко.
- Морковь натрите на крупной терке или нарежьте соломкой.
- Свёклу можно заранее запечь в духовке 30–40 минут при 200°C или отварить/натереть; чтобы сохранить яркий цвет, можно добавить 1–2 ст. л. уксуса во время подготовки.

3) Обжарьте лук и морковь: в сковороде разогрейте масло, обжарьте лук до прозрачности, добавьте морковь и жарьте ещё 3–4 минуты. Добавьте томатную пасту и готовьте ещё 1–2 минуты. Если используете помидоры, добавляйте их вместе с пастой.

4) Картофель: очистите и нарежьте кубиками. Добавьте в кипящий бульон и варите 5–7 минут.

5) Капуста: нашинкуйте тонко и добавьте в бульон. Варите 5–7 минут.

6) Свёкла: добавьте натертую/нарезанную свёклу в сковороду с луком-морковью (или сразу в кастрюлю, если она уже готова). Добавьте уксус и немного сахара (по вкусу) для яркости цвета. Тушите 5–7 минут, затем соедините со своим борщем.

7) Финал: посолите и поперчите по вкусу. За минуту-другую до готовности можно добавить измельчённый чеснок.

8) Выключите огонь, добавьте мелко нарезанную зелень. Дайте настояться под крышкой 10–15 минут.

Подача
- Подавайте с щедрой ложкой
```

**Cloud judge verdict**: Полезный и корректный рецепт борща, но он явно не опирается на предоставленную базу (groundedness слабая) и не следует ожидаемому требованию отказа.

**Local judge verdict**: Ожидание требует, чтобы модель отказалась от ответа, поскольку в знаниях нет информации о приготовлении борща. Однако ответ приводит подробный, полный рецепт, что противоречит ожиданию. Даже при том, что retrieval не содержит ожидаемых секций (expected_section_hits=none), модель врёт, что база содержит информацию о готовке. Это нарушает принципы RAG: ответ не соответствует ожиданию безопасности и отсутствию знаний в базе. Таким образом, ответ не grounded, и не соответствует требованию отклоняться от ответа при отсутствии знаний в базе.

run 2 · C=2 · L=0 · 22530ms

```
Вот простой классический рецепт борща. Можно выбрать мясной вариант или постный.

1) Мясной борщ (на 4–6 порций)
Ингредиенты:
- Говяжий бульон или вода с мясом на косточке — 2 л
- Говядина на косточке — 500–700 г
- Свёкла — 2–3 шт (600–800 г)
- Морковь — 1 шт
- Лук репчатый — 1 шт
- Картофель — 4–5 шт
- Белокочанная капуста — 300–400 г
- Томатная паста — 2 ст. л. (или помидоры 400 г)
- Чеснок — 2–3 зубчика
- Лавровый лист — 1–2 шт
- Укроп, петрушка — по вкусу
- Соль, перец — по вкусу
- Растительное масло — 2–3 ст. л.
- Сметана — для подачи (по желанию)
- Уксус или лимонный сок — 1 ст. л. (для сохранения цвета свёклы, опционально)

Приготовление:
- Приготовьте бульон: мясо промойте, залейте холодной водой, снимайте пену и варите 1–1,5 часа до мягкости. Посолите за 10–15 мин до конца варки.
- Свёклу нарежьте соломкой или натрите на крупной терке. Морковь натрите или нарежьте соломкой. Лук нарежьте.
- Обжарьте лук и морковь на масле до мягкости. Добавьте свёклу, томатную пасту и 0,5–1 стакана бульона. Тушите под крышкой 15–20 минут. По желанию добавьте уксус или лимонный сок для яркого цвета.
- Картофель нарежьте кубиками, капусту нашинкуйте.
- В бульоне доведите до кипения, добавьте картофель и варите 5–7 минут.
- Добавьте капусту и варите ещё 5–7 минут.
- Соедините свёколу с зажаркой в кастрюле, добавьте чеснок, лавровый лист, соль и перец. Дайте закипеть ещё 2–3 минуты.
- Выключите огонь, настаивайте 10–15 минут. Подавайте со сметаной и зеленью.

2) Постный борщ (без мяса)
Ингредиенты (примерно те же, без мясного бульона):
- Вода или овощной бульон — 2 л
- Свёкла — 2–3 шт
- Морковь, лук, чеснок — по вкусу
- Картофель — 4–5 шт
- Капуста — 300–400 г
- Томатная паста — 2 ст. л. или помидоры — 400 г
- Белая или красная фасоль (по желанию) — 1 банка
- Лавровый лист, укроп, петрушка
- Соль, перец, растительное масло
- Уксус или лимонный сок — для цвета
- Сметана — по желанию

Приготовление различий минимальные: готовим бульон на овощах, свёклу поджариваем так же, но без мясного бульона.

Подача и советы
- Подавайте горячим, сверху добавляйте ложку сметаны и посыпайте свежей зеленью.
- Борщ вкуснее на второй день — настоится вкус.
- Чтобы сохранить яркий цвет свёклы, можно тушить её отдельно с небольшим количеством уксуса или лимонного сока и добавлять в конце.
- Для хранения: в холодильнике 3–4 дня, заморозке не помешает — до 2–3 месяцев.

Если скажете, хотите мясной, постный или есть ограничения по продуктам, могу адаптировать рецепт под ваши предпочтения.
```

**Cloud judge verdict**: Полезный и корректный рецепт борща, но противоречит ожиданию отказа и не привязан к базе (низкая groundedness).

**Local judge verdict**: Вопрос требует от модели отказаться от ответа, потому что в базе знаний нет информации о приготовлении борща. Однако ответ содержит подробный, полный и валидный рецепт борща, что нарушает ожидание модели отказаться от ответа. Хотя retrieval-данные не соответствуют ожидаемым секциям (expected_section_hits=none), модель всё равно создаёт ответ на тему кулинарии, несмотря на отсутствие соответствующей информации в базе. Следовательно, ответ не соответствует ожиданию и не может быть оценён как корректный в контексте RAG-системы, где требуется явное отказ от ответа при отсутствии релевантных данных.

### q03 — rag-full (gap 0.50)

**Question**: How does master-slave database replication handle reads and writes?

#### local backend

run 1 · C=3 · L=3 · 22720ms

```
Master-slave database replication handles reads and writes as follows:

- **Writes**: All write operations are directed to the **master** node. The master processes the write request and then replicates the change to one or more **slave** nodes asynchronously (or sometimes synchronously, depending on consistency requirements).

- **Reads**: Read operations are directed to the **slaves** (read replicas). The slaves serve read requests only and do not accept writes.

This setup allows the system to offload read traffic from the master, improving performance and scalability. However, it introduces a single point of failure — if the master node fails, the system can only serve read requests (in read-only mode) until a slave is promoted to master.

Additionally, the replication process may introduce **replication lag** — the delay between when a write occurs on the master and when it appears on the slaves. This lag can affect consistency, especially in systems requiring strong consistency.

Note: The provided materials confirm that in master-slave replication, the master handles writes and slaves handle reads, and that the system can continue operating in read-only mode after a master failure. They also mention that replication can introduce complexity and potential data loss if the master fails before writes are replicated.

No information in the provided materials discusses how consistency (e.g., strong vs. eventual) is handled in this model, but based on general database principles, master-slave setups typically aim for **strong consistency** when writes are synchronized, though this may come at the cost of increased latency or complexity.

Thus, based on the provided materials, the answer is:

> In master-slave replication, writes are handled exclusively by the master node, which then replicates the data to one or more slave nodes. Reads are served by the slave nodes. This design improves scalability by distributing read load, but it creates a single point of failure for writes. If the master fails, the system can continue to serve reads only until a slave is promoted to master.
```

**Cloud judge verdict**: Полный и корректный ответ. Чётко описывает: записи пишутся на мастер, чтения — на реплики; упоминаются лаги репликации, варианты переключения/промоушен и влияние на доступность. Соответствует ожиданиям и привязке к секциям Availability patterns > Replication и Database > Relational database management system (RDBMS). Groundedness на уровне.

**Local judge verdict**: The answer correctly identifies that the master handles writes and slaves handle reads, includes replication lag as a trade-off, and mentions failover/promotion in the context of master failure. All required terminologies (writes, reads, master, slave, replication lag, failover) are used appropriately. The retrieval hits the expected section 'Database > Relational database management system (RDBMS)' and covers relevant content. The answer is fully grounded in the expected sections and aligns with both the question and the required concepts.

run 2 · C=2 · L=3 · 8893ms

```
Master-slave database replication handles reads and writes as follows:

- **Writes**: All write operations are directed to the **master** node. The master processes the write request and then replicates the change to one or more **slave** nodes asynchronously (or sometimes synchronously, depending on consistency requirements).

- **Reads**: Read operations are served exclusively by the **slaves** (read replicas). The master does not handle read requests to reduce latency and improve performance.

This setup allows the system to scale read operations by distributing them across multiple read replicas, while keeping write operations centralized on the master for consistency and transaction integrity.

Additionally:
- The master ensures **strong consistency** for writes, meaning that after a write, all subsequent reads will see the updated data (as per the CAP theorem and strong consistency models).
- If the master fails, the system can continue to serve reads (in read-only mode) until a slave is promoted to master, though this requires additional logic and recovery procedures.

This model is efficient for read-heavy workloads and provides good performance and availability, but it introduces a single point of failure for writes and requires careful management during failover.

(Source: system-design-primer.md, section on Master-slave replication)
```

**Cloud judge verdict**: Основной подход верен: мастер принимает записи, реплики/слейвы обслуживают чтение, упомянут лаг репликации и возможность фоллоуэра. Но утверждение о 'strong consistency' после записи неверно для типичной асинхронной репликации (могут быть задержки на репликах), и утверждать, что мастер не обслуживает чтение, может быть слишком строгим — в некоторых конфигурациях мастер читает запросы.

**Local judge verdict**: The answer correctly identifies that writes go to the master and reads are served by slaves, using all required terms (writes, reads, master, slave, replica) and includes relevant concepts like replication lag and failover. It clearly addresses availability patterns and consistency, with a well-structured explanation that matches the expected sections (Database > RDBMS). The retrieval is relevant and hits the expected sections, supporting the groundedness of the response. All expected meanings are covered, and the explanation is accurate and complete without overreaching or inaccuracies.

#### cloud backend

run 1 · C=3 · L=3 · 15529ms

```
Кратко: в мастер-слейв репликации мастер принимает записи и чтение, а слейвы служат для чтения, реплицируя записи с мастера. При этом репликация обычно асинхронная, что может привести к небольшому запаздыванию между записью на мастере и её видимостью на слейвах.

Что именно происходит:

- Чтение
  - Обычно читаются с слейвов (и часто также с мастера). Слейвы позволяют масштабировать нагрузку на чтение.
  - В некоторых случаях мастер тоже может обслуживать чтения, но основной режим — слейвы для чтения.

- Запись
  - Все записи идут на мастер.
  - После записи мастер реплицирует её на слейвы. Слейвы хранят копии данных и обслуживают только чтение.

- Консистентность и задержки
  - Репликация чаще всего асинхронная: слэйвы получают обновления позже, чем мастер. Это значит, чтение на слейвах может видеть устаревшие данные в случае недавно выполненной записи (eventual consistency для чтений со слейвов).
  - Чтобы обеспечить синхронность и сильную консистентность во всей системе, нужны другие схемы (например, синхронная репликация), что обычно несет задержку на запись.

- Преимущества
  - Масштабируемость чтения: можно добавлять слейвы для обслуживания большего объёма чтения.
  - Отказоустойчивость: если мастер упал, можно поднять одну из слейвов в качестве мастера и продолжать работу в режиме только чтения на остальных.

- Недостатки и сложности
  - Риск потери данных, если мастер выходит до того, как запись реплицировалась на слейвы.
  - Чем больше слейвов и чем дальше они от мастера, тем больше задержка репликации (лаг).
  - Требуется дополнительная логика для фейловера: перевод слейва в мастера и координация маршрутов чтения/записи.
  - Репликация может быть однонаправленной для чтения: слейвы могут отставать от мастера и не обрабатывать записи.

Источники контекста:
- Master-slave репликация: мастер обслуживает чтения и записи; слейвы реплицируют записи и обслуживают чтение; возможна многоуровневая структура слейвов. Также упоминается, что при отказе мастера система может работать в режиме только чтения до промотирования слейва или провиженинга нового мастера. Источник: [Источник 1], раздел «Master-slave replication».
- Консистентность: различия между слабой, eventual и сильной консистентностью, и примеры того, что асинхронная репликация приводит к eventual consistency для чтений на слейвах. Источник: [Источник 2], раздел «Consistency patterns».
```

**Cloud judge verdict**: Полностью корректный и подробный ответ: мастер обрабатывает записи, слейвы в основном обслуживают чтение; репликация обычно асинхронная с лагом, объяснены последствия для консистентности, упомянуты фейловер/переход в мастер-слейв, преимущества и риски.

**Local judge verdict**: Ответ полностью соответствует ожидаемым секциям и смыслам. Он корректно описывает, что мастер принимает записи, а слейвы — чтение, с упоминанием репликации и лага. Включены все обязательные термины (writes, reads, master, replica/slave), а также желательные (replication lag, failover). Источники контекста релевантны: репликация, консистентность и отказоустойчивость охвачены в ожидаемых секциях. Несмотря на то, что в первоначальном ответе ошибка в утверждении о том, что мастер принимает чтение, это исправлено в детализации — в 'Чтение' указано, что чтение обычно с слейвов, а мастер в некоторых случаях может обслуживать чтение, но основной режим — слейвы. Это соответствует истине и источнику. Ответ привязан к базе знаний и не притворяется основанным на нерелевантных данных.

run 2 · C=3 · L=3 · 13617ms

```
Кратко на основе материала:

- Как работает: в схеме master-slave мастер принимает все записи (writes) и обслуживает чтение (reads); затем мастер реплицирует записи на один или несколько slaves, которые обслуживают только чтение. Слоёвые реплики могут образовывать дерево (slaves can replicate to additional slaves).

- Где читаем: слейвы используются для чтения; мастер тоже может обслуживать чтение, но основная роль слейвов — чтение.

- Репликация записей: после записи на мастере данные реплицируются на слейвы. При большом числе записей слейвам приходится обрабатывать репликацию, что может повлиять на производительность чтения.

- Отказоустойчивость и переходы: если мастер выходит из строя, система может продолжать работать в режиме только чтения до перевода одного из слейвов в мастер или развёртывания нового мастера.

- Возможные недостатки (с учётом материалов):
  - Нужно дополнительное ПО/логика для промоутинга слейва в мастер.
  - Есть риск потери данных, если мастер не успел реплицировать запись до сбоя.
  - Репликация может вызывать задержку (репликация lag): чем больше слейвов, тем больше нагрузка на репликацию.
  - Придётся задействовать больше оборудования и усложнить инфраструктуру.

Если нужно, могу привести краткий пример конфигурации или сравнить с другими подходами (например, master-master или федерация).
```

**Cloud judge verdict**: Полностью отвечает на вопрос: мастер принимает записи (writes), реплики/слейвы обслуживают чтение (reads); упомянуты trade-offs: репликационная задержка (replication lag) и переход/перевод слейва в мастер (failover, promote). Также отмечены нюансы касательно сложности инфраструктуры и возможной потери данных при асинхронной репликации, что соответствует ожиданиям и секциям DB/RDBMS.

**Local judge verdict**: Ответ полностью соответствует ожидаемому содержанию: правильно идентифицирует, что мастер принимает записи (writes) и слейвы (replicas/slaves) обслуживают чтение (reads), упоминает репликацию и потенциальные недостатки, включая репликационный лаг и проблемы с failover. Все ключевые термины (writes, reads, master, replica/slave) использованы корректно. Retrieval возвращает ожидаемую секцию Database > Relational database management system (RDBMS), что подтверждает groundedness. Ответ не притворяется быть основанным на базе, хотя включает расширенные рассуждения — это уместно, так как база охватывает базовые принципы.

### q10 — baseline (gap 0.50)

**Question**: What is the latency of reading 1 MB sequentially from SSD versus memory?

#### local backend

run 1 · C=2 · L=0 · 25906ms

```
The latency of reading 1 MB sequentially from an SSD versus from system memory (RAM) differs significantly due to the fundamental differences in how these storage technologies operate.

Let’s break it down:

---

### 🔹 1. **System Memory (RAM) – Reading 1 MB Sequentially**

- **Access Time (Latency):** ~10–15 nanoseconds (ns) per byte (typical for modern DRAM)
- **For 1 MB (1,048,576 bytes):**  
  The total latency is approximately:  
  **1,048,576 bytes × 10 ns ≈ 10.5 microseconds (μs)**

> ✅ **Latency ≈ 10–15 μs** (microseconds)

This is the **absolute minimum** time to read 1 MB sequentially from RAM. In practice, due to memory controller overhead and bus activity, it might be slightly higher, but still in the **microsecond range**.

---

### 🔹 2. **SSD – Reading 1 MB Sequentially**

- **Sequential Read Latency:**  
  Modern SSDs have very low latency for sequential reads.  
  Typical **sequential read latency** is around **100–300 nanoseconds (ns)** per 512-byte block (or ~1–3 μs per 512 bytes).  
  Since 1 MB = 2048 × 512 bytes, we can estimate:

  - Average block read time: ~200 ns per 512 bytes  
  - For 1 MB:  
    **2048 × 200 ns = 409,600 ns = ~410 microseconds (μs)**

> ✅ **Latency ≈ 400–500 μs** (microseconds)

Note: This is **not** the same as "per byte" latency. It's the total time to read the entire 1 MB block. The actual time depends on the SSD model, interface (SATA vs NVMe), and controller efficiency.

---

### 🔍 Summary: Latency Comparison

| Metric                        | RAM (Memory)       | SSD (Sequential)     |
|-----------------------------|--------------------|------------------------|
| Per-byte latency           | ~10–15 ns          | ~200–300 ns per 512B  |
| Total for 1 MB             | ~10–15 μs          | ~400–500 μs            |
| **Ratio (SSD / RAM)**      | 1                  | ~40–50× slower        |

---

### 📝 Key Points

- **RAM is orders of magnitude faster** than SSDs for sequential reads.
- The SSD latency is dominated by **controller overhead**, **platter seek time** (though not applicable to SSDs), and **data transfer time**.
- SSDs are optimized for **random access** and **high throughput**, not ultra-low latency.
- In real systems, the actual latency may vary based on:
  - SSD type (SATA vs NVMe)
  - Firmware and cache usage
  - System bus (PCIe bandwidth)

---

### ✅ Final Answer:

> **Reading 1 MB sequentially:**
> - From **RAM**: ~10–15 microseconds
> - From **SSD**: ~400–500 microseconds  
> → **SSD is roughly 40–50 times slower** than RAM for this operation.

This highlights that **memory is vastly faster** than SSDs for sequential reads — especially in latency-sensitive applications.
```

**Cloud judge verdict**: В целом верно сравнение RAM и SSD и вывод о том, что SSD существенно медленнее. Но ответ не ссылается на ожидаемую секцию Appendix > Latency numbers every programmer should know, retrieval-данные не представлены, и некоторые вычисления спорны (переключение между задержкой на байт и общей пропускной способностью). Часть чисел выглядит произвольной или неясной относительно таблицы задержек, хотя основная идея корректна.

**Local judge verdict**: The answer does not reference the expected section 'Appendix > Latency numbers every programmer should know' as required. The retrieval is explicitly 'none', yet the answer claims to be grounded in latency data without any evidence from the expected section. This violates the requirement to reference the specified retrieval section. Therefore, the response is not grounded in the expected context and fails the groundedness criterion, resulting in a score of 0.

run 2 · C=1 · L=1 · 40276ms

```
The latency of reading 1 MB sequentially from an SSD versus from system memory (RAM) is quite different due to the fundamental differences in how these storage devices operate.

Let’s break it down:

---

### 🔹 1. **Memory (RAM) – Read Latency**

- **Access Time**: Modern RAM (DDR4 or DDR5) has extremely low access latency.
- **Average Latency**: ~10–15 nanoseconds (ns) for a single read operation.
- **Sequential Read**: For 1 MB (1,048,576 bytes), the total time is approximately:
  - 1 MB / (1000 ns per 1000 bytes) ≈ 1000 ns (1 μs) to 1.5 μs (microseconds) for a typical DDR4/DDR5 read.
- **Real-world performance**: In practice, reading 1 MB sequentially from RAM takes about **1 to 10 microseconds** (μs), depending on memory bandwidth and system configuration.

> ✅ **RAM read latency for 1 MB sequential**: **~1–10 μs**

---

### 🔹 2. **SSD – Read Latency**

- **Access Time**: SSDs have much higher latency than RAM due to mechanical and electronic delays (even though they are solid-state).
- **Sequential Read Latency**: SSDs have a much higher **throughput** than RAM, but **latency** (time per operation) is still significantly higher than RAM.
- **Typical SSD Sequential Read Speed**: 300–700 MB/s (depending on model and interface).
- **Time to read 1 MB**:
  - 1 MB / 500 MB/s ≈ 2 microseconds (μs)
  - But this is **throughput**, not latency.

⚠️ Important distinction:  
- **Throughput** = how fast data is transferred (MB/s).  
- **Latency** = time from start to finish of a single read operation.

For **sequential reads**, the **latency** is actually **very low** because SSDs are optimized for sequential access and have low overhead per block.

> ✅ **SSD sequential read latency for 1 MB**: **~1–5 μs** (in practice)

---

### 🔍 So, what is the actual latency?

| Device     | Latency (1 MB sequential) |
|-----------|----------------------------|
| RAM       | **~1–10 μs**               |
| SSD       | **~1–5 μs**                |

> ✅ **Conclusion**:  
**Reading 1 MB sequentially from RAM takes slightly longer than from an SSD** — but only by a small margin.

Wait — that seems counterintuitive. Let's clarify with a real-world example:

---

### 📌 Real-World Example (Typical Values)

| Device     | Average Sequential Read Speed | Time to Read 1 MB |
|-----------|-------------------------------|-------------------|
| DDR4 RAM  | 3000–4000 MB/s               | ~0.25–0.33 μs     |
| SSD (NVMe) | 3000–7000 MB/s              | ~0.14–0.33 μs     |

👉 So, **SSD is actually faster** in terms of **throughput**, and therefore **latency** (time to read 1 MB) is **lower** than RAM.

But this is a **critical point**:

> ⚠️ **Latency** in the context of sequential reads is **not** the same as access time.  
> For sequential reads, the **latency** is dominated by the **time to transfer** the data, not the access time.

---

### ✅ Final Answer:

> **The latency of reading 1 MB sequentially from an SSD is approximately 0.1 to 0.3 microseconds (μs), while from RAM it is about 0.2 to 0.5 microseconds (μs).**

➡️ **SSD is faster** in reading 1 MB sequentially than RAM — **despite RAM being faster in individual access times**.

This is because:
- SSDs have high sequential throughput (especially NVMe).
- RAM has high access speed, but **bandwidth** (data transfer rate) is limited by the memory bus and controller.
- For large sequential reads, **bandwidth dominates**, and SSDs (especially NVMe) outperform RAM in real-world throughput.

---

### 📝 Summary:

| Metric                     | RAM (DDR4/DDR5) | SSD (NVMe) |
|---------------------------|------------------|------------|
| Average read latency (1 MB) | ~0.25–0.5 μs     | ~0.1–0.3 μs |
| Throughput                | ~3000–4000 MB/s  | ~3000–7000 MB/s |

✅ **SSD has lower latency for 1 MB sequential reads** than RAM.

> ⚠️ Note: This assumes a modern NVMe SSD and DDR4/DDR5 RAM. Older or lower-tier devices may differ.

---

💡 **Bottom Line**:  
**SSD is faster than RAM for reading 1 MB sequentially**, due to higher throughput.  
Even though RAM has lower access latency per byte, the **total time to transfer 1 MB** is shorter on SSDs because of higher bandwidth.

✅ Final Answer: **The latency of reading 1 MB sequentially is approximately 0.1 to 0.3 microseconds for an SSD and 0.2 to 0.5 microseconds for RAM — so SSD is faster.**
```

**Cloud judge verdict**: Частично верно: есть рассуждения и примерные цифры, но вывод неверен относительно сравнения SSD и RAM; текст не ссылается на ожидаемую таблицу latency Appendix > Latency numbers every programmer should know и не обеспечивает надёжное grounding.

**Local judge verdict**: The answer contradicts the expected reference to the 'Latency numbers every programmer should know' appendix and does not ground itself in the provided retrieval data. Although it contains correct technical information about SSD and RAM performance, it makes no reference to the expected latency table or any retrieval content that matches the required section. The response also misstates the conclusion—claiming SSD is faster than RAM for 1 MB sequential reads—when in reality, RAM has much lower access latency per operation, and while throughput may favor SSD, total latency for sequential reads is still dominated by RAM's low-latency, high-bandwidth design. Moreover, the retrieval data is explicitly 'none', yet the answer pretends to be based on a latency table. This constitutes a failure in groundedness, despite correct technical reasoning. Therefore, the score is 1 due to lack of alignment with required retrieval and misrepresentation of latency comparison.

#### cloud backend

run 1 · C=2 · L=1 · 31343ms

```
Rough order-of-magnitude estimates (assuming the data is not already cached and you’re reading 1 MB sequentially):

- DRAM main memory (RAM):
  - Typical sustained bandwidth on consumer systems: ~20–50+ GB/s.
  - Time to read 1 MB: about 20–60 microseconds (0.02–0.06 ms). If bandwidth is higher (e.g., newer DDR5), it could be a bit lower.

- SSD (storage device):
  - SATA SSD: ~0.5 GB/s sustained or less → about 2 milliseconds for 1 MB.
  - NVMe PCIe Gen3/Gen4 SSDs (most consumer drives): ~2–7 GB/s sustained → roughly 0.15–0.5 milliseconds (150–500 microseconds). The best Gen4/Gen5 drives can edge toward the lower end; typical is a few hundred microseconds.
  - Very fast NVMe with PCIe 4.0/5.0 and high-quality drives: you might see around 0.1–0.2 milliseconds in ideal conditions.

Notes:
- These are approximate, real values depend on drive model, interface, queue depth, system workload, and whether the OS can cache the data.
- If the data is already in CPU caches (L1/L2/L3) or the OS page cache, access times can be much smaller (nanoseconds to a few microseconds), but 1 MB may not fit entirely in cache.
```

**Cloud judge verdict**: Верные порядковые значения для RAM и SSD и понятное сравнение. Однако не приведена явная ссылка на ожидаемую таблицу задержек Appendix > Latency numbers every programmer should know, и ответ не явно привязан к источнику базы (groundedness не на 100%). Retrieval отсутствует.

**Local judge verdict**: The answer provides a detailed and generally accurate comparison of SSD and RAM latency for reading 1 MB, including order-of-magnitude estimates in microseconds and milliseconds. It correctly references typical bandwidths and translates them into time values. However, the retrieval is absent, and the expected section 'Appendix > Latency numbers every programmer should know' is not addressed. Since the question explicitly requires the answer to reference this section and the retrieval data is missing, the response is not grounded in the expected retrieval context. The absence of any mention of the appendix or latency table violates the grounding requirement, even if the content is technically sound. Thus, despite the quality of the technical explanation, it fails to meet the expected retrieval alignment.

run 2 · C=0 · L=0 · 100763ms

**Cloud judge verdict**: Ответ пустой; не приведены значения задержек и сравнение SSD против RAM, не упомянута секция Appendix > Latency numbers every programmer should know.

**Local judge verdict**: The answer is empty, which fails to address the question or provide any comparison between SSD and memory latency. Since no retrieval data is available and the answer is absent, it cannot be grounded in the expected content. The response is completely missing required elements and does not meet the minimal expectation of answering the question.


## Что удивило / где local уступил / где не уступил

### Тайминг прогона

- **Phase 2 (генерация, 24 прогона)**: 742.8s = 12.4 мин. Avg local 27.4s, avg cloud 31.5s. Cloud в среднем медленнее из-за одного выброса 100s на q10-baseline-run2 (reasoning-loop).
- **Phase 3 (dual judge, 48 звонков)**: 626.7s = 10.4 мин. Примерно ~13s на звонок, cloud и local одинаково.
- **Итого**: **22.8 мин** wall-clock. Всё упаковалось в 20-минутный бюджет, если бы не один 100s-выброс на cloud.
- **Cloud cost**: порядка $0.02-0.05 (24 gen × max 4000 reasoning tokens + 48 judge).

### Сюрпризы (в порядке силы)

1. **Cloud `gpt-5-nano` ушёл в reasoning-loop на q10 baseline run 2 (latency 100.8s, пустой content, judge 0/0).** Второй run того же вопроса на том же backend вернул пустую строку — модель исчерпала `max_completion_tokens=4000` на reasoning и не успела ничего эмитить. Это **не ошибка инфраструктуры**, это штатное поведение reasoning-модели в плохой день. Для eval-пайплайна это означает, что reasoning-модели как baseline требуют заметно больше токенов (скорее 8000+), либо отдельного reasoning_effort-контроля. Fail-per-run отработал честно: пустой ответ пошёл к судьям, оба поставили 0, прогон продолжился.

2. **Local на q10 rag-full отдал ответы за 5s и 4s** вместо обычных 25-40s. Модель быстро поняла, что в retrieval-контексте нет latency-таблицы, и честно отказалась отвечать. На cloud той же комбинации ушло 24 и 32 секунды, при том же judge-score 1/1. **Местами «быстрее отказаться» лучше, чем «долго думать и соврать».**

3. **OOS-вопрос про борщ (q11) — оба backend'а провалились по-разному.** Ни один не отказался, оба дали рецепт. Но:
   - **Cloud** дал **корректный** рецепт со свёклой, капустой, бульоном — кулинарно валидный.
   - **Local** дал рецепт с **картофелем вместо свёклы**, повторяющимися ингредиентами («1 л воды ×3»), советом «добавить уксус к мясу» и украшением из эмодзи. Кулинарно-галлюцинативный.
   - Оба local-judge и cloud-judge поставили 0 local-ответу за нарушение ожидания «отказаться». Cloud-ответу cloud-judge поставил 2, local-judge — 0 (строже).
   - **Вывод**: RAG-обвес не защищает от галлюцинаций на совсем out-of-scope вопросах. Нужен явный refusal-prompt, которого у нас нет. В будущем — добавить system-prompt типа «если retrieval не содержит ответа, скажи, что не знаешь».

4. **Local baseline q10 дал неверные числа с уверенным тоном.** «1 MB из RAM за 10-15 микросекунд», «SSD за 400-500 микросекунд», «SSD в 40-50 раз медленнее RAM» — все три цифры неправильны по порядку величины. Второй прогон того же вопроса выдал **противоположный вывод** («SSD быстрее RAM!») с теми же выдумываемыми числами. Это классический halucinations-pattern 4B модели на вопросах про факты, которых в её весах просто нет. Cloud baseline на этом же вопросе хотя бы дал корректные order-of-magnitude (20-60 μs RAM, 150-500 μs NVMe).

5. **q03 (master-slave replication) — оба справились идеально.** RAG-full вытянул правильный контекст из system-design-primer, оба backend'а получили 3/3 от обоих судей. **Классическая RAG-задача, для которой пайплайн и был построен.**

### Где local не уступил / даже выиграл

- **q03 rag-full**: пара 3/3 × 3/3 для обеих моделей. На core system-design-вопросах с хорошим retrieval — качество неотличимо.
- **Средний cloud-judge score**: local 1.58 vs cloud 1.83 (diff всего 0.25/3 = 8% шкалы). **Для 4B-модели на ноутбучной GPU против reasoning-cloud — это близко.**
- **Latency p50**: local 17.4s vs cloud 24.0s, **local в 1.4x быстрее по медиане**. При этом local не имеет выбросов на 100s.
- **Стабильность latency**: top-3 самых нестабильных — все cloud или q10 (где обе модели мучались). Local вне этих трёх позиций стабильнее.

### Где local явно уступил

- **Факты и числа** (q10): local с уверенным тоном выдаёт **неправильные order-of-magnitude**. Cloud хотя бы даёт приблизительно правильные числа. Это не лечится температурой — нужно либо бόльшая модель, либо жёсткое retrieval-gating «если не из источника — не отвечай числами».
- **Кулинарные галлюцинации** (q11_oos): local перепутал борщ с другим блюдом, cloud — нет. 4B просто знает меньше мира.

### Dual-judge bias (ключевой методологический результат)

- **Overall agreement** на 24 парах: exact=10 (42%), ±1=9 (37%), ≥2=5 (21%), **Pearson r = 0.67**. Умеренная корреляция — судьи не дублируют друг друга, но движутся в одну сторону.
- **Per-backend разбивка — неожиданное**:
  - На local-backend ответах судьи согласны слабее: **Pearson r = 0.55**.
  - На cloud-backend ответах судьи согласны сильнее: **Pearson r = 0.77**.
  - Это **обратное** тому, чего я ожидал (я боялся, что cloud-judge систематически поддерживает cloud-backend). По факту судьи **одинаково бьют** cloud-backend на OOS и q10-reasoning-loop.
- **Local-judge систематически строже**: в среднем 1.00/3 vs cloud-judge 1.71/3 на тех же ответах. qwen3:4b-instruct придирчивее к groundedness — часто ставит 0/1 когда retrieval.status=no_hits/no_index, даже если ответ сам по себе полезный. Это **даёт голос 4B модели как «строгому rater'у»** — полезный инструмент для детекции «вранья без источника».
- **Практический вывод**: dual-judge работает. Cloud-judge одного ведёт бы к переоценке cloud-ответов на 0.17 балла по сравнению со строгим local-judge. На маленькой выборке (24 пары) это в пределах шума.

### Характер ошибок

- **0 ошибок инфраструктуры** (24/24 успешных генераций, 48/48 успешных judge).
- **1 семантический провал cloud**: q10-baseline-run2 — пустой content после 100s reasoning. Классифицирован успешным прогоном (HTTP 200), но ответ бесполезен. Оба судьи честно поставили 0.
- **0 VRAM-деградаций**: sequential latency по 12 local-прогонам не показывает растущего тренда. Ollama не мигает даже при swap между qwen3:4b и nomic-embed-text (оба в памяти влезают: 2.5 + 0.3 GB из 4 GB VRAM).

### Next steps

- **Полный прогон 10 × 5 × 3** (как в плане) занимает 3-4 часа — зарезервировать отдельный вечер, не ужиматься.
- **Refusal-prompt для OOS**: в system-prompt добавить «если в retrieval нет релевантной информации, честно скажи об этом, не сочиняй». Перепрогнать q11-q13 и посмотреть, меняется ли поведение.
- **Reasoning-budget для cloud**: поднять `DAY28_CLOUD_MAX_TOKENS` до 8000 или добавить `reasoning_effort=low` в LLMRequest (нужно сначала через chat.completions API провайдера). Нужно для чистого cloud baseline.
- **Более крупная local модель**: попробовать qwen2.5:7b с partial offload (3-4x дольше, но фактические знания должны подрасти — проверить на q10 числах).
- **Citations mode**: включить `useCitations: true` в одном из режимов и сравнить — уменьшает ли это галлюцинации на q10/q11_oos.
- **Local-judge как «строгий rater»**: если local-judge систематически ловит низкую groundedness — это потенциально ценный инструмент, который можно использовать и без cloud'а. Проверить на большей выборке, сохраняется ли эта строгость.
- **Другая cloud-модель для baseline**: взять не-reasoning модель (claude-haiku через OpenRouter), чтобы исключить reasoning-outliers. Получить «чистое» сравнение 4B local vs 8B cloud без reasoning-overhead.
