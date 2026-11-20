// The Assistant's answer: steps it made up are counted (so the person is told), and its rules say that nothing has run yet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAnswer, systemPrompt } from "../page-editor/assistant.mjs";

test("a step that is not on the list is left out and counted", () => {
  const names = new Set(["split_page", "open_panel"]);
  const got = parseAnswer(JSON.stringify({ reply: "Here is how.", actions: [{ name: "split_page", args: { page: 1, after: "a2" }, why: "two pages" }, { name: "relayout_everything", args: {} }, "junk"] }), names);
  assert.equal(got.reply, "Here is how."); assert.equal(got.dropped, 1);
  assert.deepEqual(got.actions, [{ name: "split_page", args: { page: 1, after: "a2" }, why: "two pages" }]);
  assert.equal(parseAnswer('```json\n{"reply":"ok","actions":[]}\n```', names).dropped, undefined);
  assert.deepEqual(parseAnswer("just words", names), { reply: "just words", actions: [] });
});
test("the rules: nothing has run when it answers, earlier steps are reported from the app's own record, the smallest step first", () => {
  const sys = systemPrompt({ screen: "manga" }, [{ name: "split_page", desc: "Spread one page", args: { page: "page number" } }]);
  assert.match(sys, /nothing runs when you answer/); assert.match(sys, /NEVER say that something is done/);
  assert.match(sys, /\[STEPS, written by the app/); assert.match(sys, /last resort/);
  assert.match(sys, /- split_page\(page: page number\): Spread one page/);
});
