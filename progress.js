import { seedCode } from "./codes.js?v=10";
import { pageUrl, localProgressUrl } from "./site-url.js?v=10";

const KEY = "nightweave-progress-v1";
const escape = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);

export function readProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(saved)) return saved;
    const legacy = JSON.parse(localStorage.getItem("nightweave-history-v2") || "[]");
    return legacy.map((entry, index) => ({ ...entry, kind: "T", id: `legacy-${index}`, label: "Тренажёр", url: legacyUrl(entry) }));
  } catch { return []; }
}

function legacyUrl(entry) {
  const url = pageUrl("T");
  const config = { ...entry.config };
  delete config.seed;
  url.searchParams.set("seed", seedCode("T", entry.seed));
  url.searchParams.set("cfg", JSON.stringify(config));
  if (entry.mode) url.searchParams.set("mode", entry.mode);
  return url.href;
}

export function recordProgress(entry) {
  const items = readProgress().filter(item => item.id !== entry.id);
  items.unshift({ ...entry, date: new Date().toISOString() });
  try { localStorage.setItem(KEY, JSON.stringify(items.slice(0, 60))); } catch { /* Storage is optional. */ }
  updateProgressCount();
}

export function updateProgressCount() {
  const count = document.getElementById("history-count");
  if (count) count.textContent = readProgress().length;
}

export function showProgress(openDialog) {
  const items = readProgress();
  openDialog(`<p class="eyebrow">ТВОЙ МАРШРУТ</p><h2>Мой прогресс</h2><p>Последние 60 результатов тренажёра и квизов хранятся в этом браузере.</p>${items.length ? `<div class="table-scroll"><table><thead><tr><th>Дата</th><th>Seed</th><th>Задания</th><th>Баллы</th><th></th></tr></thead><tbody>${items.map(item => `<tr><td>${new Date(item.date).toLocaleDateString("ru-RU")}</td><td>${escape(seedCode(item.kind, item.seed))}</td><td>${escape(item.label || (item.kind === "Q" ? "Квиз" : "Тренажёр"))}</td><td>${item.score} / ${item.maximum}</td><td><a class="subtle" href="${escape(localProgressUrl(item).href)}">Открыть ↗</a></td></tr>`).join("")}</tbody></table></div>` : "<p>Здесь появится результат первой проверки.</p>"}`);
}
