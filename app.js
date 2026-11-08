import { currentSiteUrl } from "./site-url.js?v=10";
import { openFullscreen } from "./fullscreen.js?v=10";
import {
  RAD,
  clamp,
  vector,
  coordinates,
  dot,
  projector,
  scoreAnswer,
  referencePoints,
  boundaryCrossings,
  greatCircles,
  angularDistance,
} from "./astro.js?v=10";
import {
  LEVELS,
  selectTargets,
  scoreSandbox,
  resolveObject,
  visibleSegments,
  simplifyStroke,
  scoreDrawing,
  sandboxPoints,
  sortMessier,
} from "./training.js?v=10";
import { GREEK_LETTERS, bayerLabel } from "./bayer.js?v=10";
import { SkyRenderer, mapHeight } from "./renderer.js?v=10";
import {
  createVariant,
  validateConfig,
  DEFAULT_CONFIG,
  variantSummary,
  variantUrl,
  readVariantUrl,
} from "./variant.js?v=10";
import { Atlas } from "./atlas.js?v=10";
import { drawCrosshair, drawTag, markTheme } from "./marker-style.js?v=10";
import { makePacket, renderPacket } from "./print.js?v=10";
import { downloadBlob } from "./pdf.js?v=10";
import { parseCode, seedCode, redirectCode, routeLinkedCode } from "./codes.js?v=10";
import { recordProgress, updateProgressCount, showProgress } from "./progress.js?v=10";

const $ = (id) => document.getElementById(id);
const r2 = (n) => Math.round(n * 100) / 100;
// Веса по разбаловке: опорные точки и пересечения с краем — по 12 б на группу, звезда — 2 б, Мессье — 1,5 б, созвездия — 16 б.
function weightOf(mode, target, targets) {
  if (mode === "stars") return 2;
  if (mode === "messier") return 1.5;
  if (mode === "reference") {
    const edge = target.id.startsWith("edge-"),
      n = targets.filter((t) => t.id.startsWith("edge-") === edge).length;
    return 12 / Math.max(1, n);
  }
  return 100;
}
const SIZE = 1000,
  CENTER = 500,
  RADIUS = 498;
const sky = $("sky"),
  marks = $("marks");
const context = sky.getContext("2d"),
  overlay = marks.getContext("2d");
const renderer = new SkyRenderer();
const STORAGE = "nightweave-variant-v3";
const numericFields = [
  "fov",
  "roll",
  "ra",
  "dec",
  "az",
  "alt",
  "latitude",
  "longitude",
  "count",
  "star-count",
  "magnitude",
  "star-size",
  "exposure",
];
const titles = {
  messier: [
    "Найди объекты<br> далёкого космоса",
    "Выбери объект и поставь точку. Если его нет в этом участке неба, отметь «Вне карты». Кнопка ⓘ открывает каталог.",
  ],
  stars: [
    "Дай звёздам<br> их имена",
    "Найди звёзды из списка. Для отсутствующих звёзд выбери «Вне карты». Уровень сложности определяет набор звёзд и букв Байера.",
  ],
  reference: [
    "Ориентируйся<br> на небесной сфере",
    "Отметь опорные точки. E, Γ и ε — пересечения экваторов и эклиптики с краем области; нумерация пар произвольная.",
  ],
  lines: [
    "Нарисуй<br> знакомые созвездия",
    "Рисуй мышью, пальцем или стилусом. Каждый штрих сохраняется отдельно. Можно переключиться на соединение двумя нажатиями.",
  ],
  sandbox: [
    "Твоё небо.<br> Твои ориентиры.",
    "Смешивай Мессье, звёзды и опорные точки на одной карте. Для Байера выбери букву и впиши созвездие; для равноденствий, солнцестояний и пересечений есть отдельный список.",
  ],
};
let catalog,
  atlas,
  projection,
  baseImage,
  renderPromise,
  toastTimer,
  drawing,
  results = [],
  learned = false;
let variant, freeAttempt;
let state = {
  mode: "messier",
  config: null,
  targets: [],
  answers: {},
  selected: 0,
  checked: false,
  strokes: [],
  pending: null,
  entries: [],
  sandboxType: "messier",
};
const labelBoxes = new WeakMap();
let lastPenContact = -Infinity;
const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const pixel = (point) => [
  CENTER + point[0] * RADIUS,
  marks.height / 2 + point[1] * RADIUS,
];
const nextFrame = () =>
  new Promise((resolve) =>
    (globalThis.requestAnimationFrame || setTimeout)(resolve),
  );

function storage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function save() {
  try {
    localStorage.setItem(
      STORAGE,
      JSON.stringify({ variant, active: state.mode, freeAttempt }),
    );
  } catch {
    /* Storage is optional. */
  }
}
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 4000);
}
function openDialog(html) {
  $("dialog-content").innerHTML = html;
  if (!$("dialog").open) $("dialog").showModal();
}
function numericSeed() {
  return String(Math.floor(100000000 + Math.random() * 900000000));
}

function readConfig() {
  const config = {};
  for (const id of numericFields) {
    const input = $(id);
    if (
      !input.checkValidity() ||
      input.value.trim() === "" ||
      !Number.isFinite(Number(input.value))
    ) {
      $("settings").hidden = false;
      input.reportValidity();
      throw new Error("Проверь числовые параметры снимка.");
    }
    config[id] = Number(input.value);
  }
  config.ra *= 15;
  config.starCount = config["star-count"];
  config.messierCount = config.count;
  config.starSize = config["star-size"];
  delete config["star-size"];
  config.count =
    state.mode === "stars" ? config.starCount : config.messierCount;
  for (const id of ["frame", "projection", "level", "display"])
    config[id] = $(id).value;
  config.date = $("date").value + "Z";
  const year = new Date(config.date).getUTCFullYear();
  if (!Number.isFinite(year) || year < 1900 || year > 2100)
    throw new Error("Выбери дату между 1900 и 2100 годом.");
  const code = parseCode($("seed").value.trim() || numericSeed(), "T");
  if (code.kind !== "T") throw new Error("Открой квиз через общее поле seed выше.");
  config.seed = code.seed;
  $("seed").value = seedCode("T", config.seed);
  config.skyMode = $("sky-mode").value || "auto";
  config.horizon = $("horizon").checked;
  config.bayerTest = $("bayer-test").checked;
  config.edges = $("edges").checked;
  if (config.projection === "gnomonic" && config.fov > 150) {
    config.fov = 150;
    $("fov").value = 150;
    toast("Поле гномонической проекции ограничено 150°.");
  }
  config.maps = [1, 2, 3].map((index) => ({
    shape: $(`map-${index}-shape`).value,
    aspect: Number($(`map-${index}-aspect`).value),
    projection: $(`map-${index}-projection`).value,
    fov: Number($(`map-${index}-fov`).value),
    ra: Number($(`map-${index}-ra`).value) * 15,
    dec: Number($(`map-${index}-dec`).value),
    roll: Number($(`map-${index}-roll`).value),
  }));
  return validateConfig(config);
}
function writeConfig(config) {
  for (const id of numericFields) {
    const value =
      id === "ra"
        ? config.ra / 15
        : id === "star-count"
          ? config.starCount
          : id === "count"
            ? config.messierCount
            : id === "star-size"
              ? config.starSize
              : config[id];
    $(id).value = value;
  }
  for (const id of ["frame", "projection", "level", "display", "seed"])
    $(id).value = config[id];
  $("sky-mode").value = config.skyMode || "auto";
  $("date").value = config.date.replace("Z", "");
  for (const [id, key] of [
    ["horizon", "horizon"],
    ["bayer-test", "bayerTest"],
    ["edges", "edges"],
  ])
    $(id).checked = config[key];
  config.maps?.forEach((map, index) => {
    for (const key of [
      "shape",
      "aspect",
      "projection",
      "fov",
      "ra",
      "dec",
      "roll",
    ])
      $(`map-${index + 1}-${key}`).value =
        key === "ra" ? map.ra / 15 : map[key];
  });
  $("variant-seed").value = seedCode("T", config.seed);
  $("seed").value = seedCode("T", config.seed);
  updateFrame();
}
function updateFrame() {
  const horizon = $("frame").value === "horizon";
  document.querySelectorAll(".eq-field").forEach((e) => (e.hidden = horizon));
  document.querySelectorAll(".hor-field").forEach((e) => (e.hidden = !horizon));
}
function tolerance() {
  return Math.max(
    0.3,
    (state.config.fov / 30) * LEVELS[state.config.level].tolerance,
  );
}

function updateVariantUrl() {
  if (!variant) return;
  const url = variantUrl(
    currentSiteUrl(),
    variant.base,
    state.mode,
  );
  globalThis.history?.replaceState(null, "", url);
  $("variant-link").href = url;
}
function updateVariantSummary() {
  if (!variant) return;
  const summary = variantSummary(variant);
  $("variant-number").textContent = seedCode("T", variant.seed);
  $("variant-total").textContent = `${summary.points} / ${summary.maximum}`;
  $("variant-status").textContent = summary.complete
    ? "Все задания проверены"
    : `Проверено ${summary.rows.filter((r) => r.checked).length} из 5 заданий`;
  $("variant-scores").innerHTML = summary.rows
    .map(
      (row) =>
        `<div><span>${row.label}</span><strong>${row.checked ? row.points : "—"} / ${row.maximum}</strong></div>`,
    )
    .join("");
}
function switchMode(mode) {
  if (!variant) return;
  const fullscreenResult = document.querySelector("[data-fullscreen-result]");
  if (fullscreenResult) fullscreenResult.textContent = "";
  state.pending = null;
  if (mode === "sandbox") {
    freeAttempt ||= {
      mode: "sandbox",
      config: { ...variant.configs[2] },
      targets: [],
      answers: {},
      selected: 0,
      checked: false,
      strokes: [],
      pending: null,
      entries: [],
      sandboxType: $("sandbox-type").value,
    };
    state = freeAttempt;
  } else state = variant.attempts[mode];
  state.config.display = $("display").value;
  projection = projector(state.config);
  results = [];
  drawing = null;
  $("results").hidden = true;
  $("grid").checked = false;
  $("guides").checked = false;
  renderAll();
  if (state.checked) checkAnswer(false);
  updateVariantSummary();
  updateVariantUrl();
  save();
}
function newTask(changeSeed = false, supplied = null) {
  try {
    if (changeSeed) $("seed").value = numericSeed();
    const config = supplied ? validateConfig(supplied) : readConfig();
    const mode = state.mode;
    variant = createVariant(catalog, config);
    freeAttempt = null;
    writeConfig(variant.base);
    learned = false;
    switchMode(mode);
    toast(
      `Seed ${seedCode("T", variant.seed)} создан: ${variant.attempts.stars.targets.length} звезда, ${variant.attempts.messier.targets.length} объекта Мессье.`,
    );
  } catch (error) {
    toast(error.message);
  }
}
function storeModeScore(mode, modeResults, line, record = true) {
  if (!variant || mode === "sandbox") return;
  if (mode === "reference") {
    variant.scores.points = modeResults
      .filter((r) => !r.target.id.startsWith("edge-"))
      .reduce((s, r) => s + r.points, 0);
    variant.scores.points = r2(variant.scores.points);
    variant.scores.edges = modeResults
      .filter((r) => r.target.id.startsWith("edge-"))
      .reduce((s, r) => s + r.points, 0);
    variant.scores.edges = r2(variant.scores.edges);
  } else
    variant.scores[mode] = line
      ? r2(line.points * 0.16)
      : r2(modeResults.reduce((s, r) => s + r.points, 0));
  updateVariantSummary();
  const summary = variantSummary(variant);
  if (record) recordProgress({
    id: "T:" + JSON.stringify(variant.base), kind: "T", seed: variant.seed,
    score: summary.points, maximum: summary.maximum,
    label: `Тренажёр · ${summary.rows.filter(row => row.checked).length} из 5 заданий`,
    url: variantUrl(currentSiteUrl(), variant.base, state.mode),
  });
  save();
}
function checkWholeVariant() {
  const active = state.mode;
  for (const mode of ["reference", "stars", "messier", "lines"]) {
    state = variant.attempts[mode];
    projection = projector(state.config);
    state.checked = true;
    const r = calculateResults(),
      line =
        mode === "lines"
          ? scoreDrawing(state.targets, state.strokes, tolerance())
          : null;
    storeModeScore(mode, r, line);
  }
  switchMode(active);
  $("variant-summary").scrollIntoView({ behavior: "smooth", block: "center" });
}
async function copyVariantLink() {
  const url = variantUrl(
    currentSiteUrl(),
    variant.base,
    state.mode,
  );
  try {
    await navigator.clipboard.writeText(url);
    toast("Ссылка на seed скопирована.");
  } catch {
    openDialog(
      `<h2>Ссылка на seed</h2><p>Seed и все настройки включены в ссылку.</p><input aria-label="Ссылка на seed" readonly value="${escape(url)}">`,
    );
  }
}

// Кнопка «Режим»: фото NASA (Млечный Путь) ⇄ экзаменационный вид (чёрные звёзды на белом).
let photoDisplay = "milkyway";
const DISPLAY_NAMES = {
  stars: "цветные звёзды",
  milkyway: "фото NASA",
  mono: "белые звёзды",
  paper: "экзамен",
};
function syncDisplayToggle() {
  const button = $("display-toggle");
  if (!button) return;
  const value = $("display").value,
    exam = value === "paper";
  button.textContent = `⇄ Режим: ${DISPLAY_NAMES[value] || value}`;
  button.title = exam
    ? "Вернуться к прежнему виду карты"
    : "Переключить на экзаменационный вид (чёрные звёзды на белом)";
  button.setAttribute("aria-pressed", String(exam));
  button.classList.toggle("on", exam);
}

async function drawBase() {
  syncDisplayToggle();
  sky.height = marks.height = mapHeight(SIZE, state.config);
  $("map-stage").classList.toggle(
    "rectangular",
    state.config.shape === "rectangle",
  );
  $("map-stage").style.aspectRatio =
    state.config.shape === "rectangle"
      ? String(state.config.aspect || 1.6)
      : "1";
  const config = { ...state.config },
    started = performance.now();
  baseImage = null;
  const completed = await renderer.render(sky, catalog, config, (status) => {
    $("render-status").textContent = status;
  });
  if (!completed) return;
  baseImage = context.getImageData(0, 0, SIZE, sky.height);
  $("render-status").textContent +=
    ` · ${Math.round(performance.now() - started)} мс`;
  drawGuides();
}
function drawPath(ctx, path, color, width = 1, dash = []) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  let previous = null;
  for (const c of path) {
    const p = projection.project(...c);
    if (!p) {
      previous = null;
      continue;
    }
    const [x, y] = pixel(p);
    if (previous) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
    previous = [x, y];
  }
  ctx.stroke();
  ctx.setLineDash([]);
}
function drawGuides() {
  if (!baseImage) return;
  context.putImageData(baseImage, 0, 0);
  const paper = state.config.display === "paper";
  if ($("grid").checked) {
    for (let ra = 0; ra < 360; ra += 30)
      drawPath(
        context,
        Array.from({ length: 181 }, (_, i) => [ra, i - 90]),
        paper ? "#9998" : "#7ba3ba45",
      );
    for (let dec = -60; dec <= 60; dec += 30)
      drawPath(
        context,
        Array.from({ length: 361 }, (_, i) => [i, dec]),
        paper ? "#9998" : "#7ba3ba45",
      );
    greatCircles().forEach((path, i) =>
      drawPath(
        context,
        path,
        paper ? "#666" : ["#9fc1dd", "#c8c082", "#bb9fc5"][i],
        1,
        [5, 7],
      ),
    );
  }
  if ($("guides").checked && state.mode !== "lines")
    for (const figure of catalog.lines)
      for (const path of figure.paths)
        drawPath(context, path, paper ? "#777" : "#8eb8cb70", 1.3);
}
// Единый стиль маркера (см. marker-style.js): перекрестие в кружке + скруглённая метка.
// correct = true — правильный ответ после проверки (зелёный), иначе — ответ пользователя.
function marker(ctx, point, label, correct = false) {
  if (!point) return;
  const [x, y] = pixel(point),
    theme = markTheme(state.config.display === "paper"),
    color = correct ? theme.good : theme.ink,
    boxes = labelBoxes.get(ctx) || [];
  drawCrosshair(ctx, x, y, color);
  if (!label) return;
  drawTag(ctx, x, y, label, theme, {
    boxes,
    width: SIZE,
    height: marks.height,
    color: correct ? theme.good : undefined,
  });
  labelBoxes.set(ctx, boxes);
}
function pair(user, correct, label) {
  if (user && correct) {
    const a = pixel(user),
      b = pixel(correct);
    overlay.strokeStyle =
      state.config.display === "paper" ? "#666" : "#cbd3c57f";
    overlay.lineWidth = 1.7;
    overlay.setLineDash([5, 6]);
    overlay.beginPath();
    overlay.moveTo(...a);
    overlay.lineTo(...b);
    overlay.stroke();
    overlay.setLineDash([]);
  }
  if (user) marker(overlay, user, label);
  if (correct)
    marker(overlay, correct, label, true);
}
function drawMarks() {
  overlay.clearRect(0, 0, SIZE, marks.height);
  labelBoxes.set(overlay, []);
  if (state.mode === "lines") {
    for (const stroke of state.strokes)
      drawPath(overlay, stroke.points, "#eaa46f", 3);
    if (drawing?.coordinates.length)
      drawPath(overlay, drawing.coordinates, "#ffb480", 3);
    if (state.pending)
      marker(overlay, projection.project(...state.pending), "");
    if (state.checked)
      for (const segment of state.targets)
        drawPath(
          overlay,
          [segment.a, segment.b],
          state.config.display === "paper" ? "#216342" : "#d5ec95",
          2,
          [6, 5],
        );
    return;
  }
  if (state.mode === "sandbox") {
    state.entries.forEach((entry, i) => {
      const r = results[i],
        correct =
          state.checked && r?.target
            ? projection.project(r.target.ra, r.target.dec)
            : null;
      pair(
        entry.absent ? null : projection.project(entry.ra, entry.dec),
        correct,
        entry.label || entry.name,
      );
    });
    if (state.pending)
      marker(overlay, projection.project(...state.pending), "?");
    return;
  }
  state.targets.forEach((target, index) => {
    const answer = state.answers[target.id],
      expected = state.checked ? results[index]?.expected || target : target;
    const user =
      answer && !answer.absent && !answer.draft
        ? projection.project(answer.ra, answer.dec)
        : null;
    pair(
      user,
      state.checked ? projection.project(expected.ra, expected.dec) : null,
      state.mode === "messier" ? target.name : String(index + 1),
    );
  });
}
// Панель греческих букв (как в экзамене) для полей «Обозначение Байера»
let bayerInput = null;
function buildGreekPad() {
  const box = document.querySelector("#greek-pad .greek");
  if (!box || box.children.length) return;
  for (const [symbol, name] of GREEK_LETTERS) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = symbol;
    b.title = name;
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = () => {
      const input = bayerInput?.isConnected ? bayerInput : document.querySelector(".bayer-answer:not(:disabled)");
      if (!input) return;
      const i = input.selectionStart ?? input.value.length,
        j = input.selectionEnd ?? i;
      input.setRangeText(symbol, i, j, "end");
      input.dispatchEvent(new Event("input"));
      input.focus();
    };
    box.append(b);
  }
}
function renderObjects() {
  buildGreekPad();
  const active = state.targets[state.selected];
  $("active-object").textContent = ["messier", "stars", "reference"].includes(
    state.mode,
  )
    ? active
      ? `Сейчас отмечаем: ${active.name}`
      : "На этом уровне нет подходящих объектов"
    : state.mode === "sandbox"
      ? "Свободные подписи на карте"
      : "Рисование созвездий";
  const list = $("objects");
  list.replaceChildren();
  list.hidden = ["lines", "sandbox"].includes(state.mode);
  $("greek-pad").hidden = true;
  $("line-tools").hidden = state.mode !== "lines";
  $("sandbox-tools").hidden = state.mode !== "sandbox";
  $("guides").disabled = state.mode === "lines";
  if (state.mode === "sandbox") {
    renderEntries();
    return;
  }
  if (state.mode === "lines") return;
  $("greek-pad").hidden = !(state.mode === "stars" && state.config.bayerTest);
  state.targets.forEach((target, index) => {
    const answer = state.answers[target.id],
      row = document.createElement("div");
    row.className =
      "object-row" + (state.selected === index ? " selected" : "");
    const select = document.createElement("button");
    select.className = "object-select";
    select.setAttribute("aria-pressed", String(state.selected === index));
    select.innerHTML = `<span class="object-number">${String(index + 1).padStart(2, "0")}</span><span class="object-name">${escape(target.name)}</span><span class="object-state">${answer && !answer.draft ? (answer.absent ? "—" : "✓") : ""}</span>`;
    select.onclick = () => {
      state.selected = index;
      renderObjects();
      save();
      if (globalThis.matchMedia?.("(max-width: 760px)").matches)
        sky.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    row.append(select);
    if (["stars", "messier"].includes(state.mode)) {
      const info = document.createElement("button");
      info.className = "object-info";
      info.textContent = "ⓘ";
      info.setAttribute("aria-label", `Каталог: ${target.name}`);
      info.onclick = () => {
        learned = true;
        $("difficulty").textContent = "С ПОДСКАЗКОЙ КАТАЛОГА";
        atlas.detail(target);
      };
      row.append(info);
    }
    const absent = document.createElement("button");
    absent.className = "absent";
    absent.type = "button";
    absent.title = "Закрасить ■ — объекта нет на карте";
    absent.innerHTML = '<i class="sq" aria-hidden="true"></i>Вне карты';
    absent.setAttribute("aria-pressed", String(Boolean(answer?.absent)));
    absent.disabled = state.checked;
    absent.onclick = () => {
      if (answer?.absent) delete state.answers[target.id];
      else state.answers[target.id] = { absent: true };
      advance();
      updateAnswer();
    };
    row.append(absent);
    if (state.mode === "stars" && state.config.bayerTest) {
      const input = document.createElement("input");
      input.className = "bayer-answer";
      input.placeholder = "Байер: α Ori";
      input.setAttribute("aria-label", `Обозначение Байера: ${target.name}`);
      input.value = answer?.bayer || "";
      input.disabled = state.checked;
      input.onfocus = () => (bayerInput = input);
      input.oninput = () => {
        const previous = state.answers[target.id];
        state.answers[target.id] = {
          ...previous,
          bayer: input.value,
          draft: !previous || previous.draft,
        };
        save();
      };
      row.append(input);
    }
    list.append(row);
  });
}
function pointOptions(select, selected) {
  select.replaceChildren();
  for (const [label, edge] of [["Равноденствия, солнцестояния и опорные точки", false], ["Пересечения с краем этой карты", true]]) {
    const group = document.createElement("optgroup");
    group.label = label;
    for (const point of sandboxPoints(state.config).filter(item => item.id.startsWith("edge-") === edge)) {
      const option = document.createElement("option");
      option.value = point.id;
      option.textContent = point.name;
      group.append(option);
    }
    if (group.children.length) select.append(group);
  }
  if ([...select.options].some(option => option.value === selected)) select.value = selected;
}
function sandboxInput() {
  return state.sandboxType === "bayer" ? $("sandbox-constellation") : state.sandboxType === "reference" ? $("sandbox-point") : $("sandbox-name");
}
function renderEntries() {
  const list = $("sandbox-entries");
  list.replaceChildren();
  $("sandbox-name-label").hidden = ["bayer", "reference"].includes(state.sandboxType);
  $("sandbox-bayer-fields").hidden = state.sandboxType !== "bayer";
  $("sandbox-point-label").hidden = state.sandboxType !== "reference";
  pointOptions($("sandbox-point"), $("sandbox-point").value);
  for (const id of ["sandbox-type", "sandbox-name", "sandbox-greek", "sandbox-index", "sandbox-constellation", "sandbox-point"])
    $(id).disabled = state.checked;
  $("sandbox-input-help").textContent = state.sandboxType === "bayer"
    ? "Созвездие впиши самостоятельно: Лира, Лиры, Lyra, Lyrae или Lyr. Индекс нужен только для обозначений вроде π3 Ori."
    : state.sandboxType === "reference"
      ? "Выбери точку по названию. Пересечения с краем рассчитываются для текущей карты; их координаты не подсказываются."
      : "Принимаются русские и английские имена, номера Мессье и запись Байера словами, например альфа Лиры.";
  $("sandbox-location").textContent = state.pending
    ? `RA ${(state.pending[0] / 15).toFixed(3)}h · Dec ${state.pending[1].toFixed(2)}°`
    : "Сначала выбери точку на карте.";
  const absentBox = $("sandbox-absent");
  absentBox.disabled = state.checked;
  $("sandbox-add").disabled = state.checked || (!state.pending && !absentBox.checked);
  $("sandbox-name").disabled = state.checked;
  if (!state.entries.length) {
    const p = document.createElement("p");
    p.className = "fine";
    p.textContent = "Здесь появятся твои подписи.";
    list.append(p);
  }
  state.entries.forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = "sandbox-entry";
    const isPoint = entry.kind === "reference";
    const input = document.createElement(isPoint ? "select" : "input");
    if (isPoint) pointOptions(input, entry.targetId);
    else input.value = entry.name;
    input.maxLength = 60;
    input.disabled = state.checked;
    input.setAttribute("aria-label", `Имя отметки ${index + 1}`);
    input.onchange = () => {
      const point = isPoint ? sandboxPoints(state.config).find(item => item.id === input.value) : null;
      entry.name = point ? point.name : input.value.trim();
      entry.label = point?.shortName;
      const found = resolveObject(catalog, entry.kind || state.sandboxType, entry.name, state.config);
      entry.targetId = found.length === 1 ? found[0].id : null;
      drawMarks();
      save();
    };
    const remove = document.createElement("button");
    remove.className = "icon-button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Удалить отметку ${index + 1}`);
    remove.disabled = state.checked;
    remove.onclick = () => {
      state.entries.splice(index, 1);
      updateAnswer();
    };
    row.append(input);
    if (entry.absent) {
      const badge = document.createElement("span");
      badge.className = "entry-absent";
      badge.title = "Отмечено: объекта нет на карте";
      badge.innerHTML = '<i class="sq on" aria-hidden="true"></i>вне карты';
      row.append(badge);
    }
    row.append(remove);
    list.append(row);
  });
}
function addEntry() {
  const absent = $("sandbox-absent").checked;
  if ((!state.pending && !absent) || state.checked) return;
  let name = $("sandbox-name").value.trim();
  const point = state.sandboxType === "reference" ? sandboxPoints(state.config).find(item => item.id === $("sandbox-point").value) : null;
  try {
    if (state.sandboxType === "bayer") name = bayerLabel($("sandbox-greek").value, $("sandbox-index").value, $("sandbox-constellation").value);
    if (point) name = point.name;
  } catch (error) { toast(error.message); sandboxInput().focus(); return; }
  if (!name) {
    sandboxInput().focus();
    return;
  }
  if (state.entries.length >= 60) {
    toast("До 60 подписей на одном снимке.");
    return;
  }
  const kind = state.sandboxType === "bayer" ? "stars" : state.sandboxType;
  const found = resolveObject(catalog, kind, name, state.config);
  state.entries.push({
    kind,
    name,
    label: point?.shortName,
    ...(absent ? { absent: true } : { ra: state.pending[0], dec: state.pending[1] }),
    targetId: found.length === 1 ? found[0].id : null,
  });
  state.pending = null;
  $("sandbox-absent").checked = false;
  $("sandbox-name").value = "";
  updateAnswer();
}
function advance() {
  for (let step = 1; step <= state.targets.length; step++) {
    const index = (state.selected + step) % state.targets.length;
    if (
      !state.answers[state.targets[index].id] ||
      state.answers[state.targets[index].id].draft
    ) {
      state.selected = index;
      break;
    }
  }
}
function updateAnswer() {
  renderObjects();
  updateProgress();
  drawMarks();
  save();
}
function updateProgress() {
  const done =
    state.mode === "lines"
      ? state.strokes.length
      : state.mode === "sandbox"
        ? state.entries.length
        : Object.values(state.answers).filter((a) => !a.draft).length;
  const percentage = ["lines", "sandbox"].includes(state.mode)
    ? 0
    : Math.round((done / Math.max(1, state.targets.length)) * 100);
  $("completion-text").textContent =
    state.mode === "lines"
      ? `Штрихов: ${done}`
      : state.mode === "sandbox"
        ? `Подписей: ${done}`
        : `Отмечено ${done} из ${state.targets.length}`;
  $("completion-percent").textContent = ["lines", "sandbox"].includes(
    state.mode,
  )
    ? "✧"
    : percentage + "%";
  $("completion-bar").style.width = percentage + "%";
  $("check").disabled = state.checked;
  $("check").textContent = state.checked
    ? "Ответ проверен ✓"
    : "Проверить ответ ↗";
  $("scoring-hint").textContent =
    state.mode === "lines"
      ? "Оцениваем полноту и точность штрихов"
      : state.mode === "sandbox"
        ? "Проверяются подписи и положения · повторы не засчитываются"
        : "Центр маркера в зелёном эталоне — полный балл, иначе 0";
}
function renderAll() {
  document
    .querySelectorAll("[data-mode]")
    .forEach((b) =>
      b.setAttribute("aria-selected", String(b.dataset.mode === state.mode)),
    );
  $("task-title").innerHTML = titles[state.mode][0];
  $("task-description").textContent = titles[state.mode][1];
  $("level-description").textContent = LEVELS[state.config.level].description;
  $("difficulty").textContent = LEVELS[state.config.level].label.toUpperCase();
  const names = {
    stereo: "СТЕРЕОГРАФИЧЕСКАЯ",
    equidistant: "РАВНОПРОМЕЖУТОЧНАЯ",
    orthographic: "ОРТОГРАФИЧЕСКАЯ",
    gnomonic: "ГНОМОНИЧЕСКАЯ",
  };
  $("view-label").textContent =
    `${names[state.config.projection]} · ${state.config.fov}°`;
  $("variant-label").textContent = seedCode("T", state.config.seed);
  $("observer-label").textContent =
    state.config.frame === "horizon"
      ? `${state.config.latitude}° / ${state.config.longitude}° · UTC`
      : `RA ${(state.config.ra / 15).toFixed(2)}h · DEC ${state.config.dec}°`;
  $("map-tip").textContent =
    state.mode === "sandbox"
      ? "Нажми на карту, затем введи подпись."
      : state.mode === "lines"
        ? "Веди по звёздам мышью, пальцем или стилусом."
        : "Выбери объект в списке и отметь его положение.";
  $("sandbox-type").value = state.sandboxType;
  const [ra, dec] = coordinates(projection.basis.forward);
  for (const [name, direction, sign] of [
    ["north", vector(ra + 180, 90 - dec), 1],
    ["south", vector(ra + 180, 90 - dec), -1],
    ["east", vector(ra + 90, 0), 1],
    ["west", vector(ra + 90, 0), -1],
  ]) {
    const x = dot(direction, projection.basis.right) * sign,
      y = -dot(direction, projection.basis.up) * sign,
      norm = Math.hypot(x, y) || 1,
      label = document.querySelector(`.compass.${name}`);
    const rectangular = state.config.shape === "rectangle";
    const aspect = state.config.aspect || 1.6;
    const ray = rectangular
      ? Math.min(
          1 / Math.max(1e-9, Math.abs(x)),
          1 / aspect / Math.max(1e-9, Math.abs(y)),
        )
      : 1 / norm;
    Object.assign(label.style, {
      left: `${50 + 48.5 * x * ray}%`,
      top: `${50 + 48.5 * y * ray * (rectangular ? aspect : 1)}%`,
      bottom: "auto",
      right: "auto",
      transform: "translate(-50%,-50%)",
    });
  }
  renderObjects();
  updateProgress();
  renderPromise = drawBase();
  drawMarks();
}
function normalizedEvent(event) {
  const rect = sky.getBoundingClientRect();
  return [
    (((event.clientX - rect.left) / rect.width) * SIZE - CENTER) / RADIUS,
    (((event.clientY - rect.top) / rect.height) * marks.height -
      marks.height / 2) /
      RADIUS,
  ];
}
function eventCoordinate(event) {
  return projection.inverse(...normalizedEvent(event));
}
function place(coordinate, focusInput = true) {
  if (!coordinate || state.checked) return;
  if (state.mode === "sandbox") {
    state.pending = coordinate;
    updateAnswer();
    if (focusInput) sandboxInput().focus({ preventScroll: true });
    return;
  }
  if (state.mode === "lines") {
    if (!state.pending) state.pending = coordinate;
    else {
      if (angularDistance(state.pending, coordinate) > 0.1)
        state.strokes.push({ points: [state.pending, coordinate] });
      state.pending = null;
    }
  } else {
    const target = state.targets[state.selected];
    if (!target) return;
    state.answers[target.id] = {
      ra: coordinate[0],
      dec: coordinate[1],
      bayer: state.answers[target.id]?.bayer || "",
    };
    advance();
  }
  updateAnswer();
}
function pointerDown(event) {
  if (event.pointerType === "pen") lastPenContact = performance.now();
  if (event.pointerType === "touch" && performance.now() - lastPenContact < 800)
    return;
  if (drawing && drawing.id !== event.pointerId) return;
  if (event.isPrimary === false || state.checked) return;
  event.preventDefault();
  sky.focus({ preventScroll: true });
  const coordinate = eventCoordinate(event);
  if (!coordinate) return;
  if (
    state.mode === "lines" &&
    ($("draw-tool").value === "freehand" || event.pointerType === "pen")
  ) {
    sky.setPointerCapture?.(event.pointerId);
    drawing = {
      id: event.pointerId,
      screen: [normalizedEvent(event)],
      coordinates: [coordinate],
    };
    state.pending = null;
    drawMarks();
  } else place(coordinate, event.pointerType !== "touch" || !sky.closest(".fullscreen-shell"));
}
function pointerMove(event) {
  const c = eventCoordinate(event);
  $("cursor-coords").textContent = c
    ? `RA ${(c[0] / 15).toFixed(2)}h · DEC ${c[1].toFixed(1)}°`
    : "ВНЕ СНИМКА";
  if (!drawing || drawing.id !== event.pointerId) return;
  const coalesced = event.getCoalescedEvents?.();
  for (const sample of coalesced?.length ? coalesced : [event]) {
    const screen = normalizedEvent(sample),
      coordinate = projection.inverse(...screen);
    if (!coordinate) {
      pointerUp(event);
      return;
    }
    const last = drawing.screen.at(-1);
    if (Math.hypot(screen[0] - last[0], screen[1] - last[1]) < 0.004) continue;
    drawing.screen.push(screen);
    drawing.coordinates.push(coordinate);
  }
  drawMarks();
}
function pointerUp(event) {
  if (!drawing || drawing.id !== event.pointerId) return;
  if (drawing.screen.length > 1) {
    const simplified = simplifyStroke(drawing.screen, 0.004),
      points = simplified.map((p) => projection.inverse(...p)).filter(Boolean);
    if (points.length > 1) state.strokes.push({ points });
  }
  drawing = null;
  if (sky.hasPointerCapture?.(event.pointerId))
    sky.releasePointerCapture(event.pointerId);
  updateAnswer();
}
function calculateResults() {
  if (state.mode === "sandbox")
    return scoreSandbox(
      state.entries,
      catalog,
      state.sandboxType,
      projection,
      tolerance(),
      state.config,
    );
  if (state.mode === "lines") return [];
  const used = new Set();
  return state.targets.map((target) => {
    const answer = state.answers[target.id];
    let expected = target;
    if (
      target.id.startsWith("edge-") &&
      answer &&
      !answer.absent &&
      !answer.draft
    ) {
      const family = target.id.split("-")[1],
        candidates = state.targets.filter(
          (t) => t.id.startsWith(`edge-${family}-`) && !used.has(t.id),
        );
      candidates.sort(
        (a, b) =>
          angularDistance([a.ra, a.dec], [answer.ra, answer.dec]) -
          angularDistance([b.ra, b.dec], [answer.ra, answer.dec]),
      );
      if (candidates.length) {
        expected = candidates[0];
        used.add(expected.id);
      }
    }
    const result = scoreAnswer(
      expected,
      answer?.draft ? null : answer,
      projection,
      tolerance(),
      weightOf(state.mode, target, state.targets),
    );
    if (
      state.mode === "stars" &&
      state.config.bayerTest &&
      result.visible &&
      answer &&
      !answer.absent &&
      !answer.draft
    ) {
      const normalize = (value) =>
        (value || "").toLowerCase().replace(/[\s.]/g, "");
      const correct = normalize(answer.bayer) === normalize(target.bayer);
      result.points = r2(result.points * 0.8 + (correct ? 0.2 * result.max : 0));
      result.reason += correct ? " · Байер ✓" : ` · Байер: ${target.bayer}`;
    }
    return { ...result, target, expected };
  });
}
function checkAnswer(record = true) {
  if (state.mode === "sandbox" && !state.entries.length) {
    toast("Сначала добавь хотя бы одну подпись.");
    return;
  }
  state.checked = true;
  state.pending = null;
  drawing = null;
  results = calculateResults();
  const line =
    state.mode === "lines"
      ? scoreDrawing(state.targets, state.strokes, tolerance())
      : null;
  const score = line
      ? r2(line.points * 0.16)
      : r2(results.reduce((sum, r) => sum + r.points, 0)),
    maximum = line ? 16 : r2(results.reduce((sum, r) => sum + (r.max ?? 100), 0)),
    percent = Math.round((score / Math.max(1, maximum)) * 100);
  const fullscreenResult = document.querySelector("[data-fullscreen-result]");
  if (fullscreenResult) fullscreenResult.textContent = `${score} / ${maximum} баллов`;
  $("results").innerHTML =
    `<div class="results-top"><div><p class="eyebrow">РАЗБОР ЗАДАНИЯ</p><h3>${percent >= 85 ? "Небо становится знакомым" : "Ориентир для следующей попытки"}</h3><p>Seed ${escape(seedCode("T", state.config.seed))} · ${LEVELS[state.config.level].label}${learned ? " · каталог использован как подсказка" : ""}</p></div><div class="score">${score}<span style="font-size:14px;color:#92a1aa"> / ${maximum}</span></div></div><div class="legend"><span class="user">◎ Твой ответ</span><span class="correct">◎ Правильный ответ</span><span>┄ Смещение</span></div>${line ? `<p>Полнота рисунка: ${Math.round(line.coverage * 100)}%. Точность штрихов: ${Math.round(line.precision * 100)}%. Пропуски и лишние линии снижают оценку; направление штриха не влияет.</p>` : `<div class="table-scroll"><table><thead><tr><th>Объект</th><th>Результат</th><th>Очки</th></tr></thead><tbody>${results.map((r, i) => `<tr><td>${r.target ? `<button class="subtle result-object" data-result="${i}">${escape(r.target.name)} ⓘ</button>` : escape(r.entry?.name || "—")}${r.target?.bayer ? `<br> <span class="mono">${escape(r.target.bayer)}</span>` : ""}</td><td>${escape(r.reason)}</td><td>${r.points} / ${r.max ?? 100}</td></tr>`).join("")}</tbody></table></div><p>Центр маркера в зелёном эталоне — полный балл, иначе 0 (баллы по разбаловке: звезда 2, Мессье 1,5, точки и края по 12 на группу, созвездия 16). Верное отсутствие — полный балл; пропуск — 0. Повтор одной подписи в песочнице не засчитывается.</p>`}<button class="secondary" id="retry">Повторить задания</button>`;
  $("results").hidden = false;
  $("retry").onclick = clearAnswers;
  document
    .querySelectorAll("[data-result]")
    .forEach(
      (button) =>
        (button.onclick = () => {
          const target = results[Number(button.dataset.result)].target;
          if (target.kind === "reference") openDialog(`<h2>${escape(target.name)}</h2><p>RA ${(target.ra / 15).toFixed(3)}h · Dec ${target.dec.toFixed(2)}°. Положение J2000; пересечения с краем зависят от выбранной карты.</p>`);
          else atlas.detail(target);
        }),
    );
  storeModeScore(state.mode, results, line, record);
  updateAnswer();
  if (record) {
    if (state.mode === "sandbox") recordProgress({
      id: "sandbox:" + JSON.stringify(state.config), kind: "T", seed: state.config.seed,
      score, maximum, label: "Песочница",
      url: variantUrl(currentSiteUrl(), variant.base, "sandbox"),
    });
    $("results").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}
function clearAnswers() {
  state.answers = {};
  state.strokes = [];
  state.entries = [];
  state.pending = null;
  state.checked = false;
  state.selected = 0;
  results = [];
  drawing = null;
  $("results").hidden = true;
  if (variant) {
    for (const key of state.mode === "reference"
      ? ["points", "edges"]
      : [state.mode])
      delete variant.scores[key];
    updateVariantSummary();
  }
  updateAnswer();
}
async function exportPdf(answer = false) {
  const buttons = [$("export-pdf"), $("export-answers")];
  buttons.forEach((b) => (b.disabled = true));
  try {
    await nextFrame();
    const packet = makePacket(
        catalog,
        state,
        $("pdf-scope").value === "full",
        variant,
      ),
      bytes = await renderPacket(packet, catalog, answer);
    downloadBlob(
      new Blob([bytes], { type: "application/pdf" }),
      `nightweave-${state.config.seed}-${answer ? "answers" : "tasks"}.pdf`,
    );
    toast(
      answer
        ? "Скачан отдельный PDF с ответами."
        : "Скачан PDF с заданиями, без ответов.",
    );
  } catch (error) {
    toast("Не удалось создать PDF: " + error.message);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}
function snapshot() {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = marks.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(sky, 0, 0);
  ctx.drawImage(marks, 0, 0);
  canvas.toBlob((blob) => downloadBlob(blob, "nightweave-snapshot.png"));
}
function showHistory() { showProgress(openDialog); }
function bindEvents() {
  $("expand-map").onclick = () => openFullscreen({
    content: document.querySelector(".lab-body"), stage: $("map-stage"), canvas: sky,
    title: "Тренажёр неба", navigation: document.querySelector(".tabs"), settings: $("settings"),
    canStartGesture: () => performance.now() - lastPenContact >= 800,
    onSingleTouchEnd: () => {
      if (state.mode === "sandbox" && state.pending && !state.checked) sandboxInput().focus({ preventScroll: true });
    },
    captureInteraction: () => {
      const attempt = state;
      const before = structuredClone({ answers: state.answers, selected: state.selected, pending: state.pending, strokes: state.strokes });
      return () => {
        if (state !== attempt) return;
        drawing = null;
        Object.assign(state, before);
        updateAnswer();
      };
    },
  });
  $("sandbox-greek").innerHTML = GREEK_LETTERS.map(([symbol, name]) => `<option value="${symbol}">${symbol} · ${name}</option>`).join("");
  $("settings-toggle").onclick = () => {
    $("settings").hidden = !$("settings").hidden;
    $("settings-toggle").setAttribute(
      "aria-expanded",
      String(!$("settings").hidden),
    );
  };
  $("frame").onchange = updateFrame;
  $("apply").onclick = () => newTask();
  $("new-task").onclick = () => newTask(true);
  $("random-view").onclick = () => {
    $("ra").value = (Math.random() * 24).toFixed(2);
    $("dec").value = (Math.asin(Math.random() * 2 - 1) / RAD).toFixed(1);
    $("az").value = Math.floor(Math.random() * 360);
    $("alt").value = Math.floor(15 + Math.random() * 65);
    $("roll").value = Math.floor(Math.random() * 360);
    newTask(true);
  };
  document.querySelectorAll("[data-mode]").forEach(
    (button) =>
      (button.onclick = () => {
        switchMode(button.dataset.mode);
      }),
  );
  $("generate-variant").onclick = () => newTask(true);
  $("load-variant").onclick = () => {
    try {
      const seed = redirectCode($("variant-seed").value, "T");
      if (seed === null) return;
      $("seed").value = seed;
      newTask();
    } catch (error) { toast(error.message); }
  };
  $("variant-seed").onkeydown = (event) => {
    if (event.key === "Enter") $("load-variant").click();
  };
  $("copy-variant").onclick = copyVariantLink;
  $("check-variant").onclick = checkWholeVariant;
  $("level").onchange = () => newTask();
  $("display").onchange = () => {
    syncDisplayToggle();
    if (!state.config) return;
    variant.base.display = $("display").value;
    for (const attempt of Object.values(variant.attempts))
      attempt.config.display = $("display").value;
    state.config.display = $("display").value;
    updateVariantUrl();
    renderPromise = drawBase();
    drawMarks();
    save();
  };
  $("display-toggle").onclick = () => {
    const select = $("display");
    if (select.value === "paper") select.value = photoDisplay;
    else {
      photoDisplay = select.value;
      select.value = "paper";
    }
    select.onchange();
  };
  $("grid").onchange = drawGuides;
  $("guides").onchange = drawGuides;
  sky.addEventListener("pointerdown", pointerDown);
  sky.addEventListener("pointermove", pointerMove);
  sky.addEventListener("pointerup", pointerUp);
  sky.addEventListener("pointercancel", () => {
    drawing = null;
    drawMarks();
  });
  sky.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      drawing = null;
      state.pending = null;
      updateAnswer();
    }
    if (["Delete", "Backspace"].includes(event.key) && !state.checked) {
      if (state.mode === "lines") state.strokes.pop();
      else if (state.mode === "sandbox") state.entries.pop();
      else if (state.targets[state.selected])
        delete state.answers[state.targets[state.selected].id];
      updateAnswer();
      event.preventDefault();
    }
    if (
      ["ArrowRight", "ArrowLeft"].includes(event.key) &&
      !["lines", "sandbox"].includes(state.mode)
    ) {
      state.selected =
        (state.selected +
          (event.key === "ArrowRight" ? 1 : -1) +
          state.targets.length) %
        Math.max(1, state.targets.length);
      renderObjects();
      event.preventDefault();
    }
  });
  $("undo-line").onclick = () => {
    if (!state.checked) {
      state.strokes.pop();
      state.pending = null;
      updateAnswer();
    }
  };
  $("sandbox-add").onclick = addEntry;
  $("sandbox-absent").onchange = () => {
    $("sandbox-location").textContent = $("sandbox-absent").checked
      ? "Позиция не нужна: впиши подпись и добавь отметку «нет на карте»."
      : "Сначала выбери точку на карте.";
    $("sandbox-add").disabled = state.checked || (!state.pending && !$("sandbox-absent").checked);
  };
  for (const id of ["sandbox-name", "sandbox-constellation", "sandbox-index", "sandbox-point"]) $(id).onkeydown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addEntry();
    }
  };
  $("sandbox-type").onchange = () => {
    for (const entry of state.entries) entry.kind ||= state.sandboxType === "bayer" ? "stars" : state.sandboxType;
    state.sandboxType = $("sandbox-type").value;
    updateAnswer();
  };
  $("sandbox-cancel").onclick = () => {
    state.pending = null;
    updateAnswer();
  };
  $("clear").onclick = clearAnswers;
  $("check").onclick = () => checkAnswer();
  $("export-pdf").onclick = () => exportPdf(false);
  $("export-answers").onclick = () => exportPdf(true);
  $("snapshot").onclick = snapshot;
  document.querySelector(".dialog-close").onclick = () => $("dialog").close();
  $("dialog").addEventListener("click", (event) => {
    if (event.target !== $("dialog")) return;
    const r = $("dialog").getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      $("dialog").close();
  });
  $("practice-nav").onclick = () =>
    document.querySelector(".lab").scrollIntoView({ behavior: "smooth" });
  $("catalog-nav").onclick = () => atlas?.open();
  $("history-nav").onclick = showHistory;
  $("help-nav").onclick = () =>
    openDialog(
      `<p class="eyebrow">FIELD NOTES</p><h2>Как заниматься в Nightweave</h2><ol><li>Выбери сложность: начальный уровень ограничивает звёзды буквами α–β; экспертный открывает весь каталог.</li><li>В параметрах отдельно задаются количества звёзд и объектов Мессье, поле зрения, наблюдатель, время UTC, размер звёзд и яркость фона.</li><li>Режимы вида: цветные звёзды на однотонном фоне; звёзды с Млечным Путём NASA; контрастные белые звёзды; чёрные точки на белом.</li><li>В обычном задании выбери объект и нажми на карту. «Вне карты» — ответ об отсутствии. ⓘ открывает карточку объекта и карту-искатель.</li><li>В песочнице выбери каталог, нажми на карту и напиши имя вручную. Принимаются номера M/М, русские и английские имена и обозначения Байера. Повторы и неизвестные имена получают ноль.</li><li>В режиме созвездий рисуй стилусом, пальцем или мышью. Есть соединение двумя нажатиями и отмена последнего штриха. Стилус всегда рисует.</li><li>PDF «Полный вариант» содержит условия и три карты. «Текущее задание» экспортирует выбранную тему. Задания и ответы скачиваются отдельными кнопками.</li></ol><p>Сначала появляется быстрый звёздный предпросмотр. Фон NASA уточняется в отдельном потоке и кэшируется. Для мгновенной работы выбери режим без Млечного Пути.</p><p>Клавиатура: ←/→ выбирают объект, Delete удаляет отметку, Esc отменяет незавершённую линию. Для нанесения точек используется мышь или сенсорный экран.</p>`,
    );
  $("sources").onclick = () =>
    openDialog(
      `<p class="eyebrow">ОБ АТЛАСЕ</p><h2>Данные и методика</h2><p>Фон: <a href="https://svs.gsfc.nasa.gov/4851/" target="_blank" rel="noreferrer">NASA Deep Star Maps 2020</a>, NASA/Goddard SVS (Ernie Wright, Laurence Schuler, Ian Jones); Gaia DR2: ESA/Gaia/DPAC. Локальная JPEG-копия — Wikimedia Commons.</p><p>Каталоги: <a href="https://github.com/ofrohn/d3-celestial" target="_blank" rel="noreferrer">D3-Celestial</a>, Olaf Frohn, BSD-3-Clause. ${catalog.stars.length} звезды до 6m, ${catalog.named.length} именованных звезды с обозначениями Байера, 110 объектов Мессье. Типы и альтернативные названия взяты из этого каталога. Карты-искатели генерируются из тех же координат.</p><p>Линии всех 88 созвездий: <a href="https://github.com/Stellarium/stellarium/blob/master/skycultures/modern/index.json" target="_blank" rel="noreferrer">Stellarium Modern</a>, Stellarium team, CC BY-SA 4.0. Исходные цепочки HIP переведены в координаты J2000; этот набор используется в тренажёре, каталоге, квизах и PDF.</p><p>Координаты J2000; для горизонта учитываются среднее звёздное время и прецессия. Без рефракции, нутации, аберрации и собственного движения. Фон NASA включает более слабые звёзды; в остальных режимах предел величины применяется ко всем точкам.</p><p>Баллы: центр маркера попал в эталонный маркер — полный балл по разбаловке (звезда 2, Мессье 1,5, опорные точки и края по 12 на группу, созвездия 16), иначе 0. Верное отсутствие — полный балл, пропуск — 0. За ФИО и значки «крестики/треугольники» баллы не начисляются. При проверке Байера 80% даёт положение, 20% — обозначение. Штрихи оцениваются по полноте и точности покрытия эталонных линий; это учебная эвристика.</p><p>Печатный комплект повторяет структуру Q24S3OC, Q25S1OC, Q25S3OC, Q26S1OC, Q26S3OC: условия и три карты. Исходные задания не копируются. PDF растровый, A4, около 200 dpi.</p>`,
    );
}
async function loadTexture() {
  try {
    const image = new Image();
    image.src = "./assets/nasa-2020.jpg";
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    renderer.setTexture({
      pixels: ctx.getImageData(0, 0, image.width, image.height).data,
      width: image.width,
      height: image.height,
    });
    if (state.config?.display === "milkyway") renderPromise = drawBase();
  } catch {
    $("asset-status").textContent = "Каталог J2000 · фон NASA недоступен";
    if (state.config?.display === "milkyway")
      toast("Фон NASA недоступен. Звёздная карта продолжает работать.");
  }
}
async function initialize() {
  bindEvents();
  try {
    if (routeLinkedCode("T")) return;
    const response = await fetch("./assets/catalog.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("Каталог недоступен");
    catalog = await response.json();
    atlas = new Atlas(catalog, openDialog);
    let linked = null;
    try {
      linked = readVariantUrl(currentSiteUrl());
    } catch (error) {
      toast(error.message);
    }
    const saved = storage(STORAGE, null);
    if (
      saved?.variant?.base?.skyMode &&
      (!linked ||
        JSON.stringify(validateConfig(linked.config)) ===
          JSON.stringify(validateConfig(saved.variant.base)))
    ) {
      variant = saved.variant;
      const selectedId = variant.attempts.messier.targets[variant.attempts.messier.selected]?.id;
      variant.attempts.messier.targets = sortMessier(variant.attempts.messier.targets);
      variant.attempts.messier.selected = Math.max(0, variant.attempts.messier.targets.findIndex(target => target.id === selectedId));
      const segments = visibleSegments(catalog, variant.configs[2]);
      if (JSON.stringify(segments) !== JSON.stringify(variant.attempts.lines.targets)) {
        variant.attempts.lines.targets = segments;
        variant.attempts.lines.checked = false;
        delete variant.scores.lines;
      }
      freeAttempt = saved.freeAttempt;
      writeConfig(variant.base);
      state.mode = linked?.mode || saved.active || "messier";
      switchMode(state.mode);
    } else {
      state.mode = linked?.mode || "messier";
      newTask(false, linked?.config || DEFAULT_CONFIG);
    }
    updateProgressCount();
    $("map-loading").hidden = true;
    loadTexture();
  } catch (error) {
    $("map-loading").textContent =
      "Не удалось загрузить данные. Запусти сайт через npm start.";
    toast(error.message);
  }
}
initialize();
