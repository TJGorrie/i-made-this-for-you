// Inline [[Title|id]] link to another entity, inserted by typing @. Without this node TipTap escapes the brackets and breaks links.
import { Node } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion'
import { linkText } from './api.ts'

export type LinkTarget = { id: string; title: string; type: string; aliases: string[] }
// A menu entry: the target, and the name it's inserted as (its title or one of its aliases).
type Match = LinkTarget & { as: string }

export const WikiLink = Node.create<{ targets: () => LinkTarget[] }>({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  addOptions: () => ({ targets: () => [] }),
  addAttributes: () => ({ id: { default: '' }, title: { default: '' } }),
  parseHTML: () => [{ tag: 'span[data-wiki-link]' }],
  // Show and save the entity's current title (or the alias the link was written as), so renames propagate wherever the link is next saved.
  renderHTML({ node }) {
    return ['span', { 'data-wiki-link': node.attrs.id, class: 'wiki-link' }, currentTitle(this.options, node.attrs)]
  },
  markdownTokenizer: {
    name: 'wikiLink',
    level: 'inline',
    start: (src) => src.indexOf('[['),
    tokenize(src) {
      const m = /^\[\[([^\]|]*)\|([^\]]+)\]\]/.exec(src)
      if (m) return { type: 'wikiLink', raw: m[0], title: m[1], id: m[2] }
    },
  },
  parseMarkdown: (token) => ({ type: 'wikiLink', attrs: { title: token.title, id: token.id } }),
  renderMarkdown(node) {
    const title = currentTitle(this.options, node.attrs ?? {}).replace(/[\]|]/g, '')
    return `[[${title}|${node.attrs?.id}]]`
  },
  addProseMirrorPlugins() {
    return [
      Suggestion<Match>({
        editor: this.editor,
        char: '@',
        allowSpaces: true,
        pluginKey: new PluginKey('wikiLinkSuggest'),
        items: ({ query }) => {
          const q = query.toLowerCase()
          const has = (name: string) => name.toLowerCase().includes(q)
          return this.options.targets().flatMap((t) => [
            ...(has(t.title) ? [{ ...t, as: t.title }] : []),
            ...(q ? t.aliases.filter(has).map((a) => ({ ...t, as: a })) : []), // aliases only once something is typed
          ]).slice(0, 8)
        },
        command: ({ editor, range, props }) =>
          editor.chain().focus().insertContentAt(range, [
            { type: 'wikiLink', attrs: { id: props.id, title: props.as } },
            { type: 'text', text: ' ' },
          ]).run(),
        render: menu,
      }),
    ]
  },
})

function currentTitle(o: { targets: () => LinkTarget[] }, a: Record<string, string>) {
  const t = o.targets().find((t) => t.id === a.id)
  return t ? linkText(a.title, t.title, t.aliases) : a.title
}

// Dropdown of matching entities under the cursor. Arrow keys move, Enter/Tab pick, Escape closes.
function menu() {
  const el = document.createElement('div')
  el.className = 'suggest'
  let props: SuggestionProps<Match>
  let index = 0
  const draw = () => {
    index = Math.min(index, Math.max(props.items.length - 1, 0))
    el.replaceChildren(...props.items.map((t, i) => {
      const b = document.createElement('button')
      b.className = i === index ? 'active' : ''
      b.append(t.as === t.title ? t.title : `${t.as} → ${t.title}`, Object.assign(document.createElement('small'), { textContent: t.type }))
      b.onmousedown = (e) => { e.preventDefault(); props.command(t) }
      return b
    }))
    el.hidden = !props.items.length
    const r = props.clientRect?.()
    if (r) Object.assign(el.style, { left: `${r.left}px`, top: `${r.bottom + 4}px` })
  }
  return {
    onStart: (p: SuggestionProps<Match>) => { props = p; index = 0; document.body.append(el); draw() },
    onUpdate: (p: SuggestionProps<Match>) => { props = p; draw() },
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      const n = props.items.length
      if (!n || el.hidden) return false
      if (event.key === 'ArrowDown') index = (index + 1) % n
      else if (event.key === 'ArrowUp') index = (index + n - 1) % n
      else if (event.key === 'Enter' || event.key === 'Tab') { props.command(props.items[index]); return true }
      else return false
      draw()
      return true
    },
    onExit: () => el.remove(),
  }
}
