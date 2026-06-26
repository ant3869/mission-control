---
name: Mission Control
version: alpha
description: Personal AI command-center dashboard. Deep-dark cinematic ops aesthetic — drama through motion, never decoration.
colors:
  base: "#0b0b0d"
  surface: "#0f0f12"
  card: "#141417"
  card-hover: "#1a1a1e"
  border: "#1e1e24"
  border-subtle: "#17171c"
  primary: "#e4e4e8"
  secondary: "#7a7a8a"
  muted: "#4a4a58"
  accent-green: "#4ade80"
  accent-amber: "#fbbf24"
  accent-red: "#f87171"
  accent-blue: "#60a5fa"
  accent-purple: "#a78bfa"
  accent-teal: "#2dd4bf"
typography:
  heading:
    fontFamily: Outfit
    fontSize: 0.875rem
    fontWeight: 600
    letterSpacing: -0.02em
    lineHeight: 1.3
  body:
    fontFamily: Outfit
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.5
  label-caps:
    fontFamily: Outfit
    fontSize: 0.625rem
    fontWeight: 600
    letterSpacing: 0.08em
    lineHeight: 1rem
  mono:
    fontFamily: JetBrains Mono
    fontSize: 0.75rem
    lineHeight: 1.4
rounded:
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
components:
  card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.xl}"
    padding: 16px
  card-hover:
    backgroundColor: "{colors.card-hover}"
    rounded: "{rounded.xl}"
    padding: 16px
  nav-item-active:
    backgroundColor: "{colors.card-hover}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: 5px 10px
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.secondary}"
    rounded: "{rounded.md}"
    padding: 5px 10px
  badge:
    backgroundColor: "#1a2e45"
    textColor: "{colors.accent-blue}"
    rounded: "999px"
    padding: 2px 6px
  pill-critical:
    backgroundColor: "#3d1a1a"
    textColor: "{colors.accent-red}"
    rounded: "999px"
    padding: 2px 8px
  pill-warning:
    backgroundColor: "#3d2d0a"
    textColor: "{colors.accent-amber}"
    rounded: "999px"
    padding: 2px 8px
  pill-success:
    backgroundColor: "#0f3320"
    textColor: "{colors.accent-green}"
    rounded: "999px"
    padding: 2px 8px
  pill-info:
    backgroundColor: "#1a2e45"
    textColor: "{colors.accent-blue}"
    rounded: "999px"
    padding: 2px 8px
---

## Overview

Cinematic deep-dark ops dashboard. The aesthetic is a matte black command center — as if Mission Control at NASA got an AI upgrade. Every surface is near-black with subtle layering (base → surface → card → card-hover). Color is reserved strictly for meaning: green for live/active, amber for warning, red for critical, blue for info, purple for AI, teal for memory/knowledge.

Drama comes only through motion — drawer slides, rise-in fades, radar sweeps, node pulses — never from gradients, glassmorphism, or decorative color.

## Colors

The palette has three structural layers and six semantic accent colors. Never introduce new colors outside this set.

### Structural surfaces (dark to light)
- **Base (#0b0b0d):** Page background. The lowest layer, near-black.
- **Surface (#0f0f12):** Subtle step above base; used for the app shell and panel backgrounds.
- **Card (#141417):** Primary content containers. Panels, tiles, list items rest here.
- **Card-hover (#1a1a1e):** Active/selected state for cards and nav items.

### Borders
- **Border (#1e1e24):** Default divider between elements.
- **Border-subtle (#17171c):** Barely-visible structural line (section dividers, inner card borders).

### Text hierarchy
- **Primary (#e4e4e8):** Body copy, active labels, headings. Slightly warm off-white, never pure white.
- **Secondary (#7a7a8a):** Supporting text — descriptions, inactive nav labels, timestamps.
- **Muted (#4a4a58):** Placeholder text, section labels, decorative metadata. Readable but recessive.

### Semantic accents (used with ~10–20% opacity tints for pill backgrounds)
- **Green (#4ade80):** Active, live, success, online.
- **Amber (#fbbf24):** Warning, medium priority, paused, planning.
- **Red (#f87171):** Critical, error, offline, high-severity alert.
- **Blue (#60a5fa):** Info, links, badges, notifications, selected state indicators.
- **Purple (#a78bfa):** AI-specific: agent activity, evals, benchmarks, model ops.
- **Teal (#2dd4bf):** Memory, knowledge graph, brain/recall systems.

## Typography

Two font families only. Body text is set in **Outfit** (geometric sans — clean and slightly clinical). Telemetry, version numbers, and code use **JetBrains Mono**.

- **Headings** are small, tight, and semibold — never large or decorative. Use `text-sm font-semibold tracking-tight`.
- **Section labels** are 10px uppercase with wide tracking (`label-caps`). Always muted color. This is the primary way sections are differentiated visually.
- **Body** matches heading size to create a compact, dense information layout.
- Avoid font sizes above `1rem` except for the main page hero (`Home` view only).

## Layout

The app runs in a half-screen window (~800px wide). Every layout decision must account for this constraint.

- **Sidebar:** Collapsible, 200px expanded / 48px collapsed. Always border-r border-border.
- **Main area:** Single column within views. Lead items first (priority/hero), followed by supporting lanes.
- **Cards:** Use `bg-card rounded-xl` consistently. Prefer single-column stacks over uniform grid tiles. Color-coded left-border lanes communicate status at a glance.
- **Overlays and drawers:** Slide in over the main content (not push layout). Use `animate-drawer-in` (translate-x + fade) for detail drawers from the right.
- **Dead space:** Fill with metadata chips, not decoration. If a panel has extra room, add context (counts, timestamps, health indicators) rather than whitespace.

## Elevation & Depth

Depth is expressed through background color steps only — no shadows, no blur, no glassmorphism.

- Lowest: `base` (#0b0b0d)
- Middle: `surface` (#0f0f12) → `card` (#141417)
- Highest / active: `card-hover` (#1a1a1e)

Borders make the layers explicit. Shadows and `backdrop-filter: blur(...)` are forbidden.

## Shapes

All interactive elements use the radius scale:

- Nav buttons, small tags: `rounded-md` (6px)
- Status pills, count badges: fully rounded (999px)
- Content cards, panels: `rounded-xl` (12px)
- Fine inner borders (scrollbars, dividers): `rounded-sm` (4px)

Never round a full card with `rounded-full`. Never use `rounded-2xl` or above.

## Components

### Card
`bg-card rounded-xl border border-border p-4`. The universal content container. Optional `hover:bg-card-hover` for interactive cards.

### Status pill
Accent color text on a ~10% opacity same-color background. Fully rounded. Used for: severity levels, agent state, connection status, task priority. No icon unless the state is ambiguous from color alone.

### Count badge
Small pill pinned right on a nav label or card header. Blue accent — `bg-accent-blue/20 text-accent-blue`. Tabular nums, semibold, 18px height minimum.

### Nav item
`px-2.5 py-[5px] rounded text-sm font-medium`. Active: `bg-card-hover text-primary`. Inactive: `text-secondary hover:bg-card hover:text-primary`. Icon is `text-muted` at rest, `text-secondary` on hover, `text-primary` when active.

### Section label (nav / panel headers)
`text-[10px] font-semibold uppercase tracking-wider text-muted`. Non-interactive. Used as a grouping header above nav sections or within content panels.

### Live badge
Animated dot + "LIVE" text. Green. Used when a data stream is connected.

## Do's and Don'ts

**Do:**
- Use motion for drama: slide, fade, pulse, sweep — all with cubic-bezier easing.
- Use accent colors only for semantic meaning, never for aesthetic variety.
- Keep label text sentence-case for headings, uppercase for section/metadata labels.
- Stack information density vertically — users prefer one clean column over a grid of equally-sized boxes.
- Add metadata chips (counts, timestamps, health ticks) to fill space meaningfully.

**Don't:**
- Don't introduce gradients, glassmorphism (`backdrop-blur`), or colored drop shadows.
- Don't use accent colors for decorative borders or icon fills without semantic meaning.
- Don't use font sizes above `1rem` outside the Home view hero.
- Don't create uniform card grids — lead with the most important item, then supporting context.
- Don't add rounded corners larger than `rounded-xl` (12px).
- Don't use `font-bold` — `font-semibold` (600) is the heaviest weight in this system.
