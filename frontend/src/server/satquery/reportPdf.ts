type TextStyle = {
  font: "regular" | "bold";
  size: number;
  before: number;
  after: number;
  indent: number;
};

type PdfLine = TextStyle & { text: string };

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 50;
const TOP_Y = 782;
const BOTTOM_Y = 55;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

function printableAscii(value: string): string {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u2192/g, "->")
    .replace(/\u00d7/g, "x")
    .replace(/\u00a0/g, " ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}

function escapePdfText(value: string): string {
  return printableAscii(value).replace(/([\\()])/g, "\\$1");
}

function styleForMarkdownLine(raw: string): PdfLine {
  if (raw.startsWith("# ")) {
    return { text: raw.slice(2), font: "bold", size: 20, before: 0, after: 10, indent: 0 };
  }
  if (raw.startsWith("## ")) {
    return { text: raw.slice(3), font: "bold", size: 14, before: 8, after: 5, indent: 0 };
  }
  if (raw.startsWith("### ")) {
    return { text: raw.slice(4), font: "bold", size: 12, before: 6, after: 4, indent: 0 };
  }
  if (raw.startsWith("- ")) {
    return { text: `- ${raw.slice(2)}`, font: "regular", size: 10, before: 1, after: 2, indent: 12 };
  }
  if (raw === "---") {
    return { text: "____________________________________________________________", font: "regular", size: 8, before: 5, after: 7, indent: 0 };
  }
  return { text: raw, font: "regular", size: 10, before: 0, after: 4, indent: 0 };
}

function wrapLine(line: PdfLine): PdfLine[] {
  if (!line.text.trim()) {
    return [{ ...line, text: "", after: Math.max(line.after, 5) }];
  }

  const availableWidth = CONTENT_WIDTH - line.indent;
  const maxChars = Math.max(20, Math.floor(availableWidth / (line.size * 0.52)));
  const words = printableAscii(line.text).split(/\s+/);
  const output: string[] = [];
  let current = "";

  for (const word of words) {
    if (word.length > maxChars) {
      if (current) {
        output.push(current);
        current = "";
      }
      for (let index = 0; index < word.length; index += maxChars) {
        output.push(word.slice(index, index + maxChars));
      }
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars) {
      output.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) output.push(current);

  return output.map((text, index) => ({
    ...line,
    text,
    before: index === 0 ? line.before : 0,
    after: index === output.length - 1 ? line.after : 1,
  }));
}

function parseMarkdown(markdown: string): PdfLine[] {
  return markdown.replace(/\r\n?/g, "\n").split("\n").flatMap((line) => wrapLine(styleForMarkdownLine(line)));
}

function textCommand(text: string, x: number, y: number, size: number, font: "regular" | "bold"): string {
  const fontName = font === "bold" ? "F2" : "F1";
  return `BT /${fontName} ${size.toFixed(1)} Tf 0 g 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escapePdfText(text)}) Tj ET`;
}

function paginate(lines: PdfLine[]): string[][] {
  const pages: string[][] = [[]];
  let y = TOP_Y;

  for (const line of lines) {
    const lineHeight = line.size * 1.35;
    const needed = line.before + lineHeight + line.after;
    if (y - needed < BOTTOM_Y) {
      pages.push([]);
      y = TOP_Y;
    }
    y -= line.before;
    if (line.text) {
      pages.at(-1)!.push(textCommand(line.text, MARGIN_X + line.indent, y, line.size, line.font));
    }
    y -= lineHeight + line.after;
  }
  return pages;
}

function buildPdf(objects: string[]): Buffer {
  let output = "%PDF-1.4\n%SATQUERY\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(output, "latin1");
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(output, "latin1");
  output += `xref\n0 ${objects.length + 1}\n`;
  output += "0000000000 65535 f \n";
  for (let index = 1; index <= objects.length; index += 1) {
    output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, "latin1");
}

export function generateReportPdf(markdown: string, jobId: string): Buffer {
  const pageCommands = paginate(parseMarkdown(markdown));
  const pageCount = pageCommands.length;
  const firstPageObjectId = 5;
  const pageObjectIds = Array.from({ length: pageCount }, (_, index) => firstPageObjectId + index * 2);
  const objects: string[] = [];

  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Count ${pageCount} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

  pageCommands.forEach((commands, index) => {
    const pageObjectId = pageObjectIds[index];
    const contentObjectId = pageObjectId + 1;
    const header = textCommand("SatQuery AI Analysis Report", MARGIN_X, 815, 9, "bold");
    const footer = textCommand(
      `Job ${jobId}  |  Page ${index + 1} of ${pageCount}`,
      MARGIN_X,
      28,
      8,
      "regular",
    );
    const stream = [header, ...commands, footer].join("\n");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
    );
    objects.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  });

  return buildPdf(objects);
}
