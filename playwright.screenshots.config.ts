// `npm run screenshots`: the README's pictures (docs/screenshots.spec.ts), kept out of the normal test run.
import base from './playwright.config.ts'

export default { ...base, testDir: 'docs' }
