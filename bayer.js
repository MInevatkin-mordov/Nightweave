export const GREEK_LETTERS = [
  ["α", "альфа", "alpha"], ["β", "бета", "beta"], ["γ", "гамма", "gamma"],
  ["δ", "дельта", "delta"], ["ε", "эпсилон", "epsilon"], ["ζ", "дзета", "zeta"],
  ["η", "эта", "eta"], ["θ", "тета", "theta"], ["ι", "йота", "iota"],
  ["κ", "каппа", "kappa"], ["λ", "лямбда", "lambda", "lamda"], ["μ", "мю", "mu"],
  ["ν", "ню", "nu"], ["ξ", "кси", "xi"], ["ο", "омикрон", "omicron"],
  ["π", "пи", "pi"], ["ρ", "ро", "rho"], ["σ", "сигма", "sigma"],
  ["τ", "тау", "tau"], ["υ", "ипсилон", "upsilon"], ["φ", "фи", "phi"],
  ["χ", "хи", "chi"], ["ψ", "пси", "psi"], ["ω", "омега", "omega"],
];

const normalize = value => String(value).normalize("NFKD").toLowerCase()
  .replace(/[\u0300-\u036f]/g, "").replace(/ё/g, "е").replace(/[\s.\-]/g, "");
const caches = new WeakMap();

function constellationIndex(catalog) {
  if (caches.has(catalog)) return caches.get(catalog);
  const index = new Map();
  for (const constellation of catalog.constellations || []) {
    for (const name of [constellation.id, constellation.name, ...(constellation.aliases || [])]) {
      const key = normalize(name);
      if (!index.has(key)) index.set(key, new Set());
      index.get(key).add(constellation.id);
    }
  }
  caches.set(catalog, index);
  return index;
}

export function normalizeBayer(value, catalog) {
  let text = String(value).normalize("NFKC").trim().toLowerCase()
    .replace(/[ϑϕϵϱς]/g, letter => ({"ϑ":"θ","ϕ":"φ","ϵ":"ε","ϱ":"ρ","ς":"σ"})[letter]);
  for (const [symbol, ...aliases] of GREEK_LETTERS) {
    const alias = aliases.find(name => text.startsWith(name));
    if (alias) { text = symbol + text.slice(alias.length); break; }
  }
  const match = text.match(/^([αβγδεζηθικλμνξοπρστυφχψω])\s*(\d*)\s*(.+)$/u);
  if (!match) return null;
  const ids = constellationIndex(catalog).get(normalize(match[3].replace(/^созвезди[ея]\s+/i, "")));
  if (ids?.size !== 1) return null;
  return `${match[1]}${match[2]} ${[...ids][0]}`;
}

export function bayerLabel(letter, index, constellation) {
  if (!GREEK_LETTERS.some(item => item[0] === letter)) throw new Error("Выбери греческую букву.");
  const suffix = String(index).trim();
  if (suffix && !/^[1-9]$/.test(suffix)) throw new Error("Индекс Байера — одна цифра от 1 до 9; его можно оставить пустым.");
  if (!String(constellation).trim()) throw new Error("Впиши название созвездия, например Лира или Lyr.");
  return `${letter}${suffix} ${String(constellation).trim()}`;
}
