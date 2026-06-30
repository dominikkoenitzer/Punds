// The floating NAVI panels carry the operator's access-point links. Link
// panels open their href when clicked; file/profile panels (if any) open a
// small window with their full text.

export type PanelKind = 'link' | 'profile' | 'file' | 'flavor'
export type PanelAccent = 'phosphor' | 'tachibana' | 'warning'

export interface PanelDatum {
  label: string
  lines: string[]
  kind: PanelKind
  href?: string
  accent?: PanelAccent
  body?: string // full text shown when the panel is opened
  decoder?: boolean // opens the interactive hex decoder
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
