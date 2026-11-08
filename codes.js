import { pageUrl } from "./site-url.js?v=10";

export function parseCode(value, fallback = "T") {
  const match = String(value).trim().match(/^([TQ])?\s*(\d{1,12})$/i);
  if (!match) throw new Error("Введи код T12345 для тренажёра или Q12345 для квиза.");
  return { kind: (match[1] || fallback).toUpperCase(), seed: match[2] };
}

export function seedCode(kind, seed) {
  return kind + parseCode(seed, kind).seed;
}

export function codeUrl(value, currentUrl, fallback = "T") {
  const code = parseCode(value, fallback);
  const url = pageUrl(code.kind, currentUrl);
  url.search = "";
  url.hash = "";
  url.searchParams.set("seed", seedCode(code.kind, code.seed));
  return url.href;
}

export function redirectCode(value, kind) {
  const code = parseCode(value, kind);
  if (code.kind === kind) return code.seed;
  globalThis.location.assign(codeUrl(value, globalThis.location.href, kind));
  return null;
}

export function routeLinkedCode(kind) {
  const url = new URL(globalThis.location.href);
  const value = seedParams(url.href).get("seed");
  if (!value || parseCode(value, kind).kind === kind) return false;
  const target = pageUrl(parseCode(value, kind).kind, url.href);
  target.search = url.search;
  target.hash = url.hash;
  globalThis.location.replace(target.href);
  return true;
}

export function seedParams(value) {
  const url = new URL(value);
  if (url.searchParams.has("seed")) return url.searchParams;
  const hash = decodeURIComponent(url.hash.slice(1));
  return new URLSearchParams(/^[TQ]?\d+$/i.test(hash) ? `seed=${hash}` : hash);
}

export function changedSettings(value, defaults) {
  if (JSON.stringify(value) === JSON.stringify(defaults)) return undefined;
  if (Array.isArray(value) && Array.isArray(defaults)) {
    if (value.some(item => !item || typeof item !== "object")) return value;
    return value.map((item, index) => changedSettings(item, defaults[index]) || {});
  }
  if (value && typeof value === "object" && defaults && typeof defaults === "object") {
    const result = {};
    for (const key of Object.keys(value)) {
      const changed = changedSettings(value[key], defaults[key]);
      if (changed !== undefined) result[key] = changed;
    }
    return Object.keys(result).length ? result : undefined;
  }
  return value;
}
