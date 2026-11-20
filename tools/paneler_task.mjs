// Paneler agent, unattended: writes the task Codex follows to turn a chapter script into a storyboard.
// Usage: node tools/paneler_task.mjs <project dir>   -> prints the task file path
// Codex reads script.md (any format) and writes script.json (every line word for word) and board.json; then
// tools/build_spec.mjs makes spec.json. The role and checklist are the same ones the human-run Paneler uses.
import fs from "node:fs"; import path from "node:path";
const dir = path.resolve(process.argv[2]), APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const role = fs.readFileSync(path.join(APP, "agents/paneler/role.md"), "utf8").split("\n").slice(2, 6).join("\n");
const checklist = fs.readFileSync(path.join(APP, "agents/paneler/checklist.md"), "utf8").split("\n").filter((l) => !/^13\./.test(l)).join("\n");
let note = "", reading = "ltr";
try { const meta = JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8")); note = String(meta.paneler_note || "").trim(); if (meta.reading === "rtl") reading = "rtl"; } catch { /* no project file */ }
try { const b = JSON.parse(fs.readFileSync(path.join(dir, "bible.json"), "utf8")); if (b.reading === "rtl" || b.reading === "ltr") reading = b.reading; } catch { /* no series settings yet */ } // the series settings win, as in tools/build_spec.mjs
const rtl = reading === "rtl";
// Which way the page reads. The words are horizontal English either way; what changes is where panels and people sit.
const direction = rtl ? `
## Reading direction: RIGHT TO LEFT (manga)

This chapter reads right to left, the way a Japanese manga does. The words stay in horizontal English.
- In a row, the FIRST panel you list is drawn on the RIGHT and the next ones run to the left. Keep writing \`panels\` in reading order; the builder puts them on the page from the right.
- Inside a panel the reader's eye also enters from the right: the first balloon is placed top right, the next one lower or to its left.
- So in a panel with two people who both speak, put the FIRST speaker's head on the RIGHT side (\`at\` x above 0.5) and the one who answers on the left. \`at\` itself is unchanged: 0 is still the left edge of the panel, 1 the right edge.
- Movement that goes forward in the story (walking on, a punch landing, a ball rolling to its target) points to the LEFT; someone coming back or being pushed back points right.
` : `
## Reading direction: left to right (comic)

This chapter reads left to right. In a row the first panel you list is on the left. In a panel with two people who both speak, put the first speaker's head on the left side (\`at\` x below 0.5) and the one who answers on the right. Movement that goes forward in the story points to the right.
`;
let known = ""; // a chapter of a book: the series already has its people and places, and the names must match them
try {
  const bible = JSON.parse(fs.readFileSync(path.join(dir, "bible.json"), "utf8")), people = Object.keys(bible.cast || {}), places = Object.keys(bible.places || {});
  if (people.length) known += `\n- The series already has these characters: ${people.join(", ")}. When one of them is in this chapter, use that name exactly, as the speaker and in \`who\` and \`cast\`. Anyone else in the chapter gets a new name as usual.`;
  if (places.length) known += `\n- The series already has these places: ${places.join(", ")}. When a panel is set in one of them, name the place in the panel's \`action\` with exactly that spelling.`;
  const props = Object.keys(bible.props || {});
  if (props.length) known += `\n- The series already has these props: ${props.join(", ")}. When one of them is in a panel, name it in the panel's \`action\` with exactly that spelling.`;
} catch { /* a new project has no settings yet */ }
// A section of a book chapter (tools/book_board.mjs writes book.json beside script.md): the book is the only source.
let book = null; try { book = JSON.parse(fs.readFileSync(path.join(dir, "book.json"), "utf8")); } catch { /* an ordinary script */ }
const bookScript = book ? `## 1. \`script.json\`: the book's text as numbered beats

\`script.md\` is ${book.of > 1 ? `section ${book.section} of ${book.of} of a chapter` : "one chapter"} of a book. Every paragraph starts with its id in square brackets, like \`[${book.example}]\`. You are ADAPTING this text into manga: the book is the only source.

\`\`\`json
{ "title": "<the chapter title, if this text opens with it>",
  "beats": [
    { "id": "S1", "type": "scene", "text": "ROBE SHOP. DAY." },
    { "id": "A001", "type": "action", "src": ["<paragraph id>", "<paragraph id>"], "text": "<what happens in those paragraphs, in plain words>" },
    { "id": "L001", "type": "line", "src": "<paragraph id>", "speaker": "Mara", "text": "<the words between the quotation marks, EXACTLY as printed>" },
    { "id": "L002", "type": "line", "src": "<paragraph id>", "speaker": "", "text": "<narration kept as a caption: an exact run of words from that paragraph>" }
  ] }
\`\`\`

- ZERO INVENTION. No new dialogue, no new events, people, objects or places, no changed order. If the book does not say it, it is not in the manga.
- Every stretch of speech between quotation marks is ONE \`line\`, in the book's order, with the id of its paragraph as \`src\`. Copy the words exactly. The only change allowed: a comma just before the closing quotation mark may be left off. A sentence the book breaks with "said Mara" is two lines.
- \`speaker\`: who says it, as the book tells it. Title Case, the same spelling every time.
- Narration: the pictures carry most of it. Keep a caption only where a picture cannot (a jump in time or place, a thought, a fact the reader needs): speaker "", an exact run of words from ONE paragraph, at most 25 words, kind "caption" on the board. Never rewrite narration.
- Nothing that happens may be left out. Every paragraph is drawn: its id is in the \`src\` of at least one panel on the board.${book.title ? `\n- The text opens with the chapter heading: make it one \`line\` (speaker "", its exact words), placed on page 1 with kind "title".` : ""}${book.before ? `\n- This section carries on from the one before; do not storyboard that part again. It ended like this (for your bearings only):\n\n> ${book.before.replace(/\n+/g, "\n> ")}` : ""}
` : "";
const bookBoard = book ? `
- BOOK: every panel has \`"src": ["<paragraph id>", …]\`: the paragraphs it draws. The panel's \`action\` says only what those paragraphs say, and keeps the details the book gives (what someone wears, holds or does with their hands). Every paragraph id of \`script.md\` appears in at least one panel's \`src\`.
- BOOK: a long chapter needs many pages. Do not summarise to save pages: about ${book.pages} pages is right for this text.` : "";
let opening = ""; try { if (+(JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8")).chapter || 1) === 1 && (!book || book.section === 1)) opening = "; the FIRST FIVE pages of the story carry fewer, 45 at most: the opening is where a reader is won or lost, so let pictures do the work there"; } catch { /* no project file */ }
const task = `# Paneler task: storyboard this chapter

You are the Paneler: the manga's cinematographer. ${role}

Work only inside \`${dir}\`. Read \`script.md\` ${book ? "(part of a book, to be adapted)" : "(the chapter script; it may be in any format: screenplay, prose, notes)"}. Write two files there, then stop. Do not draw, do not generate images, do not write anything else.

${direction}
${bookScript || `## 1. \`script.json\`: the script as numbered beats

\`\`\`json
{ "title": "<chapter title if the script gives one>",
  "beats": [
    { "id": "S1", "type": "scene", "text": "KARAOKE BOOTH. NIGHT." },
    { "id": "A001", "type": "action", "text": "<what happens, as written>" },
    { "id": "L001", "type": "line", "speaker": "Kai", "text": "<the spoken line, WORD FOR WORD>", "paren": "<quietly / to himself, if the script says>" }
  ] }
\`\`\`

- Every spoken line, narration caption and piece of on-page text a reader must read is a \`line\`, in script order, ids L001, L002, … Copy the words exactly: never fix, shorten or translate them.
- Speaker names in Title Case, the same spelling every time. Narration has speaker "".
`}

## 2. \`board.json\`: the storyboard

\`\`\`json
{ "cast": [ { "name": "Kai", "desc": "KAI, 26: tall and lean, messy black hair, tired eyes, flat expression. Long-sleeved shirt." } ],
  "pages": [
    { "note": "<one line: the beat this page ends on>",
      "panels": [
        { "job": "establish", "weight": 4, "shot": "wide", "angle": "high angle", "bg": "full",
          "action": "<one or two sentences: what the reader sees in this panel>",
          "who": [ { "name": "Kai", "at": [${rtl ? "0.75" : "0.25"}, 0.4], "size": "wide", "facing": "${rtl ? "left" : "right"}" }, { "name": "Aya", "at": [${rtl ? "0.3" : "0.7"}, 0.45], "size": "wide", "facing": "${rtl ? "right" : "left"}" } ],
          "lines": [ { "id": "L001", "kind": "speech" } ],
          "note": "<optional: why this panel is built this way>" },
        { "job": "insert", "weight": 1, "shot": "insert", "bg": "white", "action": "Kai's hands around a glass.", "who": [], "lines": [] },
        { "job": "talk", "weight": 2, "shot": "medium", "angle": "eye level", "bg": "white", "action": "…", "who": [ { "name": "Aya", "at": [0.5, 0.45], "size": "medium", "facing": "${rtl ? "right" : "left"}" } ],
          "lines": [ { "id": "L002", "kind": "speech", "parts": ["First half of the line,", "second half."] } ] },
        { "job": "react", "weight": 2, "shot": "close", "angle": "low angle", "bg": "tone", "action": "Kai looks away. Says nothing.", "who": [ { "name": "Kai", "at": [0.5, 0.45], "size": "close", "facing": "${rtl ? "left" : "right"}" } ], "lines": [] },
        { "job": "big", "weight": 5, "face": "big", "shot": "close", "angle": "eye level", "bg": "tone", "action": "…", "who": [ { "name": "Aya", "at": [0.5, 0.4], "size": "close", "facing": "camera" } ],
          "lines": [ { "id": "L003", "kind": "shout" } ] } ] } ] }
\`\`\`

You do NOT draw the layout. A page is a flat list of \`panels\` in reading order; give every panel a JOB and a WEIGHT, and the builder picks the page layout from them (the heaviest panel becomes the biggest, light panels become small, no even grids, never the same layout as the page before). Only when a page truly needs a shape of its own (a tall panel beside two stacked ones), write \`rows\` instead of \`panels\`: \`"rows": [ { "h": 0.6, "panels": [ { "w": 0.4, …panel… }, { "w": 0.6, "rows": [ … ] } ] } ]\`, with \`h\` each row's share of the page height and \`w\` each panel's share of the row width${rtl ? " (the first panel of a row is drawn on the right)" : ""}.

Fields
- \`job\`: what the panel is FOR. One of:
  - \`establish\`: sets the place and who is here. The one panel that gets \`"bg": "full"\`. Wide. Usual weight 4.
  - \`act\`: something happens (a move, a hit, something handed over). \`bg\` "simple". Usual weight 3.
  - \`talk\`: carries the conversation: a speaker and a line. \`bg\` "white" or "tone". Usual weight 2.
  - \`react\`: a face answering what just happened, often with no line at all. \`bg\` "white" or "tone". Usual weight 2.
  - \`insert\`: a hand, an eye, an object. Small. \`bg\` "white". Usual weight 1.
  - \`big\`: the big moment of the page: ONE person, framed from the chest up, one short line (six to eight words at most). Weight 5. At most one on a page, and about one every two pages; most pages have none or one.
- \`weight\`: 1 to 5, how much of the page the panel should own. It follows the story, never chance: an opening, a change of feeling and the big moment are heavy; in-between panels are light. On a page, one panel is clearly the heaviest (4 or 5) and at least two are light (1 or 2). Never give every panel the same weight: that is an even grid, and reads like a slideshow.
- \`shot\`: wide, medium, close, extreme close, insert, two-shot, full figure, overhead, point of view (free text, short). \`angle\`: eye level, low angle, high angle, from above, from behind. Two panels next to each other never share BOTH the same shot and the same angle: change the distance or the height every time (long, middle, close; high, low).
- \`bg\`: "full" (the place is drawn), "simple" (a hint of the place), "tone" (flat grey tone, emotional), "white" (nothing). It follows the job, as listed above. CONNECTING panels (talk, react, insert) have NO background: a drawn room makes the reader work out where people moved and how long it took, and that stops matching the time the talk takes. At most one or two "full" on a page.
- \`face\` (optional): \`"face": "big"\` on the ONE panel of a page that gets a big expression (a shout, tears, a comedy face). Everywhere else faces are calm: a small change of the eyes or mouth. A big expression in every panel is not rich acting, it is noise.
- \`reveal\` (optional): \`"reveal": true\` on a panel that surprises the reader. It MUST be the first panel of its page (the reader meets it right after the page turn, or the swipe), and the LAST panel of the page before sets it up with a question, a look or a hand reaching.
- \`splash\` (optional): \`"splash": true\` on ONE panel for the biggest moment of the chapter (the turn of the story, a reveal, an arrival, the hit): weight 5, first on its page, drawn as one bold image, the biggest picture in the chapter. At most one in a short chapter, one every 8 to 10 pages in a long one; most pages have none.
- \`who\`: only the named characters visible in the panel. \`at\` is where their HEAD is, as fractions of the panel [0 = left/top, 1 = right/bottom]. \`size\`: close, medium, wide or tiny. \`facing\`: left, right, camera, away, up or down. Hands-only and object panels have \`"who": []\`.
- \`lines\`: the script lines spoken in this panel, by id. \`kind\`: speech, shout, whisper, thought, caption, phone, crowd or title. \`parts\` splits a line at a pause into joined balloons; the parts joined with single spaces must equal the line exactly. \`"off": true\` when the speaker is not in the panel. \`"bridge": true\` (rare, at most one a page, never on a panel that ends its page) puts the balloon ON the border to the next panel, tying the two together: for a line that carries straight on into the next picture.
- \`cast\`: every named character, with a one-line look taken from the script (age, build, hair, clothes). If the script gives no look, write a plain neutral one and keep it consistent.

Manga flow (what makes it read as manga and not as a row of illustrations)
- SIDES STAY PUT. Within a scene each person keeps their side of the picture from panel to panel: if Kai is on the ${rtl ? "right" : "left"} and Aya on the ${rtl ? "left" : "right"} in the first panel they share, they stay that way, and each faces the other across the gutter, until a wide panel shows them move. ${rtl ? "The one who speaks first stands on the RIGHT." : "The one who speaks first stands on the left."}
- ONE BIG EXPRESSION A PAGE at most. Spend it on the panel that needs it.
- DENSITY CHANGES from panel to panel. The establishing panel and the big moment are drawn fully; a connecting panel is a face or a hand on white, nothing else. Ease off in the light panels so the big one hits.
- SILENT PANELS are wanted: a look, a hand, a held breath between two lines (\`"lines": []\`). A page of talk has at least one.
- SHORT BALLOONS: a few words each. A line of more than about 14 words is split at a pause with \`parts\`, or said over two panels (each part in the panel where it lands), before it is ever squeezed into small type.
- THE PAGE TURN: the page's last panel makes the reader want the next page (a question, a look, a hand on a door); the surprise itself is the FIRST panel of the next page.

Rules (the checks the editor will run on your board)
- EVERY line id appears exactly once, in script order, across the chapter.
- Give the story room. Pages are free: never squeeze a scene onto one page to save pages. Aim for about 5 panels and 2 to 4 spoken lines a page; a quiet beat, a look, a reveal or a punchline gets its own panel.
- HARD LIMITS, checked by the builder (a board over them is sent back): at most 6 panels a page, at most 5 spoken lines a page, at most 70 lettered words a page. If a page would go over, start a new page. A chapter is as long as its lines need: there is no limit on the number of pages, and nothing is ever cut or squeezed to save one (20 pages or fewer happens to fit one post on X; that is a nicety, never a reason).
- 3 to 6 panels a page, about 5 as a rule (a page of 1 or 2 is allowed for a big moment); one panel clearly heavier than the others.
- A BREAK-OUT, rare (the chapter's one or two biggest physical moments, never more than one a page): a figure or an object that bursts out of its panel and stands OVER the panel borders, a sword arm, a leap, a character stepping toward the reader. Ask for one by adding \`"breakout": "who or what, and what they are doing"\` to that panel (the figure is then drawn as its own picture and laid over the page). Still describe the panel's own picture in \`action\` as usual.
- A TINY STRIP, only where the beat calls for it (most chapters have one or none, never more than one a page): 3 to 5 very small panels in a row, for a countdown, quick reactions around a room, or one moment cut into slices (an eye, a hand, a clock). Write them one after another, each with \`"weight": 1\`, \`"job": "insert"\` or \`"react"\`, \`"bg": "white"\` or \`"tone"\`, and no line or a word or two. The page is then laid out with them as one thin row, and the strip counts as ONE panel toward the limit of 6 (never more than 8 panels on the page in all).
- 35 to 55 lettered words a page (never over 70)${opening}; at most 3 balloons a panel.
- A speaker is in the panel's \`who\`, or the line is marked off.
- Every page has its \`note\`.${known}${bookBoard}

Craft checklist
${checklist}
${note ? `
## Note from the person who owns this chapter

Follow this note. Where it disagrees with the pacing guidance above, the note wins; the hard limits and "every line once, word for word, in order" still hold.

> ${note.replace(/\n+/g, "\n> ")}
` : ""}
When both files are written and valid JSON, reply with one line: the number of pages and the number of lines. Then stop.
`;
const out = path.join(dir, "PANELER_TASK.md");
fs.writeFileSync(out, task); console.log(out);
