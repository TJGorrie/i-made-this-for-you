// Prose statistics for a whole book: the words and phrases you lean on, plus the dialogue helpers.
// English-centric (stop words, -ly adverbs); the counts themselves work for any language.

const STOP = new Set(`a about after again all also am an and any are as at back be been before being but by can could did do
does down even ever for from get go got had has have he her here hers him his how i if in into is it its just like me more
most my no not now of off on one only or other our out over said say says she so some still than that the their them then
there these they this those through to too up upon very was we were what when where which while who why will with would
you your yours don't didn't i'm it's he's she's can't won't wasn't couldn't`.split(/\s+/))

// Words writers are often told to cut: the default "words to check", which each project can edit (project.json `words`).
export const CRUTCHES = ['just', 'really', 'very', 'suddenly', 'actually', 'quite', 'somehow', 'seemed', 'felt', 'started to', 'began to']
export type WordLists = { check: string[]; notAdverbs: string[] } // notAdverbs: extra -ly words never to flag (names, invented words)
export const DEFAULT_WORDS: WordLists = { check: CRUTCHES, notAdverbs: [] }

// -ly words that aren't adverbs: adjectives (lovely, elderly, costly), nouns (family, belly) and verbs (reply, supply).
// improvement: a fixed list, not a dictionary; rarer -ly adjectives still get flagged until added to the project's notAdverbs.
const NOT_ADVERBS = new Set(`only family early reply holy ugly belly jelly silly friendly lonely likely daily supply apply rely
italy july fly ally lovely elderly costly deadly lively weekly monthly yearly butterfly assembly`.split(/\s+/))

export type Count = [text: string, n: number]
export type ProseStats = {
  words: number
  topWords: Count[]; phrases: Count[]; adverbs: Count[]; crutches: Count[]
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu
export const wordsOf = (s: string) => (s.match(WORD) ?? []).map((w) => w.toLowerCase().replace(/’/g, "'"))
export const isAdverb = (w: string, notAdverbs: string[] = []) =>
  w.length > 4 && w.endsWith('ly') && !NOT_ADVERBS.has(w) && !notAdverbs.some((n) => n.toLowerCase() === w)
// The words-to-check list as one whole-word, any-case pattern; a phrase matches across any spacing ("began  to").
const checkPattern = (check: string[]) => {
  const alts = check.map((c) => c.trim()).filter(Boolean).sort((a, b) => b.length - a.length)
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
  return alts.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join('|')})(?![\\p{L}\\p{N}'’-])`, 'giu') : null
}
// Markdown → prose for counting: headings and scene breaks dropped, emphasis marks and escapes removed.
const proseText = (md: string) => md.split('\n').filter((l) => !/^#|^\s*(\*\s*){3}$/.test(l)).join('\n')
  .replace(/[*_`>~]+/g, ' ').replace(/\\(.)/g, '$1')

// Where the book's running word count crosses a quarter, half and three quarters: the scene it happens in.
export type Beat = '¼' | 'Midpoint' | '¾'
export function beats(scenes: { id: string; words: number }[]) {
  const total = scenes.reduce((n, s) => n + s.words, 0)
  const out: { sceneId: string; beat: Beat }[] = []
  if (!total) return out
  const marks: [number, Beat][] = [[0.25, '¼'], [0.5, 'Midpoint'], [0.75, '¾']]
  let sum = 0
  for (const s of scenes) {
    if (!s.words) continue
    sum += s.words
    while (marks.length && sum >= marks[0][0] * total) out.push({ sceneId: s.id, beat: marks.shift()![1] })
  }
  return out
}

// Words to look at again while writing: the words-to-check list and -ly adverbs, as ranges in `text`.
export function overusedRanges(text: string, words: WordLists = DEFAULT_WORDS) {
  const out: { from: number; to: number; why: string }[] = []
  const re = checkPattern(words.check)
  if (re) for (const m of text.matchAll(re)) out.push({ from: m.index, to: m.index + m[0].length, why: 'on your words-to-check list' })
  const checked = (at: number) => out.some((r) => r.from <= at && at < r.to)
  for (const m of text.matchAll(WORD))
    if (!checked(m.index) && isAdverb(m[0].toLowerCase(), words.notAdverbs)) out.push({ from: m.index, to: m.index + m[0].length, why: '-ly adverb' })
  return out.sort((a, b) => a.from - b.from)
}

// Quotes in `text` as ranges: straight quotes within a line, or curly quotes.
export const quoteRanges = (text: string) => [...text.matchAll(/“[^”]*”|"[^"\n]*"/g)].map((m) => ({ from: m.index, to: m.index + m[0].length }))
const top = (m: Map<string, number>, n: number, min = 2): Count[] =>
  [...m].filter(([, c]) => c >= min).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n)
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

// md: the compiled book (headings are titles, `* * *` scene breaks), as /compile?format=md returns it.
// names: titles and aliases of the project's named things (characters, places), left out of the most used words.
export function proseStats(md: string, words: WordLists = DEFAULT_WORDS, names: string[] = []): ProseStats {
  const text = proseText(md)
  const all = wordsOf(text)
  const sentences = text.split(/[.!?…]+["”’)]*(?=\s|$)|\n\s*\n/).map(wordsOf).filter((s) => s.length)
  // Whole names only ("Old Man Willow" hides that phrase, not every "old"), possessives included.
  const named = checkPattern(names.flatMap((n) => [n, `${n}'s`, `${n}’s`]))

  const freq = new Map<string, number>()
  const adverbs = new Map<string, number>()
  for (const w of named ? wordsOf(text.replace(named, ' ')) : all)
    if (!STOP.has(w) && w.length > 2 && !/^\d+$/.test(w)) bump(freq, w)
  for (const w of all) if (isAdverb(w, words.notAdverbs)) bump(adverbs, w)
  // Three-word phrases within a sentence, skipping ones made only of stop words ("and then the").
  const phrases = new Map<string, number>()
  for (const s of sentences)
    for (let i = 0; i + 3 <= s.length; i++)
      if (!s.slice(i, i + 3).every((w) => STOP.has(w))) bump(phrases, s.slice(i, i + 3).join(' '))
  const checks = new Map<string, number>()
  const re = checkPattern(words.check)
  if (re) for (const m of text.matchAll(re)) bump(checks, m[0].toLowerCase().replace(/\s+/g, ' '))
  const crutches = top(checks, 100, 1)

  return {
    words: all.length,
    topWords: top(freq, 30),
    phrases: top(phrases, 15, 3),
    adverbs: top(adverbs, 20),
    crutches,
  }
}
