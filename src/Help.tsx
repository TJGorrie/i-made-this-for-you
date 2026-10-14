// A "?" that shows how a view works on hover, or on keyboard focus (Tab to it; Esc or Tab away to close).
import type { ReactNode } from 'react'

export const Help = ({ children }: { children: ReactNode }) => (
  <span className="help" tabIndex={0}>
    <span aria-hidden="true">?</span>
    <span className="help-text" role="tooltip">{children}</span>
  </span>
)
