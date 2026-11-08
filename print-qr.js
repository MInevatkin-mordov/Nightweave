import qrcode from "./vendor/qrcode.js";

export function qrMatrix(url) {
  const qr = qrcode(0, "M");
  qr.addData(url, "Byte");
  qr.make();
  return Array.from({ length: qr.getModuleCount() }, (_, row) =>
    Array.from({ length: qr.getModuleCount() }, (_, column) => qr.isDark(row, column)),
  );
}

export function drawPrintQr(ctx, url, width, height, margin = 133) {
  const matrix = qrMatrix(url), quiet = 4;
  const moduleSize = Math.max(2, Math.ceil(180 / (matrix.length + quiet * 2)));
  const size = (matrix.length + quiet * 2) * moduleSize;
  const x = width - margin - size, y = height - 56 - size;
  ctx.save();
  ctx.fillStyle = "#fff";
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = "#000";
  matrix.forEach((row, i) => row.forEach((dark, j) => {
    if (dark) ctx.fillRect(x + (j + quiet) * moduleSize, y + (i + quiet) * moduleSize, moduleSize, moduleSize);
  }));
  ctx.font = '18px "Times New Roman", serif';
  ctx.textAlign = "center";
  ctx.fillText("Открыть онлайн", x + size / 2, height - 35);
  ctx.restore();
}
