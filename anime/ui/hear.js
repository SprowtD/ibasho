// "Write down what is said": any button with data-hear="<a sound or clip of this scene>" opens this window. A Whisper installed on
// this computer listens (free, nothing is sent anywhere) and the words come back with their times. They can be copied, or put into
// one of the shot's lines: a line that already has words is only replaced after the person says yes.
// The scene screen gives what this needs through window.IbashoHear = { scene(), lines(shot) -> [{ id, speaker, text }], put(lineId, text), busy() }.
(function () {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clock = (t) => { t = Math.max(0, +t || 0); const m = Math.floor(t / 60), s = t - m * 60; return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1); };
  const fileOf = (u) => { const m = /[?&]f=([^&]+)/.exec(String(u || "")); if (!m) return String(u || ""); try { return decodeURIComponent(m[1]); } catch (e) { return ""; } };
  let dlg = null, cur = null; // cur = { f, shot, line, to, heard }
  function build() {
    dlg = document.createElement("dialog"); dlg.id = "hearDlg"; dlg.setAttribute("aria-labelledby", "hearT");
    dlg.style.cssText = "max-width:min(680px,calc(100vw - 24px));width:100%;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);padding:16px";
    dlg.innerHTML = `<h3 id="hearT" style="margin:0 0 4px">Write down what is said</h3>
      <p class="small muted" id="hearNote" style="margin:0 0 10px"></p>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 10px">
        <label class="small" style="display:inline-flex;gap:6px;align-items:center">Write it <select id="hearTo"><option value="">in the language spoken</option><option value="en">in English</option></select></label>
        <button class="btn primary" id="hearGo" type="button">Listen</button>
        <button class="btn" id="hearCopy" type="button" hidden>Copy the words</button>
        <span style="flex:1"></span><button class="btn" id="hearClose" type="button">Close</button></div>
      <p id="hearMsg" role="status" aria-live="polite" style="margin:0 0 8px"></p>
      <div id="hearOut" style="max-height:50vh;overflow:auto;display:flex;flex-direction:column;gap:6px"></div>
      <p class="small muted" id="hearFoot" style="margin:10px 0 0" hidden>The times are from the start of this file. The exported video still shares a shot's time between its lines by their length: these times are for you to place lines and cuts by.</p>`;
    document.body.appendChild(dlg);
    dlg.querySelector("#hearClose").addEventListener("click", () => dlg.close());
    dlg.querySelector("#hearGo").addEventListener("click", () => listen());
    dlg.querySelector("#hearTo").addEventListener("change", (e) => { cur.to = e.target.value; look(); });
    dlg.querySelector("#hearCopy").addEventListener("click", async () => { const t = (cur.heard.segments || []).map((s) => s.text).join("\n"); try { await navigator.clipboard.writeText(t); say("Copied."); } catch (e) { say("Could not copy here: select the words and copy them by hand."); } });
    dlg.querySelector("#hearOut").addEventListener("click", (e) => {
      const b = e.target.closest("[data-put]"); if (!b) return;
      const H = window.IbashoHear, seg = cur.heard.segments[+b.dataset.put], sel = b.parentElement.querySelector("select"), line = (H.lines(cur.shot) || []).find((x) => x.id === sel.value); if (!line || !seg) return;
      if (H.busy && H.busy()) return say("The scene is being worked on: wait for it to finish, then put the words in.");
      if (line.text && line.text.trim() && line.text.trim() !== seg.text && !confirm(`This line already has its words:\n\n“${line.text}”\n\nReplace them with what was heard?\n\n“${seg.text}”\n\nA line taken from your script or book should keep its own words.`)) return;
      H.put(line.id, seg.text); say(`Put into ${line.speaker ? line.speaker + "'s" : "the"} line.`); draw();
    });
  }
  const say = (t) => { dlg.querySelector("#hearMsg").textContent = t || ""; };
  const api = (method) => fetch(`/api/anime/hear?id=${encodeURIComponent(window.IbashoHear.scene())}&f=${encodeURIComponent(cur.f)}${cur.to ? "&to=en" : ""}`, { method }).then(async (r) => ({ ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) }));
  function draw() {
    const out = dlg.querySelector("#hearOut"), h = cur.heard, lines = cur.shot && window.IbashoHear ? window.IbashoHear.lines(cur.shot) || [] : [];
    dlg.querySelector("#hearCopy").hidden = !(h && h.segments.length); dlg.querySelector("#hearFoot").hidden = !(h && h.segments.length);
    if (!h) { out.innerHTML = ""; return; }
    if (!h.segments.length) { out.innerHTML = `<p class="muted" style="margin:0">Nothing was heard as speech in this file.</p>`; return; }
    out.innerHTML = h.segments.map((s, i) => `<div class="hear-seg" style="border:1px solid var(--line);border-radius:8px;padding:8px 10px">
      <div><span class="chip" style="font-family:var(--mono)">${clock(s.start)} to ${clock(s.end)}</span> <span class="hear-text">${esc(s.text)}</span></div>
      ${lines.length ? `<div class="small" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px"><span class="muted">Put into</span><select aria-label="Which line">${lines.map((x) => `<option value="${esc(x.id)}"${x.id === cur.line ? " selected" : ""}>${esc((x.speaker ? x.speaker + ": " : "") + (x.text || "(no words yet)")).slice(0, 90)}</option>`).join("")}</select><button class="btn sm" type="button" data-put="${i}">Put it there</button></div>` : ""}</div>`).join("");
  }
  async function look() { // what was written down before, and whether this computer can listen
    cur.heard = null; draw(); say("");
    let r; try { r = await api("GET"); } catch (e) { return say("Could not ask the app."); }
    if (!r.ok) return say(r.j.error || "Could not ask the app.");
    dlg.querySelector("#hearGo").disabled = !r.j.can; dlg.querySelector("#hearGo").textContent = r.j.heard ? "Listen again" : "Listen";
    if (r.j.heard) { cur.heard = r.j.heard; draw(); say(`Written down ${r.j.at ? new Date(r.j.at).toLocaleString() : "before"}${r.j.heard.language ? " (heard as " + r.j.heard.language + ")" : ""}.`); }
    else say(r.j.can ? `Ready: ${r.j.engine} on this computer. Nothing is sent anywhere. A minute of sound takes about a minute.` : r.j.how);
  }
  async function listen() {
    const go = dlg.querySelector("#hearGo"); go.disabled = true; say("Listening… this takes about as long as the sound itself. You can leave this open.");
    let r; try { r = await api("POST"); } catch (e) { go.disabled = false; return say("The app did not answer."); }
    go.disabled = false;
    if (!r.ok) return say(r.j.error || "It could not be written down.");
    cur.heard = r.j.heard; go.textContent = "Listen again"; draw(); say(`${r.j.heard.segments.length} piece${r.j.heard.segments.length === 1 ? "" : "s"} of speech${r.j.heard.language ? ", heard as " + r.j.heard.language : ""}.`);
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-hear]"); if (!b || !window.IbashoHear) return;
    e.preventDefault(); if (!dlg) build();
    cur = { f: fileOf(b.dataset.hear), shot: b.dataset.hearShot || "", line: b.dataset.hearLine || "", to: dlg.querySelector("#hearTo").value, heard: null };
    dlg.querySelector("#hearNote").textContent = `${cur.shot ? "Shot " + cur.shot + " · " : ""}${cur.f.split("/").pop()}. A Whisper on this computer listens: free, and nothing leaves it.`;
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
    look();
  });
})();
