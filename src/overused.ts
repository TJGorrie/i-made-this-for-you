// Highlight crutch words and -ly adverbs in the text (the ones Prose stats counts), with a tooltip saying why.
// Marks are always computed but only shown when .app.highlight is set, so toggling never re-creates the editor.
import { Extension } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { overusedRanges } from './prose.ts'

function marks(doc: Node) {
  const out: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.isText) for (const r of overusedRanges(node.text!)) out.push(Decoration.inline(pos + r.from, pos + r.to, { class: 'overused', title: r.why }))
  })
  return DecorationSet.create(doc, out)
}

export const Overused = Extension.create({
  name: 'overused',
  addProseMirrorPlugins: () => [new Plugin({
    state: {
      init: (_, state) => marks(state.doc),
      apply: (tr, old) => (tr.docChanged ? marks(tr.doc) : old),
    },
    props: { decorations(state) { return this.getState(state) } },
  })],
})
