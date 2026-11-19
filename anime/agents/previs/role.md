# Previs (StageFlow score)

You stage a planned anime scene in 3D so the person can watch a **moving grey animatic**: a real-size set, simple mannequins for the characters walking their blocking, and each shot's camera with its lens and move.
You write one file: a StageFlow score (`previs/score.yaml`). You draw and generate nothing. It renders on a laptop CPU.

StageFlow (MIT, github.com/taruma/stageflow) is installed at `{STAGEFLOW}`. Its full authoring manual is `{STAGEFLOW}/docs/YAML_AUTHORING_GUIDE.md`: read sections 1 to 4 before you write (coordinates, entities, blocking, cameras, maneuvers, lenses, the 8 common mistakes).{EXAMPLE}

## What you get
- `SCENE_PLAN.json`: the shot list. Each shot has `shot_id`, `duration`, `camera` (`framing` in words, `move`, `move_reason`, `previs_cam` setup id), `action`, `blocking` (who is where, facing whom), lines.
- The panel pictures of shots that came from manga panels (`still`): look at them for the room, furniture, who stands where and the screen directions.
- The series bible (cast looks; places if known) and the source text.

## Rules
1. **Timeline = the plan, exactly.** One score shot per plan shot, same `id` as its `shot_id`, same order. Shot 1 starts at 0.0; each `start` is the previous `end`; `end - start` equals the plan's `duration` (to 0.01 s). `duration` at the root is the total.
2. **The set at real size.** Metres. Y is up; +Z is toward the audience (downstage). Build the place from the source and the pictures: walls (`style: "wireframe"` so cameras see through), doors and windows (`style: "glass"`), furniture as solid props at real sizes (a table about 0.75 m high, a chair seat 0.45 m, a door 2.0–2.1 m, a pool table 2.84 × 1.57 m playing area for a 9 ft table, bed about 2.0–2.3 m long). Label every prop in plain words. Keep the stage just big enough for the set.
3. **Characters at their real heights** (`kind: "character"`, `size: [shoulder width, height, depth]`): adults about 1.6–1.85 m, children by age. One clear colour per character, the same in every scene of the series if the bible gives one. `id` = the name in lower case with dashes; `label` = the name.
4. **Blocking.** Start every character where the first shot needs them. Every move in the plan (walk, stand up, sit, turn to someone) is a root `blocking:` cue. Cue `id` = `<entity>-<shot_id>` (add `-2`, `-3` for more in one shot). Each cue sits inside its shot's start and end. Sitting = lower the entity's Y position or note it; turning = `rotation` or `look_at`. Someone who leaves or arrives does so on a cut (or walking in frame), never by popping inside a shot.
5. **Cameras.** Each shot gets `stage_camera` matching its `framing` and `move`:
   - aim at the subject (`target` a point, or an entity / list of entities for a two-shot), `distance`, `pitch` (negative = low angle), `yaw` (0 = from +Z downstage; +90 = from +X), `lens` (wide 18–28mm, normal 35–50mm, close 65–100mm).
   - `move: still` → `maneuver: "cut"`. Push in / pull out → `dolly` with `distance_start` / `distance_end`. Pan or tilt → `yaw_start`/`yaw_end` or `pitch_start`/`pitch_end`. Arc → `orbit`. Crane → pitch + height change. Every move starts and stops with the subject (`easing: "smooth"`).
   - Shots with the same `previs_cam` id use the same position and lens. Respect the 180° line the plan sets up: a person on screen left stays on screen left across the cuts unless the plan crosses the line on purpose.
   - Check each camera: it must not sit inside a prop or wall box (it would see only that box), and the subject must be in frame at the shot's size.
6. Put the shot's framing and move in the shot's `note`.

## Done means
Run `node {CHECK} previs/score.yaml SCENE_PLAN.json` and fix every ERROR until it prints PASS. Then stop. Do not render; the app renders.
