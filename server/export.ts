// Word (.docx) and EPUB export without pandoc. Both formats are zip files of XML: scenes are parsed with marked,
// reduced to simple blocks of styled text, and written out as WordprocessingML or XHTML.
// improvement: tables, images and footnotes come out as plain text; manuscripts rarely use them.
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'
import { randomUUID } from 'node:crypto'
import { marked, type Token, type Tokens } from 'marked'
import { CRITIC } from './review.ts'

// author and words (rounded) are only used by the submission-format Word export; cover and language by EPUB.
// Scenes may keep inline comments ({==text==}{>>note<<}): Word export turns them into Word comments.
export type Book = {
  title: string; chapters: { title: string; scenes: string[] }[]; author?: string; words?: number
  dedication?: string; acknowledgements?: string; language?: string; cover?: { file: string; type: string; data: Buffer }
}

// A BCP 47 tag like "en", "fr" or "pt-BR"; anything else falls back to English.
export const langOf = (s = '') => (/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(s.trim()) ? s.trim() : 'en')

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

// Comment markers in the text (see docx): \uE000<id>\uE002 starts comment <id>, \uE001<id>\uE002 ends it.
const MARKER = /([\uE000\uE001]\d+)\uE002/
function docxRuns(runs: Run[]) {
  return runs.map((r) => {
    if (r.br) return '<w:r><w:br/></w:r>'
    const props = (r.b ? '<w:b/>' : '') + (r.i ? '<w:i/>' : '') + (r.s ? '<w:strike/>' : '') +
      (r.code ? '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>' : '')
    // A line break inside a Markdown paragraph is just a space (hard breaks are `br` runs).
    return r.text.split(MARKER).map((t, i) => {
      if (i % 2 === 0) return t || !i ? `<w:r>${props && `<w:rPr>${props}</w:rPr>`}<w:t xml:space="preserve">${x(t.replace(/\n/g, ' '))}</w:t></w:r>` : ''
      const id = t.slice(1)
      return t[0] === '\uE000' ? `<w:commentRangeStart w:id="${id}"/>`
        : `<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`
    }).join('')
  }).join('')
}
const para = (style: string, runs: Run[]) => `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${docxRuns(runs)}</w:p>`
const DOCX_STYLE: Record<Block['kind'], string> = { p: 'Normal', h: 'Heading2', quote: 'Quote', code: 'Code', break: 'SceneBreak' }

// Manuscript-style defaults: 12pt serif, 1.5 line spacing (double for submissions), indented paragraphs, each chapter on a new page.
const STYLES = (line: number) => `${XML}<w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="${line}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:styleId="Plain"><w:name w:val="Plain"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:firstLine="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="right"/><w:ind w:firstLine="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:ind w:firstLine="720"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="2400" w:after="480"/><w:ind w:firstLine="0"/></w:pPr><w:rPr><w:sz w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:pageBreakBefore/><w:jc w:val="center"/><w:spacing w:before="1440" w:after="480"/><w:ind w:firstLine="0"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/><w:ind w:firstLine="0"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720" w:right="720" w:firstLine="0"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:firstLine="0"/><w:spacing w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Dedication"><w:name w:val="Dedication"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="2400"/><w:ind w:firstLine="0"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="SceneBreak"><w:name w:val="Scene Break"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="240"/><w:ind w:firstLine="0"/></w:pPr></w:style>
</w:styles>`

// submission: standard manuscript format for agents and editors. Double-spaced, a title page with the author's
// name and word count, and "Surname / Title / page" in the top-right of every page after it.
// Inline comments in the scenes become Word comments (comments.xml), so an editor can reply to them in Word.
export function docx(book: Book, submission = false) {
  const author = book.author?.trim() ?? ''
  const notes: string[] = []
  const paras = (md: string) => sceneBlocks(md.replace(CRITIC, (_, text, note) => `\uE000${notes.length}\uE002${text}\uE001${notes.push(note) - 1}\uE002`))
    .map((b) => para(DOCX_STYLE[b.kind], b.kind === 'break' ? [{ text: '* * *' }] : b.runs))
  const titlePage = submission
    ? [
        para('Plain', [{ text: author }]),
        para('Plain', [{ text: `About ${(book.words ?? 0).toLocaleString('en')} words` }]),
        para('Title', [{ text: book.title }]),
        ...(author ? [para('SceneBreak', [{ text: `by ${author}` }])] : []),
      ]
    : [para('Title', [{ text: book.title }])]
  const body = [
    ...titlePage,
    // Dedication on a page of its own; chapters start new pages anyway.
    ...(book.dedication ? ['<w:p><w:r><w:br w:type="page"/></w:r></w:p>', ...sceneBlocks(book.dedication).map((b) => para('Dedication', b.runs))] : []),
    ...book.chapters.flatMap((ch) => [
      para('Heading1', [{ text: ch.title }]),
      ...ch.scenes.flatMap((md, n) => [...(n ? [para('SceneBreak', [{ text: '* * *' }])] : []), ...paras(md)]),
    ]),
    ...(book.acknowledgements ? [para('Heading1', [{ text: 'Acknowledgements' }]), ...paras(book.acknowledgements)] : []),
  ].join('\n')
  const comments = `${XML}<w:comments ${W}>${notes.map((n, i) =>
    `<w:comment w:id="${i}" w:author="${x(author || 'Author')}"><w:p>${docxRuns([{ text: n }])}</w:p></w:comment>`).join('')}</w:comments>`
  const rel = (id: string, type: string, target: string) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/${type}" Target="${target}"/>`
  const surname = author.split(/\s+/).at(-1)
  const header = `${XML}<w:hdr ${W}><w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr>${docxRuns([{ text: [surname, book.title.toUpperCase()].filter(Boolean).join(' / ') + ' / ' }])}<w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:hdr>`
  // titlePg: the title page uses the (absent) first-page header, so it has none.
  const sect = submission ? '<w:headerReference w:type="default" r:id="rH"/><w:titlePg/>' : ''
  return zip([
    { name: '[Content_Types].xml', data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
${submission ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : ''}
${notes.length ? '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' : ''}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${rel('r1', 'officeDocument/2006/relationships/officeDocument', 'word/document.xml')}
${rel('r2', 'package/2006/relationships/metadata/core-properties', 'docProps/core.xml')}</Relationships>` },
    { name: 'docProps/core.xml', data: `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${x(book.title)}</dc:title></cp:coreProperties>` },
    { name: 'word/_rels/document.xml.rels', data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${rel('r1', 'officeDocument/2006/relationships/styles', 'styles.xml')}
${submission ? rel('rH', 'officeDocument/2006/relationships/header', 'header1.xml') : ''}
${notes.length ? rel('rC', 'officeDocument/2006/relationships/comments', 'comments.xml') : ''}</Relationships>` },
    { name: 'word/styles.xml', data: STYLES(submission ? 480 : 360) },
    ...(submission ? [{ name: 'word/header1.xml', data: header }] : []),
    ...(notes.length ? [{ name: 'word/comments.xml', data: comments }] : []),
    { name: 'word/document.xml', data: `${XML}<w:document ${W} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>\n${body}\n<w:sectPr>${sect}<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>` },
  ])
}

// ---- Import: Markdown or Word → a book ----

// `# Title` names the book, `## Heading` starts a chapter, a line like `* * *`, `***`, `---` or `#` breaks scenes.
// Text before the first chapter heading becomes an untitled chapter; no chapter headings at all gives one chapter.
// improvement: chapters marked only by plain "Chapter 7" lines (no heading style) stay one big chapter.
export function importMarkdown(md: string, fallbackTitle: string): Book {
  let title = ''
  const chapters: { title: string; lines: string[] }[] = []
  const BREAK = /^\s*(?:(?:[*_-]\s*){3,}|#|~{3,})\s*$/ // hr, or the "#" scene break some writers use
  for (const line of md.replace(/\r\n?/g, '\n').split('\n')) {
    const h = /^(#{1,2})\s+(.+?)\s*#*$/.exec(line)
    if (h?.[1] === '#' && !title && !chapters.length) title = h[2]
    else if (h?.[1] === '##') chapters.push({ title: h[2], lines: [] })
    else {
      if (!chapters.length) chapters.push({ title: '', lines: [] })
      chapters.at(-1)!.lines.push(BREAK.test(line) ? '\u0000' : line)
    }
  }
  return {
    title: title || fallbackTitle,
    chapters: chapters
      .map((ch, n) => ({
        title: ch.title || (chapters.length === 1 ? 'Chapter 1' : 'Untitled chapter'),
        scenes: ch.lines.join('\n').split('\u0000').map((s) => s.trim()).filter(Boolean),
      }))
      .filter((ch) => ch.title !== 'Untitled chapter' || ch.scenes.length),
  }
}

// Files in a zip, read through its central directory (local headers may leave sizes out).
export function unzip(buf: Buffer) {
  const files = new Map<string, Buffer>()
  let end = buf.length - 22
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--
  if (end < 0) throw new Error('Not a zip file')
  for (let at = buf.readUInt32LE(end + 16), n = buf.readUInt16LE(end + 10); n > 0; n--) {
    const method = buf.readUInt16LE(at + 10)
    const size = buf.readUInt32LE(at + 20)
    const nameLen = buf.readUInt16LE(at + 28)
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen)
    const local = buf.readUInt32LE(at + 42)
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const data = buf.subarray(start, start + size)
    files.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data))
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32)
  }
  return files
}

const unxml = (s: string) => s.replace(/&(?:#(\d+)|#x([\da-f]+)|(\w+));/gi, (m, d, h, name) =>
  d ? String.fromCodePoint(+d) : h ? String.fromCodePoint(parseInt(h, 16))
  : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[name] ?? m)
const mdEscape = (s: string) => s.replace(/[\\*_`[\]]/g, '\\$&')
const on = (props: string, tag: string) => new RegExp(`<w:${tag}(?:\\s+w:val="(?!0|false)[^"]*")?\\s*/>`).test(props)

const wordText = (xml: string) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => unxml(m[1])).join('')

// Word document → Markdown: Title → #, Heading 1 → ## (chapters), other headings → ###, bold/italic kept.
// Word comments come back as inline comments ({==text==}{>>note<<}) when they start and end in the same paragraph.
// improvement: style ids are matched in English ("Heading1"); a document styled in another Word language may need its own names.
export function docxToMarkdown(buf: Buffer) {
  const files = unzip(buf)
  const xml = files.get('word/document.xml')?.toString('utf8')
  if (!xml) throw new Error("This doesn't look like a Word document")
  const notes = new Map<string, string>()
  for (const [, id, body] of (files.get('word/comments.xml')?.toString('utf8') ?? '').matchAll(/<w:comment\b[^>]*?\sw:id="(\d+)"[^>]*>([\s\S]*?)<\/w:comment>/g))
    notes.set(id, body.split('</w:p>').map(wordText).filter(Boolean).join(' ').replace(/<</g, '‹‹'))
  const paras = xml.match(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g) ?? []
  return paras.map((p) => {
    const style = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] ?? ''
    const ranges = (kind: string) => new Set([...p.matchAll(new RegExp(`<w:commentRange${kind}\\b[^>]*?w:id="(\\d+)"`, 'g'))].map((m) => m[1]))
    const [starts, ends] = [ranges('Start'), ranges('End')]
    // Word splits text into many runs; neighbours with the same bold/italic are merged before marking them.
    // Comment markers are runs of their own (mark \0) that are never merged with text or styled.
    const runs: { text: string; mark: string }[] = []
    for (const [, r, edge, id] of p.matchAll(/<w:r[ >]([\s\S]*?)<\/w:r>|<w:commentRange(Start|End)\b[^>]*?w:id="(\d+)"[^>]*\/>/g)) {
      if (edge) {
        if (starts.has(id) && ends.has(id) && notes.has(id)) runs.push({ text: edge === 'Start' ? '{==' : `==}{>>${notes.get(id)}<<}`, mark: '\0' })
        continue
      }
      const props = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(r)?.[1] ?? ''
      const text = [...r.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br)\s*\/>/g)]
        .map((m) => (m[2] === 'br' ? '  \n' : m[2] ? ' ' : mdEscape(unxml(m[1])))).join('')
      const mark = (on(props, 'b') ? '**' : '') + (on(props, 'i') ? '*' : '')
      if (runs.at(-1)?.mark === mark) runs.at(-1)!.text += text
      else runs.push({ text, mark })
    }
    const text = runs.map(({ text, mark }) => text.trim() && mark && mark !== '\0'
      ? text.replace(/^(\s*)([\s\S]*?)(\s*)$/, `$1${mark}$2${[...mark].reverse().join('')}$3`) : text).join('').trim()
    if (style === 'Title') return `# ${text}`
    if (/^Heading1$|^heading 1$/i.test(style)) return `## ${text}`
    if (/^Heading\d$/i.test(style) && text) return `### ${text}`
    if (style === 'SceneBreak' || /^\s*(?:(?:\\?[*#~_-]\s*){3}|#)\s*$/.test(text)) return '* * *'
    return text
  }).join('\n\n')
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

const page = (title: string, body: string, lang: string) => `${XML}<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}">
<head><meta charset="utf-8"/><title>${x(title)}</title><link rel="stylesheet" href="style.css"/></head>
<body>${body}</body></html>`

const CSS = `body { font-family: serif; line-height: 1.5; }
h1 { text-align: center; margin-top: 30%; } h2 { text-align: center; margin: 2em 0 1.5em; }
p { margin: 0; text-indent: 1.5em; } h2 + p, .break + p { text-indent: 0; }
.break { text-align: center; text-indent: 0; margin: 1em 0; }
blockquote { margin: .5em 2em; font-style: italic; } blockquote p { text-indent: 0; }
.dedication { margin-top: 30%; text-align: center; font-style: italic; } .dedication p { text-indent: 0; }
.cover { margin: 0; text-align: center; } .cover img { max-width: 100%; max-height: 100%; }`

// Pages in reading order: cover (if any), title, dedication, chapters, acknowledgements.
export function epub(book: Book) {
  const lang = langOf(book.language)
  const md = (s: string) => sceneBlocks(s).map(htmlBlock).join('\n')
  const chapters = book.chapters.map((ch, n) => ({
    file: `chapter-${n + 1}.xhtml`, title: ch.title,
    html: page(ch.title, `<section epub:type="chapter"><h2>${x(ch.title)}</h2>\n${ch.scenes.map(md).join('\n<p class="break">* * *</p>\n')}</section>`, lang),
  }))
  const cover = book.cover && `cover.${book.cover.file.split('.').pop()}`
  const ack = book.acknowledgements ? [{ file: 'acknowledgements.xhtml', title: 'Acknowledgements',
    html: page('Acknowledgements', `<section epub:type="acknowledgments"><h2>Acknowledgements</h2>\n${md(book.acknowledgements)}</section>`, lang) }] : []
  const items = [
    ...(cover ? [{ file: 'cover.xhtml', title: 'Cover', html: page('Cover', `<section epub:type="cover" class="cover"><img src="${cover}" alt="Cover"/></section>`, lang) }] : []),
    { file: 'title.xhtml', title: book.title, html: page(book.title, `<h1>${x(book.title)}</h1>`, lang) },
    ...(book.dedication ? [{ file: 'dedication.xhtml', title: 'Dedication',
      html: page('Dedication', `<section epub:type="dedication" class="dedication">${md(book.dedication)}</section>`, lang) }] : []),
    ...chapters,
    ...ack,
  ]
  const nav = page(book.title, `<nav epub:type="toc" id="toc"><h1>${x(book.title)}</h1><ol>
${[...chapters, ...ack].map((c) => `<li><a href="${c.file}">${x(c.title)}</a></li>`).join('\n')}</ol></nav>`, lang)
  const opf = `${XML}<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:${randomUUID()}</dc:identifier>
<dc:title>${x(book.title)}</dc:title><dc:language>${lang}</dc:language>
${cover ? '<meta name="cover" content="cover-image"/>' : ''}<meta property="dcterms:modified">${new Date().toISOString().slice(0, 19)}Z</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>
${cover ? `<item id="cover-image" href="${cover}" media-type="${book.cover!.type}" properties="cover-image"/>\n` : ''}${items.map((c, n) => `<item id="c${n}" href="${c.file}" media-type="application/xhtml+xml"/>`).join('\n')}</manifest>
<spine>${items.map((_, n) => `<itemref idref="c${n}"/>`).join('')}</spine></package>`
  return zip([
    { name: 'mimetype', data: 'application/epub+zip', store: true }, // must be first and uncompressed
    { name: 'META-INF/container.xml', data: `${XML}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>` },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/nav.xhtml', data: nav },
    { name: 'OEBPS/style.css', data: CSS },
    ...(cover ? [{ name: `OEBPS/${cover}`, data: book.cover!.data }] : []),
    ...items.map((c) => ({ name: `OEBPS/${c.file}`, data: c.html })),
  ])
}
