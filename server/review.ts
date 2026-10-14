// Review items: inline comments in the body ({==text==}{>>note<<}) plus whole-entity notes (`review` frontmatter).
import { parseNote, plainText, reviewNotes } from '../src/api.ts'
import type { Entity } from './store.ts'

export const CRITIC = /\{==([\s\S]+?)==\}\{>>([\s\S]*?)<<\}/g

export type ReviewItem = { kind: 'passage' | 'note'; index: number; text?: string; note: string; done: boolean }

export const reviewItems = (e: Entity): ReviewItem[] => [
  ...[...(e.body ?? '').matchAll(CRITIC)].map((m, index) => ({ kind: 'passage' as const, index, text: plainText(m[1]), ...parseNote(m[2]) })),
  ...reviewNotes(e.review).map((n, index) => ({ kind: 'note' as const, index, ...n })),
]

// Tick off (or re-open) or remove the nth inline comment; removing keeps the text. null if there's no nth comment.
export function setInline(body: string, index: number, { done, remove }: { done?: boolean; remove?: boolean }) {
  let n = 0
  let found = false
  const out = body.replace(CRITIC, (all, text: string, raw: string) => {
    if (n++ !== index) return all
    found = true
    return remove ? text : `{==${text}==}{>>${done ? '[x] ' : ''}${parseNote(raw).note}<<}`
  })
  return found ? out : null
}
