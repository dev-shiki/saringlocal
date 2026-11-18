# Design Direction: SaringLocal

Design Read: Privacy-first hybrid AI document and incident triage workbench for engineers and compliance reviewers, in a warm archival-paper editorial and ink utility style, dial ENERGY 2 / RHYTHM 2 / MOTION 1.

## Identity and Purpose

SaringLocal solves a concrete problem for hybrid inference apps: sensitive text (emails, phone numbers, Indonesian NIK/KTP patterns, API tokens, internal URLs) should be detected and sanitized locally before anything can touch a cloud model, while users explicitly choose between `ONLY_ON_DEVICE`, `PREFER_ON_DEVICE`, `PREFER_IN_CLOUD`, and `ONLY_IN_CLOUD` via Firebase AI Logic.

The product is not a generic dark-neon chat clone. It reads like a tactile editorial redaction desk where local boundary guarantees are verifiable on screen.

## Dials

- ENERGY: 2 (Balanced: clear editorial masthead, explicit privacy boundary status bar, calm workspace)
- RHYTHM: 2 (Consistent two-pane workbench on wide viewports that shifts to structured stacked sections and tabbed inspection on mobile/tablet)
- MOTION: 1 (Hover and active state transitions only; zero continuous loops or decorative animations; respects `prefers-reduced-motion: reduce`)

## Color Palette

Maximum 2 core colors + 1 accent color over neutral paper/slate surfaces.

### Light Mode (Default: archival paper for long-form document review)
- Background: `#F6F3EC` (warm paper reduces glare during text inspection)
- Primary Surface: `#FFFFFF` (document sheet contrast)
- Secondary Surface: `#EDE8DD` (control trays and boundary summary strip)
- Primary Ink: `#1B1F23` (14.96:1 on `#F6F3EC`, 16.58:1 on `#FFFFFF`)
- Muted Ink: `#4B525A` (7.14:1 on `#F6F3EC`, 7.91:1 on `#FFFFFF`)
- Border: `#766F66` (4.96:1 on `#FFFFFF`, >= 3:1 non-text contrast on `#F6F3EC`)
- Core Color 1 (Local / Primary): `#1F4E5F` (harbour teal; 8.19:1 on `#F6F3EC`, white text `#FFFFFF` on `#1F4E5F` is 9.08:1)
- Accent Color (Cloud Boundary / Primary Action Warning): `#9E3614` / `#B4431E` (terracotta ink; `#9E3614` on `#F6F3EC` is 6.33:1, `#FFFFFF` on `#B4431E` is 5.58:1)

### Dark Mode (Toggleable for low-light developer environments)
- Background: `#14171A` (slate obsidian)
- Primary Surface: `#1D2227` (document sheet surface)
- Secondary Surface: `#252B31` (control trays and boundary strip)
- Primary Ink: `#F2EFE9` (15.68:1 on `#14171A`, 13.96:1 on `#1D2227`)
- Muted Ink: `#B8B3AA` (8.62:1 on `#14171A`, 7.68:1 on `#1D2227`)
- Border: `#6B737D` (3.34:1 non-text contrast on `#1D2227`)
- Core Color 1 (Local / Primary): `#6BB7CC` (7.94:1 on `#14171A`, `#14171A` text on `#6BB7CC` is 7.94:1)
- Accent Color (Cloud Boundary / Action): `#F07A52` (6.52:1 on `#14171A`, `#14171A` text on `#F07A52` is 6.52:1)

## Typography

- Headings: `Georgia, "Times New Roman", serif` to give the redaction desk editorial authority distinct from generic SaaS sans-serif templates.
- Body and Controls: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` for crisp legibility in forms, buttons, and dense inspection labels.
- Technical Tokens and Telemetry: `ui-monospace, "Cascadia Mono", Consolas, monospace` used strictly for redaction placeholders (`[EMAIL_1]`), SDK route logs, and JSON payload diffs.

## Written Purpose Decisions (R-31)

- Color: Harbour teal marks local on-device execution and primary navigation; terracotta marks cloud egress warnings and primary execution triggers so users immediately distinguish local vs. cloud paths.
- Layout: An asymmetric split workbench places raw input and PII boundary preview beside the tabbed Hybrid Inference Inspector (`Triage Output`, `Cloud Payload Diff`, `Firebase SDK Config`) so the user decides whether to run locally or escalate.
- Spacing: Tight 12px-16px internal padding inside tool trays paired with 24px-32px structural separation between masthead, boundary status bar, and main workbench keeps focus on the active document.
- Radii: Architectural 4px corners on document panes and inputs with 6px corners on action buttons avoid uniform pill-button templates.
- Icons: Minimal inline SVG strokes with `aria-hidden="true"` only where paired with explicit text labels (theme toggle, lock/cloud boundary indicator); zero decorative emojis or AI sparkles.
