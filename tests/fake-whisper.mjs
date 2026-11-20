#!/usr/bin/env node
// A stand-in for a local Whisper in tests: it records how it was called and prints fixed words with times. No model is run.
// FAKE_WHISPER_LOG = where to append one JSON line per call. FAKE_WHISPER_FAIL=1 makes it stop with an error.
import { appendFileSync } from "node:fs";
const argv = process.argv.slice(2);
if (process.env.FAKE_WHISPER_LOG) appendFileSync(process.env.FAKE_WHISPER_LOG, JSON.stringify({ argv }) + "\n");
if (process.env.FAKE_WHISPER_FAIL === "1") { console.error("the model file is missing"); process.exit(2); }
const en = argv.includes("--to");
console.log("loading the model (a line that is not the answer)");
console.log(JSON.stringify({ language: en ? "en" : "ja", model: "stand-in", engine: "stand-in", segments: [
  { start: 0.4, end: 1.9, text: en ? "  Over here!  " : "こっちだ！" }, { start: 2.25, end: 4.1, text: en ? "The ferry is leaving." : "フェリーが出るよ。" },
  { start: 5, end: 4, text: "times the wrong way round" }, { start: 6, end: 7, text: "   " }] }));
