// Text tagged with an entry, saved as Markdown the app parses (SPEAKER / DESCRIBED in api.ts):
//   Speaker:   dialogue tagged with who says it, {%the line%}{@[[Name|id]]}
//   Described: text describing a property of an entry ("grey eyes" → Ana's eyes), {^grey eyes^}{#[[Name|id]]:eyes}
// The name is saved as the entry's current title (or the alias it was tagged as), like @-links, so renames propagate.
import { Mark, type Editor, type JSONContent } from '@tiptap/core'
import { currentTitle, type LinkTarget } from './wikiLink.ts'
import { DESCRIBED, SPEAKER } from './api.ts'

function taggedMark(name: string, pattern: RegExp, open: string, close: string, hasProp: boolean) {
  const re = new RegExp('^' + pattern.source)
  const prop = (attrs: Record<string, any>) => (hasProp ? `:${String(attrs.prop ?? '').replace(/[}\n]/g, '')}` : '')
  return Mark.create<{ targets: () => LinkTarget[] }>({
    name,
    inclusive: false, // typing after tagged text doesn't extend it
    addOptions: () => ({ targets: () => [] }),
    addAttributes: () => ({ id: { default: '' }, title: { default: '' }, prop: { default: '' } }), // prop: Described only
    parseHTML: () => [{
      tag: `span[data-${name}]`,
      getAttrs: (el) => {
        const d = (el as HTMLElement).dataset
        return { id: d[name], title: d.title, prop: d.prop ?? '' }
      },
    }],
    renderHTML({ mark }) {
      const title = currentTitle(this.options, mark.attrs)
      return ['span', { [`data-${name}`]: mark.attrs.id, 'data-title': title, 'data-prop': mark.attrs.prop,
        title: hasProp ? `${title}: ${mark.attrs.prop}` : title, class: name }, 0]
    },
    markdownTokenizer: {
      name,
      level: 'inline',
      start: (src) => src.indexOf(open),
      tokenize(src, _tokens, lexer) {
        const m = re.exec(src)
        if (m) return { type: name, raw: m[0], title: m[2], id: m[3], prop: m[4], tokens: lexer.inlineTokens(m[1]) }
      },
    },
    parseMarkdown: (token, h) =>
      markInline(h.parseInline(token.tokens ?? []), name, { id: token.id, title: token.title, prop: token.prop ?? '' }),
    renderMarkdown(node, h) {
      const title = currentTitle(this.options, node.attrs ?? {}).replace(/[\]|]/g, '')
      return `${open}${h.renderChildren(node)}${close}[[${title}|${node.attrs?.id}]]${prop(node.attrs ?? {})}}`
    },
  })
}

// The Markdown library only marks text on load, and on save splits a mark around an @-link inside it (or, when the
// mark ends on the link, wraps the text after it). So links get the mark on load, and are saved as placeholder text
// carrying their marks, swapped back for the link afterwards.
export const markInline = (content: JSONContent[], type: string, attrs: Record<string, unknown>) =>
  content.map((n) => (n.type === 'text' || n.type === 'wikiLink' ? { ...n, marks: [...(n.marks ?? []), { type, attrs }] } : n))

export function toMarkdown(editor: Editor) {
  const md = editor.markdown!
  const links: string[] = []
  const flat = (n: JSONContent): JSONContent => n.type === 'wikiLink'
    ? { type: 'text', text: `${links.push(md.renderNodes(n)) - 1}`, marks: n.marks }
    : n.content ? { ...n, content: n.content.map(flat) } : n
  return md.serialize(flat(editor.getJSON())).replace(/(\d+)/g, (_, i) => links[+i])
}

export const Speaker = taggedMark('speaker', SPEAKER, '{%', '%}{@', false)
export const Described = taggedMark('described', DESCRIBED, '{^', '^}{#', true)
