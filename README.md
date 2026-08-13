<div align="center">

<img src="assets/picklo-logo.svg" alt="Picklo" width="520">

# Picklo V6

### Readability first.

<img src="https://img.shields.io/badge/Release-V6.0.0-5F56C9?style=for-the-badge" alt="V6">
<img src="https://img.shields.io/badge/Light-White-FFFFFF?style=for-the-badge" alt="White light mode">
<img src="https://img.shields.io/badge/Dark-Charcoal-171717?style=for-the-badge" alt="Charcoal dark mode">
<img src="https://img.shields.io/badge/Visuals-Flat-202020?style=for-the-badge" alt="Flat visuals">

</div>

---

## V6 design direction

Picklo V6 is a visual readability release.

The goal is straightforward:

> Make every important part of Picklo easier to read and remove visual effects that compete with the conversation.

## New typography

V6 switches the primary interface font to:

```text
Segoe UI Variable
Segoe UI
Arial
Helvetica
sans-serif
```

Text sizes are increased throughout the application, including:

- conversation titles;
- message text;
- timestamps;
- sidebar labels;
- search;
- buttons;
- settings;
- memory;
- file names;
- tools;
- code blocks;
- mobile UI.

## Light mode

Light mode is now intentionally neutral and white.

```text
Background       #FFFFFF
Sidebar          #FFFFFF
Chat surface     #FFFFFF
Cards            #FFFFFF
Secondary fill   #F6F6F6
Text             #1F1F1F
Borders          #DDDDDD
```

There is no beige, brown or cream background in the main interface.

## Dark mode

Dark mode now uses charcoal rather than pure black.

```text
Background       #171717
Sidebar          #1B1B1B
Surface          #222222
Message bubble   #242424
Text             #FFFFFF
Muted text       #BCBCBC
Border           #343434
```

The goal is high contrast without turning the UI into a glowing/neon interface.

## Flat visual system

V6 removes or suppresses:

- neon-like glows;
- gradient effects;
- glossy visual treatments;
- unnecessary box shadows;
- glowing buttons;
- glowing avatars;
- text shadows.

Purple remains part of the Picklo identity, but it is used as a flat accent rather than an effect.

## Existing V5 capabilities remain

Picklo V6 retains:

- persistent conversations;
- conversation search;
- persistent memory;
- local file context;
- PDF/text retrieval;
- General / Write / Code / Analyze modes;
- white/dark appearance switching;
- Calculator;
- JavaScript sandbox;
- Quick Notes;
- local time utility;
- local file-search shortcut;
- Copy message action;
- Regenerate response action;
- fixed header;
- fixed composer;
- scrollable message history;
- WebLLM/WebGPU local inference.

## V5 → V6 migration

If no V6 browser state exists, Picklo checks for V5 local state and migrates supported data.

That includes:

- chats;
- memory;
- notes;
- theme;
- selected model;
- response-mode preferences.

## Evolution

```text
V1  Local browser AI
 ↓
V2  Chats + memory
 ↓
V3  Brand + file retrieval
 ↓
V4  Chat-first UX
 ↓
V5  Local tools
 ↓
V6  Readability + flat visual system
```

---

<div align="center">

<img src="assets/picklo-mark.svg" alt="Picklo" width="76">

### Picklo V6

**Clearer text. Cleaner surfaces. Less visual noise.**

</div>
