// A "?" that shows how a view works on hover, or on keyboard focus (Tab to it; Esc or Tab away to close).
import { useEffect, useRef, type ReactNode } from 'react'

export const Help = ({ children }: { children: ReactNode }) => (
  <span className="help" tabIndex={0}>
    <span aria-hidden="true">?</span>
    <span className="help-text" role="tooltip">{children}</span>
  </span>
)

const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'
const SHORTCUTS: [keys: string, what: string][] = [
  ['@', 'Link a character, place or other entry while writing'],
  [`${mod}+B / ${mod}+I`, 'Bold / italic'],
  [`${mod}+Z / ${mod}+Shift+Z`, 'Undo / redo'],
  [`${mod}+K`, 'Search everything'],
  ['Shift+click', 'Open an entry beside the one you have open'],
  [`${mod}+click a link`, 'Open the linked entry'],
  ['Enter / Esc', 'Save / cancel a comment or note'],
  ['Esc', 'Leave focus mode'],
  ['?', 'Show this list'],
]

// Keyboard shortcuts sheet: a native modal dialog (Esc closes it).
export function Shortcuts({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (open) ref.current?.showModal(); else ref.current?.close() }, [open])
  return (
    <dialog ref={ref} className="shortcuts" aria-label="Keyboard shortcuts" onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose() /* click on the backdrop */}>
      <h3>Keyboard shortcuts</h3>
      <table>
        <tbody>{SHORTCUTS.map(([k, w]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{w}</td></tr>)}</tbody>
      </table>
      <p><button onClick={onClose}>Close</button></p>
    </dialog>
  )
}
