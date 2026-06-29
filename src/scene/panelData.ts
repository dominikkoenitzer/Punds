// The floating NAVI panels carry the operator's real data, recovered from the
// original landing page (links, profile, the Wired lore files), reframed as
// holographic cards. Link panels open their href when clicked.

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
  // --- recovered Wired lore files ------------------------------------------
  {
    label: 'REALITY.DLL',
    kind: 'file',
    accent: 'warning',
    lines: ['STATUS: CORRUPTED', 'which reality is real?', 'all of them.', 'none of them.'],
    body: `> FILE: REALITY.DLL
> STATUS: CORRUPTED
> TYPE: SYSTEM_CRITICAL

ERROR: reality module not responding
WARNING: consensus breach detected
INFO: multiple realities detected

which reality is real?
all of them. none of them.
the wired is as real as the real world.`,
  },
  {
    label: 'WIRED_ACCESS.KEY',
    kind: 'file',
    accent: 'tachibana',
    lines: ['---BEGIN KEY---', '476F642069732068', '> God is here.', '---END KEY---'],
    body: `> FILE: WIRED_ACCESS.KEY
> TYPE: CRYPTOGRAPHIC_KEY
> ACCESS: RESTRICTED

-----BEGIN WIRED KEY-----
476F6420697320686572652E
-----END WIRED KEY-----

> decoded :: God is here.`,
  },
  {
    label: 'LAIN.LOG',
    kind: 'file',
    lines: ['you are not alone.', 'you never were.', 'the net remembers.'],
    body: `> FILE: LAIN.LOG
> ACCESS: RESTRICTED
> LOCATION: THE_WIRED

you are not alone.
you have never been alone.
the network remembers everything.`,
  },
  {
    label: 'KNIGHTS.DAT',
    kind: 'file',
    lines: ['Knights of the', 'Eastern Calculus', 'barriers between', 'the wired & real'],
    body: `> FILE: KNIGHTS.DAT
> ORGANIZATION: THE_KNIGHTS
> STATUS: ENCRYPTED

the knights of the eastern calculus,
protecting the barriers between
the wired and reality...

or are they creating them?`,
  },
  {
    label: 'MESSAGE.HEX',
    kind: 'file',
    decoder: true,
    lines: ['no matter where', 'you are, everyone', 'is always', 'connected.', '▸ DECODE'],
    body: `> FILE: MESSAGE.HEX
> ENCODING: HEXADECIMAL
> DECODER: ONLINE

paste hex below and decode.`,
  },
  // --- system flavor -------------------------------------------------------
  {
    label: 'PROTOCOL 7',
    kind: 'flavor',
    lines: ['7th gen wired', 'carrier 7.83 Hz', 'handshake :: OK'],
  },
  {
    label: 'PSYCHE',
    kind: 'flavor',
    lines: ['network accelerator', 'status :: installed', 'layer 07 sync'],
  },
]
