// Единый стиль маркера: перекрестие в кружке (с точкой в центре) + скруглённая метка справа-снизу.
// Тот же вид задан в styles.css для маркеров экзамена (.mk / .ref).

export const MARK_THEME = {
  paper: { ink: "#000", fill: "#f4f9fa", border: "#555", text: "#222", good: "#216342" },
  dark: { ink: "#eef3ea", fill: "#0f1c26", border: "#9db0b9", text: "#eef3ea", good: "#d5ec95" },
};
export const markTheme = (paper) => (paper ? MARK_THEME.paper : MARK_THEME.dark);

// s — масштаб (для холста 1000 px это 1.8).
export function drawCrosshair(ctx, x, y, color, s = 1.8) {
  const r = 7 * s;
  ctx.save();
  ctx.setLineDash([]);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5 * s;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.moveTo(x - r - 3.5 * s, y);
  ctx.lineTo(x - r + 2 * s, y);
  ctx.moveTo(x + r - 2 * s, y);
  ctx.lineTo(x + r + 3.5 * s, y);
  ctx.moveTo(x, y - r - 3.5 * s);
  ctx.lineTo(x, y - r + 2 * s);
  ctx.moveTo(x, y + r - 2 * s);
  ctx.lineTo(x, y + r + 3.5 * s);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 1.3 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Метка-«плашка». boxes — уже занятые прямоугольники (чтобы подписи не налезали друг на друга).
export function drawTag(ctx, x, y, label, theme, { s = 1.8, boxes = [], width, height, color } = {}) {
  ctx.save();
  ctx.font = `500 ${10 * s}px "Nightweave Symbols", system-ui, "Segoe UI Symbol", sans-serif`;
  const h = 17 * s,
    w = Math.max(h, ctx.measureText(label).width + 12 * s);
  const gap = 5 * s;
  let bx = 0,
    by = 0;
  for (const [dx, dy] of [
    [gap, gap],
    [gap, -gap - h],
    [-gap - w, gap],
    [-gap - w, -gap - h],
    [gap, gap + h + 4 * s],
    [gap, -gap - 2 * h - 4 * s],
  ]) {
    bx = Math.min(Math.max(x + dx, 4), width - w - 4);
    by = Math.min(Math.max(y + dy, 4), height - h - 4);
    const hit = boxes.some(
      (b) => bx < b.x + b.w + 4 && bx + w + 4 > b.x && by < b.y + b.h + 4 && by + h + 4 > b.y,
    );
    if (!hit) break;
  }
  boxes.push({ x: bx, y: by, w, h });
  roundRect(ctx, bx, by, w, h, h * 0.32);
  ctx.fillStyle = theme.fill;
  ctx.fill();
  ctx.lineWidth = 1.4 * s;
  ctx.strokeStyle = color || theme.border;
  ctx.stroke();
  ctx.fillStyle = color || theme.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, bx + w / 2, by + h / 2 + 0.5 * s);
  ctx.restore();
}
