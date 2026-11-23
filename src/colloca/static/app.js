"use strict";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const state = { corpora: [], refs: [], projects: [], projFilter: "", id: null, langs: {}, facets: { tags: [], text_types: [] }, facetFor: null };

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
function table(cols, rows, mount, wordCols = [], origin = "") {
  const head = cols.map((c) => `<th class="${c.num ? "num" : ""}">${esc(c.label)}</th>`).join("") + (origin ? "<th></th>" : "");
  const body = rows.map((r) => "<tr>" + cols.map((c) => {
    const v = r[c.key];
    const cell = wordCols.includes(c.key) ? `<a class="word" data-w="${esc(v)}">${esc(v)}</a>` : esc(v);
    return `<td class="${c.num ? "num" : ""}">${cell}</td>`;
  }).join("") + (origin ? `<td><a class="addterm" title="Add to termbase" data-t="${esc(r.item)}" data-pos="${esc(r.pos || "")}" data-origin="${origin}">+ term</a></td>` : "") + "</tr>").join("");
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
  $("filterBar").hidden = !state.id || ["sources", "base", "terms"].includes(name);
  if (name === "terms") { syncTbScope(); loadTerms(); }
}
$("tabs").addEventListener("click", (e) => { if (e.target.dataset.tab) showTab(e.target.dataset.tab); });

const inProject = (c) => state.projFilter === "" || (state.projFilter === "none" ? c.project_id == null : c.project_id === +state.projFilter);
function renderCorpusSelect(visible) {
  const opt = (c) => `<option value="${c.id}" ${c.id === state.id ? "selected" : ""}>${esc(c.name)} [${c.lang}]</option>`;
  if (state.projFilter !== "") { $("corpusSel").innerHTML = visible.map(opt).join("") || "<option>— none —</option>"; return; }
  const groups = state.projects.map((p) => [p.name, visible.filter((c) => c.project_id === p.id)]).filter(([, cs]) => cs.length);
  const loose = visible.filter((c) => c.project_id == null || !state.projects.some((p) => p.id === c.project_id));
  $("corpusSel").innerHTML = (groups.map(([n, cs]) => `<optgroup label="${esc(n)}">${cs.map(opt).join("")}</optgroup>`).join("")
    + (loose.length ? (groups.length ? `<optgroup label="No project">${loose.map(opt).join("")}</optgroup>` : loose.map(opt).join("")) : "")) || "<option>— none —</option>";
}
async function loadCorpora(select) {
  state.corpora = await api("/api/corpora");
  const visible = state.corpora.filter(inProject);
  if (select) { const c = state.corpora.find((x) => x.id === select); if (c && !inProject(c)) state.projFilter = ""; state.id = select; }
  const shown = state.corpora.filter(inProject);
  if (!shown.find((c) => c.id === state.id)) state.id = shown[0]?.id ?? null;
  renderCorpusSelect(shown);
  const cur = state.corpora.find((c) => c.id === state.id);
  $("corpusInfo").textContent = cur ? `${cur.docs} docs · ${cur.tokens.toLocaleString()} words` : "No corpus yet — click “+ New”.";
  $("cSetName").value = cur?.name ?? ""; renderProjectSelects();
  const refs = state.corpora.filter((c) => cur && c.id !== cur.id && c.lang === cur.lang);
  const base = state.refs.find((r) => cur && r.lang === cur.lang && r.tokens > 0);
  $("kyRef").innerHTML = (base ? `<option value="">Base corpus — ${esc(base.name)} (${base.tokens.toLocaleString()} words)</option>` : "")
    + refs.map((c) => `<option value="${c.id}">${esc(c.name)} (${c.tokens.toLocaleString()} words)</option>`).join("")
    || "<option value='none'>— no base or other corpus —</option>";
  if (state.facetFor !== state.id) { clearFilters(); state.facetFor = state.id; }
  if (cur) { await loadDocs(); await refreshFacets(); await pollJobs(); }
  else { $("docsTable").innerHTML = ""; $("jobs").innerHTML = ""; $("filterBar").hidden = true; }
  $("filterBar").hidden = !cur || ["tab-sources", "tab-base", "tab-terms"].some((id) => $(id).classList.contains("active"));
  if ($("tab-terms").classList.contains("active")) { syncTbScope(); await loadTerms(); }
}
$("corpusSel").addEventListener("change", (e) => loadCorpora(+e.target.value));

async function init() {
  state.langs = await api("/api/languages");
  $("newLang").innerHTML = Object.entries(state.langs).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  await loadRefs();
  await loadProjects();
  await loadCorpora();
}
$("newCorpusBtn").onclick = () => { $("newName").value = ""; renderProjectSelects(); $("newDlg").showModal(); };
$("newForm").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "ok") return;
  try { const r = await post("/api/corpora", { name: $("newName").value, lang: $("newLang").value, project_id: $("newProj").value ? +$("newProj").value : null }); await loadCorpora(r.id); say("Corpus created.", "ok"); }
  catch (err) { say(err.message, "err"); }
});
$("delCorpusBtn").onclick = async () => {
  const cur = state.corpora.find((c) => c.id === state.id); if (!cur) return;
  if (!confirm(`Delete corpus “${cur.name}” and all its documents?`)) return;
  await api(base(), { method: "DELETE" }); await loadCorpora(); say("Corpus deleted.", "ok");
};

// ------------------------------------------------------------------ projects (clients)
async function loadProjects() { state.projects = await api("/api/projects"); renderProjectSelects(); renderProjSel(); }
function renderProjSel() {
  $("projSel").innerHTML = `<option value="">All projects</option>` + state.projects.map((p) => `<option value="${p.id}">${esc(p.name)} (${p.corpora})</option>`).join("")
    + `<option value="none">No project</option>`;
  $("projSel").value = state.projFilter;
}
function renderProjectSelects() {
  const opts = (sel) => `<option value="">— none —</option>` + state.projects.map((p) => `<option value="${p.id}" ${String(p.id) === String(sel) ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  const cur = state.corpora.find((c) => c.id === state.id);
  $("cSetProj").innerHTML = opts(cur?.project_id ?? ""); $("newProj").innerHTML = opts(/^\d+$/.test(state.projFilter) ? state.projFilter : "");
}
$("projSel").addEventListener("change", async (e) => { state.projFilter = e.target.value; await loadCorpora(); });
$("projBtn").onclick = () => { renderProjList(); $("projDlg").showModal(); };
function renderProjList() {
  $("projList").innerHTML = state.projects.map((p) => `<div class="row"><input data-pname="${p.id}" value="${esc(p.name)}">
    <button type="button" data-psave="${p.id}">Rename</button><button type="button" class="danger" data-pdel="${p.id}">Delete</button>
    <span class="muted">${p.corpora} corpora</span></div>`).join("") || `<p class="muted">No projects yet.</p>`;
}
const projChanged = async () => { await loadProjects(); await loadCorpora(state.id); renderProjList(); };
$("projAdd").onclick = async () => {
  try { await post("/api/projects", { name: $("projNew").value }); $("projNew").value = ""; await projChanged(); } catch (e) { say(e.message, "err"); }
};
$("projList").addEventListener("click", async (e) => {
  const d = e.target.dataset;
  try {
    if (d.psave) { await api(`/api/projects/${d.psave}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: document.querySelector(`[data-pname="${d.psave}"]`).value }) }); await projChanged(); }
    else if (d.pdel && confirm("Delete this project? Its corpora are kept and become unassigned.")) {
      if (state.projFilter === d.pdel) state.projFilter = "";
      await api(`/api/projects/${d.pdel}`, { method: "DELETE" }); await projChanged();
    }
  } catch (err) { say(err.message, "err"); }
});
$("cSetSave").onclick = async () => {
  if (!state.id) return say("Create a corpus first.", "err");
  try {
    await api(base(), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: $("cSetName").value, project_id: $("cSetProj").value ? +$("cSetProj").value : null }) });
    await loadProjects(); await loadCorpora(state.id); say("Corpus saved.", "ok");
  } catch (err) { say(err.message, "err"); }
};

// ------------------------------------------------------------------ document filter (applies to every analysis)
const scopeParams = () => ({ tags: $("fTags").value, text_type: $("fType").value, date_from: $("fFrom").value.trim(), date_to: $("fTo").value.trim() });
function clearFilters() { $("fTags").value = ""; $("fType").value = ""; $("fFrom").value = ""; $("fTo").value = ""; $("scopeInfo").textContent = ""; }
async function refreshFacets() {
  state.facets = await api(`${base()}/facets`);
  $("tagList").innerHTML = state.facets.tags.map((t) => `<option value="${esc(t.tag)}">${t.docs} docs</option>`).join("");
  $("typeList").innerHTML = state.facets.text_types.map((t) => `<option value="${esc(t.text_type)}">`).join("");
  const keep = $("fType").value;
  $("fType").innerHTML = `<option value="">any</option>` + state.facets.text_types.map((t) => `<option value="${esc(t.text_type)}">${esc(t.text_type)} (${t.docs})</option>`).join("");
  $("fType").value = state.facets.text_types.some((t) => t.text_type === keep) ? keep : "";
  await refreshScope();
}
async function refreshScope() {
  if (!state.id) return;
  try {
    const r = await api(`${base()}/scope?${qs(scopeParams())}`);
    $("scopeInfo").textContent = r.filtered ? `${r.docs} of ${r.total_docs} documents · ${r.words.toLocaleString()} of ${r.total_words.toLocaleString()} words` : "all documents";
    $("scopeInfo").className = r.filtered ? "scope-on" : "muted";
  } catch (e) { $("scopeInfo").textContent = e.message; $("scopeInfo").className = "err"; }
}
["fTags", "fFrom", "fTo"].forEach((id) => $(id).addEventListener("input", () => { clearTimeout(state.scopeTimer); state.scopeTimer = setTimeout(refreshScope, 350); }));
$("fType").addEventListener("change", refreshScope);
$("fClear").onclick = () => { clearFilters(); refreshScope(); };

// ------------------------------------------------------------------ sources
const LANG_BADGE = { mismatch: "wrong language?", uncertain: "language unclear" };
async function loadDocs() {
  const docs = await api(`${base()}/documents`);
  state.docs = docs;
  const stale = docs.filter((d) => d.stale).length;
  $("reannBox").hidden = !stale;
  $("reannInfo").textContent = `${stale} document${stale === 1 ? "" : "s"} annotated with an older NLP model.`;
  $("docsTable").innerHTML = docs.length
    ? `<thead><tr><th>Title</th><th>Type</th><th>Date</th><th>Tags</th><th class="num">Words</th><th>Checks</th><th></th></tr></thead><tbody>` +
      docs.map((d) => `<tr><td title="${esc(d.source)}">${esc(d.title)}${d.author ? `<br><span class="muted">${esc(d.author)}</span>` : ""}</td>
        <td>${esc(d.text_type)}</td><td class="muted">${esc(d.doc_date)}</td>
        <td>${d.tags.map((t) => `<span class="badge">${esc(t)}</span>`).join(" ")}</td>
        <td class="num">${d.n_tokens.toLocaleString()}</td>
        <td>${LANG_BADGE[d.lang_check] ? `<span class="badge warn" title="Language check: ${esc(d.lang_check)}">${LANG_BADGE[d.lang_check]}</span> ` : ""}${d.stale ? `<span class="badge" title="${esc(d.pipeline)}">older model</span>` : ""}</td>
        <td class="nowrap"><button data-edit="${d.id}">Edit</button> <button data-del="${d.id}" class="danger">Remove</button></td></tr>`).join("") + "</tbody>"
    : `<tbody><tr><td class="muted">No documents yet.</td></tr></tbody>`;
}
let editingDoc = null;
$("docsTable").addEventListener("click", async (e) => {
  if (e.target.dataset.edit) {
    const d = state.docs.find((x) => x.id === +e.target.dataset.edit); editingDoc = d.id;
    $("edTitle").value = d.title; $("edTags").value = d.tags.join(", "); $("edType").value = d.text_type; $("edDate").value = d.doc_date; $("edAuthor").value = d.author;
    $("docDlg").showModal(); return;
  }
  const id = e.target.dataset.del; if (!id || !confirm("Remove this document from the corpus?")) return;
  await api(`/api/documents/${id}`, { method: "DELETE" }); await loadCorpora(state.id); say("Document removed.", "ok");
});

$("docForm").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "ok") return;
  try {
    await api(`/api/documents/${editingDoc}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: $("edTitle").value, tags: $("edTags").value, text_type: $("edType").value, doc_date: $("edDate").value, author: $("edAuthor").value }) });
    await loadCorpora(state.id); say("Document updated.", "ok");
  } catch (err) { say(err.message, "err"); }
});

// ---- metadata applied to the documents being added
const newMeta = () => ({ tags: $("mTags").value, text_type: $("mType").value, doc_date: $("mDate").value, author: $("mAuthor").value });

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
  await post(`${base()}/documents?${qs({ background: true, force_language: forceLang() })}`, { title: $("pvTitle").value, text: $("pvText").value, source: pvSource, kind: "url", ...newMeta() });
  $("preview").hidden = true; $("urlIn").value = ""; say("Queued — see progress below.", "ok"); await pollJobs();
});
$("uploadBtn").onclick = busy($("uploadBtn"), async () => {
  const files = $("fileIn").files; if (!files.length) return say("Choose files first.", "err");
  const fd = new FormData(); for (const f of files) fd.append("files", f);
  const res = await api(`${base()}/upload?${qs({ force_language: forceLang(), ...newMeta() })}`, { method: "POST", body: fd });
  $("fileIn").value = "";
  const bad = res.filter((r) => !r.ok);
  say(`${res.length - bad.length} queued` + (bad.length ? `; rejected: ` + bad.map((b) => `${b.file} (${b.error})`).join("; ") : "."), bad.length ? "err" : "ok");
  await pollJobs();
});
$("pasteBtn").onclick = busy($("pasteBtn"), async () => {
  await post(`${base()}/documents?${qs({ background: true, force_language: forceLang() })}`, { title: $("pasteTitle").value || "Pasted text", text: $("pasteText").value, kind: "paste", ...newMeta() });
  $("pasteText").value = ""; $("pasteTitle").value = ""; say("Queued — see progress below.", "ok"); await pollJobs();
});
$("reannBtn").onclick = busy($("reannBtn"), async () => {
  await api(`${base()}/reannotate?only_stale=true`, { method: "POST" }); say("Re-annotation started.", "ok"); await pollJobs();
});

// ------------------------------------------------------------------ analyses
function setCsv(id, path, params) { $(id).href = `${base()}/${path}?${qs({ ...params, format: "csv" })}`; $(id).setAttribute("download", ""); }
const posParam = (id) => $(id).value.trim();

$("fqGo").onclick = busy($("fqGo"), async () => {
  const p = { unit: $("fqUnit").value, pos: posParam("fqPos"), min_freq: $("fqMin").value, exclude_stop: $("fqStop").checked, with_reference: $("fqRef").checked, limit: 1000, ...scopeParams() };
  state.lastUnit = p.unit;
  const rows = await api(`${base()}/frequency?${qs(p)}`); setCsv("fqCsv", "frequency", p);
  table([{ key: "item", label: p.unit }, { key: "pos", label: "POS" }, { key: "freq", label: "Freq", num: 1 }, { key: "per_million", label: "Per million", num: 1 },
         { key: "docs", label: "Docs", num: 1 }, { key: "docs_pct", label: "Docs %", num: 1 },
         ...(p.with_reference ? [{ key: "ref_per_million", label: "Base per M", num: 1 }] : [])], rows, $("fqOut"), ["item"], "frequency");
  say(`${rows.length} items (click a word for its concordance).`, "ok");
});

$("ccGo").onclick = busy($("ccGo"), async () => {
  const p = { q: $("ccQ").value, unit: $("ccUnit").value, width: $("ccW").value, sort: $("ccSort").value, limit: 500, ...scopeParams() };
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
  const p = { q: $("coQ").value, left: $("coL").value, right: $("coR").value, min_freq: $("coMin").value, pos: posParam("coPos"), exclude_stop: $("coStop").checked, with_reference: $("coRef").checked, ...scopeParams() };
  if (!p.q.trim()) return say("Type a node word.", "err");
  state.lastUnit = "lemma";
  const r = await api(`${base()}/collocations?${qs(p)}`); setCsv("coCsv", "collocations", p);
  $("coInfo").textContent = `Node “${p.q}”: ${r.node_freq} occurrences · sorted by logDice. Low counts are unreliable — check the concordance.`;
  table([{ key: "item", label: "Collocate (lemma)" }, { key: "pos", label: "POS" }, { key: "cooc", label: "Co-occ", num: 1 }, { key: "freq", label: "Corpus freq", num: 1 },
         { key: "docs", label: "Docs", num: 1 }, { key: "logdice", label: "logDice", num: 1 }, { key: "mi", label: "MI", num: 1 },
         { key: "tscore", label: "t-score", num: 1 }, { key: "ll", label: "LL", num: 1 },
         ...(p.with_reference ? [{ key: "ref_per_million", label: "Base per M", num: 1 }] : [])], r.rows, $("coOut"), ["item"], "collocation");
  say("");
});
$("coQ").addEventListener("keydown", (e) => { if (e.key === "Enter") $("coGo").click(); });

$("ngGo").onclick = busy($("ngGo"), async () => {
  const p = { n: $("ngN").value, unit: $("ngUnit").value, min_freq: $("ngMin").value, min_docs: $("ngDocs").value, edge_stop: $("ngEdge").checked, ...scopeParams() };
  state.lastUnit = p.unit;
  const rows = await api(`${base()}/ngrams?${qs(p)}`); setCsv("ngCsv", "ngrams", p);
  table([{ key: "item", label: `${p.n}-gram` }, { key: "freq", label: "Freq", num: 1 }, { key: "docs", label: "Docs", num: 1 }], rows, $("ngOut"), ["item"], "ngram");
  say(`${rows.length} n-grams.`, "ok");
});

$("kyGo").onclick = busy($("kyGo"), async () => {
  if ($("kyRef").value === "none") return say("Create a base corpus (Base corpora tab) or a second corpus of the same language to use as reference.", "err");
  const p = { ref: $("kyRef").value, min_freq: $("kyMin").value, pos: posParam("kyPos"), ...scopeParams() };
  state.lastUnit = "lemma";
  const rows = await api(`${base()}/keyness?${qs(p)}`); setCsv("kyCsv", "keyness", p);
  state.lastKeyness = p;
  table([{ key: "item", label: "Lemma" }, { key: "pos", label: "POS" }, { key: "freq", label: "Freq", num: 1 }, { key: "ref_freq", label: "Ref freq", num: 1 },
         { key: "per_million", label: "Per M", num: 1 }, { key: "ref_per_million", label: "Ref per M", num: 1 }, { key: "log_ratio", label: "Log ratio", num: 1 },
         { key: "ll", label: "LL", num: 1 }], rows, $("kyOut"), ["item"], "keyness");
  say("");
});

// ------------------------------------------------------------------ termbase
const curCorpus = () => state.corpora.find((c) => c.id === state.id);
const otherLang = (lang) => Object.keys(state.langs).find((l) => l !== lang);
let editingTerm = null, termCtx = null;
function termFields(t = {}) {
  $("tmSrc").value = t.src_term ?? ""; $("tmTgt").value = t.tgt_term ?? ""; $("tmStatus").value = t.status ?? "candidate";
  $("tmPos").value = t.pos ?? ""; $("tmDomain").value = t.domain ?? ""; $("tmDef").value = t.definition ?? "";
  $("tmNotes").value = t.notes ?? ""; $("tmCtx").value = t.context ?? ""; $("tmSrcDoc").textContent = t.context_source ? `from “${t.context_source}”` : "";
  $("tmExamples").innerHTML = "";
}
const POS_MAP = { NOUN: "noun", VERB: "verb", AUX: "verb", ADJ: "adjective", ADV: "adverb", PROPN: "properNoun" };
function openTerm(src, pos, origin) {
  const c = curCorpus(); if (!c) return say("Create or select a corpus first.", "err");
  editingTerm = null; termCtx = { origin, project_id: c.project_id, src_lang: c.lang };
  $("termTitle").textContent = "Add term";
  $("termLangs").textContent = `${state.langs[c.lang]} → ${state.langs[otherLang(c.lang)]}` + (c.project_id ? "" : " · general termbase (corpus has no project)");
  termFields({ src_term: src, pos: POS_MAP[pos] ?? "" }); $("termDlg").showModal(); findExamples(true);
}
document.addEventListener("click", (e) => { const a = e.target.closest("a.addterm"); if (a) openTerm(a.dataset.t, a.dataset.pos, a.dataset.origin); });
$("ccTerm").onclick = () => { const q = $("ccQ").value.trim(); if (!q) return say("Type a word or phrase first.", "err"); openTerm(q, "", "concordance"); };
async function findExamples(quiet) {
  const q = $("tmSrc").value.trim(); if (!q || !state.id) return;
  try {
    const unit = q.includes(" ") ? "form" : "lemma";
    const ex = await api(`${base()}/examples?${qs({ q, unit, limit: 5, ...scopeParams() })}`);
    $("tmExamples").innerHTML = ex.length ? ex.map((x, i) => `<div class="example" data-i="${i}" title="Click to use as the example">${esc(x.sentence)} <span class="muted">— ${esc(x.doc)}</span></div>`).join("")
      : (quiet ? "" : `<p class="muted">No sentence found for “${esc(q)}”.</p>`);
    termCtx.examples = ex;
  } catch (err) { if (!quiet) say(err.message, "err"); }
}
$("tmFind").onclick = () => findExamples(false);
$("tmExamples").addEventListener("click", (e) => {
  const d = e.target.closest(".example"); if (!d) return;
  const x = termCtx.examples[+d.dataset.i]; $("tmCtx").value = x.sentence; $("tmSrcDoc").textContent = `from “${x.doc}”`;
});
$("termForm").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "ok") return;
  const doc = $("tmSrcDoc").textContent.replace(/^from “|”$/g, "");
  const body = { src_term: $("tmSrc").value, tgt_term: $("tmTgt").value, status: $("tmStatus").value, pos: $("tmPos").value,
    domain: $("tmDomain").value, definition: $("tmDef").value, notes: $("tmNotes").value, context: $("tmCtx").value, context_source: $("tmCtx").value ? doc : "" };
  try {
    if (editingTerm) await api(`/api/terms/${editingTerm}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    else await post("/api/terms", { ...body, project_id: termCtx.project_id, src_lang: termCtx.src_lang, tgt_lang: otherLang(termCtx.src_lang), origin: termCtx.origin });
    say(editingTerm ? "Term updated." : "Term added to the termbase.", "ok");
    if ($("tab-terms").classList.contains("active")) await loadTerms();
  } catch (err) { say(err.message, "err"); }
});

function syncTbScope() {
  const keep = $("tbScope").dataset.pinned ? $("tbScope").value : null, c = curCorpus();
  $("tbScope").innerHTML = `<option value="">all projects</option><option value="none">No project (general)</option>` + state.projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
  $("tbScope").value = keep ?? (c ? (c.project_id ? String(c.project_id) : "none") : "");
}
const tbParams = () => ({ project: $("tbScope").value, status: $("tbStatus").value, q: $("tbQ").value.trim() });
async function loadTerms() {
  try {
    const rows = await api(`/api/terms?${qs(tbParams())}`); state.terms = rows;
    $("tbCount").textContent = `${rows.length} entr${rows.length === 1 ? "y" : "ies"}`;
    $("domainList").innerHTML = [...new Set(rows.map((r) => r.domain).filter(Boolean))].map((d) => `<option value="${esc(d)}">`).join("");
    const ex = { project: $("tbScope").value, status: $("tbCand").checked ? "approved,candidate" : "approved" };
    $("tbTbx").href = `/api/terms/export?${qs({ ...ex, format: "tbx" })}`; $("tbTbx2").href = `/api/terms/export?${qs({ ...ex, format: "tbx2" })}`;
    $("tbXlsx").href = `/api/terms/export?${qs({ ...ex, format: "xlsx" })}`; $("tbCsv").href = `/api/terms/export?${qs({ ...ex, format: "csv" })}`;
    $("tbOut").innerHTML = rows.length ? `<table><thead><tr><th>Source</th><th>Translation</th><th>POS</th><th>Status</th><th>Domain</th><th>Example</th><th></th></tr></thead><tbody>` +
      rows.map((r) => `<tr><td><b>${esc(r.src_term)}</b><br><span class="muted">${esc(r.src_lang)}→${esc(r.tgt_lang)}${r.project ? " · " + esc(r.project) : ""}</span></td>
        <td>${esc(r.tgt_term) || `<span class="muted">—</span>`}</td><td class="muted">${esc(r.pos)}</td>
        <td><span class="badge ${r.status === "forbidden" ? "warn" : r.status === "approved" ? "okb" : ""}">${r.status}</span></td>
        <td>${esc(r.domain)}</td><td class="muted ctx" title="${esc(r.context_source)}">${esc(r.context)}</td>
        <td class="nowrap"><button data-tedit="${r.id}">Edit</button> <button data-tdel="${r.id}" class="danger">Delete</button></td></tr>`).join("") + "</tbody></table>"
      : `<p class="muted" style="padding:.6rem">No entries here yet.</p>`;
  } catch (err) { say(err.message, "err"); }
}
$("tbScope").addEventListener("change", () => { $("tbScope").dataset.pinned = "1"; loadTerms(); });
$("tbStatus").addEventListener("change", loadTerms); $("tbCand").addEventListener("change", loadTerms);
$("tbQ").addEventListener("input", () => { clearTimeout(state.tbTimer); state.tbTimer = setTimeout(loadTerms, 300); });
$("tbOut").addEventListener("click", async (e) => {
  const d = e.target.dataset;
  if (d.tedit) {
    const t = state.terms.find((x) => x.id === +d.tedit); editingTerm = t.id; termCtx = { examples: [] };
    $("termTitle").textContent = "Edit term"; $("termLangs").textContent = `${state.langs[t.src_lang]} → ${state.langs[t.tgt_lang]}`;
    termFields(t); $("termDlg").showModal();
  } else if (d.tdel && confirm("Delete this termbase entry?")) {
    try { await api(`/api/terms/${d.tdel}`, { method: "DELETE" }); await loadTerms(); say("Entry deleted.", "ok"); } catch (err) { say(err.message, "err"); }
  }
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
    const rows = await api(`${base()}/keyness?${qs({ ...state.lastKeyness, pos, limit: n, ...scopeParams() })}`);
    items = rows.filter((r) => r.ll > 0).map((r) => ({ w: r.item, v: r.ll }));
  } else {
    const rows = await api(`${base()}/frequency?${qs({ pos, exclude_stop: true, limit: n, min_freq: 1, ...scopeParams() })}`);
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
