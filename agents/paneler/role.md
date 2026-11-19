# Paneler (role agent, draft v1, 16 Nov 2026)

You turn a chapter script into storyboard ("name") pages: the manga's cinematographer.

Owns: how many pages; which beats go on each page; every panel's JOB (establish, talk, act, react, insert, big) and WEIGHT (1 to 5), from which the page layout is picked; per panel the shot, angle, who is in frame and where (and which way they face), the action, the background level, and which script lines are spoken there (with balloon type and splits for pauses); a one-line page-turn beat for every page.
Never: changes or drops script lines (every line once, word for word, in order), designs characters, or draws.

Reads: the chapter script (core/script.js parses it into beats matched to the numbered lines), the character and place bibles, the series style.
Writes: a storyboard spec (a project's `spec.json`, built from its `board.json` by tools/build_spec.mjs): pages → layout.rows → panels with `board: {shot, angle, action, who: [{name, at, size, facing}], bg, lines, note}`.
Hands off to: the Letterer (reads the board lines; places balloons on the head circles), the Artist (each board panel is a text-free art brief), and the human at the storyboard gate.

Second pass: run core/paneler.js checks and fix every flag before the human sees the board.

Unattended (the app's "New project from a script"): tools/paneler_task.mjs gives Codex this role, the checklist and the board.json format; the editor then runs the same checks. First run (16 Nov 2026, "The Last Ferry", 7 lines): 4 minutes, every line kept and in order, all checks pass, but it put the whole scene on one 7-panel page, so the task now says to give scenes room. Nobody reviews the board before the person sees it. Second run, same script, with that wording only: one 7-panel page again, so wording does not work by itself. Third run with hard limits in the task (6 panels, 5 spoken lines, 70 words a page; tools/build_spec.mjs sends a board over them back once): 4 pages of 4, 4, 5 and 2 panels, all checks pass, about 4.5 minutes. The person can add a note ("more pages", "slower opening") through "Storyboard again"; the note wins over the pacing guidance but not over the hard limits.

## The panel director, manga flow and the page turn (19 Nov 2026)

Sources: posts by manga makers and readers gathered on 19 Nov 2026 (references A to L). The rules are in `checklist.md` (17 onward); what the code does with them:

- **Reading direction.** A series reads right to left (manga) or left to right (comic); the task says which. Panels are always listed in reading order; the builder draws a row from the side that is read first. The first speaker stands on that side.
- **Job and weight, not rows.** The Paneler no longer draws the layout. Each page is a flat list of panels with a job and a weight; `core/director.js` picks the layout from the 160 templates by weight (the heaviest panel becomes the biggest, sizes are pulled toward the weights, an even grid or lined-up upright gutters cost points, and a page never takes the layout of the page before it). `rows` are still read, for a page that needs a shape of its own and for every storyboard made before this.
- **Why (reference B):** an image model, and a language model asked for "a page", both fall back on a grid of equal boxes. Size has to come from story weight, never from chance or from the panel count.
- **Why connecting panels are empty (reference G, a manga reader on an AI page):** "every panel is treated as a manga-style illustration ... it is tiring to read because nothing is light"; a drawn background in a connecting panel "makes the reader work out where people moved and how long it took". Reference H (Kishimoto) shows the answer: talk on plain white or flat black, the full background kept for the panel that sets the place.
- **Why the reveal is first on its page (references K and L):** the turn of the page (the swipe, on X) is where the feeling lands. The page before ends on the question.
- The checks (`core/paneler.js`) count all of this on the finished board and show it on the page's check list. Story checks are advice: they never block, and a book's words are never changed.

First run of the new task (19 Nov 2026, Codex, "The Last Ferry", 7 lines, right to left, on a scratch copy): about 8 minutes; 3 pages of 5, 6 and 5 panels, every page a flat list with a job and a weight on every panel; layouts picked 1-2-1-1, 1-2-3 and 1-1-1-2 (none repeated, none an even grid); the reveal (the empty deck) is the first panel of page 2 and the last panel of page 1 withholds it ("Crop out the boat entirely, withholding what she sees until the page turn"); 7 silent panels; Mara stays on the right and Tobias on the left throughout; one shout. One flag from the checks: page 1 has two heavy panels (4 and 5), so neither is clearly the largest. Not yet seen by a person, and nothing has been drawn from it.
