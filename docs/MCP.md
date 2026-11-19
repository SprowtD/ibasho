# Ibasho for agents (MCP server)

`page-editor/mcp.mjs` lets Claude Code, Codex or any MCP client work the studio the way a person does. It talks to the **running** app over the app's own routes, so the screen and the agent never disagree. Node built-ins only.

## Set up

1. Start the app: `node page-editor/server.mjs` (http://localhost:5178).
2. Add the server to your client. Claude Code reads `.mcp.json` in this folder by itself. For others:
   ```json
   { "mcpServers": { "ibasho": { "command": "node", "args": ["/path/to/ibasho/page-editor/mcp.mjs"] } } }
   ```
3. Optional settings: `IBASHO_URL` (where the app is, default `http://127.0.0.1:5178`), `IBASHO_CHROME` (a Chrome or Chromium binary; needed only for `view_page` and `export_pages`, found by itself when it can be).

The MCP server must run on the same computer as the app (the app lets its own computer in without the access code that other devices need).

Ask the agent to call `guide` first.

## Tools

| Tool | What it does |
|---|---|
| `guide`, `status` | How to work here; what is running, spending, models picked |
| `list_projects`, `get_chapter`, `get_page` | Read chapters: pages, panels, storyboard, balloons |
| `edit_panel` | One panel's storyboard, background strength, framing, in-picture writing |
| `set_layout`, `apply_template`, `split_page` | One page's layout, by hand or from a template; spread a crowded page over two |
| `set_picture` | Put a picture on a panel (from the art list or a file) |
| `draw_panels`, `wait_for_jobs` | The Artist: panels, a page, or everything missing; `dry_run` shows prompts and cost |
| `storyboard`, `new_project` | The Paneler on a whole chapter; a new chapter from a script |
| `letter_pages`, `edit_balloons`, `check_pages` | The Letterer, single balloons, the page checks |
| `view_page`, `export_pages` | See a page as a picture; export 2048 x 3072 PNGs |
| `series_settings`, `draw_sheet` | Style, cast, places, props, sheets; the series' reading direction (`reading`: `rtl` or `ltr`) |
| `anime_overview`, `anime_scene`, `anime_edit_shots` | Shows and scenes; edit a shot list and the scene cards |
| `anime_draw`, `anime_run` | Stills, videos and sheets; blocking, previs, render, export, check, episode |
| `request` | Any other route of the app (books, models, spending, Create, looks, sound, uploads); `guide` lists them |

## Reading direction

A series reads right to left (manga) or left to right (comic). `list_projects`, `get_chapter` and `get_page` say which (`reads`). `new_project` takes `reading` (`rtl` is the start for a new series; a chapter that joins a series with `like` reads the way that series does). Panels in a row are always listed in reading order, so on a right-to-left page the first one is drawn on the right; `set_layout`, `apply_template` and `split_page` keep the page's direction, and `letter_pages` puts the first balloon of a panel top right. `series_settings` with `reading` turns the whole series: panels change sides, balloons keep their place inside their panel, pictures are not redrawn.

## Rules it keeps

- **Money.** Codex jobs are in your plan. OpenRouter jobs are estimated first; over your "ask me first" amount the tool refuses until the agent passes `approved_usd`, which it should only do after you said yes. The monthly cap is checked before and again by the app.
- **Saved work.** Nothing is deleted or rebuilt without `destructive: true` (or `confirm_rebuild` for a storyboard). Layout tools refuse to drop a panel unless it is listed in `remove`. Keys and sign-ins cannot be changed from here.
- **Strict books** refuse to draw a character with no approved sheet, as on the screen.
- A browser tab open on the same chapter or scene keeps its own copy and can save over the agent's changes: reload the tab after the agent has worked.

## How it matches the screen

Lettering, the page checks and the Artist's prompts run the app's own code (`render.js`, `core/artist.js`, `core/paneler.js`). Text is measured with Pillow from the same font files, per letter with no kerning, so a balloon can come out a few units wider or narrower than in the browser. Pages are drawn to pictures by headless Chrome from the same SVG the Export button makes.
