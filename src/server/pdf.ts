import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { fmtDateTime } from "@/lib/time";

const BRAND = rgb(0.02, 0.33, 0.45);
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.38, 0.42, 0.48);
const ACCENT = rgb(0.93, 0.34, 0.15);

let logoCache: Buffer | null = null;
async function logo() {
  logoCache ??= await readFile(path.join(process.cwd(), "public", "brand", "blink-logo.png")).catch(() => Buffer.alloc(0));
  return logoCache.length ? logoCache : null;
}

/** Remove caracteres fora do conjunto WinAnsi das fontes padrão do PDF. */
function clean(s: string) {
  return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–]/g, "-")
    .replace(/[^\x20-\x7E -ÿ—•€]/g, "");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of clean(text).split(/\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(tryLine, size) <= width) line = tryLine;
      else {
        if (line) out.push(line);
        // palavra maior que a linha (ex.: hash): quebra por caracteres
        let w = word;
        while (font.widthOfTextAtSize(w, size) > width) {
          let i = w.length;
          while (i > 1 && font.widthOfTextAtSize(w.slice(0, i), size) > width) i--;
          out.push(w.slice(0, i)); w = w.slice(i);
        }
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

/** Escreve blocos de texto com quebra de página automática. */
class Writer {
  page!: PDFPage;
  y = 0;
  constructor(private doc: PDFDocument, private fonts: { regular: PDFFont; bold: PDFFont }, private size: [number, number] = [595.28, 841.89], private margin = 50, private header?: (p: PDFPage) => number) {
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage(this.size);
    this.y = this.size[1] - this.margin - (this.header ? this.header(this.page) : 0);
  }
  get width() { return this.size[0] - this.margin * 2; }
  text(t: string, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number; indent?: number } = {}) {
    const size = o.size ?? 10;
    const font = o.bold ? this.fonts.bold : this.fonts.regular;
    for (const line of wrap(t, font, size, this.width - (o.indent ?? 0))) {
      if (this.y - size < this.margin + 20) this.newPage();
      this.page.drawText(line, { x: this.margin + (o.indent ?? 0), y: this.y - size, size, font, color: o.color ?? INK });
      this.y -= size * 1.35;
    }
    this.y -= o.gap ?? 4;
  }
  pair(label: string, value: string) {
    this.text(label, { size: 8, bold: true, color: MUTED, gap: 0 });
    this.text(value, { size: 10, gap: 6 });
  }
  rule() {
    if (this.y < this.margin + 40) this.newPage();
    this.page.drawLine({ start: { x: this.margin, y: this.y }, end: { x: this.size[0] - this.margin, y: this.y }, thickness: 0.6, color: rgb(0.85, 0.87, 0.9) });
    this.y -= 12;
  }
  space(h: number) { if (this.y - h < this.margin + 20) this.newPage(); else this.y -= h; }
}

async function fontsOf(doc: PDFDocument) {
  return { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
}

async function drawLogo(doc: PDFDocument, page: PDFPage, x: number, yTop: number, h = 34) {
  const l = await logo();
  if (!l) return 0;
  const img = await doc.embedPng(l);
  const w = (img.width / img.height) * h;
  page.drawImage(img, { x, y: yTop - h, width: w, height: h });
  return h;
}

function footer(doc: PDFDocument, font: PDFFont, text: string, from = 0) {
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    if (i < from) return;
    const { width } = p.getSize();
    p.drawText(clean(`${text} · página ${i + 1} de ${pages.length}`), { x: 50, y: 24, size: 7, font, color: MUTED, maxWidth: width - 100 });
  });
}

// =====================================================================
// Termo modelo (gerado pelo sistema)
// =====================================================================
export async function buildModelTermPdf(o: { title: string; versionLabel: string; trainingTitle: string; declaration: string; body: string[] }) {
  const doc = await PDFDocument.create();
  doc.setTitle(clean(o.title)); doc.setProducer("BLINK Academy"); doc.setCreator("BLINK Academy");
  const fonts = await fontsOf(doc);
  const w = new Writer(doc, fonts, undefined, 56);
  await drawLogo(doc, w.page, 56, w.y, 40);
  w.space(54);
  w.page.drawRectangle({ x: 56, y: w.y - 34, width: w.width, height: 34, color: rgb(1, 0.95, 0.9), borderColor: ACCENT, borderWidth: 1 });
  w.page.drawText("MODELO — REVISAR E APROVAR COM A ÁREA JURÍDICA DA BLINK ANTES DO USO OFICIAL", { x: 66, y: w.y - 22, size: 9, font: fonts.bold, color: ACCENT });
  w.space(50);
  w.text(o.title.toUpperCase(), { size: 15, bold: true, color: BRAND, gap: 2 });
  w.text(`Versão ${o.versionLabel} · Treinamento: ${o.trainingTitle}`, { size: 9, color: MUTED, gap: 14 });
  for (const p of o.body) w.text(p, { size: 10.5, gap: 8 });
  w.space(6);
  w.text("DECLARAÇÃO DO MOTORISTA", { size: 10, bold: true, color: BRAND, gap: 4 });
  w.text(o.declaration, { size: 10.5, gap: 10 });
  w.text("A assinatura deste termo é feita eletronicamente no portal BLINK Academy, após a identificação por CPF e por código de uso único enviado ao contato cadastrado. O registro de evidências (data, hora, endereço IP, dispositivo, código de verificação e resumos criptográficos) é anexado ao documento assinado.", { size: 9, color: MUTED });
  footer(doc, fonts.regular, `${o.title} · versão ${o.versionLabel} · MODELO`);
  return Buffer.from(await doc.save());
}

// =====================================================================
// Termo assinado = termo original + manifesto de assinatura
// =====================================================================
export type SignatureManifest = {
  verificationCode: string; verifyUrl: string; signedAt: Date;
  signerName: string; signerCpfMask: string; trainingTitle: string; trainingVersion: number;
  termTitle: string; termVersion: string; termSha256: string; declaration: string;
  examScore: number; examAttempt: number; otpChannel: string; otpDestinationMask: string;
  ip: string; userAgent: string; evidenceSha256: string; drawingPng: Buffer | null;
};

export async function buildSignedTermPdf(original: Buffer, m: SignatureManifest) {
  const doc = await PDFDocument.create();
  doc.setTitle(clean(`${m.termTitle} — assinado`)); doc.setProducer("BLINK Academy"); doc.setCreator("BLINK Academy");
  doc.setSubject(`Código de verificação ${m.verificationCode}`); doc.setCreationDate(m.signedAt); doc.setModificationDate(m.signedAt);
  const src = await PDFDocument.load(original, { ignoreEncryption: false });
  for (const p of await doc.copyPages(src, src.getPageIndices())) doc.addPage(p);
  const originalPages = doc.getPageCount();
  const fonts = await fontsOf(doc);
  const w = new Writer(doc, fonts);
  await drawLogo(doc, w.page, 50, w.y, 30);
  w.space(44);
  w.text("MANIFESTO DE ASSINATURA ELETRÔNICA", { size: 14, bold: true, color: BRAND, gap: 2 });
  w.text(`Código de verificação: ${m.verificationCode}`, { size: 11, bold: true, color: ACCENT, gap: 2 });
  w.text(`Verifique em ${m.verifyUrl}`, { size: 9, color: MUTED, gap: 10 });
  w.rule();
  w.pair("SIGNATÁRIO", `${m.signerName} · CPF ${m.signerCpfMask}`);
  w.pair("DATA E HORA DA ASSINATURA (HORÁRIO DE BRASÍLIA)", `${fmtDateTime(m.signedAt)} · ${m.signedAt.toISOString()}`);
  w.pair("DOCUMENTO ASSINADO", `${m.termTitle} — versão ${m.termVersion} (páginas anteriores deste arquivo)`);
  w.pair("SHA-256 DO TERMO ORIGINAL", m.termSha256);
  w.pair("TREINAMENTO", `${m.trainingTitle} — versão ${m.trainingVersion} · avaliação aprovada com ${m.examScore}% (${m.examAttempt}ª tentativa)`);
  w.pair("FORMA DE IDENTIFICAÇÃO", `Sessão autenticada por CPF + código de uso único; assinatura confirmada por novo código de uso único enviado por ${m.otpChannel === "email" ? "e-mail" : "SMS"} para ${m.otpDestinationMask}.`);
  w.pair("ENDEREÇO IP E DISPOSITIVO", `${m.ip} · ${m.userAgent.slice(0, 220)}`);
  w.pair("DECLARAÇÃO ACEITA", m.declaration);
  w.pair("SHA-256 DO REGISTRO DE EVIDÊNCIAS", m.evidenceSha256);
  if (m.drawingPng) {
    const img = await doc.embedPng(m.drawingPng);
    const scale = Math.min(260 / img.width, 70 / img.height);
    const iw = img.width * scale, ih = img.height * scale;
    w.text("RUBRICA DESENHADA NA TELA (COMPLEMENTAR)", { size: 8, bold: true, color: MUTED, gap: 2 });
    w.space(ih + 4);
    w.page.drawImage(img, { x: 50, y: w.y, width: iw, height: ih });
    w.space(8);
    w.text("A rubrica desenhada, isoladamente, não comprova a identidade do signatário; ela complementa a identificação por CPF e código de uso único.", { size: 8, color: MUTED });
  }
  w.rule();
  w.text("Este manifesto foi gerado automaticamente pela plataforma BLINK Academy no momento da assinatura. O registro de evidências fica armazenado de forma imutável e pode ser conferido pelo código de verificação. A validade jurídica deste termo depende de revisão e aprovação da área jurídica da BLINK.", { size: 8, color: MUTED });
  footer(doc, fonts.regular, `BLINK Academy · termo assinado · ${m.verificationCode}`, originalPages);
  return Buffer.from(await doc.save());
}

// =====================================================================
// Comprovante de conclusão
// =====================================================================
export type CertificateData = {
  code: string; verifyUrl: string; issuedAt: Date; holderName: string; holderCpfMask: string;
  trainingTitle: string; trainingVersion: number; startedAt: Date | null; completedAt: Date;
  videosCompleted: number; examScore: number; examAttempt: number; passPct: number; signedAt: Date; signatureCode: string;
};

export async function buildCertificatePdf(c: CertificateData) {
  const doc = await PDFDocument.create();
  doc.setTitle(clean(`Comprovante de conclusão — ${c.code}`)); doc.setProducer("BLINK Academy"); doc.setCreator("BLINK Academy");
  doc.setCreationDate(c.issuedAt); doc.setModificationDate(c.issuedAt);
  const { regular, bold } = await fontsOf(doc);
  const W = 841.89, H = 595.28;
  const p = doc.addPage([W, H]);
  p.drawRectangle({ x: 18, y: 18, width: W - 36, height: H - 36, borderColor: BRAND, borderWidth: 2 });
  p.drawRectangle({ x: 18, y: H - 30, width: W - 36, height: 12, color: ACCENT });
  await drawLogo(doc, p, 50, H - 50, 46);
  const center = (t: string, y: number, size: number, f = regular, color = INK) => {
    const s = clean(t);
    const tw = f.widthOfTextAtSize(s, size);
    p.drawText(s, { x: (W - tw) / 2, y, size, font: f, color });
  };
  center("COMPROVANTE DE CONCLUSÃO DE TREINAMENTO", H - 140, 22, bold, BRAND);
  center("A BLINK Logística Inteligente registra que", H - 185, 12, regular, MUTED);
  center(c.holderName.toUpperCase(), H - 222, 24, bold);
  center(`CPF ${c.holderCpfMask}`, H - 245, 11, regular, MUTED);
  center("concluiu o treinamento", H - 280, 12, regular, MUTED);
  center(`${c.trainingTitle} — versão ${c.trainingVersion}`, H - 308, 17, bold, BRAND);
  center(`com vídeos obrigatórios assistidos (${c.videosCompleted}), avaliação aprovada com ${c.examScore}% (mínimo ${c.passPct}%, ${c.examAttempt}ª tentativa)`, H - 340, 11);
  center(`e termo assinado eletronicamente em ${fmtDateTime(c.signedAt)}.`, H - 358, 11);
  const cols: [string, string][] = [
    ["Concluído em", fmtDateTime(c.completedAt)],
    ["Código do comprovante", c.code],
    ["Código da assinatura", c.signatureCode],
  ];
  cols.forEach(([l, v], i) => {
    const x = 70 + i * ((W - 140) / 3);
    p.drawText(clean(l.toUpperCase()), { x, y: 130, size: 8, font: bold, color: MUTED });
    p.drawText(clean(v), { x, y: 112, size: 13, font: bold, color: INK });
  });
  p.drawText(clean(`Confira a autenticidade em ${c.verifyUrl}`), { x: 70, y: 70, size: 9, font: regular, color: MUTED });
  p.drawText(clean(`Emitido em ${fmtDateTime(c.issuedAt)} (horário de Brasília) pela plataforma BLINK Academy.`), { x: 70, y: 56, size: 8, font: regular, color: MUTED });
  return Buffer.from(await doc.save());
}

/** Lê o PDF enviado e devolve o número de páginas (lança erro se o arquivo não for um PDF válido). */
export async function pdfPageCount(data: Buffer) {
  if (data.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("O arquivo não é um PDF.");
  const d = await PDFDocument.load(data, { ignoreEncryption: false, updateMetadata: false });
  return d.getPageCount();
}
