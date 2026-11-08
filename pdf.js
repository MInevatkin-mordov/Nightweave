// A small PDF writer for JPEG pages. Text is rasterized by the browser for Cyrillic support.
export function createPdf(pages) {
  const encoder = new TextEncoder();
  const chunks = [],
    offsets = [0];
  let length = 0;
  const append = (value) => {
    const bytes = typeof value === "string" ? encoder.encode(value) : value;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id, body) => {
    offsets[id] = length;
    append(`${id} 0 obj\n${body}\nendobj\n`);
  };
  append("%PDF-1.4\n% Nightweave\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(
    2,
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ")}] >>`,
  );
  pages.forEach((page, index) => {
    const pageWidth = page.widthPoints || 595.28;
    const pageHeight = page.heightPoints || 841.89;
    const id = 3 + index * 3;
    const raw = atob(page.jpeg.split(",")[1]);
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    object(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Img ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`,
    );
    offsets[id + 1] = length;
    append(
      `${id + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`,
    );
    append(bytes);
    append("\nendstream\nendobj\n");
    const content = `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Img Do Q\n`;
    object(
      id + 2,
      `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`,
    );
  });
  const start = length,
    count = 3 + pages.length * 3;
  append(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let i = 1; i < count; i++)
    append(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  append(
    `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`,
  );
  const result = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) {
    result.set(chunk, position);
    position += chunk.length;
  }
  return result;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
