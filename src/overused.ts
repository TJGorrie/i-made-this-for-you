// Highlight words to check and -ly adverbs (the ones Prose stats counts), and quotes not yet tagged with a speaker.
// Marks are always computed but only shown when .app.highlight-words / .app.highlight-dialogue is set,
// so switching never re-creates the editor.
import { Extension } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { DEFAULT_WORDS, overusedRanges, quoteRanges, type WordLists } from './prose.ts'

function marks(doc: Node, words: WordLists) {
  const out: Decoration[] = []
  const speaker = doc.type.schema.marks.speaker
  doc.descendants((block, pos) => {
    if (!block.isTextblock) return true
    // The paragraph's text, one character per position: inline nodes (links, line breaks) stand in as one character.
    let text = ''
    block.forEach((child) => { text += child.isText ? child.text! : child.type.name === 'hardBreak' ? '\n' : '￼'.repeat(child.nodeSize) })
    const at = pos + 1
    for (const r of overusedRanges(text, words)) out.push(Decoration.inline(at + r.from, at + r.to, { class: 'overused', title: r.why }))
    for (const r of quoteRanges(text))
      if (!speaker || !doc.rangeHasMark(at + r.from, at + r.to, speaker))
        out.push(Decoration.inline(at + r.from, at + r.to, { class: 'untagged', title: 'No speaker tagged' }))
    return false
  })
  return DecorationSet.create(doc, out)
}

export const Overused = Extension.create<{ words: () => WordLists }>({
  name: 'overused',
  addOptions: () => ({ words: () => DEFAULT_WORDS }),
  addProseMirrorPlugins() {
    const words = this.options.words
    return [new Plugin({
      state: {
        init: (_, state) => marks(state.doc, words()),
        // Tagging a speaker changes marks only, which is still a doc change.
        apply: (tr, old) => (tr.docChanged ? marks(tr.doc, words()) : old),
      },
      props: { decorations(state) { return this.getState(state) } },
    })]
  },
})
