export const RAD = Math.PI / 180;
export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export const wrap = (value) => ((value % 360) + 360) % 360;
export const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
export const vector = (ra, dec) => [
  Math.cos(dec * RAD) * Math.cos(ra * RAD),
  Math.cos(dec * RAD) * Math.sin(ra * RAD),
  Math.sin(dec * RAD),
];
export const coordinates = (v) => [
  wrap(Math.atan2(v[1], v[0]) / RAD),
  Math.asin(clamp(v[2], -1, 1)) / RAD,
];
export const angularDistance = (a, b) =>
  Math.acos(clamp(dot(vector(...a), vector(...b)), -1, 1)) / RAD;

export function siderealTime(date, longitude) {
  const jd = new Date(date).getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  return wrap(
    280.46061837 +
      360.98564736629 * (jd - 2451545) +
      0.000387933 * t * t -
      (t * t * t) / 38710000 +
      longitude,
  );
}

// Precession from J2000 to the mean equator and equinox of the observation date.
export function precess(ra, dec, date, inverse = false) {
  const t = (new Date(date).getTime() / 86400000 + 2440587.5 - 2451545) / 36525;
  const zeta =
    ((2306.2181 * t + 0.30188 * t * t + 0.017998 * t ** 3) / 3600) * RAD;
  const z =
    ((2306.2181 * t + 1.09468 * t * t + 0.018203 * t ** 3) / 3600) * RAD;
  const theta =
    ((2004.3109 * t - 0.42665 * t * t - 0.041833 * t ** 3) / 3600) * RAD;
  const rotateZ = (v, a) => [
    v[0] * Math.cos(a) - v[1] * Math.sin(a),
    v[0] * Math.sin(a) + v[1] * Math.cos(a),
    v[2],
  ];
  const rotateY = (v, a) => [
    v[0] * Math.cos(a) - v[2] * Math.sin(a),
    v[1],
    v[0] * Math.sin(a) + v[2] * Math.cos(a),
  ];
  let v = vector(ra, dec);
  v = inverse
    ? rotateZ(rotateY(rotateZ(v, -z), -theta), -zeta)
    : rotateZ(rotateY(rotateZ(v, zeta), theta), z);
  return coordinates(v);
}

export function observerBasis(config) {
  const lst = siderealTime(config.date, config.longitude);
  return {
    up: vector(...precess(lst, config.latitude, config.date, true)),
    north: vector(
      ...precess(lst + 180, 90 - config.latitude, config.date, true),
    ),
    east: vector(...precess(lst + 90, 0, config.date, true)),
  };
}

export function camera(config) {
  const observer = observerBasis(config);
  let ra = config.ra,
    dec = config.dec;
  let roll = config.roll;
  if (config.frame === "horizon") {
    const az = config.az * RAD,
      alt = config.alt * RAD;
    const v = observer.up.map(
      (x, i) =>
        x * Math.sin(alt) +
        Math.cos(alt) *
          (observer.north[i] * Math.cos(az) + observer.east[i] * Math.sin(az)),
    );
    [ra, dec] = coordinates(v);
    const vertical = observer.up.map(
      (x, i) =>
        x * Math.cos(alt) -
        Math.sin(alt) *
          (observer.north[i] * Math.cos(az) + observer.east[i] * Math.sin(az)),
    );
    const equatorialNorth = vector(ra + 180, 90 - dec);
    const west = vector(ra - 90, 0);
    roll +=
      Math.atan2(dot(vertical, west), dot(vertical, equatorialNorth)) / RAD;
  }
  const forward = vector(ra, dec);
  const north = vector(ra + 180, 90 - dec);
  const west = vector(ra - 90, 0);
  const r = roll * RAD;
  return {
    forward,
    right: west.map((v, i) => v * Math.cos(r) - north[i] * Math.sin(r)),
    up: north.map((v, i) => v * Math.cos(r) + west[i] * Math.sin(r)),
    zenith: observer.up,
  };
}

function radius(angle, projection) {
  if (projection === "stereo") return 2 * Math.tan(angle / 2);
  if (projection === "gnomonic") return Math.tan(angle);
  if (projection === "orthographic") return Math.sin(angle);
  return angle;
}

export function projector(config) {
  const rectangular = config.shape === "rectangle";
  const aspect = config.aspect || 1.6;
  const basis = camera(config);
  const limit = (config.fov / 2) * RAD;
  const scale = radius(limit, config.projection);
  function project(ra, dec, horizon = config.horizon) {
    const v = vector(ra, dec),
      cosine = clamp(dot(v, basis.forward), -1, 1);
    const angle = Math.acos(cosine);
    if (
      (!rectangular && angle > limit + 1e-9) ||
      (rectangular &&
        ((["gnomonic", "orthographic"].includes(config.projection) &&
          cosine < 0) ||
          angle > Math.PI - 1e-8)) ||
      (horizon && dot(v, basis.zenith) < -1e-10)
    )
      return null;
    const factor =
      angle < 1e-10
        ? 1 / scale
        : radius(angle, config.projection) / (Math.sin(angle) * scale);
    const point = [dot(v, basis.right) * factor, -dot(v, basis.up) * factor];
    if (
      rectangular &&
      (Math.abs(point[0]) > 1 + 1e-9 || Math.abs(point[1]) > 1 / aspect + 1e-9)
    )
      return null;
    return point;
  }
  function inverse(x, y) {
    const r = Math.hypot(x, y);
    if (
      rectangular
        ? Math.abs(x) > 1 + 1e-9 || Math.abs(y) > 1 / aspect + 1e-9
        : r > 1 + 1e-9
    )
      return null;
    const d = r * scale;
    if (config.projection === "orthographic" && d > 1 + 1e-9) return null;
    let angle = d;
    if (config.projection === "stereo") angle = 2 * Math.atan(d / 2);
    if (config.projection === "gnomonic") angle = Math.atan(d);
    if (config.projection === "orthographic")
      angle = Math.asin(clamp(d, -1, 1));
    const k = r < 1e-12 ? 0 : Math.sin(angle) / r;
    const v = basis.forward.map(
      (a, i) =>
        a * Math.cos(angle) + k * (x * basis.right[i] - y * basis.up[i]),
    );
    if (config.horizon && dot(v, basis.zenith) < -1e-10) return null;
    return coordinates(v);
  }
  return { project, inverse, basis };
}

export function randomGenerator(seed) {
  let value = 2166136261;
  for (const character of String(seed))
    value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(items, random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Радиус эталонного маркера в нормированных координатах карты (радиус кружка перекрестия).
export const HIT_RADIUS = 0.025;

// Попал центром в эталонный маркер — полный балл (weight), иначе 0.
export function scoreAnswer(target, answer, projection, tolerance, weight = 100) {
  const point = projection.project(target.ra, target.dec);
  const visible = Boolean(point);
  if (!answer) return { points: 0, max: weight, visible, error: null, reason: "Нет ответа" };
  if (answer.absent)
    return {
      points: visible ? 0 : weight,
      max: weight,
      visible,
      error: null,
      reason: visible ? "Объект есть на карте" : "Верно: вне карты",
    };
  if (!visible)
    return { points: 0, max: weight, visible, error: null, reason: "Объект вне карты" };
  const error = angularDistance(
    [target.ra, target.dec],
    [answer.ra, answer.dec],
  );
  const user = projection.project(answer.ra, answer.dec);
  const hit = Boolean(user) && Math.hypot(user[0] - point[0], user[1] - point[1]) <= HIT_RADIUS;
  return {
    points: hit ? weight : 0,
    max: weight,
    visible,
    error,
    reason: hit ? "Попадание в эталон" : `Мимо эталона · ошибка ${error.toFixed(2)}°`,
  };
}

export const referencePoints = [
  { id: "spring", name: "♈ Весеннее равноденствие", ra: 0, dec: 0 },
  { id: "autumn", name: "♎ Осеннее равноденствие", ra: 180, dec: 0 },
  { id: "summer", name: "☀ Летнее солнцестояние", ra: 90, dec: 23.4393 },
  { id: "winter", name: "❄ Зимнее солнцестояние", ra: 270, dec: -23.4393 },
  { id: "north", name: "Северный полюс мира", ra: 0, dec: 90 },
  { id: "south", name: "Южный полюс мира", ra: 0, dec: -90 },
  {
    id: "G1",
    name: "Γ₁ Галактический ∩ небесный экватор",
    ra: 102.85948,
    dec: 0,
  },
  {
    id: "G2",
    name: "Γ₂ Галактический ∩ небесный экватор",
    ra: 282.85948,
    dec: 0,
  },
];

const galacticPole = vector(192.85948, 27.12825);
const eclipticPole = vector(270, 90 - 23.4393);
const intersection = [
  galacticPole[1] * eclipticPole[2] - galacticPole[2] * eclipticPole[1],
  galacticPole[2] * eclipticPole[0] - galacticPole[0] * eclipticPole[2],
  galacticPole[0] * eclipticPole[1] - galacticPole[1] * eclipticPole[0],
];
const intersectionNorm = Math.hypot(...intersection);
for (const sign of [1, -1]) {
  const [ra, dec] = coordinates(
    intersection.map((value) => (sign * value) / intersectionNorm),
  );
  referencePoints.push({
    id: `epsilon-${sign}`,
    name: `ε${sign === 1 ? "₁" : "₂"} Галактический экватор ∩ эклиптика`,
    ra,
    dec,
  });
}

export function greatCircles() {
  const equator = [],
    ecliptic = [],
    galactic = [];
  const pole = vector(192.85948, 27.12825);
  const a = vector(102.85948, 0);
  const b = [
    pole[1] * a[2] - pole[2] * a[1],
    pole[2] * a[0] - pole[0] * a[2],
    pole[0] * a[1] - pole[1] * a[0],
  ];
  for (let l = 0; l <= 360; l += 0.5) {
    const t = l * RAD,
      e = 23.4393 * RAD;
    equator.push([l, 0]);
    ecliptic.push(
      coordinates([
        Math.cos(t),
        Math.sin(t) * Math.cos(e),
        Math.sin(t) * Math.sin(e),
      ]),
    );
    galactic.push(
      coordinates(a.map((v, i) => v * Math.cos(t) + b[i] * Math.sin(t))),
    );
  }
  return [equator, ecliptic, galactic];
}

export function boundaryCrossings(config) {
  const projection = projector(config),
    result = [];
  greatCircles().forEach((points, index) => {
    let count = 0;
    for (let i = 1; i < points.length; i++) {
      const insideA = Boolean(projection.project(...points[i - 1]));
      const insideB = Boolean(projection.project(...points[i]));
      if (insideA === insideB) continue;
      let a = points[i - 1],
        b = points[i];
      for (let step = 0; step < 24; step++) {
        const av = vector(...a),
          bv = vector(...b);
        const mid = av.map((v, j) => v + bv[j]);
        const length = Math.hypot(...mid);
        const c = coordinates(mid.map((v) => v / length));
        if (Boolean(projection.project(...c)) === insideA) a = c;
        else b = c;
      }
      const point = insideA ? a : b;
      result.push({
        id: `edge-${index}-${count}`,
        name: `${["E", "Γ", "ε"][index]}${++count} · пересечение с краем`,
        ra: point[0],
        dec: point[1],
      });
    }
  });
  return result;
}
