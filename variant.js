import {
  boundaryCrossings,
  projector,
  randomGenerator,
  referencePoints,
  clamp,
  RAD,
} from "./astro.js?v=10";
import { selectTargets, visibleSegments, eligibleObjects } from "./training.js?v=10";
import { parseCode, seedCode, changedSettings, seedParams } from "./codes.js?v=10";
import { pageUrl } from "./site-url.js?v=10";

export const DEFAULT_MAPS = [
  {
    shape: "circle",
    aspect: 1,
    projection: "stereo",
    fov: 120,
    ra: 84,
    dec: 20,
    roll: 0,
  },
  {
    shape: "circle",
    aspect: 1,
    projection: "stereo",
    fov: 120,
    ra: 84,
    dec: 20,
    roll: 0,
  },
  {
    shape: "rectangle",
    aspect: 1.6,
    projection: "gnomonic",
    fov: 95,
    ra: 270,
    dec: -15,
    roll: 0,
  },
];
export const DEFAULT_CONFIG = {
  frame: "equatorial",
  ra: 84,
  dec: 20,
  az: 180,
  alt: 60,
  latitude: 55.75,
  longitude: 37.62,
  date: "2026-01-15T20:00Z",
  fov: 120,
  roll: 0,
  projection: "stereo",
  shape: "circle",
  aspect: 1,
  starCount: 21,
  messierCount: 24,
  count: 24,
  magnitude: 5.5,
  starSize: 1,
  exposure: 0.65,
  level: "beginner",
  display: "milkyway",
  horizon: false,
  bayerTest: false,
  edges: true,
  seed: "684920157",
  skyMode: "auto",
  maps: DEFAULT_MAPS,
};

export function validateConfig(input = {}) {
  const c = { ...DEFAULT_CONFIG };
  const ranges = {
    ra: [0, 360],
    dec: [-90, 90],
    az: [0, 360],
    alt: [-90, 90],
    latitude: [-90, 90],
    longitude: [-180, 180],
    fov: [20, 180],
    roll: [-360, 360],
    starCount: [1, 24],
    messierCount: [1, 24],
    magnitude: [0, 6],
    starSize: [0.5, 2.5],
    exposure: [0, 1.5],
  };
  for (const [key, [low, high]] of Object.entries(ranges))
    if (input[key] !== undefined) {
      const n = Number(input[key]);
      if (!Number.isFinite(n) || n < low || n > high)
        throw new Error(`Некорректный параметр ${key}`);
      c[key] = n;
    }
  for (const [key, values] of Object.entries({
    frame: ["equatorial", "horizon"],
    projection: ["stereo", "equidistant", "orthographic", "gnomonic"],
    level: ["beginner", "standard", "advanced", "expert"],
    display: ["stars", "milkyway", "mono", "paper"],
    skyMode: ["auto", "manual"],
  }))
    if (input[key] !== undefined) {
      if (!values.includes(input[key]))
        throw new Error(`Некорректный параметр ${key}`);
      c[key] = input[key];
    }
  for (const key of ["horizon", "bayerTest", "edges"])
    if (typeof input[key] === "boolean") c[key] = input[key];
  if (input.date !== undefined) {
    const date = new Date(input.date);
    if (
      !Number.isFinite(date.getTime()) ||
      date.getUTCFullYear() < 1900 ||
      date.getUTCFullYear() > 2100
    )
      throw new Error("Некорректная дата");
    c.date = date.toISOString();
  }
  const code = parseCode(input.seed ?? c.seed, "T");
  if (code.kind !== "T") throw new Error("Для тренажёра нужен seed с префиксом T.");
  c.seed = code.seed;
  c.date = new Date(c.date).toISOString();
  c.starCount = Math.round(c.starCount);
  c.messierCount = Math.round(c.messierCount);
  c.maps = DEFAULT_MAPS.map((defaults, index) => {
    const m = input.maps?.[index] || defaults;
    const result = { ...defaults };
    if (m.shape !== undefined && !["circle", "rectangle"].includes(m.shape))
      throw new Error("Неизвестная форма карты");
    if (
      m.projection !== undefined &&
      !["stereo", "equidistant", "orthographic", "gnomonic"].includes(
        m.projection,
      )
    )
      throw new Error("Неизвестная проекция");
    for (const key of ["shape", "projection"])
      if (m[key] !== undefined) result[key] = m[key];
    for (const [key, range] of Object.entries({
      ra: [0, 360],
      dec: [-90, 90],
      fov: [20, 180],
      roll: [-360, 360],
      aspect: [1, 2],
    }))
      if (m[key] !== undefined) {
        const n = Number(m[key]);
        if (!Number.isFinite(n) || n < range[0] || n > range[1])
          throw new Error("Некорректные параметры карты");
        result[key] = n;
      }
    if (result.projection === "gnomonic")
      result.fov = Math.min(150, result.fov);
    if (result.shape === "rectangle" && result.projection === "orthographic")
      result.fov = Math.min(110, result.fov);
    return result;
  });
  return c;
}

// Подбор области неба по seed. Для каждой карты берём случайные центры,
// пока в области не окажется достаточно материала для задания.
function pickSky(catalog, base) {
  const random = randomGenerator(base.seed + "sky-v1");
  const randomCenter = () => ({
    ra: Math.round(random() * 3600) / 10,
    dec: Math.round((Math.asin(random() * 1.7 - 0.85) / RAD) * 10) / 10,
  });
  const rollRandom = randomGenerator(base.seed + "maps-v3");
  const rolls = base.maps.map((m) => m.roll + Math.floor(rollRandom() * 360));
  const make = (index, center) => ({
    ...base,
    ...base.maps[index],
    ...center,
    roll: rolls[index],
  });
  const enough = (index, config) => {
    if (index === 0) {
      const p = projector(config);
      const inside = referencePoints.filter(
        (pt) =>
          ["spring", "autumn", "summer", "winter", "G1", "epsilon-1"].includes(pt.id) &&
          p.project(pt.ra, pt.dec),
      ).length;
      return inside >= 2 && boundaryCrossings(config).length >= 3;
    }
    const mode = index === 1 ? "stars" : "messier";
    const wanted = Math.min(
      index === 1 ? base.starCount : base.messierCount,
      eligibleObjects(catalog, mode, config).length,
    );
    const p = projector(config);
    const seen = eligibleObjects(catalog, mode, config).filter((o) =>
      p.project(o.ra, o.dec),
    ).length;
    if (seen < Math.ceil(wanted * 0.6)) return false;
    return index === 1 || visibleSegments(catalog, config).length >= 3;
  };
  return base.maps.map((_, index) => {
    let best = null;
    for (let attempt = 0; attempt < 60; attempt++) {
      const center = randomCenter();
      if (enough(index, make(index, center))) return center;
      best ||= center;
    }
    return best;
  });
}

export function createVariant(catalog, input) {
  const base = validateConfig(input),
    random = randomGenerator(base.seed + "maps-v3");
  const sky = base.skyMode === "auto" ? pickSky(catalog, base) : null;
  const configs = base.maps.map((map, index) => ({
    ...base,
    ...map,
    ...(sky ? sky[index] : {}),
    roll: map.roll + Math.floor(random() * 360),
    seed: base.seed,
    maps: undefined,
  }));
  const references = referencePoints.filter((point) =>
    ["spring", "autumn", "summer", "winter", "G1", "epsilon-1"].includes(
      point.id,
    ),
  );
  const edges = boundaryCrossings(configs[0]);
  const stars = selectTargets(catalog, "stars", {
    ...configs[1],
    count: base.starCount,
  });
  const messier = selectTargets(catalog, "messier", {
    ...configs[2],
    count: base.messierCount,
  });
  const lines = visibleSegments(catalog, configs[2]);
  const attempt = (mode, config, targets) => ({
    mode,
    config,
    targets,
    answers: {},
    selected: 0,
    checked: false,
    strokes: [],
    pending: null,
    entries: [],
    sandboxType: "messier",
  });
  return {
    seed: base.seed,
    base,
    configs,
    references,
    edges,
    attempts: {
      reference: attempt("reference", configs[0], [...references, ...edges]),
      stars: attempt("stars", configs[1], stars),
      messier: attempt("messier", configs[2], messier),
      lines: attempt("lines", configs[2], lines),
    },
    scores: {},
  };
}

export function variantSummary(variant) {
  const definitions = [
    ["points", "1. Опорные точки", variant.references.length ? 12 : 0],
    ["edges", "2. Пересечения с краем", variant.edges.length ? 12 : 0],
    ["stars", "3. Имена звёзд", variant.attempts.stars.targets.length * 2],
    [
      "messier",
      "4. Объекты Мессье",
      variant.attempts.messier.targets.length * 1.5,
    ],
    ["lines", "5. Фигуры созвездий", 16],
  ];
  const rows = definitions.map(([id, label, maximum]) => ({
    id,
    label,
    maximum,
    points: Math.round(clamp(variant.scores[id] ?? 0, 0, maximum) * 100) / 100,
    checked: maximum === 0 || Object.hasOwn(variant.scores, id),
  }));
  return {
    rows,
    points: Math.round(rows.reduce((sum, r) => sum + r.points, 0) * 100) / 100,
    maximum: Math.round(rows.reduce((sum, r) => sum + r.maximum, 0) * 100) / 100,
    complete: rows.every((r) => r.checked),
  };
}

export function variantUrl(url, config, mode = "messier") {
  const validated = validateConfig(config),
    result = pageUrl("T", url);
  result.search = "";
  result.hash = "";
  result.searchParams.set("seed", seedCode("T", validated.seed));
  const settings = { ...validated };
  delete settings.seed;
  const defaults = { ...validateConfig(), seed: undefined };
  delete defaults.seed;
  const changed = changedSettings(settings, defaults);
  if (changed) result.searchParams.set("cfg", JSON.stringify(changed));
  if (mode !== "messier") result.searchParams.set("mode", mode);
  return result.href;
}
export function readVariantUrl(url) {
  const params = seedParams(url);
  if (!params.has("seed")) return null;
  const raw = params.get("cfg");
  if (raw && raw.length > 8000)
    throw new Error("Слишком длинные параметры ссылки");
  const config = validateConfig({
    ...(raw ? JSON.parse(raw) : {}),
    seed: params.get("seed"),
  });
  const mode = params.get("mode");
  return {
    config,
    mode: ["reference", "stars", "messier", "lines", "sandbox"].includes(mode)
      ? mode
      : "messier",
  };
}
