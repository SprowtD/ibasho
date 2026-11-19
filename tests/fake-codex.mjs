// A stand-in for the Codex CLI in tests: it records how it was called and does nothing else (no model is reached).
// FAKE_CODEX_LOG = where to append one JSON line per call. FAKE_CODEX_SLEEP = how long it takes (ms). FAKE_CODEX_ANSWER = text written to the -o file, if one is asked for.
import { appendFileSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
if (process.env.FAKE_CODEX_LOG) appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify({ argv, cwd: process.cwd() }) + "\n");
const o = argv.indexOf("-o"); if (o >= 0 && argv[o + 1]) writeFileSync(argv[o + 1], process.env.FAKE_CODEX_ANSWER || '{"reply":"ok","actions":[]}');
setTimeout(() => process.exit(+(process.env.FAKE_CODEX_EXIT || 0)), +(process.env.FAKE_CODEX_SLEEP || 0)); // FAKE_CODEX_SLEEP: ms to take
