(function () {
  "use strict";

  /* ---------- Defaults ---------- */
  const DEFAULT_CONTEXT =
    "Nahrávka výukové hodiny chemie na české střední škole. Učitel vysvětluje chemické názvosloví, " +
    "vzorce, rovnice a výpočty. Vzorce často čte po písmenech a číslech, např. „há dva es o čtyři“ (H2SO4).";

  // Literal terms passed as keywords (gpt-transcribe) or appended to the prompt (older models)
  const DEFAULT_GLOSSARY = [
    "oxidační číslo", "oxid", "hydroxid", "kyselina", "sůl", "bezkyslíkatá kyselina", "kyslíkatá kyselina",
    "kyselina sírová", "kyselina siřičitá", "kyselina chlorovodíková", "kyselina dusičná",
    "kyselina fosforečná", "kyselina uhličitá", "hydroxid sodný", "hydroxid draselný", "hydroxid vápenatý",
    "peroxid vodíku", "oxid uhličitý", "oxid siřičitý", "chlorid sodný", "síran měďnatý",
    "uhličitan vápenatý", "amoniak", "H2SO4", "HCl", "HNO3", "H3PO4", "NaOH", "KOH", "Ca(OH)2", "H2O",
    "CO2", "NaCl", "CuSO4", "NH3", "mol", "molární hmotnost", "látkové množství", "hmotnostní zlomek",
    "molární koncentrace", "pH", "neutralizace", "redoxní reakce", "oxidace", "redukce",
    "elektronegativita", "valenční elektrony", "kation", "anion", "katalyzátor",
    "-natý", "-itý", "-ičitý", "-ečný", "-ičný", "-istý", "-ičelý",
  ].join(", ");

  const DEFAULT_NOTES_PROMPT = `Jsi pečlivý asistent pro studium chemie. Dostaneš automatický přepis české výukové hodiny chemie. Vytvoř z něj přehledné studijní zápisky v češtině ve formátu Markdown.

Pravidla:
- Začni nadpisem "# " s výstižným názvem tématu hodiny a pod ním krátkým shrnutím (2–4 věty).
- Obsah rozděl do sekcí "##" (případně "###") podle témat v pořadí, v jakém zazněla.
- Důležité definice, pravidla a vzorce dej do calloutu: řádek začínající "> 💡 **Klíčové:** ".
- Časté chyby a upozornění: "> ⚠️ **Pozor:** ". Řešené příklady: "> 🧪 **Příklad:** ".
- Chemické vzorce piš s indexy v Unicode (H₂O, H₂SO₄, Ca(OH)₂), náboje iontů horním indexem (Na⁺, SO₄²⁻), oxidační čísla římskými číslicemi, např. Fe(III) nebo S^VI.
- Rovnice piš na samostatný řádek, např. "2 H₂ + O₂ → 2 H₂O"; vyčísli je, pokud je to z kontextu jednoznačné.
- Výpočty rozepiš krok za krokem: zadání, vzorec, dosazení, výsledek s jednotkou.
- Opravuj zjevné chyby přepisu v chemických názvech a vzorcích, ale nevymýšlej nic, co v hodině nezaznělo. Pokud si nejsi jistý, napiš „(nejasné v záznamu)“.
- Vynech organizační řeči a odbočky. Zadané úkoly, testy a termíny ale uveď v sekci "## Organizační informace".
- Na konec přidej "## Klíčové body" (5–10 odrážek) a "## Otázky k opakování" (3–6 otázek).`;

  const DEFAULTS = {
    apiKey: "",
    transcribeModel: "gpt-transcribe",
    notesModel: "gpt-4o-mini",
    context: DEFAULT_CONTEXT,
    glossary: DEFAULT_GLOSSARY,
    notesPrompt: DEFAULT_NOTES_PROMPT,
  };

  const PRICE_PER_MIN = { "gpt-transcribe": 0.0045, "gpt-4o-transcribe": 0.006 };
  const SETTINGS_VERSION = 2;

  /* ---------- Storage (best effort) ---------- */
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
    },
  };

  const saved = store.get("tv.settings", {});
  if (saved.v !== SETTINGS_VERSION) {
    // v1 used gpt-4o-transcribe and a single prompt text; start from the new defaults
    delete saved.transcribeModel; delete saved.glossary; delete saved.context;
  }
  let settings = Object.assign({}, DEFAULTS, saved, { v: SETTINGS_VERSION });
  let history = store.get("tv.history", []);
  let current = null; // { id, title, date, transcript, notes }
  let busy = false;

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const el = {
    settingsDialog: $("settingsDialog"), settingsBtn: $("settingsBtn"), settingsForm: $("settingsForm"),
    apiKey: $("apiKey"), transcribeModel: $("transcribeModel"), notesModel: $("notesModel"),
    context: $("context"), glossary: $("glossary"), notesPrompt: $("notesPrompt"), resetPrompts: $("resetPrompts"),
    keyWarning: $("keyWarning"), drop: $("drop"), fileInput: $("fileInput"),
    progress: $("progress"), steps: $("steps"), bar: $("bar"), status: $("status"),
    error: $("error"), result: $("result"), resultTitle: $("resultTitle"),
    notesView: $("notesView"), transcriptView: $("transcriptView"),
    tabNotes: $("tabNotes"), tabTranscript: $("tabTranscript"),
    copyBtn: $("copyBtn"), downloadBtn: $("downloadBtn"), regenBtn: $("regenBtn"),
    historyList: $("historyList"), historySection: $("historySection"),
  };

  /* ---------- Settings ---------- */
  function fillSettingsForm() {
    el.apiKey.value = settings.apiKey;
    el.transcribeModel.value = settings.transcribeModel;
    el.notesModel.value = settings.notesModel;
    el.context.value = settings.context;
    el.glossary.value = settings.glossary;
    el.notesPrompt.value = settings.notesPrompt;
  }

  function refreshKeyWarning() {
    el.keyWarning.hidden = !!settings.apiKey;
  }

  el.settingsBtn.addEventListener("click", () => { fillSettingsForm(); el.settingsDialog.showModal(); });
  el.resetPrompts.addEventListener("click", () => {
    el.context.value = DEFAULT_CONTEXT;
    el.glossary.value = DEFAULT_GLOSSARY;
    el.notesPrompt.value = DEFAULT_NOTES_PROMPT;
  });
  el.settingsForm.addEventListener("submit", (e) => {
    if (e.submitter && e.submitter.value === "cancel") return;
    settings = {
      v: SETTINGS_VERSION,
      apiKey: el.apiKey.value.trim(),
      transcribeModel: el.transcribeModel.value,
      notesModel: el.notesModel.value.trim() || DEFAULTS.notesModel,
      context: el.context.value.trim(),
      glossary: el.glossary.value.trim(),
      notesPrompt: el.notesPrompt.value.trim() || DEFAULT_NOTES_PROMPT,
    };
    if (!store.set("tv.settings", settings)) {
      showError("Settings could not be saved in this browser (private mode?). They will be lost on reload.");
    }
    refreshKeyWarning();
  });
  el.keyWarning.querySelector("button").addEventListener("click", () => el.settingsBtn.click());

  /* ---------- OpenAI ---------- */
  async function openaiFetch(path, init, label) {
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      let res;
      try {
        res = await fetch("https://api.openai.com/v1" + path, init());
      } catch (e) {
        lastErr = new Error(`${label}: network error (${e.message}).`);
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
        continue;
      }
      if (res.ok) return res.json();
      let detail = "";
      try { detail = (await res.json()).error.message; } catch { /* ignore */ }
      if (res.status === 401) throw new Error("The OpenAI API key is invalid. Check it in Settings.");
      if (res.status === 429 && /quota|billing/i.test(detail)) {
        throw new Error("OpenAI credit is used up (or the hard limit was reached). Top up at platform.openai.com.");
      }
      lastErr = new Error(`${label} failed (${res.status}): ${detail || res.statusText}`);
      if (res.status !== 429 && res.status < 500) throw lastErr;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
    throw lastErr;
  }

  let keywordsUnsupported = false;

  function glossaryTerms() {
    return (settings.glossary || "").split(/[,;\n]/).map((t) => t.trim()).filter(Boolean).slice(0, 100);
  }

  async function transcribeChunk(chunk, previousText) {
    const useKeywords = settings.transcribeModel === "gpt-transcribe" && !keywordsUnsupported;
    let prompt = settings.context || "";
    if (!useKeywords && settings.glossary) prompt += "\nPojmy: " + settings.glossary;
    if (previousText) prompt += "\n\n" + previousText.slice(-400);
    const terms = useKeywords ? glossaryTerms() : [];
    try {
      const data = await openaiFetch("/audio/transcriptions", () => {
        const fd = new FormData();
        fd.append("file", chunk.blob, "audio.wav");
        fd.append("model", settings.transcribeModel);
        fd.append("language", "cs");
        fd.append("response_format", "json");
        if (prompt) fd.append("prompt", prompt);
        for (const t of terms) fd.append("keywords[]", t);
        return { method: "POST", headers: { Authorization: "Bearer " + settings.apiKey }, body: fd };
      }, "Transcription");
      return (data.text || "").trim();
    } catch (e) {
      // If the API rejects the keywords field, fall back to putting the terms into the prompt
      if (useKeywords && /keyword/i.test(e.message)) {
        console.warn("Keywords rejected, retrying with prompt only:", e.message);
        keywordsUnsupported = true;
        return transcribeChunk(chunk, previousText);
      }
      throw e;
    }
  }

  async function writeNotes(transcript) {
    const data = await openaiFetch("/chat/completions", () => ({
      method: "POST",
      headers: { Authorization: "Bearer " + settings.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: settings.notesModel,
        temperature: 0.3,
        messages: [
          { role: "system", content: settings.notesPrompt },
          { role: "user", content: "Přepis hodiny:\n\n" + transcript },
        ],
      }),
    }), "Writing notes");
    return data.choices[0].message.content.trim();
  }

  /* ---------- Progress UI ---------- */
  const STEP_LABELS = ["Extracting audio (on this device)", "Transcribing", "Writing study notes"];

  function setStep(index, text, fraction) {
    [...el.steps.children].forEach((li, i) => {
      li.className = i < index ? "done" : i === index ? "active" : "";
      if (i === index && text) li.querySelector("span").textContent = text;
    });
    el.bar.style.width = Math.round(Math.max(0, Math.min(1, fraction)) * 100) + "%";
  }

  function resetSteps() {
    el.steps.innerHTML = STEP_LABELS.map((l) => `<li><span>${l}</span></li>`).join("");
    el.bar.style.width = "0%";
    el.status.textContent = "";
  }

  function showError(msg) {
    el.error.textContent = msg;
    el.error.hidden = !msg;
  }

  const fmtMin = (sec) => {
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  /* ---------- Main pipeline ---------- */
  async function processFile(file) {
    if (busy) return;
    showError("");
    if (!settings.apiKey) {
      showError("Add your OpenAI API key in Settings first.");
      el.settingsBtn.click();
      return;
    }
    busy = true;
    el.drop.classList.add("disabled");
    el.progress.hidden = false;
    resetSteps();
    let wakeLock = null;
    try { wakeLock = await navigator.wakeLock.request("screen"); } catch { /* optional */ }

    try {
      // 1. Audio
      setStep(0, null, 0);
      const { chunks } = await AudioExtract.extractAudioChunks(file, (f) => {
        setStep(0, `Extracting audio (on this device) – ${Math.round(f * 100)} %`, f * 0.25);
      });
      if (!chunks.length) throw new Error("No audio was found in this file.");
      const totalSec = chunks.reduce((s, c) => s + c.durationSec, 0);
      const price = (PRICE_PER_MIN[settings.transcribeModel] || 0.006) * (totalSec / 60);
      el.status.textContent =
        `Audio length ${fmtMin(totalSec)} · ${chunks.length} part(s) · estimated cost ≈ $${price.toFixed(2)}`;

      // 2. Transcription
      const texts = [];
      for (let i = 0; i < chunks.length; i++) {
        setStep(1, `Transcribing – part ${i + 1} of ${chunks.length}`, 0.25 + (0.55 * i) / chunks.length);
        texts.push(await transcribeChunk(chunks[i], texts[i - 1]));
      }
      const transcript = texts.join("\n\n");
      current = {
        id: Date.now().toString(36),
        title: file.name.replace(/\.[^.]+$/, ""),
        date: new Date().toISOString(),
        transcript,
        notes: "",
      };
      renderResult();

      // 3. Notes
      setStep(2, null, 0.85);
      current.notes = await writeNotes(transcript);
      saveCurrent();
      renderResult();
      setStep(3, null, 1);
      el.status.textContent += " · Done ✓";
    } catch (e) {
      console.error(e);
      let msg = e && e.message ? e.message : String(e);
      if (msg === "NO_AUDIO_TRACK") msg = "This video has no audio track.";
      if (msg === "DECODE_FAILED") {
        msg = "This browser cannot read this file format. Try Chrome or Edge on a computer, or export the video as MP4.";
      }
      if (/allocation|memory|Array buffer/i.test(msg)) {
        msg = "The file is too big for this browser to open. Use Chrome or Edge on a computer, or upload an MP4.";
      }
      showError(msg);
      if (current && current.transcript && !current.notes) {
        saveCurrent();
        el.status.textContent = "The transcript is saved. Use “Regenerate notes” to try the notes again.";
      }
    } finally {
      busy = false;
      el.drop.classList.remove("disabled");
      el.fileInput.value = "";
      if (wakeLock) wakeLock.release().catch(() => {});
    }
  }

  /* ---------- Result ---------- */
  let activeTab = "notes";

  function renderMarkdown(md) {
    const html = marked.parse(md, { breaks: false, gfm: true });
    const clean = DOMPurify.sanitize(html);
    const tmp = document.createElement("div");
    tmp.innerHTML = clean;
    // Turn emoji blockquotes into callout boxes
    tmp.querySelectorAll("blockquote").forEach((bq) => {
      const t = bq.textContent.trim();
      if (t.startsWith("⚠")) bq.classList.add("callout", "warn");
      else if (t.startsWith("🧪")) bq.classList.add("callout", "example");
      else bq.classList.add("callout");
    });
    return tmp.innerHTML;
  }

  function renderResult() {
    if (!current) { el.result.hidden = true; return; }
    el.result.hidden = false;
    el.resultTitle.textContent = current.title;
    el.notesView.innerHTML = current.notes
      ? renderMarkdown(current.notes)
      : '<p class="muted">Study notes are not ready yet…</p>';
    el.transcriptView.textContent = current.transcript;
    el.regenBtn.disabled = !current.transcript;
    setTab(activeTab);
  }

  function setTab(tab) {
    activeTab = tab;
    el.tabNotes.setAttribute("aria-selected", tab === "notes");
    el.tabTranscript.setAttribute("aria-selected", tab === "transcript");
    el.notesView.hidden = tab !== "notes";
    el.transcriptView.hidden = tab !== "transcript";
    el.copyBtn.textContent = tab === "notes" ? "Copy notes (Markdown)" : "Copy transcript";
  }

  el.tabNotes.addEventListener("click", () => setTab("notes"));
  el.tabTranscript.addEventListener("click", () => setTab("transcript"));

  function currentText() {
    return activeTab === "notes" ? current.notes : current.transcript;
  }

  el.copyBtn.addEventListener("click", async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(currentText());
      flash(el.copyBtn, "Copied ✓");
    } catch {
      showError("Copy failed – select the text and copy it manually.");
    }
  });

  el.downloadBtn.addEventListener("click", () => {
    if (!current) return;
    const isNotes = activeTab === "notes";
    const blob = new Blob([currentText()], { type: isNotes ? "text/markdown" : "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = current.title + (isNotes ? " – zápisky.md" : " – přepis.txt");
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  el.regenBtn.addEventListener("click", async () => {
    if (!current || busy) return;
    if (!settings.apiKey) { el.settingsBtn.click(); return; }
    busy = true;
    showError("");
    el.regenBtn.disabled = true;
    el.regenBtn.textContent = "Writing…";
    try {
      current.notes = await writeNotes(current.transcript);
      saveCurrent();
      setTab("notes");
      renderResult();
    } catch (e) {
      showError(e.message);
    } finally {
      busy = false;
      el.regenBtn.disabled = false;
      el.regenBtn.textContent = "Regenerate notes";
    }
  });

  function flash(btn, text) {
    const old = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = old; }, 1500);
  }

  /* ---------- History ---------- */
  function saveCurrent() {
    history = [current, ...history.filter((h) => h.id !== current.id)].slice(0, 30);
    while (history.length && !store.set("tv.history", history)) history.pop();
    renderHistory();
  }

  function renderHistory() {
    el.historySection.hidden = !history.length;
    el.historyList.innerHTML = "";
    for (const h of history) {
      const li = document.createElement("li");
      const open = document.createElement("button");
      open.className = "link";
      open.textContent = h.title;
      open.addEventListener("click", () => { current = h; renderResult(); el.result.scrollIntoView({ behavior: "smooth" }); });
      const date = document.createElement("span");
      date.className = "muted";
      date.textContent = new Date(h.date).toLocaleString();
      const del = document.createElement("button");
      del.className = "icon";
      del.title = "Remove from history";
      del.textContent = "✕";
      del.addEventListener("click", () => {
        if (!confirm(`Remove “${h.title}” from history?`)) return;
        history = history.filter((x) => x.id !== h.id);
        store.set("tv.history", history);
        renderHistory();
      });
      li.append(open, date, del);
      el.historyList.append(li);
    }
  }

  /* ---------- File input ---------- */
  el.fileInput.addEventListener("change", () => {
    if (el.fileInput.files[0]) processFile(el.fileInput.files[0]);
  });
  ["dragenter", "dragover"].forEach((t) => el.drop.addEventListener(t, (e) => {
    e.preventDefault(); el.drop.classList.add("over");
  }));
  ["dragleave", "drop"].forEach((t) => el.drop.addEventListener(t, (e) => {
    e.preventDefault(); el.drop.classList.remove("over");
  }));
  el.drop.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (f) processFile(f);
  });
  window.addEventListener("beforeunload", (e) => {
    if (busy) { e.preventDefault(); e.returnValue = ""; }
  });

  /* ---------- Init ---------- */
  refreshKeyWarning();
  renderHistory();
  if (history[0]) { current = history[0]; renderResult(); }
})();
