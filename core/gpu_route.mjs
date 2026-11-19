// Pick the GPU for a job on a rented machine: cheapest that fits, fastest, or the studio default
// (fastest unless it costs more than 1.5x the cheapest). Data: core/models/gpu_clouds.json; rule written there too.
// Works in node and the browser. Live prices replace the starting prices when a cloud has a price API (offers argument).

/** Offers from the catalogue's starting prices: [{ cloud, cloudName, gpu, vram, speed, perHour, startup, inStock }] */
export function offersFrom(catalog, connected = null) {
  const out = [];
  for (const c of catalog.clouds) {
    if (connected && !connected.includes(c.id.replace(/-serverless$/, ""))) continue;
    for (const [gpu, perHour] of Object.entries(c.prices)) {
      const g = catalog.gpus[gpu]; if (!g) continue;
      out.push({ cloud: c.id, cloudName: c.name, gpu, vram: g.vram, speed: g.speed, perHour, startup: c.startup_s, inStock: true });
    }
  }
  return out;
}

/** Shown when someone switches on "I have permission"; saved with the date and time on their own computer (saved/permissions.json). */
export const PERMISSION_CONFIRM = "By switching this on you confirm you have permission from the model's maker to use it where you are. Ibasho does not check this.";

/**
 * Where a licence needs the maker's permission. Ibasho NEVER blocks a model: in an excluded region it says so,
 * links to the maker's licence page to apply, and the person can mark that they have permission (permissions = [model ids]).
 * Returns { state: "free" | "needs-permission" | "has-permission", link, message }.
 */
export function licenceStatus(model, region, permissions = []) {
  if (!region || !(model.excluded || []).includes(region)) return { state: "free", link: null, message: "" };
  if (permissions.includes(model.id)) return { state: "has-permission", link: model.licence_request || null, message: `You have marked that you have permission to use ${model.name} in ${region}.` };
  return { state: "needs-permission", link: model.licence_request || null,
    message: `${model.name}'s licence needs its maker's permission in ${region}, for the model and what it makes. Apply on the licence page; once you have permission, switch on "I have permission" to use it.` };
}

/**
 * job: { vram (GB the model needs), seconds4090 (time of the work on an RTX 4090) }
 * prefer: "cheapest" | "fastest" | "default"
 * Returns { pick, choices } where each choice has seconds and cost; null pick when nothing fits.
 */
export function route(job, offers, prefer = "default") {
  const need = job.vram * 1.15;
  const choices = offers.filter((o) => o.inStock && o.vram >= need).map((o) => {
    const seconds = job.seconds4090 / o.speed + o.startup;
    return { ...o, seconds: Math.round(seconds), cost: +(o.perHour * seconds / 3600).toFixed(4) };
  });
  if (!choices.length) return { pick: null, choices, why: `No GPU in stock has ${Math.ceil(need)} GB or more.` };
  const cheapest = [...choices].sort((a, b) => a.cost - b.cost || a.seconds - b.seconds)[0];
  const fastest = [...choices].sort((a, b) => a.seconds - b.seconds || a.cost - b.cost)[0];
  let pick, why;
  if (prefer === "cheapest") { pick = cheapest; why = "the cheapest job"; }
  else if (prefer === "fastest") { pick = fastest; why = "the fastest job"; }
  else { // the studio rule: the fastest choice that costs no more than 1.5x the cheapest
    pick = [...choices].filter((c) => c.cost <= cheapest.cost * 1.5).sort((a, b) => a.seconds - b.seconds || a.cost - b.cost)[0];
    why = pick === cheapest ? "cheapest (nothing faster within 1.5x its cost)" : `fastest within 1.5x the cheapest cost (${Math.round(100 * (1 - pick.seconds / cheapest.seconds))}% quicker for ${Math.round(100 * (pick.cost / cheapest.cost - 1))}% more)`;
  }
  choices.sort((a, b) => a.cost - b.cost);
  return { pick, choices, why, cheapest, fastest };
}
