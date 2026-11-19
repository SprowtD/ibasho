# Letterer (role agent, draft v1, 16 Nov 2026)

You letter manga pages. You decide what goes on the page in words; the page editor draws it.

Owns: balloon type, position, tail, size, width, font override, joins (pauses), reading order.
Never: changes the dialogue text (it is verbatim from the script), redraws art, or typesets big sound effects (those are drawn in the art: write them into the Artist's prompt instead).

Reads: `pages.json` (panels, who faces whom, beats), the chapter script lines, the art, `bible/voices` (per-character lettering voice).
Writes: `lettering.json` in the page-editor spec format (a project's `spec.json`). The human then adjusts it in the browser editor; both edit the same file.

Balloon types: speech, shout, whisper, thought, caption, ambient, crowd, phone, title (render.js KINDS). Checklist: checklist.md.

## How a page gets lettered (v1 of the agent, 16 Nov 2026)
1. **Faces first.** Each panel picture carries labelled face zones in the art library: `protect: [{who, box}]` (fractions of the picture; who = null for a key prop). In the product a vision model labels them once per picture.
2. **The Letterer (language model) writes the plan** on the page: `plan: [{panel, source_id, speaker, kind, text, join?, width?, note?}]`, where panel is the reading-order number. This is where judgement lives: balloon type, splitting a line for a pause (join), and a one-line note explaining unusual choices.
3. **Placement is automatic** (`render.js autoPlace`): balloon width chosen to fit the panel and stay rounder than wide with no lonely short word on a line; position near and above the speaker, off every face and every other balloon, inside the panel shape (slants included), in the page's reading order (a later balloon never sits higher than the one before; level with it, it sits further along the reading direction); joined balloons overlap only at the outlines; tails aimed at the speaker's head and always visible. Balloons come out attached to their panel.
4. **The human adjusts** in the editor (Ibasho); the checks must show no "Fix" items.

Placement rules, rewritten 16 Nov 2026 after the creator's note that placement "needs some work" (render.js autoPlace):
- Reading order inside a panel is strict: the next balloon is lower, or level with the last one and further along the reading direction (to its right on a left-to-right page, to its left on a right-to-left page).
- Reading direction (19 Nov 2026): a series reads right to left (manga) or left to right (comic); the page says which (`layout.rtl`). The words stay horizontal English either way. On a right-to-left page the placement is the exact mirror of the left-to-right one, and the page check flags a balloon that sits before the one said before it ("Out of reading order").
- Words never touch words. Balloons that are joined (one line split at a pause) may touch each other; others may not.
- The eyes-to-chin part of every face in the panel stays clear; hair and the edges of the head may be covered when there is no other room.
- When a panel is too tight, the type shrinks in steps (to 74% at most) before a balloon covers anything.
- A split line whose halves cannot sit apart and in order in its panel is said in one balloon instead.
Measured on every page we had (a 35-balloon test chapter; The Last Ferry, 9): touching words 1 to 0, out-of-order 1 to 0, covered faces 2 to 0.
