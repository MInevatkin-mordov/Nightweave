import {
  angularDistance,
  clamp,
  projector,
  randomGenerator,
  shuffle,
  referencePoints,
  boundaryCrossings,
  HIT_RADIUS,
} from "./astro.js?v=10";
import { normalizeBayer } from "./bayer.js?v=10";

export const LEVELS = {
  beginner: {
    label: "Начальный",
    greek: "αβ",
    magnitude: 2.7,
    absent: 0.15,
    tolerance: 1.5,
    description: "Яркие звёзды α–β, знакомые объекты Мессье; мягкий допуск.",
  },
  standard: {
    label: "Базовый",
    greek: "αβγδ",
    magnitude: 3.6,
    absent: 0.25,
    tolerance: 1,
    description: "Звёзды α–δ до 3.6m; яркая часть каталога Мессье.",
  },
  advanced: {
    label: "Продвинутый",
    greek: "αβγδεζηθ",
    magnitude: 4.8,
    absent: 0.3,
    tolerance: 0.7,
    description: "Звёзды α–θ до 4.8m; все объекты Мессье.",
  },
  expert: {
    label: "Экспертный",
    greek: null,
    magnitude: 6,
    absent: 0.35,
    tolerance: 0.45,
    description:
      "Все обозначения Байера, включая π и поздние буквы; строгий допуск.",
  },
};

const introductoryMessier = new Set([
  1, 8, 13, 27, 31, 33, 42, 43, 44, 45, 51, 57, 81, 82, 101, 104,
]);

export function eligibleObjects(catalog, mode, config) {
  const level = LEVELS[config.level] || LEVELS.beginner;
  if (mode === "messier")
    return catalog.messier.filter((object) => {
      if (config.level === "beginner")
        return introductoryMessier.has(object.number) || object.mag <= 6.5;
      if (config.level === "standard") return object.mag <= 8.5;
      return true;
    });
  return catalog.named.filter(
    (star) =>
      star.mag <= Math.min(config.magnitude, level.magnitude) &&
      (!level.greek || level.greek.includes(star.bayer[0])),
  );
}

export function sortMessier(objects) {
  return [...objects].sort((a, b) => (a.number ?? Number(a.id.slice(1))) - (b.number ?? Number(b.id.slice(1))));
}

export function selectTargets(catalog, mode, config) {
  const p = projector(config),
    random = randomGenerator(config.seed + mode + config.level);
  const pool = eligibleObjects(catalog, mode, config);
  const visible = shuffle(
    pool.filter((object) => p.project(object.ra, object.dec)),
    random,
  );
  const absent = shuffle(
    pool.filter((object) => !p.project(object.ra, object.dec)),
    random,
  );
  let count = Math.min(config.count, pool.length);
  const outsideCount = Math.min(
    absent.length,
    Math.round(count * LEVELS[config.level].absent),
  );
  const chosen = visible.slice(0, count - outsideCount);
  chosen.push(...absent.slice(0, count - chosen.length));
  const unique = [
    ...new Map(chosen.map((object) => [object.id, object])).values(),
  ];
  for (const object of [...visible, ...absent]) {
    if (unique.length >= count) break;
    if (!unique.some((item) => item.id === object.id)) unique.push(object);
  }
  return mode === "messier" ? sortMessier(unique) : shuffle(unique, random);
}

export function normalizeName(value) {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[\s._‐‑–—-]/g, "")
    .replace(/^м(?=\d)/, "m");
}

export function sandboxPoints(config) {
  const symbols = {spring:"♈",autumn:"♎",summer:"☀",winter:"❄",north:"NCP",south:"SCP",G1:"Γ₁",G2:"Γ₂","epsilon-1":"ε₁","epsilon--1":"ε₂"};
  return [...referencePoints, ...(config ? boundaryCrossings(config) : [])].map(point => ({
    ...point, kind: "reference", shortName: symbols[point.id] || point.name.split(" ·")[0],
  }));
}

export function resolveObject(catalog, mode, name, config) {
  const normalized = normalizeName(name);
  if (!normalized) return [];
  const pool = mode === "reference" ? sandboxPoints(config) : mode === "messier" ? catalog.messier : catalog.named;
  const bayer = ["stars", "bayer"].includes(mode) ? normalizeBayer(name, catalog) : null;
  return pool.filter((object) =>
    (bayer && object.bayer && normalizeBayer(object.bayer, catalog) === bayer) ||
    [
      object.id,
      object.name,
      object.title,
      object.bayer,
      ...(object.aliases || []),
    ]
      .filter(Boolean)
      .some((alias) => normalizeName(alias) === normalized),
  );
}

export function scoreSandbox(entries, catalog, mode, projection, tolerance, config) {
  const used = new Set();
  return entries.map((entry) => {
    const matches = resolveObject(catalog, entry.kind || mode, entry.name, config);
    const target = matches.length === 1 ? matches[0] : null;
    if (!target)
      return {
        entry,
        target: null,
        points: 0,
        error: null,
        reason: matches.length
          ? "Неоднозначное имя: уточни номер или обозначение"
          : "Имя не найдено в каталоге",
      };
    if (used.has(target.id))
      return {
        entry,
        target,
        points: 0,
        error: null,
        reason: "Повтор объекта: засчитана только первая отметка",
      };
    used.add(target.id);
    if (entry.absent) {
      const visible = Boolean(projection.project(target.ra, target.dec));
      return {
        entry,
        target,
        points: visible ? 0 : 100,
        error: null,
        reason: visible ? "Объект есть на карте" : "Верно: вне карты",
      };
    }
    if (!projection.project(target.ra, target.dec))
      return {
        entry,
        target,
        points: 0,
        error: null,
        reason: "Объект вне карты",
      };
    const error = angularDistance(
      [entry.ra, entry.dec],
      [target.ra, target.dec],
    );
    const a = projection.project(target.ra, target.dec),
      b = projection.project(entry.ra, entry.dec),
      hit = Boolean(b) && Math.hypot(a[0] - b[0], a[1] - b[1]) <= HIT_RADIUS;
    return {
      entry,
      target,
      error,
      points: hit ? 100 : 0,
      reason: hit ? "Попадание в эталон" : `Мимо эталона · ошибка ${error.toFixed(2)}°`,
    };
  });
}

export function simplifyStroke(points, tolerance) {
  if (points.length <= 2) return points;
  const a = points[0],
    b = points.at(-1),
    dx = b[0] - a[0],
    dy = b[1] - a[1];
  let maximum = 0,
    split = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const t = clamp(
      ((points[i][0] - a[0]) * dx + (points[i][1] - a[1]) * dy) /
        (dx * dx + dy * dy || 1),
      0,
      1,
    );
    const distance = Math.hypot(
      points[i][0] - a[0] - t * dx,
      points[i][1] - a[1] - t * dy,
    );
    if (distance > maximum) {
      maximum = distance;
      split = i;
    }
  }
  if (maximum <= tolerance) return [a, b];
  return [
    ...simplifyStroke(points.slice(0, split + 1), tolerance).slice(0, -1),
    ...simplifyStroke(points.slice(split), tolerance),
  ];
}

export function visibleSegments(catalog, config) {
  const p = projector(config),
    result = [];
  for (const figure of catalog.lines)
    for (const path of figure.paths)
      for (let i = 1; i < path.length; i++) {
        let start = null,
          previous = null;
        const a = path[i - 1],
          b = path[i];
        let dra = b[0] - a[0];
        if (dra > 180) dra -= 360;
        if (dra < -180) dra += 360;
        for (let j = 0; j <= 80; j++) {
          const t = j / 80,
            point = [a[0] + dra * t, a[1] + (b[1] - a[1]) * t];
          if (p.project(...point)) {
            start ||= point;
            previous = point;
          }
          if ((!p.project(...point) || j === 80) && start) {
            if (angularDistance(start, previous) > 0.25)
              result.push({ a: start, b: previous, id: figure.id });
            start = previous = null;
          }
        }
      }
  return result;
}

function samples(paths, step) {
  const points = [];
  for (const path of paths)
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1],
        b = path[i];
      let dra = b[0] - a[0];
      if (dra > 180) dra -= 360;
      if (dra < -180) dra += 360;
      const n = Math.max(1, Math.ceil(angularDistance(a, b) / step));
      for (let j = 0; j <= n; j++) {
        const t = j / n,
          ra = ((a[0] + dra * t) * Math.PI) / 180,
          dec = ((a[1] + (b[1] - a[1]) * t) * Math.PI) / 180;
        points.push([
          Math.cos(ra) * Math.cos(dec),
          Math.sin(ra) * Math.cos(dec),
          Math.sin(dec),
        ]);
      }
    }
  return points;
}

export function scoreDrawing(segments, strokes, tolerance) {
  const step = Math.max(0.05, tolerance / 6);
  const expected = samples(
    segments.map((s) => [s.a, s.b]),
    step,
  );
  const drawn = samples(
    strokes.map((s) => s.points),
    step,
  );
  if (!expected.length || !drawn.length)
    return { points: 0, coverage: 0, precision: 0 };
  const fraction = (a, b) =>
    a.reduce((sum, point) => {
      let best = -1;
      for (const other of b)
        best = Math.max(
          best,
          point[0] * other[0] + point[1] * other[1] + point[2] * other[2],
        );
      const error = Math.max(
        0,
        (Math.acos(clamp(best, -1, 1)) * 180) / Math.PI - step / 2,
      );
      return sum + clamp(1 - error / tolerance, 0, 1);
    }, 0) / a.length;
  const coverage = fraction(expected, drawn),
    precision = fraction(drawn, expected);
  return {
    points: Math.round(
      (200 * coverage * precision) / (coverage + precision || 1),
    ),
    coverage,
    precision,
  };
}
