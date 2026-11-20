// Publish: send a finished manga chapter to a reading site (Ibasho Read) as a PRIVATE DRAFT. The person reviews it on the site
// and makes it public there: Ibasho never publishes anything by itself, and has no "publish now".
//
// Each person enters their own site address and publishing key. The key is kept in saved/publish.json on this computer
// (beside the other keys, outside the code, never in a project), is sent only from this server (never by the browser), is
// shown again only masked, and is never written to a log or an error message.
//
//   GET    /api/publish            { site, key: masked or "", connected, last: { ok, msg, at } }
//   POST   /api/publish            { site?, key? } saves what is given and tests the connection
//   DELETE /api/publish            forgets the key
//   POST   /api/publish/test       asks the site for the books again
//   GET    /api/publish/books      { author, books: [{ id, title, book_label, published, url, chapters: [...] }] }
//   GET    /api/publish/check?p=   the exported pages of a project against the site's limits, before anything is sent
//   POST   /api/publish/send?p=    { book, number, title, thumbnail_page?, notes?, replace? } sends every exported page
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readBody as readLimited, KB } from "./limits.mjs";
const readBody256 = (req) => readLimited(req, 256 * KB);

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_SITE = "https://read.ibasho.studio";
export const LIMITS = { pages: 100, bytes: 80 * 1024 * 1024, page: 15 * 1024 * 1024, width: 2000 }; // the site's own limits (its handoff, 20 Nov 2026)
const FILE = (saved) => join(saved, "publish.json");
const load = async (saved) => { try { return JSON.parse(await readFile(FILE(saved), "utf8")); } catch { return {}; } };
const keep = async (saved, s) => { await mkdir(saved, { recursive: true }); await writeFile(FILE(saved), JSON.stringify(s, null, 1), { mode: 0o600 }); };
/** A key as it may be shown again: its public start, the rest hidden. */
export const masked = (key) => { if (!key) return ""; const m = /^(ibr_[A-Za-z0-9]{1,16})_/.exec(key); return (m ? m[1] + "_" : key.slice(0, 4)) + "••••"; };
/** The site address as the person may give it -> its origin, or an error to show. Plain http only for a copy on this computer. */
export function siteOf(raw) {
  let u; try { u = new URL(String(raw || "").trim() || DEFAULT_SITE); } catch { throw new Error("That is not a site address. It looks like " + DEFAULT_SITE); }
  if (u.username || u.password) throw new Error("The site address has no name or password in it.");
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) throw new Error("The site address must start with https://");
  return u.origin;
}
const say = (code, error) => ({ ok: false, status: 0, code, error });
/** One call to the site. Never throws; the key goes in the header and nowhere else. -> { ok, status, ...the site's JSON } */
async function call(site, key, path, opts = {}) {
  let res;
  try { res = await fetch(new URL("/api/v1/" + path, site), { method: opts.method || "GET", headers: { authorization: "Bearer " + key, accept: "application/json" }, body: opts.body, redirect: "error", signal: AbortSignal.timeout(opts.ms || 20000) }); }
  catch (e) { return say("network", e && e.name === "TimeoutError" ? "The site did not answer in time. Nothing was saved there. Try again." : "The site could not be reached. Check the address and the internet connection. Nothing was saved there."); }
  let j = null; try { j = await res.json(); } catch { /* not JSON */ }
  if (!j || typeof j !== "object") return { ok: false, status: res.status, code: "bad_response", error: `The site gave an answer Ibasho could not read (${res.status}). Is this the address of an Ibasho Read site?` };
  return { ok: res.ok, status: res.status, ...j };
}
const WORDS = { // what to do next, added to the site's own words (which are written for people)
  unauthorized: "That key does not work. Make a new one on the site (Author studio, Publishing keys) and paste it here.",
  rate_limited: "The site has had enough requests from this key for now. Try again later.",
  book_not_found: "That book is no longer there, or belongs to another account. The list of books was read again.",
  chapter_published: "That chapter is already public or set to go public on the site. It cannot be replaced from Ibasho: pick another number, or change it on the site.",
  too_large: "The chapter is over the site's 80 MB. Split the chapter in two.",
};
const forPeople = (r) => ({ ...r, error: r.error || `The site answered ${r.status}.`, next: WORDS[r.code] || "" });
async function books(saved) {
  const s = await load(saved); if (!s.key) return { ok: false, status: 0, code: "no_key", error: "No publishing key is saved yet." };
  const r = await call(s.site || DEFAULT_SITE, s.key, "books/");
  s.last = r.ok ? { ok: true, msg: `Connected as ${String(r.author || "the author").slice(0, 80)}. ${(r.books || []).length} manga book${(r.books || []).length === 1 ? "" : "s"}.`, at: new Date().toISOString() }
    : { ok: false, msg: WORDS[r.code] || r.error || "The site did not answer.", at: new Date().toISOString() };
  await keep(saved, s);
  return r.ok ? { ok: true, site: s.site || DEFAULT_SITE, author: r.author || "", books: Array.isArray(r.books) ? r.books : [] } : forPeople(r);
}
const state = async (saved) => { const s = await load(saved); return { site: s.site || DEFAULT_SITE, key: masked(s.key), connected: !!(s.key && s.last && s.last.ok), last: s.last || null, keys_at: (s.site || DEFAULT_SITE) + "/studio/keys/", new_manga_at: (s.site || DEFAULT_SITE) + "/studio/manga/new/" }; };

const pagesOf = async (saved, proj) => { const dir = join(saved, "exports", proj); let names = []; try { names = (await readdir(dir)).filter((n) => /^page-\d+\.png$/.test(n)).sort((x, y) => parseInt(x.slice(5), 10) - parseInt(y.slice(5), 10)); } catch { /* none exported */ } return { dir, names }; }; // sorted by number: page-100 comes after page-99
const run = (cmd, args, ms = 600000) => new Promise((ok, bad) => execFile(cmd, args, { timeout: ms, maxBuffer: 1 << 24 }, (e, out, err) => (e ? bad(new Error(String(err || e.message).trim().split("\n").pop())) : ok(String(out)))));
/** The exported pages made ready to send: at most 2,000 px wide (the site scales anything wider down itself), PNG when the
 *  whole chapter fits the site's size limit, else JPEG at quality 92. -> { files: [{ name, path, bytes, type }], kind, bytes } */
const PREP = `import sys, os, json
from PIL import Image
src, out, width, cap = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
names = json.loads(sys.argv[5])
def make(kind):
    files, total = [], 0
    for i, n in enumerate(names):
        im = Image.open(os.path.join(src, n)).convert("RGB")
        if im.width > width: im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
        name = "%03d.%s" % (i + 1, "png" if kind == "png" else "jpg"); f = os.path.join(out, name)
        im.save(f, "PNG", optimize=True) if kind == "png" else im.save(f, "JPEG", quality=92, optimize=True)
        b = os.path.getsize(f); total += b; files.append({"name": name, "path": f, "bytes": b, "type": "image/png" if kind == "png" else "image/jpeg"})
        if kind == "png" and total > cap: return None
    return {"files": files, "kind": kind, "bytes": total}
got = make("png") or make("jpeg")
for f in os.listdir(out):
    if got and not any(x["name"] == f for x in got["files"]): os.remove(os.path.join(out, f))
print(json.dumps(got))`;
async function prepared(dir, names, out) { return JSON.parse((await run("/usr/bin/python3", ["-c", PREP, dir, out, String(LIMITS.width), String(LIMITS.bytes - 2 * 1024 * 1024), JSON.stringify(names)])).trim().split("\n").pop()); }

const readJson = async (req) => { const b = await readBody256(req); try { return JSON.parse(b.toString("utf8") || "{}"); } catch { return {}; } };
const json = (res, data, code = 200) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store"); res.end(JSON.stringify(data)); return true; };
const sending = new Set(); // one send a project at a time

export async function publish(req, res, url, saved) {
  if (!url.pathname.startsWith("/api/publish")) return false;
  const p = url.pathname, proj = (url.searchParams.get("p") || "").replace(/[^\w-]/g, "_");
  if (p === "/api/publish" && req.method === "GET") return json(res, await state(saved));
  if (p === "/api/publish" && req.method === "DELETE") { const s = await load(saved); delete s.key; delete s.last; await keep(saved, s); return json(res, await state(saved)); }
  if (p === "/api/publish" && req.method === "POST") {
    const b = await readJson(req), s = await load(saved);
    if (b.site != null) { try { const site = siteOf(b.site); if (site !== (s.site || DEFAULT_SITE)) delete s.last; s.site = site; } catch (e) { return json(res, { error: e.message }, 400); } }
    if (b.key != null) { const key = String(b.key).replace(/\s+/g, ""); // a key has no spaces or line breaks: ones pasted along are dropped
      if (!/^[\x21-\x7e]{12,300}$/.test(key)) return json(res, { error: "That does not look like a publishing key. Copy it whole from the site (it starts with ibr_)." }, 400);
      s.key = key; delete s.last; }
    await keep(saved, s);
    if (s.key) await books(saved); // the test: its outcome is kept as "last"
    return json(res, await state(saved));
  }
  if (p === "/api/publish/test" && req.method === "POST") { await books(saved); return json(res, await state(saved)); }
  if (p === "/api/publish/books" && req.method === "GET") { const r = await books(saved); return json(res, r, r.ok ? 200 : r.status >= 400 ? r.status : 502); }
  if (p === "/api/publish/check" && req.method === "GET") { // before anything is sent: how many pages are exported, and whether they fit
    const { dir, names } = await pagesOf(saved, proj); let bytes = 0, at = 0; for (const n of names) { const st = await stat(join(dir, n)); bytes += st.size; at = Math.max(at, st.mtimeMs); }
    return json(res, { pages: names.length, exported_at: at, bytes, limits: LIMITS, problems: [names.length ? "" : "No page of this chapter is exported yet.", names.length > LIMITS.pages ? `This chapter has ${names.length} pages and the site takes ${LIMITS.pages} a chapter. Split it in two.` : ""].filter(Boolean) });
  }
  if (p === "/api/publish/send" && req.method === "POST") {
    const b = await readJson(req), s = await load(saved);
    if (!s.key) return json(res, { error: "No publishing key is saved yet.", code: "no_key" }, 400);
    const number = parseInt(b.number, 10), title = String(b.title || "").trim(), notes = String(b.notes || "").trim(), book = parseInt(b.book, 10);
    if (!(book > 0)) return json(res, { error: "Choose the book this chapter belongs to.", code: "no_book" }, 400);
    if (!(number >= 1 && number <= 9999) || String(number) !== String(b.number).trim()) return json(res, { error: "The chapter number is a whole number from 1 to 9999.", code: "bad_number" }, 400);
    if (!title || title.length > 200) return json(res, { error: "Give the chapter a title (up to 200 letters).", code: "bad_title" }, 400);
    if (notes.length > 5000) return json(res, { error: "The note is over 5,000 letters.", code: "bad_notes" }, 400);
    const { dir, names } = await pagesOf(saved, proj);
    if (!proj || !names.length) return json(res, { error: "No page of this chapter is exported yet.", code: "no_pages" }, 400);
    if (names.length > LIMITS.pages) return json(res, { error: `This chapter has ${names.length} pages and the site takes ${LIMITS.pages} a chapter. Split it in two. Nothing was sent.`, code: "too_many_pages" }, 400);
    if (sending.has(proj)) return json(res, { error: "This chapter is being sent already.", code: "busy" }, 409);
    sending.add(proj);
    const work = await mkdtemp(join(tmpdir(), "ibasho-publish-"));
    try {
      let made; try { made = await prepared(dir, names, work); } catch (e) { return json(res, { error: "The pages could not be made ready: " + e.message, code: "prepare" }, 500); }
      if (!made || made.bytes > LIMITS.bytes - 2 * 1024 * 1024) return json(res, { error: `The pages come to ${Math.round((made ? made.bytes : 0) / 1048576)} MB even as JPEG, and the site takes 80 MB a chapter. Split the chapter in two. Nothing was sent.`, code: "too_large" }, 400);
      const big = made.files.find((f) => f.bytes > LIMITS.page); if (big) return json(res, { error: `Page ${parseInt(big.name, 10)} is over 15 MB, the most the site takes for one page. Nothing was sent.`, code: "page_too_large" }, 400);
      const form = new FormData();
      form.set("number", String(number)); form.set("title", title);
      const thumb = parseInt(b.thumbnail_page, 10); if (thumb >= 1 && thumb <= made.files.length) form.set("thumbnail_page", String(thumb));
      if (notes) form.set("notes", notes);
      if (b.replace === true) form.set("replace", "true");
      for (const f of made.files) form.append("pages", new Blob([await readFile(f.path)], { type: f.type }), f.name); // 001, 002 ...: the order is the names'
      const r = await call(s.site || DEFAULT_SITE, s.key, `books/${book}/chapters/`, { method: "POST", body: form, ms: 300000 });
      if (!r.ok) return json(res, forPeople(r), r.status >= 400 ? r.status : 502);
      const sent = { at: new Date().toISOString(), site: s.site || DEFAULT_SITE, book, number, title, pages: made.files.length, replaced: r.status === 200, review_url: (r.chapter || {}).review_url || "", preview_url: (r.chapter || {}).preview_url || "" };
      s.sent = s.sent || {}; s.sent[proj] = sent; await keep(saved, s); // where and when this chapter last went, so it can be sent again to the same place
      return json(res, { ok: true, status: r.status, chapter: r.chapter || {}, sent, kind: made.kind, bytes: made.bytes, message: "Sent to Ibasho Read as a draft. Open the site to review and publish." });
    } finally { sending.delete(proj); await rm(work, { recursive: true, force: true }); }
  }
  if (p === "/api/publish/sent" && req.method === "GET") { const s = await load(saved); return json(res, (s.sent || {})[proj] || null); }
  return json(res, { error: "not found" }, 404);
}
