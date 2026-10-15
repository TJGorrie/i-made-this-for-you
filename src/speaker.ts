// Dialogue tagged with who says it, saved as {%the line%}{@[[Name|id]]} (SPEAKER in api.ts).
// The name is saved as the speaker's current title (or the alias it was tagged as), like @-links, so renames propagate.
import { Mark } from '@tiptap/core'
import { currentTitle, type LinkTarget } from './wikiLink.ts'

export const Speaker = Mark.create<{ targets: () => LinkTarget[] }>({
  name: 'speaker',
  inclusive: false, // typing after a tagged line doesn't extend it
  addOptions: () => ({ targets: () => [] }),
  addAttributes: () => ({ id: { default: '' }, title: { default: '' } }),
  parseHTML: () => [{
    tag: 'span[data-speaker]',
    getAttrs: (el) => ({ id: (el as HTMLElement).dataset.speaker, title: (el as HTMLElement).title }),
  }],
  renderHTML({ mark }) {
    return ['span', { 'data-speaker': mark.attrs.id, title: currentTitle(this.options, mark.attrs), class: 'speaker' }, 0]
  },
  markdownTokenizer: {
    name: 'speaker',
    level: 'inline',
    start: (src) => src.indexOf('{%'),
    tokenize(src, _tokens, lexer) {
      const m = /^\{%([\s\S]+?)%\}\{@\[\[([^\]|]*)\|([^\]]+)\]\]\}/.exec(src)
      if (m) return { type: 'speaker', raw: m[0], title: m[2], id: m[3], tokens: lexer.inlineTokens(m[1]) }
    },
  },
  parseMarkdown: (token, h) => h.applyMark('speaker', h.parseInline(token.tokens ?? []), { id: token.id, title: token.title }),
  renderMarkdown(node, h) {
    const title = currentTitle(this.options, node.attrs ?? {}).replace(/[\]|]/g, '')
    return `{%${h.renderChildren(node)}%}{@[[${title}|${node.attrs?.id}]]}`
  },
})
