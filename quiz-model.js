import { randomGenerator, shuffle, clamp, angularDistance } from "./astro.js?v=10";
import { eligibleObjects, normalizeName } from "./training.js?v=10";
import { parseCode, seedCode, changedSettings, seedParams } from "./codes.js?v=10";
import { pageUrl } from "./site-url.js?v=10";

export const QUESTION_TYPES = {
  "messier-name": "Название по номеру Мессье",
  "messier-number": "Номер Мессье по названию",
  "messier-type": "Тип объекта по названию",
  "messier-locator": "Мессье по карте-искателю",
  "star-bayer": "Байер по имени звезды",
  "star-name": "Имя звезды по Байеру",
  "star-constellation": "Созвездие по имени звезды",
  "star-locator": "Звезда по карте-искателю",
};
export const QUIZ_DEFAULTS = {
  seed: "684920157",
  count: 15,
  level: "beginner",
  answerMode: "choice",
  options: 4,
  types: Object.keys(QUESTION_TYPES),
  fov: 60,
  lines: true,
  shape: "circle",
  timeLimit: 0,
  feedback: "end",
};
export function validateQuiz(input = {}) {
  const q = { ...QUIZ_DEFAULTS, types: [...QUIZ_DEFAULTS.types].sort() };
  const code = parseCode(input.seed ?? q.seed, "Q");
  if (code.kind !== "Q") throw new Error("Для квиза нужен seed с префиксом Q.");
  q.seed = code.seed;
  for (const [key, min, max] of [
    ["count", 1, 40],
    ["options", 2, 6],
    ["fov", 20, 100],
    ["timeLimit", 0, 120],
  ])
    if (input[key] !== undefined) {
      const n = Number(input[key]);
      if (!Number.isFinite(n) || n < min || n > max)
        throw new Error("Проверь числовые настройки квиза");
      q[key] = Math.round(n);
    }
  for (const [key, allowed] of Object.entries({
    level: ["beginner", "standard", "advanced", "expert"],
    answerMode: ["choice", "text"],
    shape: ["circle", "rectangle"],
    feedback: ["end", "each"],
  }))
    if (input[key] !== undefined) {
      if (!allowed.includes(input[key]))
        throw new Error("Неизвестная настройка квиза");
      q[key] = input[key];
    }
  if (typeof input.lines === "boolean") q.lines = input.lines;
  if (input.types !== undefined) {
    if (
      !Array.isArray(input.types) ||
      !input.types.length ||
      input.types.some((t) => !Object.hasOwn(QUESTION_TYPES, t))
    )
      throw new Error("Выбери хотя бы один тип вопросов");
    q.types = [...new Set(input.types)].sort();
  }
  return q;
}

function definition(type, object) {
  const display = object.title || object.name;
  switch (type) {
    case "messier-name":
      return {
        prompt: `Как называется объект ${object.id}?`,
        answer: display,
        aliases: [display, object.english].filter(Boolean),
      };
    case "messier-number":
      return {
        prompt: `Какой номер Мессье имеет объект «${display}»?`,
        answer: object.id,
        aliases: [object.id, String(object.number), `М ${object.number}`],
      };
    case "messier-type":
      return {
        prompt: `К какому типу относится ${object.id} — ${display}?`,
        answer: object.typeName,
        aliases: [object.typeName],
      };
    case "star-bayer":
      return {
        prompt: `Каково обозначение Байера звезды «${object.name}»?`,
        answer: object.bayer,
        aliases: [object.bayer],
      };
    case "star-name":
      return {
        prompt: `Как называется звезда ${object.bayer}?`,
        answer: object.name,
        aliases: [object.name, object.english].filter(Boolean),
      };
    case "star-constellation":
      return {
        prompt: `В каком созвездии находится звезда «${object.name}»?`,
        answer: object.constellationName,
        aliases: [object.constellationName, object.constellation],
      };
    default:
      return {
        prompt: `${type.startsWith("star") ? "Какая звезда отмечена" : "Какой объект Мессье отмечен"} крестом на карте?`,
        answer: object.name,
        aliases: [
          object.name,
          object.id,
          object.title,
          object.english,
          object.bayer,
          ...(object.aliases || []),
        ].filter(Boolean),
        image: true,
      };
  }
}
export function generateQuiz(catalog, input) {
  const config = validateQuiz(input),
    random = randomGenerator(config.seed + "quiz-v1"),
    poolConfig = { ...config, magnitude: 6 };
  const pools = {
    messier: eligibleObjects(catalog, "messier", poolConfig),
    star: eligibleObjects(catalog, "stars", poolConfig),
  };
  const candidates = [];
  for (const type of config.types)
    for (const object of pools[type.startsWith("star") ? "star" : "messier"])
      if (
        !["messier-name", "messier-number"].includes(type) ||
        !/^(NGC|IC|WN)\s/i.test(object.title)
      )
        candidates.push({ type, object });
  const ordered = shuffle(candidates, random);
  const questions = [];
  for (const { type, object } of ordered) {
    if (questions.length >= config.count) break;
    const info = definition(type, object),
      pool = pools[type.startsWith("star") ? "star" : "messier"];
    const alternatives = [
      ...new Set(
        pool
          .filter(
            (other) =>
              !info.image ||
              angularDistance([object.ra, object.dec], [other.ra, other.dec]) >
                Math.max(1, config.fov / 40),
          )
          .map((other) => definition(type, other).answer),
      ),
    ].filter((answer) => normalizeName(answer) !== normalizeName(info.answer));
    const options = shuffle(
      [
        info.answer,
        ...shuffle(alternatives, random).slice(0, config.options - 1),
      ],
      random,
    );
    const offset = (random() - 0.5) * config.fov * 0.4;
    const map = {
      frame: "equatorial",
      ra:
        (object.ra +
          offset / Math.max(0.3, Math.cos((object.dec * Math.PI) / 180)) +
          360) %
        360,
      dec: clamp(object.dec + (random() - 0.5) * config.fov * 0.3, -89, 89),
      roll: Math.floor(random() * 360),
      fov: config.fov,
      projection: "stereo",
      shape: config.shape,
      aspect: 1.6,
      horizon: false,
      latitude: 0,
      longitude: 0,
      date: "2000-01-01T12:00Z",
      magnitude: 6,
      starSize: 1.25,
      display: "mono",
    };
    questions.push({
      ...info,
      type,
      object,
      options,
      map,
      id: `${type}-${object.id}`,
    });
  }
  return { config, questions };
}
export function gradeQuestion(question, value) {
  return question.aliases.some(
    (alias) => normalizeName(alias) === normalizeName(value),
  )
    ? 10
    : 0;
}
export function gradeQuiz(quiz, answers) {
  const rows = quiz.questions.map((question, i) => ({
    question,
    value: answers[i] || "",
    points: gradeQuestion(question, answers[i] || ""),
  }));
  return {
    rows,
    points: rows.reduce((sum, r) => sum + r.points, 0),
    maximum: rows.length * 10,
  };
}
export function quizUrl(url, config) {
  const c = validateQuiz(config),
    u = pageUrl("Q", url);
  u.search = "";
  u.hash = "";
  u.searchParams.set("seed", seedCode("Q", c.seed));
  const settings = { ...c };
  delete settings.seed;
  const defaults = { ...validateQuiz({ types: QUIZ_DEFAULTS.types }) };
  delete defaults.seed;
  const changed = changedSettings(settings, defaults);
  if (changed) u.searchParams.set("cfg", JSON.stringify(changed));
  return u.href;
}
export function readQuizUrl(url) {
  const params = seedParams(url);
  if (!params.has("seed")) return null;
  const raw = params.get("cfg");
  if (raw?.length > 6000) throw new Error("Слишком длинная ссылка");
  return validateQuiz({
    ...(raw ? JSON.parse(raw) : {}),
    seed: params.get("seed"),
  });
}
