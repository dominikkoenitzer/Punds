// The floating NAVI panels carry the operator's access-point links. Each panel
// opens its href when clicked.

export type PanelKind = 'link'

export interface PanelDatum {
  label: string
  lines: string[]
  kind: PanelKind
  href?: string
}

export const PANEL_DATA: PanelDatum[] = [
  // --- access points (clickable links) -------------------------------------
  {
    label: 'PERSONAL_SITE',
    kind: 'link',
    href: 'https://dominikkoenitzer.ch',
    lines: ['/home/web', 'PROTOCOL 7 · L01', '08ms · LINKED', '▸ OPEN'],
  },
  {
    label: 'JOURNAL',
    kind: 'link',
    href: 'https://senbon.ch',
    lines: ['/senbon/journal', 'PROTOCOL 7 · L04', '23ms · LINKED', '▸ OPEN'],
  },
  {
    label: 'REPOSITORY',
    kind: 'link',
    href: 'https://github.com/dominikkoenitzer',
    lines: ['/git/hub', 'PROTOCOL 7 · L09', '41ms · MIRRORED', '▸ OPEN'],
  },
  {
    label: 'TRANSFER',
    kind: 'link',
    href: 'https://www.paypal.com/paypalme/dominikkoenitzer',
    lines: ['/pay/support', 'PROTOCOL 7 · L13', '7.83ms · SECURE', '▸ OPEN'],
  },
]
