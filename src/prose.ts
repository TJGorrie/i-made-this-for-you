// Prose statistics for a whole book: sentence length, dialogue share, and the words and phrases you lean on.
// English-centric (stop words, -ly adverbs); the counts themselves work for any language.

const STOP = new Set(`a about after again all also am an and any are as at back be been before being but by can could did do
does down even ever for from get go got had has have he her here hers him his how i if in into is it its just like me more
most my no not now of off on one only or other our out over said say says she so some still than that the their them then
there these they this those through to too up upon very was we were what when where which while who why will with would
you your yours don't didn't i'm it's he's she's can't won't wasn't couldn't`.split(/\s+/))

// Words writers are often told to cut. Counted wherever they appear.
export const CRUTCHES = ['just', 'really', 'very', 'suddenly', 'actually', 'quite', 'somehow', 'seemed', 'felt', 'started to', 'began to', 'that']

// -ly words that aren't adverbs.
const NOT_ADVERBS = new Set(['only', 'family', 'early', 'reply', 'holy', 'ugly', 'belly', 'jelly', 'lily', 'silly', 'friendly', 'lonely', 'likely', 'daily', 'supply', 'apply', 'rely', 'italy', 'emily', 'sally', 'bully', 'fly', 'july'])

export type Count = [text: string, n: number]
export type ProseStats = {
  words: number; sentences: number; avgSentence: number; longestSentence: number; dialogue: number // % of words inside quotes
  syllables: number; flesch: number // Flesch reading ease (English)
  topWords: Count[]; phrases: Count[]; adverbs: Count[]; crutches: Count[]
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu
export const wordsOf = (s: string) => (s.match(WORD) ?? []).map((w) => w.toLowerCase().replace(/’/g, "'"))
export const isAdverb = (w: string) => w.length > 4 && w.endsWith('ly') && !NOT_ADVERBS.has(w)
// Words inside quotation marks (straight quotes within a line, or curly quotes).
export const dialogueWords = (text: string) => (text.match(/“[^”]*”|"[^"\n]*"/g) ?? []).reduce((n, q) => n + wordsOf(q).length, 0)
// Markdown → prose for counting: headings and scene breaks dropped, emphasis marks and escapes removed.
export const proseText = (md: string) => md.split('\n').filter((l) => !/^#|^\s*(\*\s*){3}$/.test(l)).join('\n')
  .replace(/[*_`>~]+/g, ' ').replace(/\\(.)/g, '$1')

// improvement: English syllables by vowel groups (a silent final "e" dropped, "-le" kept); off by one on words like "created".
export function syllablesOf(word: string) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  const core = /[^aeiouy]le$/.test(w) ? w : w.replace(/e$/, '')
  return Math.max(1, core.match(/[aeiouy]+/g)?.length ?? 0)
}
export const flesch = (words: number, sentences: number, syllables: number) =>
  words && sentences ? 206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words) : 0

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

// Words to look at again while writing: crutch words and -ly adverbs, as ranges in `text`.
const CRUTCH_WORDS = new Set(CRUTCHES.filter((c) => !c.includes(' ')))
export function overusedRanges(text: string) {
  const out: { from: number; to: number; why: string }[] = []
  for (const m of text.matchAll(WORD)) {
    const w = m[0].toLowerCase().replace(/’/g, "'")
    const why = CRUTCH_WORDS.has(w) ? 'often cut in revision' : isAdverb(w) ? '-ly adverb' : ''
    if (why) out.push({ from: m.index, to: m.index + m[0].length, why })
  }
  for (const m of text.matchAll(/(?<![\p{L}\p{N}])(?:started|began) to(?![\p{L}\p{N}])/giu))
    out.push({ from: m.index, to: m.index + m[0].length, why: 'often cut in revision' })
  return out.sort((a, b) => a.from - b.from)
}
const top = (m: Map<string, number>, n: number, min = 2): Count[] =>
  [...m].filter(([, c]) => c >= min).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n)
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

// md: the compiled book (headings are titles, `* * *` scene breaks), as /compile?format=md returns it.
export function proseStats(md: string): ProseStats {
  const text = proseText(md)
  const all = wordsOf(text)
  const sentences = text.split(/[.!?…]+["”’)]*(?=\s|$)|\n\s*\n/).map(wordsOf).filter((s) => s.length)
  const quoted = dialogueWords(text)
  const syllables = all.reduce((n, w) => n + syllablesOf(w), 0)

  const freq = new Map<string, number>()
  const adverbs = new Map<string, number>()
  for (const w of all) {
    if (!STOP.has(w) && w.length > 2 && !/^\d+$/.test(w)) bump(freq, w)
    if (isAdverb(w)) bump(adverbs, w)
  }
  // Three-word phrases within a sentence, skipping ones made only of stop words ("and then the").
  const phrases = new Map<string, number>()
  for (const s of sentences)
    for (let i = 0; i + 3 <= s.length; i++)
      if (!s.slice(i, i + 3).every((w) => STOP.has(w))) bump(phrases, s.slice(i, i + 3).join(' '))
  const joined = ` ${all.join(' ')} `
  const crutches: Count[] = CRUTCHES.map((c) => [c, joined.match(new RegExp(`(?<= )${c}(?= )`, 'g'))?.length ?? 0] as Count).filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])

  return {
    words: all.length,
    sentences: sentences.length,
    avgSentence: sentences.length ? all.length / sentences.length : 0,
    longestSentence: Math.max(0, ...sentences.map((s) => s.length)),
    dialogue: all.length ? Math.round((quoted / all.length) * 100) : 0,
    syllables,
    flesch: flesch(all.length, sentences.length, syllables),
    topWords: top(freq, 30),
    phrases: top(phrases, 15, 3),
    adverbs: top(adverbs, 20),
    crutches,
  }
}
