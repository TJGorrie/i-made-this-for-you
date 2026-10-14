// Focus mode helpers: the paragraph with the cursor gets class "current" (CSS dims the rest when .app.dim),
// and with .app.typewriter every cursor move scrolls the caret to the middle of the screen.
// Both read the toggles from the page's classes, so the editor never needs re-creating when they change.
import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const Focus = Extension.create({
  name: 'focus',
  addProseMirrorPlugins: () => [new Plugin({
    props: {
      decorations(state) {
        const { $head } = state.selection
        if ($head.depth < 1) return null
        const at = $head.before(1)
        return DecorationSet.create(state.doc, [Decoration.node(at, at + $head.node(1).nodeSize, { class: 'current' })])
      },
    },
    view: () => ({
      update(view, prev) {
        if (prev.selection.eq(view.state.selection) && prev.doc.eq(view.state.doc)) return
        if (!view.hasFocus() || !view.dom.closest('.app.focus.typewriter')) return
        const pane = view.dom.closest<HTMLElement>('.pane')
        const top = view.coordsAtPos(view.state.selection.head).top - innerHeight / 2
        // The pane scrolls on wide screens; on phones the page does.
        ;(pane && pane.scrollHeight > pane.clientHeight ? pane : window).scrollBy({ top })
      },
    }),
  })],
})
