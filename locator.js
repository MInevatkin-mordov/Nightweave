import { projector } from "./astro.js?v=10";
import { vectorMap, mapHeight } from "./renderer.js?v=10";
import { drawCrosshair, markTheme } from "./marker-style.js?v=10";

export function drawLocator(
  canvas,
  catalog,
  question,
  lines = true,
  paper = false,
) {
  const config = { ...question.map, display: paper ? "paper" : "mono" };
  canvas.height = mapHeight(canvas.width, config);
  vectorMap(canvas, catalog, config);
  const ctx = canvas.getContext("2d"),
    p = projector(config),
    cx = canvas.width / 2,
    cy = canvas.height / 2,
    radius = cx - 2;
  if (lines) {
    ctx.strokeStyle = paper ? "#888" : "#8cc6d380";
    ctx.lineWidth = Math.max(1, canvas.width / 700);
    for (const figure of catalog.lines)
      for (const path of figure.paths) {
        ctx.beginPath();
        let previous = null;
        for (const c of path) {
          const point = p.project(...c);
          if (!point) {
            previous = null;
            continue;
          }
          const x = cx + point[0] * radius,
            y = cy + point[1] * radius;
          if (previous) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
          previous = point;
        }
        ctx.stroke();
      }
  }
  const position = p.project(question.object.ra, question.object.dec);
  if (position) {
    const x = cx + position[0] * radius,
      y = cy + position[1] * radius;
    drawCrosshair(ctx, x, y, markTheme(paper).ink, (canvas.width / 1000) * 1.8);
  }
}
