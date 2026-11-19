# Anime side ("Anime Desk")

Built so far (16 Nov 2026): step 1, **shot list + still animatic**, and step 2, **grey 3D animatic** (StageFlow). No paid model is called anywhere here.

## What it does
1. **Animate manga pages:** pick a storyboarded manga project and tick the pages of one scene. Every panel becomes a shot (`core/plan.js` `draftFromPages`): its action, who is where, its lines (a line split over joined balloons is one line), a rough type and length (long enough to say the lines), and the panel's picture as the shot's still.
2. **Shot list on a phone:** each shot as a card: length −/+, mouth on/off per line, move up/down, add, split, delete (its lines move to the neighbouring shot), and an editor for type, framing, camera move + reason, setup id, action, book verb, expressions, line placement and the five movement layers. Scene cards: intent, lighting, palette, sound plan, signature gestures, craft checks. Saves as you type.
3. **Plan check (craft gate G1)** on every change: `core/plan.js` `check`, a port of an earlier Python checker (same errors and warnings on the same plan, tested 16 Nov on a draft and on a finished plan), minus the previs camera list.
4. **Blocking pass (Codex):** `agents/blocking/role.md` turns the draft into a real anime plan (in-between movement, cameras with reasons, timing, scene cards). Run unattended by `server.mjs` (`codex exec`, effort high); the check runs after, and Codex is sent back once with the problems. The dialogue must come back word for word, or it is put back. The old plan is kept in `history/`; "Versions" puts one back.
5. **Still animatic:** plays the shots at their lengths in the browser: stills with a slow push, pull or pan from the camera move, grey cards with the action and name dots for shots with no picture, subtitles (mouth-off lines in italics), a scrub bar with shot ticks.

6. **Grey 3D animatic (step 2):** the Previs agent (`agents/previs/role.md`, Codex) writes a StageFlow score (`previs/score.yaml`): the place at real size, a mannequin per character walking the blocking, every shot's camera, lens and move, timed exactly to the plan. `core/score.mjs` checks it (timeline = plan, entities exist, blocking inside its shot, **no camera inside a person or prop, nobody between the lens and what it frames** unless the shot says over-the-shoulder) and Codex is sent back once with the errors. Then this computer films it: `npm run record` in the StageFlow folder, 720p, 12 fps (about 5 min for 48 s on the PC), one render at a time. "Play grey 3D" plays it with the subtitles in step; "Show stills" switches. Changing shot lengths makes it "out of date": "Render again" moves every shot and move to the new times without AI (`retime`); adding or removing shots needs the previs pass again. "View from above" renders the set from the top with the cameras shown. Old scores are kept in `previs/history/`.
   StageFlow is found at `STUDIO_STAGEFLOW`, else a folder called `stageflow` next to the app (MIT, github.com/taruma/stageflow): clone it there and run `npm install` in it.

7. **Scenes of their own and sound (17 Nov):** a scene can start from a script or from nothing (`core/plan.js` `draftFromScript`; `scene.json` has an empty `project`), each shot can take an uploaded still (`stills/`), and music, voice and sound-effect files (`audio/`, placed by `sound.json`: start with the scene or a shot, offset, skip, length, loudness) play in step with the animatic. Routes: `/api/anime/upload`, `/api/anime/sound`; `/api/anime/media` serves `stills/` and `audio/`.

8. **Looks and drawing (17 Nov):** a look says how the anime is drawn: a name, words (or one of five templates, `core/looks.json`, example pictures in `ui/looks/` made by `tools/look_examples.mjs`), up to 8 reference pictures, and its own sheets for characters, places and props. Looks live in `page-editor/anime-looks/<id>/` (not in git; `STUDIO_LOOKS` for tests) and are shared: a scene points at one, and a scene made from a manga joins its series' look. "Draw" on a shot or a sheet goes through Codex's image tool in the studio's one queue (`page-editor/saved/queue.json`, kind "anime"; `dev.mjs` alone uses a small queue of its own). A shot sends, five pictures at most: look references, its current picture as the composition reference (a manga panel keeps its staging), then sheets (the look's own first, the manga's only when the look has none). Takes are kept as `stills/<shot>-takeNN.png`, trimmed to 16:9 with the whole picture in `stills/full/`; `/api/anime/request` returns what would be sent. Tested 17 Nov: without a colour sheet the model took a character's clothes and hair from the look picture; with a sheet drawn in the look it did not.

9. **Shows and episodes (17 Nov):** a show is a look plus its episodes (`anime-looks/<id>/show.json`: ordered episodes, each an ordered list of scene ids, cleaned on every read against the scenes that point at the look). Every scene is in the show whose look it uses. Routes: `/api/anime/shows` (list, new), `/api/anime/show?show=` (state, save episodes), `/api/anime/place?id=` (put a scene into a show and episode), and `look`, `draw`, `draws`, `upload` take `show=` in place of a scene's `id=`, so style and sheets are set up before any scene exists (a sheet drawn that way is queued under `~look~<id>`). Screens: `#/` grouped by show, `#/show/<id>`, `#/newin/<show>/<episode>`.

10. **The Writer (17 Nov):** `agents/writer/role.md`. `runShowIdea` (task `SHOW_TASK.md` in the look's folder, answer `show_idea.json`) adds cast entries to the look and episodes with `summary` and planned scenes (`ideas`) to `show.json`; `runSceneIdea` (task `WRITE_TASK.md`, answer `script.md` in the scene's folder) then `draftFromScript`. Jobs: kind "show" under `~look~<id>`, kind "writing" under the scene id (editing waits, as for Blocking). Routes: `POST /api/anime/shows {name, idea}`, `POST /api/anime/showidea?show=`, `POST /api/anime/scenes {title, idea, show, episode, planned}`.

11. **Sound layers (17 Nov):** `sound.json` = `{ tracks: [{ id, kind: voice|music|sfx, name, who, gain, mute, solo }], gone: [names whose voice layer was removed], clips: [{ ..., track, line, fadeIn, fadeOut }] }`. `ensureTracks` (ui/app.js) makes the layers and places older clips by kind. `Mix` is the one sound engine (used by the timeline and by `Player`); `Clock` is the player when it is docked beside the timeline, else a clock of its own. `window.__mix()` reports what each clip is doing (used by browser tests).

12. **Recording, fitting, export, clips, episodes (17 Nov, late):** `core/export.mjs` makes a scene's mp4 with ffmpeg (stills with moves, video clips, grey cards, ASS subtitles, the mixed sound with fades and the music dip); `runExport` (scene `export/`, five kept) and `runEpisode` (show `export/`, joined with the concat demuxer, three kept per episode). A shot's video clip: `clip`, `clip_dur`, `clip_from`, `clip_sound`, `clip_poster` on the shot, files in the scene's `clips/` (`keepClip`); its sound is a sound clip with `clipOf` kept in step by `ensureTracks`. Takes: sound clips sharing a `line`, all but one with `off`. Routes: `upload?kind=clip`, `peaks`, `export`, `episode?show=&ep=`, `showfile?show=&f=`.

## Files
- `core/plan.js`: draft + check (browser and node)
- `server.mjs`: `anime(req, res, url)` routes: `/anime/` screens, `/api/anime/projects | scenes | scene | plan | block | history`
- `ui/index.html`, `ui/app.js`: the screens
- `agents/blocking/role.md`: the Blocking + Cinematographer agent
- `core/score.mjs`: StageFlow scores: check, camera geometry, retime, render
- `agents/previs/role.md`: the Previs agent
- `tools/check_plan.mjs`, `tools/check_score.mjs`: the checks from the command line
- `dev.mjs`: test server on its own port

Scenes live in `page-editor/anime-scenes/<id>/` (`scene.json`, `SCENE_PLAN.json`, `history/`, `previs/` with score.yaml, pov.mp4, top.mp4, meta.json, history/; the Codex task files). Not in git: the person's own work.

## Test
    STUDIO_ANIME=<scratch dir> node anime/dev.mjs 5191     # never the real anime-scenes/
then http://localhost:5191/anime/. It reads the manga projects and saved pages read-only.
