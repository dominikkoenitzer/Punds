// Every address the page links to, in the order the plaques hang on the rack.
// The domains move to their vercel.app addresses before the old ones lapse, so
// this file is the only place that needs to change when they do.

export interface Link {
  name: string
  href: string
}

export const LINKS: readonly Link[] = [
  { name: 'Portfolio', href: 'https://dk.punds.ch' },
  { name: 'GitHub', href: 'https://github.com/dominikkoenitzer' },
  { name: 'Senbon', href: 'https://senbon.punds.ch/' },
]
