// Inline comment on a stretch of text, saved as CriticMarkup: {==commented text==}{>>the note<<}.
// A ticked-off comment keeps its mark with a [x] prefix on the note ({>>[x] the note<<}), so it can be re-opened.
// ponytail: an @-link inside a commented stretch falls outside the comment on save (text kept); fine for notes.
import { Mark } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { parseNote } from './api.ts'

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
  parseMarkdown: (token, h) => h.applyMark('comment', h.parseInline(token.tokens ?? []), { note: token.note, done: token.done }),
  renderMarkdown: (node, h) =>
    `{==${h.renderChildren(node)}==}{>>${node.attrs?.done ? '[x] ' : ''}${String(node.attrs?.note ?? '').replace(/<</g, '‹‹')}<<}`,
})

// The doc's comments in order, as ranges (the nth one is the nth {==…==} in the saved Markdown).
export type CommentRange = { from: number; to: number; text: string; note: string; done: boolean }
export function commentRanges(doc: Node): CommentRange[] {
  const out: CommentRange[] = []
  doc.descendants((node, pos) => {
    const m = node.marks.find((m) => m.type.name === 'comment')
    if (!m) return
    const last = out.at(-1)
    if (last && last.to === pos && last.note === m.attrs.note && last.done === m.attrs.done) last.to = pos + node.nodeSize
    else out.push({ from: pos, to: pos + node.nodeSize, text: '', note: m.attrs.note, done: m.attrs.done })
  })
  for (const r of out) r.text = doc.textBetween(r.from, r.to, ' ')
  return out
}
