/**
 * A small text PDF. Tear sheets downloaded in the browser use this writer.
 * METHODS.pdf is printed from HTML by Chrome. MODEL_SPEC §13.
 */

export function textPdf(title: string, lines: string[]): Uint8Array {
  const pages = paginate(lines, 46);
  const objects: string[] = [];
  const pageIds: number[] = [];
  const fontId = 3;
  let next = 4;
  for (const page of pages) {
    const contentId = next++;
    const pageId = next++;
    pageIds.push(pageId);
    const stream = pageStream(title, page);
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
  }
  const kids = pageIds.map((id) => `${id} 0 R`).join(" ");
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${kids}] >>`;
  objects[fontId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;
  let body = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let id = 1; id < objects.length; id++) {
    if (!objects[id]) continue;
    offsets[id] = body.length;
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = body.length;
  let table = `xref\n0 ${objects.length}\n`;
  table += "0000000000 65535 f \n";
  for (let id = 1; id < objects.length; id++) {
    table += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  body += `${table}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(body);
}

function paginate(lines: string[], size: number): string[][] {
  const clean = lines.length > 0 ? lines : [" "];
  const pages: string[][] = [];
  for (let i = 0; i < clean.length; i += size) pages.push(clean.slice(i, i + size));
  return pages;
}

function pageStream(title: string, lines: string[]): string {
  const commands = ["BT", "/F1 11 Tf", "54 750 Td", `14 TL`, `(${escapePdf(title)}) Tj`, "T*"];
  for (const line of lines) commands.push(`(${escapePdf(line.slice(0, 110))}) Tj`, "T*");
  commands.push("ET");
  return commands.join("\n");
}

function escapePdf(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
