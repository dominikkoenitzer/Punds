// The floating NAVI panels carry the operator's main data: the access-point
// links, and an operator profile. Link panels open their href when clicked;
// the profile opens a small window with its full text.

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
  // --- operator profile ----------------------------------------------------
  {
    label: 'OPERATOR',
    kind: 'profile',
    lines: ['DOMINIK_KOENITZER', 'NODE 0xD04C_1K_N37', 'STATUS :: ONLINE', 'LAYER 07 · WIRED'],
    body: `OPERATOR :: DOMINIK_KOENITZER
NODE     :: 0xD04C_1K_N37
STATUS   :: ONLINE
LAYER    :: 07 // THE WIRED

operator of this node, jacked into the wired.
follow the access points to find the rest.`,
  },
]
