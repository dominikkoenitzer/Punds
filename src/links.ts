// Every address the page links to, in the order the plaques hang on the rack.
// The sites sit on punds.ch subdomains, so this file is the one place to change when they move.

export interface Link {
  name: string
  href: string
}

export const LINKS: readonly Link[] = [
  { name: 'Portfolio', href: 'https://dk.punds.ch' },
  { name: 'GitHub', href: 'https://github.com/dominikkoenitzer' },
  { name: 'Senbon', href: 'https://senbon.punds.ch/' },
]
