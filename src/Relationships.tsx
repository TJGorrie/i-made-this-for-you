// Relationship editing (on an entity) and the graph of all relationships.
import { useEffect, useRef, useState } from 'react'
import cytoscape from 'cytoscape'
import type { Relationship, Row } from './api.ts'
import type { LinkTarget } from './wikiLink.ts'

type ListProps = { value: unknown; targets: LinkTarget[]; onChange: (v: Relationship[]) => void }

export function RelationshipList({ value, targets, onChange }: ListProps) {
  const rels = Array.isArray(value) ? (value as Relationship[]) : []
  const update = (i: number, patch: Partial<Relationship>) => onChange(rels.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <section className="relationships">
      <h4>Relationships</h4>
      {rels.map((r, i) => (
        <div key={i} className="rel">
          <input aria-label="Relationship" placeholder="e.g. sister of" value={r.kind} onChange={(e) => update(i, { kind: e.target.value })} />
          <select aria-label="Related to" value={r.to} onChange={(e) => update(i, { to: e.target.value })}>
            {!targets.some((t) => t.id === r.to) && <option value={r.to}>(missing)</option>}
            {targets.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
          <button className="mini" title="Remove relationship" onClick={() => onChange(rels.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      {targets.length > 0 && (
        <button className="mini" onClick={() => onChange([...rels, { kind: '', to: targets[0].id }])}>+ relationship</button>
      )}
    </section>
  )
}

// The canvas can't use CSS variables, so resolve the theme colour (light-dark() included) through an element.
function css(name: string) {
  const probe = document.body.appendChild(Object.assign(document.createElement('i'), { style: `color: var(${name})` }))
  const color = getComputedStyle(probe).color
  probe.remove()
  return color
}

const TYPE_COLORS: Record<string, string> = {
  character: '#4e79a7', location: '#59a14f', faction: '#e15759', item: '#f28e2b', lore: '#b07aa1', event: '#76b7b2',
}

export function Graph({ rows, onOpen }: { rows: Row[]; onOpen: (id: string) => void }) {
  const el = useRef<HTMLDivElement>(null)
  const [tree, setTree] = useState(false)
  const [only, setOnly] = useState('') // e.g. "parent|child|married" for a family tree
  const terms = only.toLowerCase().split('|').map((t) => t.trim()).filter(Boolean)
  const byId = new Map(rows.map((r) => [r.id, r]))
  const edges = rows.flatMap((r) =>
    (Array.isArray(r.relationships) ? (r.relationships as Relationship[]) : [])
      .filter((rel) => byId.has(rel.to) && (!terms.length || terms.some((t) => rel.kind.toLowerCase().includes(t))))
      .map((rel, i) => ({ data: { id: `${r.id}:${i}`, source: r.id, target: rel.to, label: rel.kind } })),
  )
  // Only entities that take part in a relationship; everything else would just be loose dots.
  const nodes = [...new Set(edges.flatMap((e) => [e.data.source, e.data.target]))].map((id) => {
    const r = byId.get(id)!
    return { data: { id, label: r.title, color: TYPE_COLORS[r.type] ?? '#999' } }
  })

  useEffect(() => {
    if (!el.current || !nodes.length) return
    const cy = cytoscape({
      container: el.current,
      elements: [...nodes, ...edges],
      // Tree: each relationship points downward (A "parent of" B puts A above B).
      layout: tree ? { name: 'breadthfirst', directed: true, spacingFactor: 1.3 } : { name: 'cose', animate: false, nodeRepulsion: () => 8000 },
      style: [
        { selector: 'node', style: { label: 'data(label)', 'background-color': 'data(color)', color: css('--text'), 'font-size': 12, 'text-valign': 'bottom', 'text-margin-y': 4 } },
        { selector: 'edge', style: { label: 'data(label)', 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', width: 1.5, 'line-color': css('--border-2'), 'target-arrow-color': css('--border-2'), 'font-size': 10, color: css('--muted'), 'text-rotation': 'autorotate', 'text-background-color': css('--panel'), 'text-background-opacity': 1 } },
      ],
    })
    cy.on('tap', 'node', (e) => onOpen(e.target.id()))
    return () => cy.destroy()
  }, [JSON.stringify([nodes, edges]), tree]) // re-layout only when the graph itself changes

  return (
    <div className="graph-view">
      <h2>Relationships</h2>
      <p>
        <input aria-label="Only relationships matching" placeholder="Only… e.g. parent|child|married" value={only}
          onChange={(e) => setOnly(e.target.value)} />{' '}
        <label><input type="checkbox" checked={tree} onChange={(e) => setTree(e.target.checked)} /> Tree layout</label>
      </p>
      {nodes.length
        ? <p className="muted">Click a node to open it. Add relationships from any wiki entry.</p>
        : <p className="muted">{only ? 'No relationships match.' : 'No relationships yet. Open a wiki entry and use “+ relationship”.'}</p>}
      <div ref={el} className="graph" data-nodes={nodes.length} data-edges={edges.length} data-layout={tree ? 'tree' : 'web'} />
    </div>
  )
}
