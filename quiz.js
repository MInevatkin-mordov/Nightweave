import { currentSiteUrl } from "./site-url.js?v=10";
import { openFullscreen, closeFullscreen } from "./fullscreen.js?v=10";
import {
  QUESTION_TYPES,
  QUIZ_DEFAULTS,
  validateQuiz,
  generateQuiz,
  gradeQuestion,
  gradeQuiz,
  quizUrl,
  readQuizUrl,
} from "./quiz-model.js?v=10";
import { drawLocator } from "./locator.js?v=10";
import { printQuiz } from "./quiz-print.js?v=10";
import { downloadBlob } from "./pdf.js?v=10";
import { Atlas } from "./atlas.js?v=10";

import { seedCode, redirectCode, routeLinkedCode } from "./codes.js?v=10";
import { recordProgress, updateProgressCount, showProgress } from "./progress.js?v=10";

const $ = (id) => document.getElementById(id),
  KEY = "nightweave-quiz-v1";
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let catalog,
  atlas,
  quiz,
  answers = {},
  index = 0,
  finished = false,
  startedAt = 0,
  timer,
  notice,
  checked = {};
const seed = () => String(Math.floor(100000000 + Math.random() * 900000000));
function toast(value) {
  $("toast").textContent = value;
  $("toast").hidden = false;
  clearTimeout(notice);
  notice = setTimeout(() => ($("toast").hidden = true), 4000);
}
function openDialog(html) {
  $("dialog-content").innerHTML = html;
  if (!$("dialog").open) $("dialog").showModal();
}
function save() {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        config: quiz.config,
        answers,
        index,
        finished,
        startedAt,
        checked,
      }),
    );
  } catch {
    /* Storage is optional. */
  }
}
function readForm() {
  const values = {};
  for (const key of Object.keys(QUIZ_DEFAULTS)) {
    if (key === "types")
      values.types = [
        ...document.querySelectorAll("[data-question-type]:checked"),
      ].map((e) => e.dataset.questionType);
    else if (key === "lines") values.lines = $("q-lines").checked;
    else values[key] = $("q-" + key).value;
  }
  return validateQuiz(values);
}
function writeForm(config) {
  for (const key of Object.keys(QUIZ_DEFAULTS)) {
    if (key === "types")
      document
        .querySelectorAll("[data-question-type]")
        .forEach(
          (e) => (e.checked = config.types.includes(e.dataset.questionType)),
        );
    else if (key === "lines") $("q-lines").checked = config.lines;
    else $("q-" + key).value = key === "seed" ? seedCode("Q", config.seed) : config[key];
  }
}
function updateUrl() {
  const url = quizUrl(
    currentSiteUrl(),
    quiz.config,
  );
  globalThis.history?.replaceState(null, "", url);
}
function start(random = false, config = null) {
  closeFullscreen();
  try {
    if (!random && !config) {
      const value = redirectCode($("q-seed").value, "Q");
      if (value === null) return;
      $("q-seed").value = value;
    }
    if (random) $("q-seed").value = seed();
    quiz = generateQuiz(catalog, config || readForm());
    writeForm(quiz.config);
    answers = {};
    index = 0;
    finished = false;
    checked = {};
    startedAt = Date.now();
    $("quiz-result").hidden = true;
    $("quiz-run").hidden = false;
    updateUrl();
    render();
    save();
    setTimer();
    if (quiz.questions.length < quiz.config.count)
      toast(`Для этих настроек доступно ${quiz.questions.length} вопросов.`);
  } catch (error) {
    toast(error.message);
  }
}
function render() {
  const q = quiz.questions[index];
  if (!q) return;
  if (!q.image) closeFullscreen();
  $("quiz-position").textContent =
    `Вопрос ${index + 1} из ${quiz.questions.length}`;
  $("quiz-answered").textContent =
    `Ответов: ${Object.values(answers).filter(Boolean).length}`;
  $("quiz-topic").textContent = QUESTION_TYPES[q.type];
  $("quiz-question").textContent = q.prompt;
  $("quiz-image").hidden = !q.image;
  $("quiz-expand-map").hidden = !q.image;
  if (q.image) {
    drawLocator($("quiz-image"), catalog, q, quiz.config.lines);
    $("quiz-image").style.borderRadius =
      q.map.shape === "rectangle" ? "0" : "50%";
  }
  const list = $("quiz-options");
  list.replaceChildren();
  list.hidden = quiz.config.answerMode !== "choice";
  $("quiz-text-label").hidden = quiz.config.answerMode !== "text";
  if (quiz.config.answerMode === "choice")
    for (const [i, value] of q.options.entries()) {
      const button = document.createElement("button");
      button.className =
        "quiz-choice" + (answers[index] === value ? " selected" : "");
      button.setAttribute("aria-pressed", String(answers[index] === value));
      button.textContent = `${String.fromCharCode(1040 + i)}. ${value}`;
      button.disabled = finished || checked[index];
      button.onclick = () => {
        answers[index] = value;
        if (quiz.config.feedback === "each") checked[index] = true;
        save();
        render();
      };
      list.append(button);
    }
  $("quiz-text").value = answers[index] || "";
  $("quiz-text").disabled = finished || checked[index];
  $("quiz-feedback").textContent =
    finished || checked[index]
      ? `${gradeQuestion(q, answers[index] || "") ? "Верно · 10 / 10" : "0 / 10"} · Правильный ответ: ${q.answer}`
      : quiz.config.answerMode === "text" && quiz.config.feedback === "each"
        ? "Нажми «Далее», чтобы проверить введённый ответ."
        : "";
  $("quiz-prev").disabled = index === 0;
  $("quiz-next").textContent =
    index === quiz.questions.length - 1 ? "Проверить квиз" : "Далее →";
}
function next() {
  if (quiz.config.feedback === "each" && !checked[index]) {
    checked[index] = true;
    render();
    save();
    return;
  }
  if (index < quiz.questions.length - 1) {
    index++;
    render();
    save();
  } else finish();
}
function finish(record = true) {
  closeFullscreen();
  if (finished) return;
  finished = true;
  clearInterval(timer);
  const result = gradeQuiz(quiz, answers);
  if (record) recordProgress({
    id: `Q:${startedAt}:${JSON.stringify(quiz.config)}`, kind: "Q", seed: quiz.config.seed,
    score: result.points, maximum: result.maximum, label: `Квиз · вопросов: ${quiz.questions.length}`,
    url: quizUrl(currentSiteUrl(), quiz.config),
  });
  $("quiz-result").innerHTML =
    `<div class="results-top"><div><p class="eyebrow">${escape(seedCode("Q", quiz.config.seed))}</p><h2>Твой результат</h2></div><div class="score">${result.points} / ${result.maximum}</div></div><div class="table-scroll"><table><thead><tr><th>№</th><th>Твой ответ</th><th>Правильный ответ</th><th>Баллы</th></tr></thead><tbody>${result.rows.map((r, i) => `<tr><td>${i + 1}</td><td>${escape(r.value || "Нет ответа")}</td><td>${escape(r.question.answer)} <button class="subtle" data-quiz-object="${i}" aria-label="Каталог: ${escape(r.question.object.name)}">ⓘ</button></td><td>${r.points} / 10</td></tr>`).join("")}</tbody></table></div><button id="quiz-repeat" class="secondary">Повторить тот же квиз</button>`;
  $("quiz-result").hidden = false;
  document
    .querySelectorAll("[data-quiz-object]")
    .forEach(
      (button) =>
        (button.onclick = () =>
          atlas.detail(
            quiz.questions[Number(button.dataset.quizObject)].object,
          )),
    );
  $("quiz-repeat").onclick = () => start(false, quiz.config);
  render();
  save();
  $("quiz-result").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function setTimer() {
  clearInterval(timer);
  const tick = () => {
    if (!quiz.config.timeLimit) {
      $("quiz-timer").textContent = "Без лимита времени";
      return;
    }
    const remaining = Math.max(
      0,
      Math.ceil(
        (startedAt + quiz.config.timeLimit * 60000 - Date.now()) / 1000,
      ),
    );
    $("quiz-timer").textContent =
      `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
    if (!remaining && !finished) {
      toast("Время вышло. Ответы проверены.");
      finish();
    }
  };
  tick();
  if (quiz.config.timeLimit && !finished) timer = setInterval(tick, 1000);
}
async function copyLink() {
  const url = quizUrl(
    currentSiteUrl(),
    quiz.config,
  );
  try {
    await navigator.clipboard.writeText(url);
    toast("Ссылка на квиз скопирована.");
  } catch {
    openDialog(
      `<h2>Ссылка на квиз</h2><input aria-label="Ссылка на квиз" readonly value="${escape(url)}">`,
    );
  }
}
async function pdf(answer) {
  const buttons = [$("quiz-print"), $("quiz-print-answers")];
  buttons.forEach((b) => (b.disabled = true));
  try {
    await new Promise((r) => setTimeout(r, 0));
    const bytes = await printQuiz(quiz, catalog, answer);
    downloadBlob(
      new Blob([bytes], { type: "application/pdf" }),
      `nightweave-quiz-${quiz.config.seed}-${answer ? "answers" : "questions"}.pdf`,
    );
    toast("PDF готов.");
  } catch (error) {
    toast(error.message);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}
async function initialize() {
  $("quiz-expand-map").onclick = () => openFullscreen({ content: $("quiz-run"), stage: $("quiz-image"), canvas: $("quiz-image"), title: "Карта к вопросу" });
  $("quiz-types").innerHTML = Object.entries(QUESTION_TYPES)
    .map(
      ([key, label]) =>
        `<label class="checkbox"><input type="checkbox" data-question-type="${key}" checked>${label}</label>`,
    )
    .join("");
  $("quiz-generate").onclick = () => start(true);
  $("quiz-load").onclick = () => start();
  $("quiz-copy").onclick = copyLink;
  $("quiz-prev").onclick = () => {
    if (index > 0) {
      index--;
      render();
      save();
    }
  };
  $("quiz-next").onclick = next;
  $("quiz-finish").onclick = finish;
  $("quiz-text").oninput = () => {
    answers[index] = $("quiz-text").value;
    save();
    $("quiz-answered").textContent =
      `Ответов: ${Object.values(answers).filter(Boolean).length}`;
  };
  $("quiz-text").onkeydown = (event) => {
    if (event.key === "Enter") next();
  };
  $("quiz-print").onclick = () => pdf(false);
  $("quiz-print-answers").onclick = () => pdf(true);
  $("quiz-catalog").onclick = () => atlas?.open();
  $("history-nav").onclick = () => showProgress(openDialog);
  updateProgressCount();
  $("q-seed").onkeydown = event => { if (event.key === "Enter") start(); };
  document.querySelector(".dialog-close").onclick = () => $("dialog").close();
  try {
    if (routeLinkedCode("Q")) return;
    const response = await fetch("./assets/catalog.json", { cache: "no-cache" });
    if (!response.ok) throw new Error("Каталог недоступен");
    catalog = await response.json();
    atlas = new Atlas(catalog, openDialog);
    let linked = null;
    try {
      linked = readQuizUrl(
        currentSiteUrl(),
      );
    } catch (error) {
      toast(error.message);
    }
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(KEY));
    } catch {
      /* No saved quiz. */
    }
    if (
      saved?.config &&
      (!linked ||
        JSON.stringify(validateQuiz(saved.config)) === JSON.stringify(linked))
    ) {
      quiz = generateQuiz(catalog, saved.config);
      answers = saved.answers || {};
      index = Math.min(saved.index || 0, quiz.questions.length - 1);
      startedAt = saved.startedAt || Date.now();
      checked = saved.checked || {};
      finished = false;
      writeForm(quiz.config);
      $("quiz-run").hidden = false;
      updateUrl();
      render();
      if (saved.finished) finish(false);
      else setTimer();
    } else start(false, linked || QUIZ_DEFAULTS);
    $("quiz-loading").hidden = true;
  } catch (error) {
    $("quiz-loading").textContent =
      "Не удалось загрузить квиз. Запусти сайт через npm start.";
    toast(error.message);
  }
}
initialize();
