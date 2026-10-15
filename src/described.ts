// Text describing a property of an entry ("grey eyes" → Ana's eyes), saved as {^grey eyes^}{#[[Name|id]]:eyes} (DESCRIBED in api.ts).
// The entry lists its descriptions from the text, so editing the passage updates it. The name follows renames, like speaker.ts.
import { Mark } from '@tiptap/core'
import { currentTitle, type LinkTarget } from './wikiLink.ts'

export const Described = Mark.create<{ targets: () => LinkTarget[] }>({
  name: 'described',
  inclusive: false,
  addOptions: () => ({ targets: () => [] }),
  addAttributes: () => ({ id: { default: '' }, title: { default: '' }, prop: { default: '' } }),
  parseHTML: () => [{
    tag: 'span[data-described]',
    getAttrs: (el) => ({ id: (el as HTMLElement).dataset.described, title: (el as HTMLElement).dataset.title, prop: (el as HTMLElement).dataset.prop }),
  }],
  renderHTML({ mark }) {
    const title = currentTitle(this.options, mark.attrs)
    return ['span', { 'data-described': mark.attrs.id, 'data-title': title, 'data-prop': mark.attrs.prop, title: `${title}: ${mark.attrs.prop}`, class: 'described' }, 0]
  },
  markdownTokenizer: {
    name: 'described',
    level: 'inline',
    start: (src) => src.indexOf('{^'),
    tokenize(src, _tokens, lexer) {
      const m = /^\{\^([\s\S]+?)\^\}\{#\[\[([^\]|]*)\|([^\]]+)\]\]:([^}]*)\}/.exec(src)
      if (m) return { type: 'described', raw: m[0], title: m[2], id: m[3], prop: m[4], tokens: lexer.inlineTokens(m[1]) }
    },
  },
  parseMarkdown: (token, h) => h.applyMark('described', h.parseInline(token.tokens ?? []), { id: token.id, title: token.title, prop: token.prop }),
  renderMarkdown(node, h) {
    const title = currentTitle(this.options, node.attrs ?? {}).replace(/[\]|]/g, '')
    return `{^${h.renderChildren(node)}^}{#[[${title}|${node.attrs?.id}]]:${String(node.attrs?.prop ?? '').replace(/[}\n]/g, '')}}`
  },
})
