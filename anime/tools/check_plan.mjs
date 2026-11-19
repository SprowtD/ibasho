#!/usr/bin/env node
// The plan check (craft gate G1) from the command line: node anime/tools/check_plan.mjs <SCENE_PLAN.json> [--json]
// Prints each error and warning, then PASS or FAIL; exit 1 on FAIL.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const P = createRequire(import.meta.url)("../core/plan.js");
const [file, flag] = process.argv.slice(2);
if (!file) { console.error("usage: check_plan.mjs <SCENE_PLAN.json> [--json]"); process.exit(2); }
const r = P.check(JSON.parse(readFileSync(file, "utf8")));
if (flag === "--json") { console.log(JSON.stringify(r)); process.exit(r.pass ? 0 : 1); }
const s = r.stats;
console.log(`${s.shots} shots, ${s.seconds} s, median ${s.median} s` + (s.thirds ? `; mean shot length by third ${s.thirds.join(" / ")} s` : ""));
for (const w of r.warnings) console.log("WARN ", (w.shot ? w.shot + ": " : "") + w.msg);
for (const e of r.errors) console.log("ERROR", (e.shot ? e.shot + ": " : "") + e.msg);
console.log(r.pass ? "PASS" : `FAIL (${r.errors.length} errors)`);
process.exit(r.pass ? 0 : 1);
