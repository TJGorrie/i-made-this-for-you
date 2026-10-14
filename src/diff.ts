// Word-level diff for comparing an old version with the current text.
export type Part = { op: '=' | '-' | '+'; text: string }

// improvement: plain LCS table; above ~4M cells (two very different 2,000-word middles) it shows the changed middle
// as one removal plus one addition instead. Myers' algorithm if people compare whole rewritten chapters.
const MAX_CELLS = 4_000_000

export function diffWords(a: string, b: string): Part[] {
  const x = a.split(/(\s+)/).filter(Boolean)
  const y = b.split(/(\s+)/).filter(Boolean)
  let pre = 0
  while (pre < x.length && pre < y.length && x[pre] === y[pre]) pre++
  let suf = 0
  while (suf < x.length - pre && suf < y.length - pre && x[x.length - 1 - suf] === y[y.length - 1 - suf]) suf++
  const xs = x.slice(pre, x.length - suf)
  const ys = y.slice(pre, y.length - suf)
  const parts: Part[] = []
  const push = (op: Part['op'], text: string) => {
    const last = parts.at(-1)
    if (last?.op === op) last.text += text
    else if (text) parts.push({ op, text })
  }
  push('=', x.slice(0, pre).join(''))
  if ((xs.length + 1) * (ys.length + 1) > MAX_CELLS) {
    push('-', xs.join(''))
    push('+', ys.join(''))
  } else {
    // lcs[i][j]: longest common run of xs[i..] and ys[j..], flattened.
    const w = ys.length + 1
    const lcs = new Uint32Array((xs.length + 1) * w)
    for (let i = xs.length - 1; i >= 0; i--)
      for (let j = ys.length - 1; j >= 0; j--)
        lcs[i * w + j] = xs[i] === ys[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1])
    let i = 0, j = 0
    while (i < xs.length || j < ys.length) {
      if (i < xs.length && j < ys.length && xs[i] === ys[j]) { push('=', xs[i]); i++; j++ }
      // Ties go to the removal, so a replaced word reads "old" then "new".
      else if (i < xs.length && (j === ys.length || lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) push('-', xs[i++])
      else push('+', ys[j++])
    }
  }
  push('=', x.slice(x.length - suf).join(''))
  return parts
}
