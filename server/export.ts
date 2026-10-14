// Word (.docx) and EPUB export without pandoc. Both formats are zip files of XML: scenes are parsed with marked,
// reduced to simple blocks of styled text, and written out as WordprocessingML or XHTML.
// improvement: tables, images and footnotes come out as plain text; manuscripts rarely use them.
import { crc32, deflateRawSync } from 'node:zlib'
import { randomUUID } from 'node:crypto'
import { marked, type Token, type Tokens } from 'marked'

export type Book = { title: string; chapters: { title: string; scenes: string[] }[] }

type Run = { text: string; b?: boolean; i?: boolean; s?: boolean; code?: boolean; br?: boolean }
type Block = { kind: 'p' | 'h' | 'quote' | 'code' | 'break'; runs: Run[] }

// ---- Markdown → blocks ----

function inline(tokens: Token[] = [], style: Omit<Run, 'text'> = {}): Run[] {
  return tokens.flatMap((t): Run[] => {
    switch (t.type) {
      case 'strong': return inline((t as Tokens.Strong).tokens, { ...style, b: true })
      case 'em': return inline((t as Tokens.Em).tokens, { ...style, i: true })
      case 'del': return inline((t as Tokens.Del).tokens, { ...style, s: true })
      case 'codespan': return [{ ...style, code: true, text: (t as Tokens.Codespan).text }]
      case 'br': return [{ text: '', br: true }]
      case 'html': return [{ ...style, text: (t as Tokens.HTML).raw }] // angle brackets someone typed: kept as text, never lost
      default: {
        const kids = (t as { tokens?: Token[] }).tokens
        return kids?.length ? inline(kids, style) : [{ ...style, text: (t as { text?: string }).text ?? '' }]
      }
    }
  })
}

function blocks(tokens: Token[], quote = false): Block[] {
  const kind = quote ? 'quote' : 'p'
  return tokens.flatMap((t): Block[] => {
    switch (t.type) {
      case 'space': return []
      case 'heading': return [{ kind: 'h', runs: inline((t as Tokens.Heading).tokens) }]
      case 'hr': return [{ kind: 'break', runs: [] }]
      case 'blockquote': return blocks((t as Tokens.Blockquote).tokens, true)
      case 'code': return (t as Tokens.Code).text.split('\n').map((line) => ({ kind: 'code', runs: [{ text: line, code: true }] }))
      case 'list': {
        const l = t as Tokens.List
        return l.items.flatMap((item, n) => {
          const [first, ...rest] = blocks(item.tokens, quote)
          const bullet = { text: l.ordered ? `${Number(l.start || 1) + n}. ` : '• ' }
          return first ? [{ ...first, runs: [bullet, ...first.runs] }, ...rest] : []
        })
      }
      case 'table': {
        const tb = t as Tokens.Table
        return [tb.header, ...tb.rows].map((cells) => ({ kind, runs: cells.flatMap((c, i) => [...(i ? [{ text: ' | ' }] : []), ...inline(c.tokens)]) }))
      }
      case 'paragraph': case 'text': {
        const p = t as Tokens.Paragraph
        return [{ kind, runs: inline(p.tokens ?? [{ type: 'text', raw: p.text, text: p.text } as Token]) }]
      }
      case 'html': return [{ kind, runs: [{ text: (t as Tokens.HTML).raw.trim() }] }]
      default: return []
    }
  })
}

const sceneBlocks = (md: string) => blocks(marked.lexer(md))

// ---- Zip ----

// Minimal zip writer (deflate, UTF-8 names). Entries marked stored are kept uncompressed (EPUB needs that for `mimetype`).
export function zip(files: { name: string; data: string | Buffer; store?: boolean }[]) {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const raw = Buffer.from(f.data)
    const body = f.store ? raw : deflateRawSync(raw)
    const name = Buffer.from(f.name)
    const fields = (h: Buffer, at: number) => {
      h.writeUInt16LE(20, at); h.writeUInt16LE(0x0800, at + 2); h.writeUInt16LE(f.store ? 0 : 8, at + 4)
      h.writeUInt16LE(0, at + 6); h.writeUInt16LE(33, at + 8) // 1980-01-01 00:00: same bytes on every export
      h.writeUInt32LE(crc32(raw), at + 10); h.writeUInt32LE(body.length, at + 14); h.writeUInt32LE(raw.length, at + 18)
      h.writeUInt16LE(name.length, at + 22)
    }
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); fields(local, 4)
    const dirEntry = Buffer.alloc(46)
    dirEntry.writeUInt32LE(0x02014b50, 0); dirEntry.writeUInt16LE(20, 4); fields(dirEntry, 6); dirEntry.writeUInt32LE(offset, 42)
    parts.push(local, name, body)
    central.push(dirEntry, name)
    offset += local.length + name.length + body.length
  }
  const dir = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, dir, end])
}

// Text for XML: escaped, and without control characters XML doesn't allow.
const x = (s: string) =>
  s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

// ---- Word ----

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

function docxRuns(runs: Run[]) {
  return runs.map((r) => {
    if (r.br) return '<w:r><w:br/></w:r>'
    const props = (r.b ? '<w:b/>' : '') + (r.i ? '<w:i/>' : '') + (r.s ? '<w:strike/>' : '') +
      (r.code ? '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>' : '')
    // A line break inside a Markdown paragraph is just a space (hard breaks are `br` runs).
    return `<w:r>${props && `<w:rPr>${props}</w:rPr>`}<w:t xml:space="preserve">${x(r.text.replace(/\n/g, ' '))}</w:t></w:r>`
  }).join('')
}
const para = (style: string, runs: Run[]) => `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${docxRuns(runs)}</w:p>`
const DOCX_STYLE: Record<Block['kind'], string> = { p: 'Normal', h: 'Heading2', quote: 'Quote', code: 'Code', break: 'SceneBreak' }

// Manuscript-style defaults: 12pt serif, 1.5 line spacing, indented paragraphs, each chapter on a new page.
const STYLES = `${XML}<w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:ind w:firstLine="720"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="2400" w:after="480"/><w:ind w:firstLine="0"/></w:pPr><w:rPr><w:sz w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:pageBreakBefore/><w:jc w:val="center"/><w:spacing w:before="1440" w:after="480"/><w:ind w:firstLine="0"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/><w:ind w:firstLine="0"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720" w:right="720" w:firstLine="0"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:firstLine="0"/><w:spacing w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="SceneBreak"><w:name w:val="Scene Break"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="240"/><w:ind w:firstLine="0"/></w:pPr></w:style>
</w:styles>`

export function docx(book: Book) {
  const body = [
    para('Title', [{ text: book.title }]),
    ...book.chapters.flatMap((ch) => [
      para('Heading1', [{ text: ch.title }]),
      ...ch.scenes.flatMap((md, n) => [
        ...(n ? [para('SceneBreak', [{ text: '* * *' }])] : []),
        ...sceneBlocks(md).map((b) => para(DOCX_STYLE[b.kind], b.kind === 'break' ? [{ text: '* * *' }] : b.runs)),
      ]),
    ]),
  ].join('\n')
  const rel = (id: string, type: string, target: string) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/${type}" Target="${target}"/>`
  return zip([
    { name: '[Content_Types].xml', data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${rel('r1', 'officeDocument/2006/relationships/officeDocument', 'word/document.xml')}
${rel('r2', 'package/2006/relationships/metadata/core-properties', 'docProps/core.xml')}</Relationships>` },
    { name: 'docProps/core.xml', data: `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${x(book.title)}</dc:title></cp:coreProperties>` },
    { name: 'word/_rels/document.xml.rels', data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${rel('r1', 'officeDocument/2006/relationships/styles', 'styles.xml')}</Relationships>` },
    { name: 'word/styles.xml', data: STYLES },
    { name: 'word/document.xml', data: `${XML}<w:document ${W}><w:body>\n${body}\n<w:sectPr><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>` },
  ])
}

// ---- EPUB 3 ----

function htmlRuns(runs: Run[]) {
  return runs.map((r) => {
    if (r.br) return '<br/>'
    let h = x(r.text)
    if (r.code) h = `<code>${h}</code>`
    if (r.s) h = `<del>${h}</del>`
    if (r.i) h = `<em>${h}</em>`
    if (r.b) h = `<strong>${h}</strong>`
    return h
  }).join('')
}
const htmlBlock = (b: Block) =>
  b.kind === 'break' ? '<p class="break">* * *</p>'
  : b.kind === 'h' ? `<h3>${htmlRuns(b.runs)}</h3>`
  : b.kind === 'quote' ? `<blockquote><p>${htmlRuns(b.runs)}</p></blockquote>`
  : b.kind === 'code' ? `<pre><code>${htmlRuns(b.runs)}</code></pre>`
  : `<p>${htmlRuns(b.runs)}</p>`

const page = (title: string, body: string) => `${XML}<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><meta charset="utf-8"/><title>${x(title)}</title><link rel="stylesheet" href="style.css"/></head>
<body>${body}</body></html>`

const CSS = `body { font-family: serif; line-height: 1.5; }
h1 { text-align: center; margin-top: 30%; } h2 { text-align: center; margin: 2em 0 1.5em; }
p { margin: 0; text-indent: 1.5em; } h2 + p, .break + p { text-indent: 0; }
.break { text-align: center; text-indent: 0; margin: 1em 0; }
blockquote { margin: .5em 2em; font-style: italic; } blockquote p { text-indent: 0; }`

// improvement: language is always "en"; a book `language` field if anyone writes in another language.
export function epub(book: Book) {
  const chapters = book.chapters.map((ch, n) => ({
    file: `chapter-${n + 1}.xhtml`, title: ch.title,
    html: page(ch.title, `<section epub:type="chapter"><h2>${x(ch.title)}</h2>\n${ch.scenes
      .map((md) => sceneBlocks(md).map(htmlBlock).join('\n')).join('\n<p class="break">* * *</p>\n')}</section>`),
  }))
  const items = [{ file: 'title.xhtml', title: book.title }, ...chapters]
  const nav = page(book.title, `<nav epub:type="toc" id="toc"><h1>${x(book.title)}</h1><ol>
${chapters.map((c) => `<li><a href="${c.file}">${x(c.title)}</a></li>`).join('\n')}</ol></nav>`)
  const opf = `${XML}<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:${randomUUID()}</dc:identifier>
<dc:title>${x(book.title)}</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">${new Date().toISOString().slice(0, 19)}Z</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>
${items.map((c, n) => `<item id="c${n}" href="${c.file}" media-type="application/xhtml+xml"/>`).join('\n')}</manifest>
<spine>${items.map((_, n) => `<itemref idref="c${n}"/>`).join('')}</spine></package>`
  return zip([
    { name: 'mimetype', data: 'application/epub+zip', store: true }, // must be first and uncompressed
    { name: 'META-INF/container.xml', data: `${XML}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>` },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/nav.xhtml', data: nav },
    { name: 'OEBPS/style.css', data: CSS },
    { name: 'OEBPS/title.xhtml', data: page(book.title, `<h1>${x(book.title)}</h1>`) },
    ...chapters.map((c) => ({ name: `OEBPS/${c.file}`, data: c.html })),
  ])
}
