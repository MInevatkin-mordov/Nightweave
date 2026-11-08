import { createVariant } from "./variant.js?v=10";
import { projector, scoreAnswer, angularDistance } from "./astro.js?v=10";
import { vectorMap, mapHeight } from "./renderer.js?v=10";
import { GREEK_LETTERS, normalizeBayer } from "./bayer.js?v=10";
import { LEVELS } from "./training.js?v=10";

const $ = (id) => document.getElementById(id);
const W = 900, RADIUS = W / 2 - 2;
const rnd = () => String(Math.floor(1e8 + Math.random() * 9e8));
let catalog, questions = [], badKeys = new Set();

// Опорные точки и пересечения с краем карты (режимы «1–2» тренажёра, объединены).
const POINT_META = {
  spring: ["♈", "Весеннее равноденствие"],
  autumn: ["♎", "Осеннее равноденствие"],
  summer: ["♋", "Летнее солнцестояние"],
  winter: ["♑", "Зимнее солнцестояние"],
  G1: ["Γ", "Галактический ∩ небесный экватор"],
  "epsilon-1": ["ε", "Галактический экватор ∩ эклиптика"],
};
const EDGE_META = [
  ["Е", "Небесный экватор ∩ край карты"],
  ["Γ", "Галактический экватор ∩ край карты"],
  ["ε", "Эклиптика ∩ край карты"],
];
const edgeFamily = (id) => Number(id.split("-")[1]);
const KIND_TITLE = { points: "Опорные точки", stars: "Имена звёзд", messier: "Объекты Мессье" };
const labelOf = (q, t) =>
  q.kind === "stars" ? `${t.name} (${t.bayer})`
  : q.kind === "points"
    ? t.id.startsWith("edge-")
      ? `${EDGE_META[edgeFamily(t.id)][0]}${Number(t.id.split("-")[2]) + 1} · пересечение с краем`
      : `${POINT_META[t.id][0]} ${POINT_META[t.id][1]}`
    : t.name;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

async function init() {
  catalog = await (await fetch("./assets/catalog.json")).json();
  // Звёзды без однозначного греческого обозначения в задание не берём.
  const seen = new Set();
  for (const s of catalog.named) {
    const k = normalizeBayer(s.bayer, catalog);
    if (k && seen.has(k)) badKeys.add(k);
    if (k) seen.add(k);
  }
  const p = new URLSearchParams(location.search);
  $("seed").value = (p.get("seed") || rnd()).replace(/^T/i, "");
  if (LEVELS[p.get("level")]) $("level").value = p.get("level");
  $("apply").onclick = build;
  $("new").onclick = () => { $("seed").value = rnd(); build(); };
  $("check").onclick = checkAll;
  build();
}

function build() {
  $("summary").hidden = true;
  const seed = $("seed").value.trim().replace(/^T/i, "") || rnd();
  const level = $("level").value;
  let v;
  try { v = createVariant(catalog, { seed, level }); }
  catch (e) { $("quiz").textContent = e.message; return; }
  $("seed").value = v.seed;
  history.replaceState(null, "", `?seed=${v.seed}&level=${level}`);
  const a = v.attempts;
  questions = [
    makeQuestion("points", 1, a.reference.config, a.reference.targets, `nw-strike:${v.seed}:${level}:points`),
    makeQuestion("stars", 2, a.stars.config, a.stars.targets.filter((t) => {
      const k = normalizeBayer(t.bayer, catalog);
      return k && !badKeys.has(k);
    }), `nw-strike:${v.seed}:${level}:stars`),
    makeQuestion("messier", 3, a.messier.config, a.messier.targets, `nw-strike:${v.seed}:${level}:messier`),
  ];
  $("quiz").replaceChildren(...questions.map((q) => q.root));
  for (const q of questions) refreshList(q);
}

function makeQuestion(kind, number, cfg, targets, strikeKey) {
  cfg = { ...cfg, display: "paper" };
  const proj = projector(cfg);
  const q = {
    kind, cfg, targets, proj, markers: [], sel: null, pick: null, checked: false,
    H: mapHeight(W, cfg), strikeKey, struck: loadStrikes(strikeKey), seq: 0,
  };
  q.items = kind === "points" ? pointItems(targets) : targets;
  q.tol = Math.max(0.3, (cfg.fov / 30) * LEVELS[cfg.level].tolerance);

  const canvas = el("canvas");
  canvas.width = W; canvas.height = q.H;
  vectorMap(canvas, catalog, cfg);
  const c = canvas.getContext("2d");
  c.strokeStyle = "#000"; c.lineWidth = 3;
  if (cfg.shape === "rectangle") c.strokeRect(1, 1, W - 2, q.H - 2);
  else { c.beginPath(); c.arc(W / 2, q.H / 2, RADIUS, 0, 7); c.stroke(); }

  q.layer = el("div", "layer");
  q.stage = el("div", "stage" + (cfg.shape === "rectangle" ? " rect" : ""));
  q.stage.append(canvas, q.layer);

  q.state = el("span", "difficulty", "Нет ответа");
  q.pts = el("span", "difficulty", "Балл: —");
  const top = el("div", "lab-top");
  const tab = el("div", "tabs");
  tab.append(el("button", "", `Вопрос ${number} · ${KIND_TITLE[kind]}`));
  tab.firstChild.setAttribute("aria-selected", "true");
  tab.firstChild.setAttribute("role", "tab");
  tab.firstChild.disabled = true;
  tab.firstChild.style.opacity = 1;
  tab.firstChild.style.cursor = "default";
  const status = el("div", "q-state");
  status.append(q.state, q.pts);
  top.append(tab, status);

  const meta = el("div", "map-meta");
  meta.append(el("span", "", `${cfg.projection.toUpperCase()} · ${cfg.fov}°`), el("span", "", "ЭКЗАМЕНАЦИОННАЯ КАРТА"));
  const mapCol = el("div", "map-column");
  mapCol.append(meta, q.stage);

  const header = el("div", "assignment-header");
  header.append(
    el("span", "eyebrow", `ВОПРОС ${number}`),
    el("h2", "", kind === "stars" ? "Найди звёзды\nиз списка" : kind === "points" ? "Отметь опорные\nточки и края карты" : "Найди объекты\nМессье"),
    el("p", "prompt", kind === "stars"
      ? "Щёлкните по звезде на карте — появится маркер; впишите обозначение звезды по Байеру (например, α CMa или β Ori). Если звезды нет на карте, маркер не ставьте. Закрасьте ■ квадраты при наименованиях объектов, не принадлежащих показанной на карте области неба. Чтобы убрать маркер — перетащите его за рамку карты или дважды щёлкните по нему."
      : kind === "points"
        ? "Отметьте положения точек равноденствия (♈︎, ♎︎) и солнцестояния (♋︎, ♑︎), при наличии; точку пересечения галактического и небесного экватора — символом Γ, галактического экватора и эклиптики — символом ε. Затем символами Е, Γ, ε отметьте точки пересечения небесного экватора, галактического экватора и эклиптики с границей карты — все, при наличии. Символы из нижней группы можно ставить несколько раз. Закрасьте ■ квадраты при наименованиях объектов, не принадлежащих показанной на карте области неба. Чтобы убрать маркер — перетащите его за рамку карты или дважды щёлкните по нему."
        : "Перетащите объект из списка на карту (или выберите его в списке и щёлкните по карте). Закрасьте ■ квадраты при наименованиях объектов, не принадлежащих показанной на карте области неба. Чтобы убрать маркер — перетащите его за рамку карты или дважды щёлкните по нему."),
  );
  header.firstChild.nextSibling.style.whiteSpace = "pre-line";

  q.list = makeList(q);
  q.editor = makeEditor(q);
  const aside = el("aside", "assignment");
  aside.append(header, q.list, q.editor);

  q.feedback = el("div", "feedback");
  q.feedback.hidden = true;

  q.root = el("section", "lab exam-q");
  const bodyEl = el("div", "lab-body");
  bodyEl.append(mapCol, aside);
  q.root.append(top, bodyEl, q.feedback);

  q.stage.onclick = (e) => {
    if (q.checked || q.suppressClick) return;
    const pos = fractions(q, e);
    if (!inside(q, pos)) return;
    if (q.kind === "stars") {
      const m = { fx: pos[0], fy: pos[1], text: "" };
      q.markers.push(m);
      select(q, m);
    } else if (q.pick) place(q, q.pick, pos);
  };
  if (kind !== "stars") {
    q.stage.ondragover = (e) => e.preventDefault();
    q.stage.ondrop = (e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("text/plain");
      if (!q.checked && q.items.some((t) => t.id === id)) place(q, id, fractions(q, e));
    };
  }
  return q;
}

// --- зачёркивание позиций в списке (запоминается между перезагрузками) ---
function loadStrikes(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key) || "[]")); } catch { return new Set(); }
}
function saveStrikes(q) {
  try { localStorage.setItem(q.strikeKey, JSON.stringify([...q.struck])); } catch { /* ignore */ }
}

// строки списка для «опорных точек»: сначала сами точки, затем символы для краёв карты
function pointItems(targets) {
  const items = [{ head: "Опорные точки" }];
  for (const t of targets) if (!t.id.startsWith("edge-")) items.push({ id: t.id, sym: POINT_META[t.id][0] + (/[♈♎♋♑]/.test(POINT_META[t.id][0]) ? "\uFE0E" : ""), name: POINT_META[t.id][1] });
  items.push({ head: "Пересечения с краем карты · можно ставить несколько раз" });
  EDGE_META.forEach(([sym, name], f) => items.push({ id: `pal-${f}`, sym, name, palette: true }));
  return items;
}

function makeList(q) {
  const ul = el("ul", "ex-list");
  let n = 0;
  for (const t of q.items) {
    if (t.head) { ul.append(el("li", "ex-head", t.head)); continue; }
    const draggable = q.kind !== "stars";
    const li = el("li", "ex-row" + (draggable ? " drag" : ""));
    li.dataset.id = t.id;
    li.append(el("span", "num", String(++n).padStart(2, "0")));
    const name = el("div", "name");
    if (draggable) name.append(el("span", "grip", "✥"));
    if (t.sym) name.append(el("span", "sym", t.sym));
    name.append(el("span", "label", q.kind === "stars" ? t.name : q.kind === "messier" ? t.name.replace(/^M/, "M ") : t.name));
    name.append(el("span", "used-mark"));
    if (draggable) {
      li.draggable = true;
      li.ondragstart = (e) => e.dataTransfer.setData("text/plain", t.id);
      name.onclick = () => {
        if (q.checked) return;
        q.pick = q.pick === t.id ? null : t.id;
        refreshList(q);
      };
    } else {
      name.onclick = () => { if (!t.palette) toggleStrike(q, t.id); };
    }
    const btn = el("button", "strike-btn");
    btn.append(el("span", "ico"));
    btn.type = "button";
    btn.title = "Закрасить ■ — объекта нет на карте";
    btn.setAttribute("aria-label", "Объекта нет на карте");
    btn.onclick = (e) => { e.stopPropagation(); toggleStrike(q, t.id); };
    if (t.palette) btn.hidden = true;
    li.append(name, btn);
    ul.append(li);
  }
  return ul;
}

function toggleStrike(q, id) {
  if (q.checked) return;
  if (q.struck.has(id)) q.struck.delete(id);
  else {
    q.struck.add(id);
    // «нет на карте» и маркер на карте друг другу противоречат
    if (q.kind !== "stars" && q.markers.some((m) => m.key === id)) {
      q.markers = q.markers.filter((m) => m.key !== id);
      saveStrikes(q);
      refresh(q);
      return;
    }
  }
  saveStrikes(q);
  refreshList(q);
}

const fractions = (q, e) => {
  const r = q.stage.getBoundingClientRect();
  return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
};
// внутри рабочей области (рамки карты)?
const inside = (q, pos) =>
  pos[0] >= 0 && pos[0] <= 1 && pos[1] >= 0 && pos[1] <= 1 && Boolean(q.proj.inverse(...norm(q, pos)));
const norm = (q, [fx, fy]) => [(fx * W - W / 2) / RADIUS, (fy * q.H - q.H / 2) / RADIUS];
const toFraction = (q, [nx, ny]) => [(nx * RADIUS + W / 2) / W, (ny * RADIUS + q.H / 2) / q.H];

function place(q, id, pos) {
  if (!inside(q, pos)) return;
  if (id.startsWith("pal-")) {
    // символ края карты: каждый щелчок/перетаскивание добавляет новую копию
    const f = Number(id.slice(4));
    q.markers.push({ key: `edge:${f}:${++q.seq}`, text: EDGE_META[f][0], edge: true, fx: pos[0], fy: pos[1] });
    refresh(q);
    return;
  }
  let m = q.markers.find((x) => x.key === id);
  if (!m) {
    const t = q.items.find((x) => x.id === id);
    m = { key: id, text: q.kind === "points" ? t.sym : t.name.replace(/^M/, "M ") };
    q.markers.push(m);
  }
  [m.fx, m.fy] = pos;
  if (q.struck.delete(id)) saveStrikes(q);
  q.pick = null;
  refresh(q);
}

function refreshList(q) {
  for (const row of q.list.children) {
    const id = row.dataset.id;
    if (!id) continue;
    const count = id.startsWith("pal-")
      ? q.markers.filter((m) => m.key.startsWith(`edge:${id.slice(4)}:`)).length
      : q.markers.some((m) => m.key === id) ? 1 : 0;
    row.classList.toggle("sel", id === q.pick);
    row.classList.toggle("used", count > 0 && !id.startsWith("pal-"));
    row.classList.toggle("struck", q.struck.has(id));
    row.querySelector(".strike-btn").setAttribute("aria-pressed", String(q.struck.has(id)));
    row.querySelector(".used-mark").textContent = count ? (id.startsWith("pal-") ? `● × ${count}` : "● на карте") : "";
  }
}

function refresh(q) {
  q.layer.replaceChildren();
  for (const m of q.markers) {
    const node = el("div", "mk");
    node.classList.toggle("sel", m === q.sel);
    node.classList.toggle("edge", !!m.edge);
    node.classList.toggle("bad", q.kind === "stars" && !!m.text && !normalizeBayer(m.text, catalog));
    node.style.left = m.fx * 100 + "%";
    node.style.top = m.fy * 100 + "%";
    node.append(el("i"), el("span", "sym", m.text || "…"));
    node.onclick = (e) => e.stopPropagation();
    node.ondblclick = (e) => {
      if (q.checked) return;
      e.stopPropagation();
      q.markers = q.markers.filter((x) => x !== m);
      if (q.sel === m) select(q, null);
      refresh(q);
    };
    node.onpointerdown = (e) => {
      if (q.checked) return;
      e.stopPropagation();
      node.setPointerCapture(e.pointerId);
      let moved = false, out = false;
      node.onpointermove = (ev) => {
        const pos = fractions(q, ev);
        moved = true;
        q.suppressClick = true;
        out = !inside(q, pos);
        // за пределами рабочей области маркер пропадает; вернули — появляется
        node.style.visibility = out ? "hidden" : "visible";
        if (out) return;
        [m.fx, m.fy] = pos;
        node.style.left = pos[0] * 100 + "%";
        node.style.top = pos[1] * 100 + "%";
      };
      node.onpointerup = () => {
        node.onpointermove = node.onpointerup = node.onpointercancel = null;
        setTimeout(() => { q.suppressClick = false; }, 0);
        if (moved && out) {
          // отпустили за рамкой — маркер удаляется
          q.markers = q.markers.filter((x) => x !== m);
          if (q.sel === m) select(q, null); else refresh(q);
        } else if (moved) refresh(q);
        else if (q.kind === "stars") select(q, m);
      };
      node.onpointercancel = () => {
        node.onpointermove = node.onpointerup = node.onpointercancel = null;
        q.suppressClick = false;
        refresh(q);
      };
    };
    q.layer.append(node);
  }
  refreshList(q);
  const n = q.markers.length;
  if (!q.checked) q.state.textContent = n ? "Ответ сохранён" : "Нет ответа";
}

function select(q, m) {
  q.sel = m;
  q.editor.hidden = !m || q.kind !== "stars";
  if (m) {
    q.input.value = m.text;
    q.input.focus();
  }
  refresh(q);
}

function makeEditor(q) {
  const box = el("div", "editor");
  box.hidden = true;
  q.input = el("input");
  q.input.placeholder = "Обозначение по Байеру, например β Ori";
  q.input.oninput = () => {
    if (q.sel) { q.sel.text = q.input.value; refresh(q); }
  };
  q.input.onkeydown = (e) => { if (e.key === "Enter") select(q, null); };
  const greek = el("div", "greek");
  for (const [symbol, name] of GREEK_LETTERS) {
    const b = el("button", "", symbol);
    b.type = "button";
    b.title = name;
    b.onclick = () => {
      const i = q.input.selectionStart ?? q.input.value.length;
      const j = q.input.selectionEnd ?? i;
      q.input.setRangeText(symbol, i, j, "end");
      q.input.focus();
      q.input.oninput();
    };
    greek.append(b);
  }
  const done = el("button", "primary", "Готово"), del = el("button", "secondary", "Удалить маркер");
  done.onclick = () => select(q, null);
  del.onclick = () => {
    q.markers = q.markers.filter((x) => x !== q.sel);
    select(q, null);
  };
  const row = el("div", "row");
  row.append(el("small", "", "Формат: буква, номер (если есть), созвездие — α Lyr, ν1 Sgr"), del, done);
  box.append(q.input, greek, row);
  return box;
}

// Веса по разбаловке: звезда 2 б, Мессье 1,5 б, опорные точки и края — по 12 б на группу.
function weightOf(q, t) {
  if (q.kind === "stars") return 2;
  if (q.kind === "messier") return 1.5;
  const edge = t.id.startsWith("edge-"),
    n = q.targets.filter((x) => x.id.startsWith("edge-") === edge).length;
  return 12 / Math.max(1, n);
}
const r2 = (n) => Math.round(n * 100) / 100;

function scoreList(q, targets) {
  return targets.map((t) => {
    const key = q.kind === "stars" ? normalizeBayer(t.bayer, catalog) : null;
    const m = q.kind === "stars"
      ? q.markers.find((x) => key && normalizeBayer(x.text, catalog) === key)
      : q.markers.find((x) => x.key === t.id);
    const visible = Boolean(q.proj.project(t.ra, t.dec));
    const w = weightOf(q, t);
    if (!m) {
      const flagged = q.struck.has(t.id);
      if (visible) return { t, max: w, points: 0, reason: flagged ? "объект есть на карте" : "не отмечена" };
      return flagged
        ? { t, max: w, points: w, reason: "верно: вне карты" }
        : { t, max: w, points: 0, reason: "не указано, что объекта нет на карте" };
    }
    const [ra, dec] = q.proj.inverse(...norm(q, [m.fx, m.fy]));
    const r = scoreAnswer(t, { ra, dec }, q.proj, q.tol, w);
    return { t, max: w, points: r.points, reason: r.reason };
  });
}

// Пересечения с краем: каждую отметку сопоставляем с ближайшим ещё не занятым пересечением того же круга.
function scoreEdges(q) {
  const out = [];
  for (const f of [0, 1, 2]) {
    const targets = q.targets.filter((t) => t.id.startsWith(`edge-${f}-`));
    const marks = q.markers.filter((m) => m.key.startsWith(`edge:${f}:`));
    const pairs = [];
    for (const m of marks) {
      const [ra, dec] = q.proj.inverse(...norm(q, [m.fx, m.fy]));
      for (const t of targets) pairs.push({ m, t, ra, dec, d: angularDistance([t.ra, t.dec], [ra, dec]) });
    }
    pairs.sort((x, y) => x.d - y.d);
    const usedM = new Set(), byTarget = new Map();
    for (const p of pairs) {
      if (usedM.has(p.m) || byTarget.has(p.t)) continue;
      usedM.add(p.m);
      byTarget.set(p.t, p);
    }
    for (const t of targets) {
      const p = byTarget.get(t);
      if (!p) { out.push({ t, max: weightOf(q, t), points: 0, reason: "не отмечена" }); continue; }
      const w = weightOf(q, t);
      const r = scoreAnswer(t, { ra: p.ra, dec: p.dec }, q.proj, q.tol, w);
      out.push({ t, max: w, points: r.points, reason: r.reason });
    }
    for (const m of marks)
      if (!usedM.has(m)) out.push({ extra: true, t: { name: `${EDGE_META[f][0]} · лишняя отметка` }, points: 0, reason: "такого пересечения нет" });
  }
  return out;
}

function score(q) {
  if (q.kind !== "points") return scoreList(q, q.targets);
  return [...scoreList(q, q.targets.filter((t) => !t.id.startsWith("edge-"))), ...scoreEdges(q)];
}

function checkAll() {
  let total = 0, max = 0;
  for (const q of questions) {
    q.checked = true;
    select(q, null);
    const results = score(q);
    const pts = r2(results.reduce((s, r) => s + r.points, 0)), top = r2(results.filter((r) => !r.extra).reduce((s, r) => s + r.max, 0));
    total += pts; max += top;
    q.pts.textContent = `Балл: ${pts} из ${top}`;
    q.state.textContent = "Проверено";
    for (const r of results) {
      if (r.extra) continue;
      const p = q.proj.project(r.t.ra, r.t.dec);
      if (!p) continue;
      const [fx, fy] = toFraction(q, p);
      const ring = el("div", "ref");
      ring.style.left = fx * 100 + "%";
      ring.style.top = fy * 100 + "%";
      ring.append(el("i"), el("em", "", q.kind === "stars" ? r.t.bayer : q.kind === "points" ? labelOf(q, r.t).split(" ")[0] : r.t.name));
      q.layer.append(ring);
    }
    const ratio = pts / top;
    q.feedback.hidden = false;
    q.feedback.className = "feedback" + (ratio > 0.85 ? " ok" : "");
    q.feedback.replaceChildren(el("div", "",
      ratio > 0.85 ? "Ваш ответ верный." : ratio > 0.3 ? "Ваш ответ частично правильный." : "Ваш ответ неправильный."));
    const list = el("ul");
    for (const r of results) {
      const name = r.extra ? r.t.name : labelOf(q, r.t);
      list.append(el("li", "", `${r.points > 0 ? "✓" : "✗"} ${name}: ${r2(r.points)} из ${r2(r.max ?? 0)} — ${r.reason}`));
    }
    q.feedback.append(list);
  }
  const s = $("summary");
  s.hidden = false;
  s.textContent = `Итого: ${r2(total)} из ${r2(max)} баллов`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

init();
