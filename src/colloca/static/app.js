"use strict";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const state = { corpora: [], refs: [], id: null, langs: {} };

// ------------------------------------------------------------------ helpers
function say(text, kind = "") { const m = $("msg"); m.textContent = text; m.className = kind; }
async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    let detail = res.statusText;
    try { const j = await res.json(); detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch (_) {}
    throw new Error(detail);
  }
  return res.status === 204 ? null : res.json();
}
const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== "" && v != null && v !== false || v === false)).toString();
const base = () => `/api/corpora/${state.id}`;
function busy(btn, fn) {
  return async () => {
    if (!state.id && btn.dataset.needs !== "none") return say("Create or select a corpus first.", "err");
    btn.disabled = true; say("Working…");
    try { await fn(); } catch (e) { say(e.message, "err"); } finally { btn.disabled = false; }
  };
}
function table(cols, rows, mount, wordCols = []) {
  const head = cols.map((c) => `<th class="${c.num ? "num" : ""}">${esc(c.label)}</th>`).join("");
  const body = rows.map((r) => "<tr>" + cols.map((c) => {
    const v = r[c.key];
    const cell = wordCols.includes(c.key) ? `<a class="word" data-w="${esc(v)}">${esc(v)}</a>` : esc(v);
    return `<td class="${c.num ? "num" : ""}">${cell}</td>`;
  }).join("") + "</tr>").join("");
  mount.innerHTML = rows.length ? `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` : `<p class="muted" style="padding:.6rem">No results.</p>`;
}
// click a word anywhere -> concordance
document.addEventListener("click", (e) => {
  const a = e.target.closest("a.word"); if (!a) return;
  const unit = state.lastUnit === "form" ? "form" : "lemma";
  $("ccQ").value = a.dataset.w; $("ccUnit").value = a.dataset.w.includes(" ") ? "form" : unit;
  showTab("concordance"); $("ccGo").click();
});

// ------------------------------------------------------------------ tabs & corpora
function showTab(name) {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + name));
}
$("tabs").addEventListener("click", (e) => { if (e.target.dataset.tab) showTab(e.target.dataset.tab); });

async function loadCorpora(select) {
  state.corpora = await api("/api/corpora");
  if (select) state.id = select;
  if (!state.corpora.find((c) => c.id === state.id)) state.id = state.corpora[0]?.id ?? null;
  $("corpusSel").innerHTML = state.corpora.map((c) =>
    `<option value="${c.id}" ${c.id === state.id ? "selected" : ""}>${esc(c.name)} [${c.lang}]</option>`).join("") || "<option>— none —</option>";
  const cur = state.corpora.find((c) => c.id === state.id);
  $("corpusInfo").textContent = cur ? `${cur.docs} docs · ${cur.tokens.toLocaleString()} words` : "No corpus yet — click “+ New”.";
  const refs = state.corpora.filter((c) => cur && c.id !== cur.id && c.lang === cur.lang);
  const base = state.refs.find((r) => cur && r.lang === cur.lang && r.tokens > 0);
  $("kyRef").innerHTML = (base ? `<option value="">Base corpus — ${esc(base.name)} (${base.tokens.toLocaleString()} words)</option>` : "")
    + refs.map((c) => `<option value="${c.id}">${esc(c.name)} (${c.tokens.toLocaleString()} words)</option>`).join("")
    || "<option value='none'>— no base or other corpus —</option>";
  if (cur) { await loadDocs(); await pollJobs(); }
  else { $("docsTable").innerHTML = ""; $("jobs").innerHTML = ""; }
}
$("corpusSel").addEventListener("change", (e) => loadCorpora(+e.target.value));

async function init() {
  state.langs = await api("/api/languages");
  $("newLang").innerHTML = Object.entries(state.langs).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  await loadRefs();
  await loadCorpora();
}
$("newCorpusBtn").onclick = () => { $("newName").value = ""; $("newDlg").showModal(); };
$("newForm").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "ok") return;
  try { const r = await post("/api/corpora", { name: $("newName").value, lang: $("newLang").value }); await loadCorpora(r.id); say("Corpus created.", "ok"); }
  catch (err) { say(err.message, "err"); }
});
$("delCorpusBtn").onclick = async () => {
  const cur = state.corpora.find((c) => c.id === state.id); if (!cur) return;
  if (!confirm(`Delete corpus “${cur.name}” and all its documents?`)) return;
  await api(base(), { method: "DELETE" }); await loadCorpora(); say("Corpus deleted.", "ok");
};

// ------------------------------------------------------------------ sources
const LANG_BADGE = { mismatch: "wrong language?", uncertain: "language unclear" };
async function loadDocs() {
  const docs = await api(`${base()}/documents`);
  const stale = docs.filter((d) => d.stale).length;
  $("reannBox").hidden = !stale;
  $("reannInfo").textContent = `${stale} document${stale === 1 ? "" : "s"} annotated with an older NLP model.`;
  $("docsTable").innerHTML = docs.length
    ? `<thead><tr><th>Title</th><th>Source</th><th class="num">Words</th><th>Checks</th><th>Added</th><th></th></tr></thead><tbody>` +
      docs.map((d) => `<tr><td>${esc(d.title)}</td><td class="muted">${d.kind === "url" ? `<a href="${esc(d.source)}" target="_blank" rel="noopener noreferrer">${esc(d.source)}</a>` : esc(d.source || d.kind)}</td>
        <td class="num">${d.n_tokens.toLocaleString()}</td>
        <td>${LANG_BADGE[d.lang_check] ? `<span class="badge warn" title="Language check: ${esc(d.lang_check)}">${LANG_BADGE[d.lang_check]}</span> ` : ""}${d.stale ? `<span class="badge" title="${esc(d.pipeline)}">older model</span>` : ""}</td>
        <td class="muted">${esc(d.added)}</td>
        <td><button data-del="${d.id}" class="danger">Remove</button></td></tr>`).join("") + "</tbody>"
    : `<tbody><tr><td class="muted">No documents yet.</td></tr></tbody>`;
}
$("docsTable").addEventListener("click", async (e) => {
  const id = e.target.dataset.del; if (!id || !confirm("Remove this document from the corpus?")) return;
  await api(`/api/documents/${id}`, { method: "DELETE" }); await loadCorpora(state.id); say("Document removed.", "ok");
});

// ---- background jobs (imports and re-annotation run on the server; we poll for progress)
let jobTimer = null;
const forceLang = () => $("forceLang").checked;
function renderJobs(jobs) {
  const recent = jobs.slice(-8).reverse();
  $("jobs").innerHTML = recent.map((j) => {
    const pct = Math.round(j.progress * 100);
    const state = j.status === "error" ? `<span class="err">${esc(j.error)}</span>`
      : j.status === "done" ? `<span class="ok">done${(j.result.warnings || []).length ? " — " + esc(j.result.warnings.join(" ")) : ""}</span>`
      : j.status === "running" ? `<progress max="100" value="${pct}"></progress> ${pct}%` : "queued";
    return `<div class="job"><b>${esc(j.label)}</b> ${state}</div>`;
  }).join("");
}
async function pollJobs() {
  clearTimeout(jobTimer);
  if (!state.id) return;
  const id = state.id, jobs = await api(`/api/corpora/${id}/jobs`);
  renderJobs(jobs);
  if (jobs.some((j) => j.status === "queued" || j.status === "running")) { state.jobsActive = true; jobTimer = setTimeout(() => pollJobs().catch(() => {}), 1000); }
  else if (state.jobsActive) { state.jobsActive = false; await loadCorpora(id); }
}
let pvSource = "";
$("previewBtn").onclick = busy($("previewBtn"), async () => {
  const r = await post("/api/preview-url", { url: $("urlIn").value });
  pvSource = r.url; $("pvTitle").value = r.title; $("pvText").value = r.text; $("preview").hidden = false; updatePv(); say("");
});
const updatePv = () => { $("pvStats").textContent = `${$("pvText").value.split(/\s+/).filter(Boolean).length.toLocaleString()} words`; };
$("pvText").addEventListener("input", updatePv);
$("pvCancel").onclick = () => { $("preview").hidden = true; };
$("pvAdd").onclick = busy($("pvAdd"), async () => {
  await post(`${base()}/documents?${qs({ background: true, force_language: forceLang() })}`, { title: $("pvTitle").value, text: $("pvText").value, source: pvSource, kind: "url" });
  $("preview").hidden = true; $("urlIn").value = ""; say("Queued — see progress below.", "ok"); await pollJobs();
});
$("uploadBtn").onclick = busy($("uploadBtn"), async () => {
  const files = $("fileIn").files; if (!files.length) return say("Choose files first.", "err");
  const fd = new FormData(); for (const f of files) fd.append("files", f);
  const res = await api(`${base()}/upload?${qs({ force_language: forceLang() })}`, { method: "POST", body: fd });
  $("fileIn").value = "";
  const bad = res.filter((r) => !r.ok);
  say(`${res.length - bad.length} queued` + (bad.length ? `; rejected: ` + bad.map((b) => `${b.file} (${b.error})`).join("; ") : "."), bad.length ? "err" : "ok");
  await pollJobs();
});
$("pasteBtn").onclick = busy($("pasteBtn"), async () => {
  await post(`${base()}/documents?${qs({ background: true, force_language: forceLang() })}`, { title: $("pasteTitle").value || "Pasted text", text: $("pasteText").value, kind: "paste" });
  $("pasteText").value = ""; $("pasteTitle").value = ""; say("Queued — see progress below.", "ok"); await pollJobs();
});
$("reannBtn").onclick = busy($("reannBtn"), async () => {
  await api(`${base()}/reannotate?only_stale=true`, { method: "POST" }); say("Re-annotation started.", "ok"); await pollJobs();
});

// ------------------------------------------------------------------ analyses
function setCsv(id, path, params) { $(id).href = `${base()}/${path}?${qs({ ...params, format: "csv" })}`; $(id).setAttribute("download", ""); }
const posParam = (id) => $(id).value.trim();

$("fqGo").onclick = busy($("fqGo"), async () => {
  const p = { unit: $("fqUnit").value, pos: posParam("fqPos"), min_freq: $("fqMin").value, exclude_stop: $("fqStop").checked, with_reference: $("fqRef").checked, limit: 1000 };
  state.lastUnit = p.unit;
  const rows = await api(`${base()}/frequency?${qs(p)}`); setCsv("fqCsv", "frequency", p);
  table([{ key: "item", label: p.unit }, { key: "pos", label: "POS" }, { key: "freq", label: "Freq", num: 1 }, { key: "per_million", label: "Per million", num: 1 },
         { key: "docs", label: "Docs", num: 1 }, { key: "docs_pct", label: "Docs %", num: 1 },
         ...(p.with_reference ? [{ key: "ref_per_million", label: "Base per M", num: 1 }] : [])], rows, $("fqOut"), ["item"]);
  say(`${rows.length} items (click a word for its concordance).`, "ok");
});

$("ccGo").onclick = busy($("ccGo"), async () => {
  const p = { q: $("ccQ").value, unit: $("ccUnit").value, width: $("ccW").value, sort: $("ccSort").value, limit: 500 };
  if (!p.q.trim()) return say("Type a word or phrase.", "err");
  const r = await api(`${base()}/concordance?${qs(p)}`); setCsv("ccCsv", "concordance", p);
  $("ccInfo").textContent = `${r.total} hits` + (r.total > r.lines.length ? ` (showing ${r.lines.length})` : "");
  $("ccOut").innerHTML = r.lines.length ? `<table class="kwic"><tbody>` + r.lines.map((l) =>
    `<tr><td class="l">${esc(l.left)}</td><td class="n">${esc(l.node)}</td><td>${esc(l.right)}</td><td class="src" title="${esc(l.doc)}">${esc(l.doc)}</td></tr>`).join("") + "</tbody></table>"
    : `<p class="muted" style="padding:.6rem">No hits.</p>`;
  say("");
});
$("ccQ").addEventListener("keydown", (e) => { if (e.key === "Enter") $("ccGo").click(); });

$("coGo").onclick = busy($("coGo"), async () => {
  const p = { q: $("coQ").value, left: $("coL").value, right: $("coR").value, min_freq: $("coMin").value, pos: posParam("coPos"), exclude_stop: $("coStop").checked, with_reference: $("coRef").checked };
  if (!p.q.trim()) return say("Type a node word.", "err");
  state.lastUnit = "lemma";
  const r = await api(`${base()}/collocations?${qs(p)}`); setCsv("coCsv", "collocations", p);
  $("coInfo").textContent = `Node “${p.q}”: ${r.node_freq} occurrences · sorted by logDice. Low counts are unreliable — check the concordance.`;
  table([{ key: "item", label: "Collocate (lemma)" }, { key: "pos", label: "POS" }, { key: "cooc", label: "Co-occ", num: 1 }, { key: "freq", label: "Corpus freq", num: 1 },
         { key: "docs", label: "Docs", num: 1 }, { key: "logdice", label: "logDice", num: 1 }, { key: "mi", label: "MI", num: 1 },
         { key: "tscore", label: "t-score", num: 1 }, { key: "ll", label: "LL", num: 1 },
         ...(p.with_reference ? [{ key: "ref_per_million", label: "Base per M", num: 1 }] : [])], r.rows, $("coOut"), ["item"]);
  say("");
});
$("coQ").addEventListener("keydown", (e) => { if (e.key === "Enter") $("coGo").click(); });

$("ngGo").onclick = busy($("ngGo"), async () => {
  const p = { n: $("ngN").value, unit: $("ngUnit").value, min_freq: $("ngMin").value, min_docs: $("ngDocs").value, edge_stop: $("ngEdge").checked };
  state.lastUnit = p.unit;
  const rows = await api(`${base()}/ngrams?${qs(p)}`); setCsv("ngCsv", "ngrams", p);
  table([{ key: "item", label: `${p.n}-gram` }, { key: "freq", label: "Freq", num: 1 }, { key: "docs", label: "Docs", num: 1 }], rows, $("ngOut"), ["item"]);
  say(`${rows.length} n-grams.`, "ok");
});

$("kyGo").onclick = busy($("kyGo"), async () => {
  if ($("kyRef").value === "none") return say("Create a base corpus (Base corpora tab) or a second corpus of the same language to use as reference.", "err");
  const p = { ref: $("kyRef").value, min_freq: $("kyMin").value, pos: posParam("kyPos") };
  state.lastUnit = "lemma";
  const rows = await api(`${base()}/keyness?${qs(p)}`); setCsv("kyCsv", "keyness", p);
  state.lastKeyness = p;
  table([{ key: "item", label: "Lemma" }, { key: "pos", label: "POS" }, { key: "freq", label: "Freq", num: 1 }, { key: "ref_freq", label: "Ref freq", num: 1 },
         { key: "per_million", label: "Per M", num: 1 }, { key: "ref_per_million", label: "Ref per M", num: 1 }, { key: "log_ratio", label: "Log ratio", num: 1 },
         { key: "ll", label: "LL", num: 1 }], rows, $("kyOut"), ["item"]);
  say("");
});

// ------------------------------------------------------------------ base (reference) corpora
let refTimer = null;
async function loadRefs() {
  state.refs = await api("/api/references");
  renderRefs();
}
function renderRefs() {
  $("baseCards").innerHTML = Object.entries(state.langs).map(([lang, name]) => {
    const r = state.refs.find((x) => x.lang === lang);
    if (!r) return `<div class="card"><h3>${esc(name)}</h3><p class="muted">No base corpus yet.</p>
      <button class="primary" data-ref-create="${lang}">Create ${esc(name)} base corpus</button></div>`;
    return `<div class="card"><h3>${esc(name)}</h3>
      <p><b>${esc(r.name)}</b><br><span class="muted">${r.docs} parts · ${r.tokens.toLocaleString()} words</span></p>
      <input type="file" data-ref-file="${r.id}" multiple accept=".txt,.csv,.tsv">
      <button class="primary" data-ref-upload="${r.id}">Upload sentence files</button>
      <button class="danger" data-ref-del="${r.id}">Delete</button>
      <div class="refjobs" id="refjobs-${r.id}" aria-live="polite"></div></div>`;
  }).join("");
  pollRefJobs();
}
async function pollRefJobs() {
  clearTimeout(refTimer);
  let active = false;
  for (const r of state.refs) {
    const jobs = await api(`/api/corpora/${r.id}/jobs`);
    const box = $(`refjobs-${r.id}`);
    if (box) box.innerHTML = jobs.slice(-4).reverse().map((j) => {
      const pct = Math.round(j.progress * 100);
      const st = j.status === "error" ? `<span class="err">${esc(j.error)}</span>`
        : j.status === "done" ? `<span class="ok">done — ${j.result.documents ?? 0} parts, ${(j.result.tokens ?? 0).toLocaleString()} words</span>`
        : j.status === "running" ? `<progress max="100" value="${pct}"></progress> ${pct}%` : "queued";
      return `<div class="job"><b>${esc(j.label)}</b> ${st}</div>`;
    }).join("");
    if (jobs.some((j) => j.status === "queued" || j.status === "running")) active = true;
  }
  if (active) { state.refJobsActive = true; refTimer = setTimeout(() => pollRefJobs().catch(() => {}), 1000); }
  else if (state.refJobsActive) { state.refJobsActive = false; await loadRefs(); await loadCorpora(state.id); }
}
$("baseCards").addEventListener("click", async (e) => {
  const d = e.target.dataset;
  try {
    if (d.refCreate) { await post("/api/references", { lang: d.refCreate }); await loadRefs(); await loadCorpora(state.id); say("Base corpus created. Now upload sentence files.", "ok"); }
    else if (d.refDel) {
      if (!confirm("Delete this base corpus and all its texts? Keyness will have no default reference until you build another.")) return;
      await api(`/api/corpora/${d.refDel}`, { method: "DELETE" }); await loadRefs(); await loadCorpora(state.id); say("Base corpus deleted.", "ok");
    } else if (d.refUpload) {
      const files = document.querySelector(`[data-ref-file="${d.refUpload}"]`).files;
      if (!files.length) return say("Choose sentence files first.", "err");
      const fd = new FormData(); for (const f of files) fd.append("files", f);
      const res = await api(`/api/corpora/${d.refUpload}/upload?${qs({ sentences: true, force_language: $("refForce").checked })}`, { method: "POST", body: fd });
      const bad = res.filter((r) => !r.ok);
      say(`${res.length - bad.length} queued` + (bad.length ? `; rejected: ` + bad.map((b) => `${b.file} (${b.error})`).join("; ") : "."), bad.length ? "err" : "ok");
      await pollRefJobs();
    }
  } catch (err) { say(err.message, "err"); }
});

// ------------------------------------------------------------------ word cloud (self-contained spiral layout)
$("wcGo").onclick = busy($("wcGo"), async () => {
  const pos = posParam("wcPos"), n = +$("wcN").value;
  let items;
  if ($("wcSrc").value === "keyness") {
    if (!state.lastKeyness) return say("Run a comparison in the Keyness tab first.", "err");
    const rows = await api(`${base()}/keyness?${qs({ ...state.lastKeyness, pos, limit: n })}`);
    items = rows.filter((r) => r.ll > 0).map((r) => ({ w: r.item, v: r.ll }));
  } else {
    const rows = await api(`${base()}/frequency?${qs({ pos, exclude_stop: true, limit: n, min_freq: 1 })}`);
    items = rows.map((r) => ({ w: r.item, v: r.freq }));
  }
  drawCloud(items); say(items.length ? "" : "Nothing to draw.");
});
function drawCloud(items) {
  const c = $("wcCanvas"), ctx = c.getContext("2d"), W = c.width, H = c.height;
  ctx.fillStyle = getComputedStyle(document.body).backgroundColor; ctx.fillRect(0, 0, W, H);
  if (!items.length) return;
  const max = Math.sqrt(items[0].v), min = Math.sqrt(items[items.length - 1].v);
  const palette = ["#1f5fbf", "#c2410c", "#15803d", "#7e22ce", "#b45309", "#0e7490", "#be123c"];
  const placed = [];
  items.forEach((it, i) => {
    const size = 14 + (max === min ? 20 : 54 * (Math.sqrt(it.v) - min) / (max - min));
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    const w = ctx.measureText(it.w).width + 6, h = size * 1.05;
    for (let t = 0; t < 4000; t += 0.35) {
      const r = 3 * t, x = W / 2 + r * Math.cos(t) * 1.6 - w / 2, y = H / 2 + r * Math.sin(t) - h / 2;
      if (x < 4 || y < 4 || x + w > W - 4 || y + h > H - 4) continue;
      if (placed.some((p) => x < p.x + p.w && x + w > p.x && y < p.y + p.h && y + h > p.y)) continue;
      placed.push({ x, y, w, h });
      ctx.fillStyle = palette[i % palette.length]; ctx.textBaseline = "top"; ctx.fillText(it.w, x + 3, y); break;
    }
  });
}
$("wcPng").onclick = () => { const a = document.createElement("a"); a.href = $("wcCanvas").toDataURL("image/png"); a.download = "wordcloud.png"; a.click(); };

init().catch((e) => say(e.message, "err"));
