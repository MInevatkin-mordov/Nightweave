import { currentSiteUrl } from "./site-url.js?v=10";
import {
  boundaryCrossings,
  projector,
  randomGenerator,
  referencePoints,
} from "./astro.js?v=10";
import { selectTargets, visibleSegments, resolveObject, sortMessier } from "./training.js?v=10";
import { vectorMap, mapHeight } from "./renderer.js?v=10";
import { createVariant, variantUrl } from "./variant.js?v=10";
import { createPdf } from "./pdf.js?v=10";
import { drawPrintQr } from "./print-qr.js?v=10";

const WIDTH = 1654,
  HEIGHT = 2339,
  MARGIN = 133;
const font = (ctx, size = 29, bold = false) => {
  ctx.font = `${bold ? "bold " : ""}${size}px "Times New Roman", "Nightweave Symbols", serif`;
  ctx.fillStyle = "#000";
};
function text(ctx, value, x, y, width, size = 28, bold = false) {
  font(ctx, size, bold);
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

export function makePacket(catalog, state, full = true, variant = null) {
  const config = { ...state.config, display: "paper" };
  const url = variantUrl(currentSiteUrl(), variant?.base || config, state.mode);
  if (!full) {
    const mode = state.mode;
    const targets =
      state.mode === "sandbox"
        ? state.entries
            .map((entry) => {
              const kind = entry.kind || state.sandboxType;
              const found = resolveObject(catalog, kind, entry.name, state.config);
              return found.length === 1 ? { ...found[0], kind, name: found[0].shortName || found[0].name } : null;
            })
            .filter(Boolean)
        : state.targets;
    return {
      url,
      seed: config.seed,
      config,
      sheets: [
        {
          mode,
          config,
          targets: mode === "messier" ? sortMessier(targets) : targets,
          segments: mode === "lines" ? state.targets : [],
        },
      ],
    };
  }

  const v = variant || createVariant(catalog, config);
  return {
    url,
    seed: v.seed,
    config: v.base,
    sheets: [
      {
        mode: "reference",
        config: v.configs[0],
        targets: v.attempts.reference.targets,
        references: v.references,
        edges: v.edges,
      },
      {
        mode: "stars",
        config: v.configs[1],
        targets: v.attempts.stars.targets,
      },
      {
        mode: "messier",
        config: v.configs[2],
        targets: sortMessier(v.attempts.messier.targets),
        segments: v.attempts.lines.targets,
      },
    ],
  };
}

function page(seed, number, total, answer, landscape = false, url) {
  const canvas = document.createElement("canvas");
  canvas.width = landscape ? HEIGHT : WIDTH;
  canvas.height = landscape ? WIDTH : HEIGHT;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  font(ctx, 24);
  ctx.fillText(`#${seed}`, MARGIN, 94);
  ctx.fillText("Фамилия И. О.: __________________________", 550, 94);
  ctx.fillText(`Страница ${number} из ${total}`, canvas.width - 374, 94);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#111";
  ctx.beginPath();
  ctx.moveTo(MARGIN, 114);
  ctx.lineTo(canvas.width - MARGIN, 114);
  ctx.stroke();
  font(ctx, 15);
  ctx.fillStyle = "#555";
  ctx.fillText(
    "Nightweave · NASA/Goddard SVS · ESA/Gaia/DPAC · J2000",
    MARGIN,
    canvas.height - 68,
  );
  drawPrintQr(ctx, url, canvas.width, canvas.height);
  return { canvas, ctx };
}

function list(ctx, objects, y, answers = false, config) {
  const rows = Math.ceil(objects.length / 3),
    columnWidth = (WIDTH - 2 * MARGIN) / 3;
  const p = projector(config);
  objects.forEach((object, index) => {
    const column = Math.floor(index / rows),
      row = index % rows;
    const x = MARGIN + column * columnWidth,
      yy = y + row * 44;
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1.6;
    ctx.strokeRect(x + 4, yy - 21, 17, 17);
    if (answers && !p.project(object.ra, object.dec)) {
      ctx.fillStyle = "#174f87";
      ctx.fillRect(x + 5, yy - 20, 15, 15);
    }
    const value = object.name;
    text(
      ctx,
      value,
      x + 34,
      yy,
      columnWidth - 36,
      27,
    );
  });
  return y + rows * 44 + 30;
}

function instructionPage(packet, answer) {
  const { canvas, ctx } = page(
    packet.seed,
    1,
    packet.sheets.length + 1,
    answer,
    false,
    packet.url,
  );
  let y = 173;
  y =
    text(
      ctx,
      "Не забудьте подписать каждый лист!",
      MARGIN,
      y,
      WIDTH - 2 * MARGIN,
      30,
      true,
    ) + 20;
  if (packet.sheets.length === 3) {
    y = text(
      ctx,
      "1. Отметьте на Карте 1, если возможно, точки равноденствия (♈, ♎) и солнцестояния (☀, ❄); точку пересечения галактического и небесного экваторов Γ; точку пересечения эклиптики и галактического экватора ε.",
      MARGIN,
      y,
      WIDTH - 2 * MARGIN,
    );
    y =
      text(
        ctx,
        answer
          ? "Перечислите отсутствующие точки: " +
              packet.sheets[0].references
                .filter(
                  (t) =>
                    !projector(packet.sheets[0].config).project(t.ra, t.dec),
                )
                .map((t) => t.name)
                .join("; ")
          : "Перечислите отсутствующие точки: __________________________________________",
        MARGIN,
        y + 12,
        WIDTH - 2 * MARGIN,
        26,
      ) + 25;
    y =
      text(
        ctx,
        "2. Отметьте на Карте 1 точки пересечения небесного экватора и границы карты E₁, E₂; галактического экватора и границы карты Γ₁, Γ₂; эклиптики и границы карты ε₁, ε₂ (при наличии). Нумерация пар произвольная.",
        MARGIN,
        y,
        WIDTH - 2 * MARGIN,
      ) + 25;
    y =
      text(
        ctx,
        "3. Отметьте на Карте 2 крестиками и подпишите обозначениями Байера присутствующие звёзды из списка. Закрасьте квадраты при названиях звёзд, не принадлежащих показанной области неба.",
        MARGIN,
        y,
        WIDTH - 2 * MARGIN,
      ) + 12;
    y = list(ctx, packet.sheets[1].targets, y, answer, packet.sheets[1].config);
    y =
      text(
        ctx,
        "4. Отметьте на Карте 3 треугольниками и подпишите объекты из списка. Закрасьте квадраты при названиях объектов, не принадлежащих показанной области неба.",
        MARGIN,
        y,
        WIDTH - 2 * MARGIN,
      ) + 12;
    y = list(ctx, packet.sheets[2].targets, y, answer, packet.sheets[2].config);
    text(
      ctx,
      "5. Зарисуйте на Карте 3 фигуры созвездий, в том числе видимые частично. Не продолжайте линии за границей карты.",
      MARGIN,
      y,
      WIDTH - 2 * MARGIN,
    );
  } else {
    const sheet = packet.sheets[0];
    const instruction =
      sheet.mode === "lines"
        ? "1. Зарисуйте на Карте 1 фигуры созвездий, в том числе видимые частично. Не продолжайте линии за границей карты."
        : sheet.mode === "sandbox"
          ? "1. Отметьте на Карте 1 объекты и опорные точки из списка. Звёзды подпишите обозначениями Байера, объекты Мессье — номерами. Закрасьте квадраты при названиях отсутствующих объектов."
        : sheet.mode === "stars"
          ? "1. Отметьте на Карте 1 крестиками и подпишите обозначениями Байера звёзды из списка. Закрасьте квадраты при названиях отсутствующих звёзд."
          : sheet.mode === "reference"
            ? "1. Отметьте на Карте 1 перечисленные опорные точки. Укажите отсутствующие на карте."
            : "1. Отметьте на Карте 1 треугольниками и подпишите объекты из списка. Закрасьте квадраты при названиях отсутствующих объектов.";
    y = text(ctx, instruction, MARGIN, y, WIDTH - 2 * MARGIN) + 30;
    if (sheet.mode !== "lines")
      list(ctx, sheet.targets, y, answer, sheet.config);
  }
  return canvas;
}

function annotate(ctx, canvas, sheet) {
  const p = projector(sheet.config),
    center = canvas.width / 2,
    radius = center - 2;
  const labels = [];
  for (const [index, target] of sheet.targets.entries()) {
    if (!Number.isFinite(target.ra) || !Number.isFinite(target.dec)) continue;
    const point = p.project(target.ra, target.dec);
    if (!point) continue;
    const x = center + point[0] * radius,
      y = canvas.height / 2 + point[1] * radius;
    ctx.strokeStyle = "#174f87";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const mode = sheet.mode === "sandbox" ? target.kind : sheet.mode;
    if (mode === "messier") {
      ctx.moveTo(x, y - 7);
      ctx.lineTo(x + 6, y + 5);
      ctx.lineTo(x - 6, y + 5);
      ctx.closePath();
    } else {
      ctx.moveTo(x - 6, y);
      ctx.lineTo(x + 6, y);
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x, y + 6);
    }
    ctx.stroke();
    const label =
      mode === "stars" || mode === "bayer"
        ? target.bayer
        : mode === "messier"
          ? target.name
          : target.shortName || (target.id.startsWith("edge-")
            ? target.name.split(" ·")[0]
            : {
                spring: "♈",
                autumn: "♎",
                summer: "☀",
                winter: "❄",
                G1: "Γ",
                "epsilon-1": "ε",
              }[target.id] || String(index + 1));
    ctx.font = 'italic 23px "Times New Roman", "Nightweave Symbols", serif';
    const width = ctx.measureText(label).width;
    let tx = clampPrint(x + 10, 8, canvas.width - width - 8),
      ty = clampPrint(y - 10, 25, canvas.height - 25);
    for (
      let step = 0;
      step < 8 &&
      labels.some(
        (box) =>
          tx < box.x + box.w && tx + width > box.x && Math.abs(ty - box.y) < 25,
      );
      step++
    )
      ty += 27;
    labels.push({ x: tx, y: ty, w: width });
    ctx.fillStyle = "#fff";
    ctx.fillRect(tx - 2, ty - 20, width + 4, 25);
    ctx.fillStyle = "#174f87";
    ctx.fillText(label, tx, ty);
  }
  for (const segment of sheet.segments || []) {
    const a = p.project(...segment.a),
      b = p.project(...segment.b);
    if (!a || !b) continue;
    ctx.strokeStyle = "#174f87";
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.moveTo(center + a[0] * radius, canvas.height / 2 + a[1] * radius);
    ctx.lineTo(center + b[0] * radius, canvas.height / 2 + b[1] * radius);
    ctx.stroke();
  }
}
const clampPrint = (value, low, high) => Math.max(low, Math.min(high, value));

export async function renderPacket(packet, catalog, answer = false) {
  await document.fonts.load?.('29px "Nightweave Symbols"');
  await document.fonts.ready;
  const pages = [instructionPage(packet, answer)];
  for (const [index, sheet] of packet.sheets.entries()) {
    const { canvas, ctx } = page(
      packet.seed,
      index + 2,
      packet.sheets.length + 1,
      answer,
      sheet.config.shape === "rectangle",
      packet.url,
    );
    font(ctx, 36);
    ctx.textAlign = "center";
    ctx.fillText(
      `Карта ${index + 1}${packet.sheets.length === 3 ? [" (к заданиям 1 и 2)", " (к заданию 3)", " (к заданиям 4 и 5)"][index] : ""}`,
      canvas.width / 2,
      sheet.config.shape === "rectangle" ? 210 : 445,
    );
    ctx.textAlign = "left";
    const map = document.createElement("canvas");
    map.width =
      sheet.config.shape === "rectangle"
        ? Math.min(
            2000,
            Math.floor((canvas.height - 640) * (sheet.config.aspect || 1.6)),
          )
        : 1400;
    map.height = mapHeight(map.width, sheet.config);
    vectorMap(map, catalog, {
      ...sheet.config,
      display: "paper",
      starSize: 1.1,
    });
    if (answer) annotate(map.getContext("2d"), map, sheet);
    ctx.drawImage(
      map,
      (canvas.width - map.width) / 2,
      sheet.config.shape === "rectangle" ? 275 : 530,
      map.width,
      map.height,
    );
    pages.push(canvas);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return createPdf(
    pages.map((canvas) => ({
      jpeg: canvas.toDataURL("image/jpeg", 0.96),
      width: canvas.width,
      height: canvas.height,
      widthPoints: canvas.width > canvas.height ? 841.89 : 595.28,
      heightPoints: canvas.width > canvas.height ? 595.28 : 841.89,
    })),
  );
}
