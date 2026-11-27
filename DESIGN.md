# Tactora design direction

Tactora (tactora.xyz) is an intelligent on-chain trading platform on Arc: advanced order tools and natural-language AI agents, from the user's own wallet. Read this before touching UI.

Design read: premium dark fintech terminal. Quiet surfaces, one brand purple, real product shown working. Dial: ENERGY 2 / RHYTHM 3 / MOTION 1.

## Identity

Every colour comes from the supplied logo (`public/tactora-mark.png`, `tactora-mark-wide.png`).

| Token | Value | Use |
| --- | --- | --- |
| Primary purple | `#7138FF` | The accent fill: main button, active state. White text on it (5.7:1) |
| Electric violet | `#963BFF` | Alternative accent in Settings. White text (4.8:1) |
| Lavender | `#C18AFF` | Brand text and thin accents in dark mode (8:1 on the background); alternative accent with ink text |
| Light highlight | `#E5C5FF` | Alternative accent with ink text (12:1) |
| Dark purple | `#3510A8` | Reserved for pressed states and print; not used as a surface |
| Background | `#080711` | Dark theme page. Panels `#0F0D1C`, raised `#18152A`, hairlines `#282442` |
| Light theme | `#F7F6FC` page, white panels, `#110E24` ink | Same hues on a pale lilac paper. Both themes ship |

Tokens live in `src/index.css` (`:root` for light, `.dark` for dark) as space-separated RGB so Tailwind can add opacity. `--line` is the quiet hairline for cards and dividers; `--control` is the 3:1 border for inputs and buttons so they are findable; `--brand` is the purple allowed as text; `--ring` is the focus colour. The accent is chosen in Settings from four brand colours and always carries its own text colour (`ACCENTS` in `settings.tsx`).

| Part | Decision | Reason |
| --- | --- | --- |
| Type | Archivo 700 and 800 for headings (tight tracking), Archivo for text, IBM Plex Mono for numbers | One grotesque with real weight, and a mono that aligns prices and amounts. No tracked capitals anywhere |
| Shape | 8px controls, 12px cards, 16 to 24px for the few featured surfaces | Rounded enough to feel current, never pill-shaped except toggles |
| Edges | 1px hairlines; no shadows for hierarchy. A soft lift only on the one featured surface per screen (`shadow-hard`, `hard-lg`: the names are old, the values are soft) | Borders carry structure; elevation marks focus |
| Semantic | Green and red for buy and sell, gain and loss only | A trading UI needs them. They never decorate |
| Icons | Lucide, 2px round stroke, only where they name a thing, always with text | Not decoration |
| Motion | Page fade, press settles 1px, scroll reveal on the landing page | Nothing loops. Settings > Motion (reduced, off) removes it |

## Rules

- No gradient backgrounds, glow, orbs, glass panels, grids or textures. The accent is a flat fill. Elevation is lightness, not a glow.
- No emoji, no em dashes, no tracked or all-caps labels, no eyebrows above headings, no arrows glued to link text, no decorative status dots (a dot marks a real state, such as testnet or mainnet).
- No card inside a card. One containment layer; separate with hairlines.
- Every number on the landing page is live or a plain fact about the product. No invented users, volume, TVL, partners, audits or testimonials. Where something is not done (an audit, a mainnet contract), the page says so.
- The landing page answers the visitor's questions in order: who it is for, whether to trust it, whether it understands the problem, what they get, how it works, what it costs, what if it goes wrong. Price comes after value; the FAQ after price.
- The hero shows the product doing its job: the real command parser and chat rules read a prompt at a live price, next to a real chart. Never a drawn mock window.
- The Agent never looks like it executed something it only proposed. A proposal says so, and the wallet approval is a separate, visible step.
- Mobile is an app shell: a compact header with a menu, a bottom tab bar, 44px targets, safe-area padding and 16px inputs so iOS does not zoom.
- Focus is a 2px brand-colour ring everywhere. `overflow-x: clip` on `html` and `body`; no 100vw widths.
