import { currentSiteUrl } from "./site-url.js?v=10";
import { createPdf } from "./pdf.js?v=10";
import { drawLocator } from "./locator.js?v=10";
import { quizUrl } from "./quiz-model.js?v=10";
import { drawPrintQr } from "./print-qr.js?v=10";

const WIDTH = 1654,
  HEIGHT = 2339,
  MARGIN = 133;
function text(ctx, value, x, y, width, size = 29, bold = false) {
  ctx.font = `${bold ? "bold " : ""}${size}px "Times New Roman", "Nightweave Symbols",serif`;
  ctx.fillStyle = "#000";
  let line = "";
  for (const word of value.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > width && line) {
      ctx.fillText(line, x, y);
      y += size * 1.35;
      line = word;
    } else line = candidate;
  }
  ctx.fillText(line, x, y);
  return y + size * 1.5;
}
export async function printQuiz(quiz, catalog, answers = false) {
  await document.fonts.load?.('29px "Nightweave Symbols"');
  await document.fonts.ready;
  const pages = [];
  let canvas, ctx, y;
  const addPage = () => {
    canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    pages.push(canvas);
    y = 170;
    if (pages.length === 1) {
      y = text(
        ctx,
        answers
          ? "Квиз по объектам Мессье и звёздам. Ответы"
          : "Квиз по объектам Мессье и звёздам",
        MARGIN,
        y,
        WIDTH - 2 * MARGIN,
        32,
        true,
      );
      y =
        text(
          ctx,
          answers
            ? "Правильные ответы приведены под каждым вопросом."
            : quiz.config.answerMode === "choice"
              ? "Выберите один правильный ответ в каждом вопросе. Не забудьте подписать каждый лист!"
              : "Впишите ответы на вопросы. Не забудьте подписать каждый лист!",
          MARGIN,
          y + 10,
          WIDTH - 2 * MARGIN,
          27,
        ) + 25;
    }
  };
  addPage();
  for (const [index, question] of quiz.questions.entries()) {
    const imageHeight = question.map.shape === "rectangle" ? 350 : 560;
    const reserve = question.image
      ? imageHeight + 150
      : 210 + question.options.length * 40;
    if (y + reserve > HEIGHT - 340) addPage();
    y =
      text(
        ctx,
        `${index + 1}. ${question.prompt}`,
        MARGIN,
        y,
        WIDTH - 2 * MARGIN,
        29,
      ) + 12;
    let optionX = MARGIN,
      optionY = y,
      optionWidth = WIDTH - 2 * MARGIN;
    if (question.image) {
      const map = document.createElement("canvas");
      map.width = 560;
      drawLocator(map, catalog, question, quiz.config.lines, true);
      ctx.drawImage(map, MARGIN, y, map.width, map.height);
      optionX = 780;
      optionWidth = WIDTH - MARGIN - optionX;
      optionY = y + 30;
    }
    if (answers) {
      optionY = text(
        ctx,
        `Ответ: ${question.answer}`,
        optionX,
        optionY,
        optionWidth,
        29,
        true,
      );
    } else if (quiz.config.answerMode === "choice") {
      for (const [i, choice] of question.options.entries()) {
        ctx.strokeStyle = "#111";
        ctx.lineWidth = 1.4;
        ctx.strokeRect(optionX, optionY - 22, 19, 19);
        optionY =
          text(
            ctx,
            `${String.fromCharCode(1040 + i)}. ${choice}`,
            optionX + 35,
            optionY,
            optionWidth - 35,
            27,
          ) + 8;
      }
    } else
      optionY =
        text(
          ctx,
          "Ответ: __________________________________",
          optionX,
          optionY,
          optionWidth,
          27,
        ) + 45;
    y = question.image ? Math.max(y + imageHeight, optionY) + 70 : optionY + 45;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  for (const [i, page] of pages.entries()) {
    const c = page.getContext("2d");
    text(
      c,
      `#${quiz.config.seed}`,
      MARGIN,
      94,
      450,
      24,
    );
    text(c, "Фамилия И. О.: ______________________", 570, 94, 650, 24);
    text(c, `Страница ${i + 1} из ${pages.length}`, 1280, 94, 300, 24);
    c.strokeStyle = "#111";
    c.beginPath();
    c.moveTo(MARGIN, 114);
    c.lineTo(WIDTH - MARGIN, 114);
    c.stroke();
    text(
      c,
      "Nightweave · D3-Celestial · J2000",
      MARGIN,
      HEIGHT - 65,
      WIDTH - 2 * MARGIN,
      16,
    );
    drawPrintQr(c, quizUrl(currentSiteUrl(), quiz.config), WIDTH, HEIGHT);
  }
  return createPdf(
    pages.map((page) => ({
      jpeg: page.toDataURL("image/jpeg", 0.96),
      width: WIDTH,
      height: HEIGHT,
    })),
  );
}
