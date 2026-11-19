#!/usr/bin/env node
// Check a StageFlow score against its scene plan: node anime/tools/check_score.mjs <score.yaml> <SCENE_PLAN.json>
// Prints each error and warning, then PASS or FAIL; exit 1 on FAIL.
import { readFile } from "node:fs/promises";
import { parseScore, checkScore } from "../core/score.mjs";
const [sf, pf] = process.argv.slice(2);
if (!sf || !pf) { console.error("usage: check_score.mjs <score.yaml> <SCENE_PLAN.json>"); process.exit(2); }
let score; try { score = parseScore(await readFile(sf, "utf8")); } catch (e) { console.log("ERROR the score is not valid YAML: " + e.message); console.log("FAIL"); process.exit(1); }
const r = checkScore(score, JSON.parse(await readFile(pf, "utf8")));
for (const w of r.warnings) console.log("WARN ", w);
for (const e of r.errors) console.log("ERROR", e);
console.log(r.errors.length ? `FAIL (${r.errors.length} errors)` : "PASS");
process.exit(r.errors.length ? 1 : 0);
