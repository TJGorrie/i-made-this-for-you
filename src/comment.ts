// Inline comment on a stretch of text, saved as CriticMarkup: {==commented text==}{>>the note<<}.
// A ticked-off comment keeps its mark with a [x] prefix on the note ({>>[x] the note<<}), so it can be re-opened.
import { Mark } from '@tiptap/core'
import type { Mark as PMMark, Node } from '@tiptap/pm/model'
import { parseNote } from './api.ts'
import { markInline } from './tags.ts'

export const Comment = Mark.create({
  name: 'comment',
  inclusive: false, // typing at the edge of a comment doesn't extend it
  addAttributes: () => ({ note: { default: '' }, done: { default: false } }),
  parseHTML: () => [{
    tag: 'span[data-comment]',
    getAttrs: (el) => ({ note: (el as HTMLElement).dataset.comment, done: 'done' in (el as HTMLElement).dataset }),
  }],
  renderHTML: ({ mark }) =>
    ['span', { 'data-comment': mark.attrs.note, 'data-done': mark.attrs.done ? '' : null, title: mark.attrs.note, class: 'comment' }, 0],
  markdownTokenizer: {
    name: 'comment',
    level: 'inline',
    start: (src) => src.indexOf('{=='),
    tokenize(src, _tokens, lexer) {
      const m = /^\{==([\s\S]+?)==\}\{>>([\s\S]*?)<<\}/.exec(src)
      if (m) return { type: 'comment', raw: m[0], ...parseNote(m[2]), tokens: lexer.inlineTokens(m[1]) }
    },
  },
  parseMarkdown: (token, h) => markInline(h.parseInline(token.tokens ?? []), 'comment', { note: token.note, done: token.done }),
  renderMarkdown: (node, h) =>
    `{==${h.renderChildren(node)}==}{>>${node.attrs?.done ? '[x] ' : ''}${String(node.attrs?.note ?? '').replace(/<</g, '‹‹')}<<}`,
})

// The doc's comments in order, as ranges (the nth one is the nth {==…==} in the saved Markdown).
export type CommentRange = { from: number; to: number; text: string; note: string; done: boolean }
export const commentRanges = (doc: Node): CommentRange[] =>
  markRanges(doc, 'comment').map((r) => ({ ...r, note: r.attrs.note, done: r.attrs.done }))

// Stretches of text carrying a mark (comment, described…), in order; the nth is the nth in the saved Markdown.
export function markRanges(doc: Node, name: string) {
  const out: { from: number; to: number; text: string; attrs: Record<string, any>; mark: PMMark }[] = []
  doc.descendants((node, pos) => {
    const m = node.marks.find((m) => m.type.name === name)
    if (!m) return
    const last = out.at(-1)
    if (last && last.to === pos && last.mark.eq(m)) last.to = pos + node.nodeSize
    else out.push({ from: pos, to: pos + node.nodeSize, text: '', attrs: m.attrs, mark: m })
  })
  for (const r of out) r.text = doc.textBetween(r.from, r.to, ' ')
  return out
}
