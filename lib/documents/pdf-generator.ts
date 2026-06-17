import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from 'pdf-lib'

// US Letter
const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 72
const CONTENT_W = PAGE_W - 2 * MARGIN

interface PdfContext {
  doc: PDFDocument
  page: PDFPage
  font: PDFFont
  boldFont: PDFFont
  y: number
}

function newPage(ctx: PdfContext) {
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H])
  ctx.y = PAGE_H - MARGIN
}

function checkBreak(ctx: PdfContext, needed: number) {
  if (ctx.y - needed < MARGIN + 20) newPage(ctx)
}

function wrapText(text: string, font: PDFFont, size: number): string[] {
  if (!text.trim()) return ['']
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) > CONTENT_W) {
      if (line) lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

function drawLines(ctx: PdfContext, lines: string[], font: PDFFont, size: number, opts: {
  leading?: number
  center?: boolean
  indent?: number
  color?: [number, number, number]
} = {}) {
  const leading = opts.leading ?? Math.round(size * 1.5)
  const c = opts.color ? rgb(...opts.color as [number, number, number]) : rgb(0, 0, 0)
  for (const line of lines) {
    checkBreak(ctx, leading)
    let x = MARGIN + (opts.indent ?? 0)
    if (opts.center) {
      x = MARGIN + (CONTENT_W - font.widthOfTextAtSize(line, size)) / 2
    }
    ctx.page.drawText(line, { x, y: ctx.y, size, font, color: c })
    ctx.y -= leading
  }
}

type DrawOpts = { leading?: number; center?: boolean; indent?: number; color?: [number, number, number] }

function drawParagraph(ctx: PdfContext, text: string, font: PDFFont, size: number, opts?: DrawOpts) {
  const lines = wrapText(text, font, size)
  drawLines(ctx, lines, font, size, opts)
}

function drawHRule(ctx: PdfContext) {
  checkBreak(ctx, 16)
  ctx.y -= 4
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: PAGE_W - MARGIN, y: ctx.y },
    thickness: 0.5,
    color: rgb(0.65, 0.65, 0.65),
  })
  ctx.y -= 12
}

export interface GeneratePDFOptions {
  title: string
  content: string
  signatureDataUrl?: string | null
}

export async function generateDocumentPDF(opts: GeneratePDFOptions): Promise<Buffer> {
  const { title, content, signatureDataUrl } = opts

  const pdfDoc = await PDFDocument.create()
  const font     = await pdfDoc.embedFont(StandardFonts.TimesRoman)
  const boldFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBold)

  const ctx: PdfContext = {
    doc: pdfDoc,
    page: pdfDoc.addPage([PAGE_W, PAGE_H]),
    font,
    boldFont,
    y: PAGE_H - MARGIN,
  }

  // ── Document title ─────────────────────────────────────────────────────────
  const titleLines = wrapText(title.toUpperCase(), boldFont, 14)
  drawLines(ctx, titleLines, boldFont, 14, { center: true, leading: 20 })
  ctx.y -= 8

  // ── Parse content ─────────────────────────────────────────────────────────
  const paragraphs = content.split('\n')

  for (let i = 0; i < paragraphs.length; i++) {
    const raw = paragraphs[i]

    if (raw.startsWith('## ')) {
      // Section heading
      ctx.y -= 6
      drawParagraph(ctx, raw.slice(3), boldFont, 10, { leading: 16 })
      ctx.y -= 2
    } else if (raw.trim() === '---') {
      drawHRule(ctx)
    } else if (raw.trim() === '') {
      ctx.y -= 6
    } else {
      // Detect signature-line patterns: lines with many underscores
      const isSignatureLine = /^_{5,}/.test(raw.trim())
      drawParagraph(ctx, raw, font, 9.5, {
        leading: 14,
        color: isSignatureLine ? [0, 0, 0] as [number, number, number] : undefined,
      })
    }
  }

  // ── Signature image ────────────────────────────────────────────────────────
  if (signatureDataUrl) {
    try {
      const commaIdx = signatureDataUrl.indexOf(',')
      const base64 = signatureDataUrl.slice(commaIdx + 1)
      const imgBytes = Buffer.from(base64, 'base64')

      const isPng = signatureDataUrl.startsWith('data:image/png')
      const sigImg = isPng
        ? await pdfDoc.embedPng(imgBytes)
        : await pdfDoc.embedJpg(imgBytes)

      const sigW = 160
      const sigH = (sigImg.height / sigImg.width) * sigW

      checkBreak(ctx, sigH + 10)
      ctx.y -= 6
      ctx.page.drawImage(sigImg, {
        x: MARGIN,
        y: ctx.y - sigH,
        width: sigW,
        height: sigH,
      })
      ctx.y -= sigH + 4
    } catch {
      // Signature embed failed — skip silently, doc still generates
    }
  }

  // ── Page numbers ───────────────────────────────────────────────────────────
  const pages = pdfDoc.getPages()
  const total = pages.length
  for (let p = 0; p < total; p++) {
    const pg = pages[p]
    const label = `${p + 1} / ${total}`
    const lw = font.widthOfTextAtSize(label, 8)
    pg.drawText(label, {
      x: PAGE_W / 2 - lw / 2,
      y: MARGIN / 2,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    })
  }

  return Buffer.from(await pdfDoc.save())
}
