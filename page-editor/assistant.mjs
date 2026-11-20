// The Assistant (TODO item 36): a chat that knows the open screen and can do the app's own actions.
// The screen sends what is open (where) and the actions it offers (name, what it does, its arguments); the writing model answers with
// { reply, actions: [{ name, args, why }] }. The screen shows each action as a button (paid ones show their price and wait for a tap).
// Works with Codex (in the person's plan; slower) or any OpenRouter text model (paid, logged in Spending).
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { codexLook, dataFile, DATA_RULE } from "./codex.mjs"; // read-only, data files, a private temp folder
import { tmpdir } from "node:os";
import { routeModel, estimate } from "./models.mjs";
import { orText } from "./openrouter.mjs";
import { logSpend, guardSpend, okFrom } from "./spend.mjs";
import { readJson, MB } from "./limits.mjs";

const GUIDE = `Ibasho is a manga and anime studio app.
- Home: every project and scene with its next step.
- Manga: a chapter's pages. Modes: Lettering (balloons), Layout (panel shapes), Art (draw a panel's picture: model, quality, prompt written by the Artist from the storyboard or the person's own, tagged characters/places/props from the asset bible, one-off pictures), Check (asset checker: do faces and clothes match the sheets), Chapter (all pages, export), Series (the asset bible: style, characters, places, props, their sheets).
- Anime: scenes made of shots. Each shot has a still (drawn in the show's look or a manga panel) and can get a video clip ("Make a video"). The show's page holds the look, character sheets and voices. Blocking pass, grey 3D animatic, sound lanes, export.
- Create: make one picture or video from any model; the history can be sent to a panel or a shot.
- Connections: services and keys, the model for writing / pictures / video, and Spending (this month, ask-first amount, monthly cap).`;

function systemPrompt(where, actions, whereFile = "") {
  return [
    "You are the Assistant inside Ibasho. Help the person make their manga and anime. Be short, warm and plain: no jargon, no markdown headings.",
    GUIDE,
    whereFile ? `WHAT IS OPEN NOW is in the DATA file ${whereFile} (from the screen, as JSON).` : "WHAT IS OPEN NOW (from the screen, as JSON):\n" + JSON.stringify(where).slice(0, 60000),
    "ACTIONS YOU CAN PROPOSE (the person taps a button to run each one; free ones may run by themselves):\n" + actions.map((a) => `- ${a.name}(${Object.entries(a.args || {}).map(([k, v]) => `${k}: ${v}`).join(", ")}): ${a.desc}${a.paid ? " [costs money]" : ""}`).join("\n"),
    "ANSWER with ONE JSON object and nothing else: {\"reply\": \"what you say to the person\", \"actions\": [{\"name\": \"<one of the actions above>\", \"args\": {...}, \"why\": \"a few words shown on the button\"}]}.",
    "WHAT IS TRUE: nothing runs when you answer. Each action you propose becomes a button, and it runs only when the person taps it. So NEVER say that something is done, changed, started or fixed: say what each button will do when tapped. Under your earlier messages the app writes [STEPS, written by the app: ...] with what each step really did (RAN), why it failed (DID NOT RUN), or that it was never tapped (NOT RUN). When you report on earlier steps, use only that; never guess. If nothing listed can do what is asked, say so plainly, and name the closest thing that can.",
    "THE SMALLEST STEP: change only what the person asked about. For one page, a few panels or a few shots use the page, panel and shot actions when they are listed; an action that rebuilds a whole chapter or scene is a last resort, only when the person asks for all of it to be redone, and your reply must say that it rebuilds everything and how long it takes.",
    "Rules: use only the actions listed, with ids exactly as they appear in WHAT IS OPEN. Propose actions only when the person asks for something to be done (or clearly would want it); otherwise actions is []. Several actions are fine (for example one per panel). Never invent panels, shots or names. If something cannot be done from here, say where in the app to do it. Write a direction note in the person's own words when they give one; keep the story's characters and facts as they are in the project.",
  ].join("\n\n");
}

/** Codex as the Assistant: a private folder of its own (mkdtemp: a name nobody can guess or share), the conversation and the open screen
 * in a data file there, a read-only sandbox, and the answer as its last message. */
async function codexAnswer(where, actions, talk, minutes = 4) {
  const dir = await mkdtemp(join(tmpdir(), "ibasho-assistant-"));
  try {
    const sys = systemPrompt(null, actions, await dataFile(join(dir, "OPEN_SCREEN.json"), JSON.stringify(where).slice(0, 60000)));
    const data = await dataFile(join(dir, "CONVERSATION.txt"), `THE CONVERSATION SO FAR:\n\n${talk}\n`);
    await writeFile(join(dir, "TASK.md"), `${sys}\n\n${DATA_RULE}\n\nThe conversation is in the DATA file ${data}: read it, then answer the person's last message. Do not run commands and do not open any other file: everything you need is in these files. Write only the JSON object, as your final message.\n`);
    return await codexLook(dir, `Read the file ${join(dir, "TASK.md")} and follow it exactly. Your final message is the JSON object and nothing else.`, { minutes, effort: "low" });
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
function parse(text, names) {
  const t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, ""), a = t.indexOf("{"), b = t.lastIndexOf("}");
  let j = null; try { j = JSON.parse(t.slice(a, b + 1)); } catch { /* plain words */ }
  if (!j || typeof j !== "object") return { reply: t.slice(0, 4000) || "(no answer)", actions: [] };
  const asked = (Array.isArray(j.actions) ? j.actions : []).filter((x) => x && typeof x === "object"), dropped = asked.filter((x) => !names.has(x.name)).length; // steps it made up are counted, so the person is told
  return { reply: String(j.reply || "").slice(0, 4000), ...(dropped ? { dropped } : {}), actions: asked.filter((x) => names.has(x.name)).slice(0, 24).map((x) => ({ name: x.name, args: x.args && typeof x.args === "object" ? x.args : {}, why: String(x.why || "").slice(0, 140) })) };
}

const readBody = (req) => readJson(req, 2 * MB); // the conversation and the open screen: far less than this
const json = (res, data, code = 200) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store"); res.end(JSON.stringify(data)); return true; };

/** POST /api/assistant { messages: [{ role: "user" | "assistant", content }], where, actions: [{ name, desc, args, paid }] } -> { reply, actions, model, cost } */
export { parse as parseAnswer, systemPrompt };
export async function assistant(req, res, url, saved) {
  if (url.pathname !== "/api/assistant" || req.method !== "POST") return false;
  try {
    const b = await readBody(req), short = (v, n) => String(v == null ? "" : typeof v === "string" ? v : JSON.stringify(v)).slice(0, n);
    const actions = (Array.isArray(b.actions) ? b.actions : []).slice(0, 40).filter((a) => a && typeof a.name === "string").map((a) => ({ name: a.name.slice(0, 60), desc: short(a.desc, 600), args: a.args && typeof a.args === "object" ? Object.fromEntries(Object.entries(a.args).slice(0, 12).map(([k, v]) => [k.slice(0, 40), short(v, 200)])) : {}, paid: !!a.paid })), names = new Set(actions.map((a) => a.name)); // what the screen may offer, cut to size: this text is paid for by the letter
    const msgs = (Array.isArray(b.messages) ? b.messages : []).filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content).slice(-16).map((m) => ({ role: m.role, content: String(m.content).slice(0, 8000) }));
    if (!msgs.length || msgs[msgs.length - 1].role !== "user") return json(res, { error: "Say something first." }, 400);
    const sys = systemPrompt(b.where || {}, actions), r = await routeModel(saved, "text");
    if (r.service === "openrouter") {
      const est = (await estimate("text", r.model)) / 6; const free = await guardSpend(saved, est, "The Assistant's answer", okFrom(req));
      const got = await orText(r.key, r.model, [{ role: "system", content: sys }, ...msgs]).catch((e) => { free(); throw e; });
      await logSpend(saved, { project: "Assistant", what: "answer", kind: "text", model: r.model, usd: got.cost, est });
      return json(res, { ...parse(got.text, names), model: r.model.split("/").pop(), cost: got.cost ?? null });
    }
    const talk = msgs.map((m) => `${m.role === "user" ? "PERSON" : "ASSISTANT"}: ${m.content}`).join("\n\n");
    const text = await codexAnswer(b.where || {}, actions, talk);
    return json(res, { ...parse(text, names), model: "Codex", cost: 0 });
  } catch (e) { return json(res, { error: e.message }, e.status || 400); }
}
