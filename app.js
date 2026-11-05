(function () {
  "use strict";

  const { SUBJECTS, BASE_NOTES_PROMPT, AUTO_CONTEXT, AUTO_TERMS, CLASSIFY_PROMPT } = window.Subjects;
  const UNSORTED = "Nezařazeno";

  /* ---------- Settings ---------- */
  const SETTINGS_VERSION = 3;
  const DEFAULTS = {
    v: SETTINGS_VERSION,
    openaiKey: "",
    elevenKey: "",
    engine: "auto", // auto | elevenlabs | openai
    notesModel: "auto", // auto | explicit OpenAI model id
    extraTerms: "",
    subject: "auto", // auto | subject id
  };

  // Transcription price per minute of audio (USD), for the estimate shown to the user
  const PRICE_PER_MIN = { elevenlabs: (0.22 + 0.05) / 60, openai: 0.0045 };
  const FALLBACK_NOTES_MODEL = "gpt-4o-mini";

  /* ---------- Storage (best effort) ---------- */
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    },
  };

  function loadSettings() {
    const saved = store.get("tv.settings", {});
    if (saved.v !== SETTINGS_VERSION) {
      // Older versions: keep only the OpenAI key
      return Object.assign({}, DEFAULTS, { openaiKey: saved.openaiKey || saved.apiKey || "" });
    }
    return Object.assign({}, DEFAULTS, saved);
  }

  let settings = loadSettings();
  let lessons = []; // library, loaded from IndexedDB
  let current = null; // { id, title, subject, topic, engine, notesModel, date, transcript, notes }
  let busy = false;

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const el = {
    settingsDialog: $("settingsDialog"), settingsBtn: $("settingsBtn"), settingsForm: $("settingsForm"),
    openaiKey: $("openaiKey"), elevenKey: $("elevenKey"), engine: $("engine"), notesModel: $("notesModel"),
    loadModels: $("loadModels"), extraTerms: $("extraTerms"),
    copySetupLink: $("copySetupLink"), setupNotice: $("setupNotice"),
    keyWarning: $("keyWarning"), subjects: $("subjects"), drop: $("drop"), fileInput: $("fileInput"),
    engineInfo: $("engineInfo"),
    progress: $("progress"), steps: $("steps"), bar: $("bar"), status: $("status"),
    error: $("error"), result: $("result"), resultTitle: $("resultTitle"),
    resultPath: $("resultPath"), resultMeta: $("resultMeta"), editBtn: $("editBtn"),
    notesView: $("notesView"), transcriptView: $("transcriptView"),
    tabNotes: $("tabNotes"), tabTranscript: $("tabTranscript"),
    copyBtn: $("copyBtn"), downloadBtn: $("downloadBtn"), regenBtn: $("regenBtn"),
    librarySection: $("librarySection"), library: $("library"), librarySearch: $("librarySearch"),
    exportBtn: $("exportBtn"), importInput: $("importInput"),
    editDialog: $("editDialog"), editForm: $("editForm"), editTitle: $("editTitle"),
    editSubject: $("editSubject"), editTopic: $("editTopic"), topicOptions: $("topicOptions"),
    editHeading: $("editHeading"), editContentWrap: $("editContentWrap"), editContent: $("editContent"),
    newNoteBtn: $("newNoteBtn"), newNoteBtn2: $("newNoteBtn2"), ownBadge: $("ownBadge"), tabs: $("tabs"),
    myNotes: $("myNotes"), annotationList: $("annotationList"), annotationForm: $("annotationForm"),
    annotationText: $("annotationText"),
  };

  function saveSettings() {
    if (!store.set("tv.settings", settings)) {
      showError("Settings could not be saved in this browser (private mode?). They will be lost on reload.");
    }
  }

  function activeEngine() {
    if (settings.engine === "elevenlabs") return "elevenlabs";
    if (settings.engine === "openai") return "openai";
    return settings.elevenKey ? "elevenlabs" : "openai";
  }

  const ENGINE_LABEL = { elevenlabs: "ElevenLabs Scribe v2", openai: "OpenAI gpt-transcribe" };
  const subjectLabel = (id) => (SUBJECTS[id] ? `${SUBJECTS[id].icon} ${SUBJECTS[id].label}` : "📄 Ostatní");

  /* ---------- Subject picker ---------- */
  function renderSubjects() {
    el.subjects.innerHTML = "";
    const options = [["auto", "✨ Auto-detect"], ...Object.entries(SUBJECTS).map(([id, s]) => [id, `${s.icon} ${s.label}`])];
    for (const [id, label] of options) {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(settings.subject === id));
      b.textContent = label;
      b.addEventListener("click", () => {
        if (busy) return;
        settings.subject = id;
        saveSettings();
        renderSubjects();
      });
      el.subjects.append(b);
    }
  }

  function refreshInfo() {
    el.keyWarning.hidden = !!settings.openaiKey;
    const eng = activeEngine();
    const notes = settings.notesModel === "auto" ? "best available GPT" : settings.notesModel;
    el.engineInfo.textContent = `Transcription: ${ENGINE_LABEL[eng]} · Notes: ${notes}`;
  }

  /* ---------- Settings dialog ---------- */
  function fillSettingsForm() {
    el.openaiKey.value = settings.openaiKey;
    el.elevenKey.value = settings.elevenKey;
    el.engine.value = settings.engine;
    setNotesModelOptions(cachedModelIds(), settings.notesModel);
    el.extraTerms.value = settings.extraTerms;
  }

  function setNotesModelOptions(ids, selected) {
    const auto = pickBestModel(ids);
    el.notesModel.innerHTML = "";
    const add = (value, label) => {
      const o = document.createElement("option");
      o.value = value; o.textContent = label;
      el.notesModel.append(o);
    };
    add("auto", auto ? `Auto – best available (${auto})` : "Auto – best available");
    const list = [...ids].sort();
    if (selected && selected !== "auto" && !list.includes(selected)) list.unshift(selected);
    for (const id of list) add(id, id);
    el.notesModel.value = selected || "auto";
  }

  el.settingsBtn.addEventListener("click", () => { fillSettingsForm(); el.settingsDialog.showModal(); });
  el.keyWarning.querySelector("button").addEventListener("click", () => el.settingsBtn.click());

  el.loadModels.addEventListener("click", async () => {
    const key = el.openaiKey.value.trim();
    if (!key) { alert("Enter the OpenAI API key first."); return; }
    el.loadModels.disabled = true;
    el.loadModels.textContent = "Loading…";
    try {
      const ids = await listOpenAIModels(key, true);
      setNotesModelOptions(ids, el.notesModel.value);
    } catch (e) {
      alert(e.message);
    } finally {
      el.loadModels.disabled = false;
      el.loadModels.textContent = "Load my models";
    }
  });

  el.settingsForm.addEventListener("submit", (e) => {
    if (e.submitter && e.submitter.value === "cancel") return;
    settings = Object.assign({}, settings, {
      openaiKey: el.openaiKey.value.trim(),
      elevenKey: el.elevenKey.value.trim(),
      engine: el.engine.value,
      notesModel: el.notesModel.value || "auto",
      extraTerms: el.extraTerms.value.trim(),
    });
    saveSettings();
    refreshInfo();
  });

  /* ---------- HTTP helper ---------- */
  async function apiFetch(provider, url, makeInit, label) {
    const name = provider === "elevenlabs" ? "ElevenLabs" : "OpenAI";
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      let res;
      try {
        res = await fetch(url, makeInit());
      } catch (e) {
        lastErr = new Error(`${label}: network error (${e.message}).`);
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
        continue;
      }
      if (res.ok) return res.json();
      let detail = "";
      try {
        const j = await res.json();
        detail = (j.error && j.error.message) || (j.detail && (j.detail.message || JSON.stringify(j.detail))) || "";
      } catch { /* ignore */ }
      if (res.status === 401) throw new Error(`The ${name} API key is invalid or lacks permission. Check it in Settings. ${detail}`);
      if (res.status === 402 || /quota|billing|credits|insufficient/i.test(detail)) {
        throw new Error(`${name} credit is used up (or the limit was reached). ${detail}`);
      }
      lastErr = new Error(`${label} failed (${res.status}): ${detail || res.statusText}`);
      lastErr.status = res.status;
      if (res.status !== 429 && res.status < 500) throw lastErr;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
    throw lastErr;
  }

  /* ---------- Transcription ---------- */
  // subject may be "auto" (first audio part, before the subject is known)
  function termsFor(subject) {
    const extra = (settings.extraTerms || "").split(/[,;\n]/).map((t) => t.trim()).filter(Boolean);
    const base = SUBJECTS[subject] ? SUBJECTS[subject].terms : AUTO_TERMS();
    return [...new Set([...extra, ...base])].filter((t) => t.length <= 50).slice(0, 100);
  }
  const contextFor = (subject) => (SUBJECTS[subject] ? SUBJECTS[subject].context : AUTO_CONTEXT);

  const unsupported = { openaiKeywords: false, elevenKeyterms: false };

  async function transcribeOpenAI(chunk, previousText, subject) {
    const useKeywords = !unsupported.openaiKeywords;
    const terms = termsFor(subject);
    let prompt = contextFor(subject);
    if (!useKeywords) prompt += "\nPojmy: " + terms.join(", ");
    if (previousText) prompt += "\n\n" + previousText.slice(-400);
    try {
      const data = await apiFetch("openai", "https://api.openai.com/v1/audio/transcriptions", () => {
        const fd = new FormData();
        fd.append("file", chunk.blob, "audio.wav");
        fd.append("model", "gpt-transcribe");
        fd.append("language", "cs");
        fd.append("response_format", "json");
        fd.append("prompt", prompt);
        if (useKeywords) for (const t of terms) fd.append("keywords[]", t);
        return { method: "POST", headers: { Authorization: "Bearer " + settings.openaiKey }, body: fd };
      }, "Transcription");
      return (data.text || "").trim();
    } catch (e) {
      if (useKeywords && /keyword/i.test(e.message)) {
        console.warn("Keywords rejected, retrying with prompt only:", e.message);
        unsupported.openaiKeywords = true;
        return transcribeOpenAI(chunk, previousText, subject);
      }
      throw e;
    }
  }

  async function transcribeEleven(chunk, subject) {
    const useKeyterms = !unsupported.elevenKeyterms;
    try {
      const data = await apiFetch("elevenlabs", "https://api.elevenlabs.io/v1/speech-to-text", () => {
        const fd = new FormData();
        fd.append("file", chunk.blob, "audio.wav");
        fd.append("model_id", "scribe_v2");
        fd.append("language_code", "cs");
        fd.append("tag_audio_events", "false");
        fd.append("diarize", "false");
        if (useKeyterms) for (const t of termsFor(subject)) fd.append("keyterms", t);
        return { method: "POST", headers: { "xi-api-key": settings.elevenKey }, body: fd };
      }, "Transcription");
      return (data.text || "").trim();
    } catch (e) {
      if (useKeyterms && /keyterm/i.test(e.message)) {
        console.warn("Keyterms rejected, retrying without:", e.message);
        unsupported.elevenKeyterms = true;
        return transcribeEleven(chunk, subject);
      }
      throw e;
    }
  }

  /* ---------- Notes model selection ---------- */
  const EXCLUDE = /(mini|nano|luna|astra|pro|audio|realtime|transcribe|tts|image|search|codex|instruct|embedding|moderation|oss|preview|chat-latest|\d{4}-\d{2}-\d{2})/i;
  const TIER_BONUS = { sol: 3, terra: 1 };

  function pickBestModel(ids) {
    let best = null, bestScore = -1;
    for (const id of ids) {
      const m = /^gpt-(\d+(?:\.\d+)?)(?:-([a-z]+))?$/i.exec(id);
      if (!m || EXCLUDE.test(id)) continue;
      const tier = (m[2] || "").toLowerCase();
      const score = parseFloat(m[1]) * 10 + (tier ? TIER_BONUS[tier] || 0 : 2);
      if (score > bestScore) { bestScore = score; best = id; }
    }
    return best;
  }

  function cachedModelIds() {
    const c = store.get("tv.models", null);
    return c && Array.isArray(c.ids) ? c.ids : [];
  }

  async function listOpenAIModels(key, force) {
    const c = store.get("tv.models", null);
    if (!force && c && Date.now() - c.at < 24 * 3600 * 1000 && c.ids.length) return c.ids;
    const res = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: "Bearer " + key } });
    if (!res.ok) throw new Error(`Could not load OpenAI models (${res.status}). Check the API key.`);
    const ids = (await res.json()).data.map((m) => m.id).filter((id) => /^(gpt|o\d)/i.test(id));
    store.set("tv.models", { at: Date.now(), ids });
    return ids;
  }

  async function resolveNotesModel() {
    if (settings.notesModel && settings.notesModel !== "auto") return settings.notesModel;
    try {
      return pickBestModel(await listOpenAIModels(settings.openaiKey)) || FALLBACK_NOTES_MODEL;
    } catch {
      return FALLBACK_NOTES_MODEL;
    }
  }

  /* ---------- OpenAI text generation ---------- */
  function extractResponsesText(data) {
    if (typeof data.output_text === "string") return data.output_text;
    return (data.output || [])
      .flatMap((o) => o.content || [])
      .filter((c) => c.type === "output_text")
      .map((c) => c.text)
      .join("");
  }

  async function generateText(model, system, user, label) {
    const auth = { Authorization: "Bearer " + settings.openaiKey, "Content-Type": "application/json" };
    try {
      const data = await apiFetch("openai", "https://api.openai.com/v1/chat/completions", () => ({
        method: "POST",
        headers: auth,
        body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      }), label);
      return data.choices[0].message.content.trim();
    } catch (e) {
      // Some newer models are only available through the Responses API
      if (e.status && e.status < 500 && /respons|not supported|chat/i.test(e.message)) {
        const data = await apiFetch("openai", "https://api.openai.com/v1/responses", () => ({
          method: "POST",
          headers: auth,
          body: JSON.stringify({ model, instructions: system, input: user }),
        }), label);
        return extractResponsesText(data).trim();
      }
      throw e;
    }
  }

  const stripDiacritics = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

  async function classifySubject(sample, model) {
    const answer = stripDiacritics((await generateText(model, CLASSIFY_PROMPT, sample.slice(0, 6000), "Detecting subject")).toLowerCase());
    return Object.keys(SUBJECTS).find((id) => answer.includes(id)) || null;
  }

  function topicsFor(subject) {
    return [...new Set(lessons.filter((l) => l.subject === subject && l.topic && l.topic !== UNSORTED).map((l) => l.topic))].sort();
  }

  // Reuse an existing topic name when it only differs in case/diacritics/spacing
  function canonicalTopic(subject, topic) {
    const norm = (s) => stripDiacritics(s).toLowerCase().replace(/\s+/g, " ").trim();
    return topicsFor(subject).find((t) => norm(t) === norm(topic)) || topic;
  }

  function parseNotes(raw) {
    const lines = raw.replace(/^```[a-z]*\n/i, "").split("\n");
    let topic = "", title = "", sep = -1;
    for (let i = 0; i < Math.min(lines.length, 12); i++) {
      const line = lines[i].trim().replace(/^\*\*|\*\*$/g, "");
      const t = /^T[EÉ]MA\s*:\s*(.+)$/i.exec(line);
      const n = /^N[AÁ]ZEV\s*:\s*(.+)$/i.exec(line);
      if (t) topic = t[1].trim();
      else if (n) title = n[1].trim();
      else if (/^-{3,}$/.test(line) && (topic || title)) { sep = i; break; }
    }
    const notes = (sep >= 0 ? lines.slice(sep + 1) : lines).join("\n").trim();
    if (!title) {
      const h = /^#\s+(.+)$/m.exec(notes);
      if (h) title = h[1].trim();
    }
    const clean = (s) => s.replace(/^["„“']+|["“”']+$/g, "").trim();
    return { topic: clean(topic), title: clean(title), notes };
  }

  async function writeNotes(transcript, subject, model) {
    const raw = await generateText(model, BASE_NOTES_PROMPT(SUBJECTS[subject], topicsFor(subject)),
      "Přepis hodiny:\n\n" + transcript, "Writing notes");
    const parsed = parseNotes(raw);
    parsed.topic = parsed.topic ? canonicalTopic(subject, parsed.topic) : UNSORTED;
    return parsed;
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
    const engine = activeEngine();
    if (!settings.openaiKey || (engine === "elevenlabs" && !settings.elevenKey)) {
      showError(!settings.openaiKey
        ? "Add your OpenAI API key in Settings first (it is needed for the study notes)."
        : "ElevenLabs is selected for transcription but no ElevenLabs API key is set.");
      el.settingsBtn.click();
      return;
    }
    let subject = settings.subject;
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
      const price = PRICE_PER_MIN[engine] * (totalSec / 60);
      const statusBase = `Audio ${fmtMin(totalSec)} · ${chunks.length} part(s) · ${ENGINE_LABEL[engine]} ≈ $${price.toFixed(2)}`;
      el.status.textContent = statusBase;

      // 2. Transcription (first part decides the subject when on auto)
      const model = await resolveNotesModel();
      const texts = [];
      for (let i = 0; i < chunks.length; i++) {
        setStep(1, `Transcribing (${ENGINE_LABEL[engine]}) – part ${i + 1} of ${chunks.length}`,
          0.25 + (0.55 * i) / chunks.length);
        texts.push(engine === "elevenlabs"
          ? await transcribeEleven(chunks[i], subject)
          : await transcribeOpenAI(chunks[i], texts[i - 1], subject));
        if (i === 0 && subject === "auto") {
          setStep(1, "Detecting the subject…", 0.25 + 0.55 / chunks.length);
          subject = (await classifySubject(texts[0], model)) || "biologie";
          el.status.textContent = `${SUBJECTS[subject].label} (auto) · ${statusBase}`;
        }
      }
      if (!el.status.textContent.includes("(auto)")) el.status.textContent = `${SUBJECTS[subject].label} · ${statusBase}`;
      const transcript = texts.join("\n\n");
      current = {
        id: Date.now().toString(36),
        title: file.name.replace(/\.[^.]+$/, ""),
        fileName: file.name,
        subject, topic: UNSORTED, engine,
        date: new Date().toISOString(),
        transcript,
        notes: "",
      };
      renderResult();

      // 3. Notes + title + topic folder
      setStep(2, `Writing study notes (${model})`, 0.85);
      const out = await writeNotes(transcript, subject, model);
      Object.assign(current, { notes: out.notes, topic: out.topic, notesModel: model });
      if (out.title) current.title = out.title;
      await saveCurrent();
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
        await saveCurrent();
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
    const tmp = document.createElement("div");
    tmp.innerHTML = DOMPurify.sanitize(marked.parse(md, { gfm: true }));
    tmp.querySelectorAll("blockquote").forEach((bq) => {
      const t = bq.textContent.trim();
      bq.classList.add("callout");
      if (t.startsWith("⚠")) bq.classList.add("warn");
      else if (t.startsWith("🧪")) bq.classList.add("example");
    });
    return tmp.innerHTML;
  }

  function renderResult() {
    if (!current) { el.result.hidden = true; return; }
    el.result.hidden = false;
    el.resultTitle.textContent = current.title;
    el.resultPath.textContent = `${subjectLabel(current.subject)} › 📁 ${current.topic || UNSORTED}`;
    el.resultMeta.textContent = [
      new Date(current.date).toLocaleDateString(),
      current.engine ? ENGINE_LABEL[current.engine] : "",
      current.notesModel || "",
    ].filter(Boolean).join(" · ");
    const own = current.kind === "note";
    el.ownBadge.hidden = !own;
    el.tabs.hidden = own;
    el.regenBtn.hidden = own;
    if (own) {
      el.resultMeta.textContent = new Date(current.date).toLocaleDateString() +
        (current.updated ? ` · edited ${new Date(current.updated).toLocaleDateString()}` : "");
    }
    el.notesView.classList.toggle("own", own);
    el.notesView.innerHTML = current.notes
      ? renderMarkdown(current.notes)
      : `<p class="muted">${own ? "Empty note – use ✎ Edit to write it." : "Study notes are not ready yet…"}</p>`;
    el.transcriptView.textContent = current.transcript || "";
    el.regenBtn.disabled = !current.transcript;
    renderAnnotations();
    setTab(own ? "notes" : activeTab);
  }

  /* ---------- Personal notes attached to a lesson ---------- */
  const fmtDateTime = (iso) => new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" });

  function renderAnnotations() {
    const list = current.annotations || [];
    el.myNotes.hidden = current.kind === "note";
    el.annotationList.innerHTML = "";
    for (const a of list) {
      const box = document.createElement("div");
      box.className = "annotation";
      const head = document.createElement("div");
      head.className = "annotation-head";
      head.innerHTML = `<span>✍️ My note · ${fmtDateTime(a.date)}${a.updated ? " (edited)" : ""}</span>`;
      const edit = document.createElement("button");
      edit.className = "icon"; edit.type = "button"; edit.title = "Edit note"; edit.textContent = "✎";
      const del = document.createElement("button");
      del.className = "icon"; del.type = "button"; del.title = "Delete note"; del.textContent = "✕";
      head.append(edit, del);
      const body = document.createElement("div");
      body.className = "annotation-body";
      body.innerHTML = renderMarkdown(a.text);
      edit.addEventListener("click", () => {
        const ta = document.createElement("textarea");
        ta.rows = Math.max(3, a.text.split("\n").length + 1);
        ta.value = a.text;
        const save = document.createElement("button");
        save.type = "button"; save.textContent = "Save";
        save.addEventListener("click", async () => {
          const text = ta.value.trim();
          if (!text) return;
          Object.assign(a, { text, updated: new Date().toISOString() });
          await saveCurrent();
          renderAnnotations();
        });
        body.replaceChildren(ta, save);
        ta.focus();
      });
      del.addEventListener("click", async () => {
        if (!confirm("Delete this note?")) return;
        current.annotations = list.filter((x) => x !== a);
        await saveCurrent();
        renderAnnotations();
      });
      box.append(head, body);
      el.annotationList.append(box);
    }
  }

  el.annotationForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = el.annotationText.value.trim();
    if (!text || !current) return;
    current.annotations = [...(current.annotations || []),
      { id: Date.now().toString(36), text, date: new Date().toISOString() }];
    el.annotationText.value = "";
    await saveCurrent();
    renderAnnotations();
  });

  // Markdown for copy/download: AI notes followed by her own notes, clearly marked
  function notesWithAnnotations(l) {
    const list = l.annotations || [];
    if (!list.length) return l.notes;
    const mine = list.map((a) => `> ✍️ **Moje poznámka (${fmtDateTime(a.date)}):**\n> ${a.text.replace(/\n/g, "\n> ")}`).join("\n\n");
    return `${l.notes}\n\n## ✍️ Moje poznámky\n\n${mine}`;
  }

  function setTab(tab) {
    activeTab = tab;
    el.tabNotes.setAttribute("aria-selected", String(tab === "notes"));
    el.tabTranscript.setAttribute("aria-selected", String(tab === "transcript"));
    el.notesView.hidden = tab !== "notes";
    el.transcriptView.hidden = tab !== "transcript";
    el.myNotes.classList.toggle("hidden-tab", tab !== "notes");
    el.copyBtn.textContent = tab === "notes" ? "Copy notes (Markdown)" : "Copy transcript";
  }

  el.tabNotes.addEventListener("click", () => setTab("notes"));
  el.tabTranscript.addEventListener("click", () => setTab("transcript"));

  const currentText = () => (activeTab === "notes" ? notesWithAnnotations(current) : current.transcript);

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
    const suffix = current.kind === "note" ? " – můj zápis.md" : isNotes ? " – zápisky.md" : " – přepis.txt";
    downloadFile(current.title + suffix, currentText(),
      isNotes ? "text/markdown" : "text/plain");
  });

  function downloadFile(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name.replace(/[\\/:*?"<>|]+/g, "-");
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  el.regenBtn.addEventListener("click", async () => {
    if (!current || busy) return;
    if (!settings.openaiKey) { el.settingsBtn.click(); return; }
    busy = true;
    showError("");
    el.regenBtn.disabled = true;
    el.regenBtn.textContent = "Writing…";
    try {
      const model = await resolveNotesModel();
      const subject = SUBJECTS[current.subject] ? current.subject
        : (await classifySubject(current.transcript, model)) || "biologie";
      const out = await writeNotes(current.transcript, subject, model);
      Object.assign(current, { subject, notes: out.notes, notesModel: model });
      if (!current.topic || current.topic === UNSORTED) current.topic = out.topic;
      if (out.title && (!current.title || current.title === (current.fileName || "").replace(/\.[^.]+$/, ""))) {
        current.title = out.title;
      }
      await saveCurrent();
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

  /* ---------- Edit (move to another subject/topic, rename) ---------- */
  let editMode = "edit"; // edit | new

  function openEditDialog(mode) {
    editMode = mode;
    const isNew = mode === "new";
    const target = isNew ? null : current;
    el.editHeading.textContent = isNew ? "✍️ New note" : target.kind === "note" ? "✍️ Edit my note" : "Edit lesson";
    el.editTitle.value = isNew ? "" : target.title;
    el.editSubject.innerHTML = Object.entries(SUBJECTS)
      .map(([id, s]) => `<option value="${id}">${s.icon} ${s.label}</option>`).join("");
    const subj = isNew ? (SUBJECTS[settings.subject] ? settings.subject : current && SUBJECTS[current.subject] ? current.subject : "biologie")
      : SUBJECTS[target.subject] ? target.subject : "biologie";
    el.editSubject.value = subj;
    el.editTopic.value = isNew ? (current && current.subject === subj && current.topic !== UNSORTED ? current.topic : "")
      : target.topic === UNSORTED ? "" : target.topic || "";
    const showContent = isNew || target.kind === "note";
    el.editContentWrap.hidden = !showContent;
    el.editContent.value = isNew ? "" : showContent ? target.notes : "";
    fillTopicOptions();
    el.editDialog.showModal();
  }

  el.editBtn.addEventListener("click", () => { if (current) openEditDialog("edit"); });
  el.newNoteBtn.addEventListener("click", () => openEditDialog("new"));
  el.newNoteBtn2.addEventListener("click", () => openEditDialog("new"));

  function fillTopicOptions() {
    el.topicOptions.innerHTML = topicsFor(el.editSubject.value)
      .map((t) => `<option value="${t.replace(/"/g, "&quot;")}"></option>`).join("");
  }
  el.editSubject.addEventListener("change", fillTopicOptions);

  el.editForm.addEventListener("submit", async (e) => {
    if (e.submitter && e.submitter.value === "cancel") return;
    const subject = el.editSubject.value;
    const topicInput = el.editTopic.value.trim();
    const topic = topicInput ? canonicalTopic(subject, topicInput) : UNSORTED;
    if (editMode === "new") {
      const now = new Date().toISOString();
      current = {
        id: Date.now().toString(36), kind: "note",
        title: el.editTitle.value.trim() || "Můj zápis",
        subject, topic, date: now, transcript: "", notes: el.editContent.value.trim(),
      };
    } else {
      current.title = el.editTitle.value.trim() || current.title;
      current.subject = subject;
      current.topic = topic;
      if (current.kind === "note") {
        current.notes = el.editContent.value.trim();
        current.updated = new Date().toISOString();
      }
    }
    renderResult();
    await saveCurrent();
    el.result.scrollIntoView({ behavior: "smooth" });
  });

  /* ---------- Library ---------- */
  async function saveCurrent() {
    try {
      await LessonDB.put(current);
    } catch (e) {
      showError("Could not save the lesson in this browser: " + e.message);
    }
    lessons = [current, ...lessons.filter((l) => l.id !== current.id)];
    renderLibrary();
  }

  const groupState = new Map(); // key -> open (user toggles survive re-renders)

  function matches(l, q) {
    if (!q) return true;
    const mine = (l.annotations || []).map((a) => a.text).join(" ");
    const hay = stripDiacritics(`${l.title} ${l.topic} ${l.notes} ${mine}`).toLowerCase();
    return stripDiacritics(q).toLowerCase().split(/\s+/).every((w) => hay.includes(w));
  }

  function groupDetails(key, summaryHtml, defaultOpen) {
    const d = document.createElement("details");
    d.open = groupState.has(key) ? groupState.get(key) : defaultOpen;
    d.innerHTML = `<summary>${summaryHtml}</summary>`;
    d.addEventListener("toggle", () => groupState.set(key, d.open));
    return d;
  }

  const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function renderLibrary() {
    el.librarySection.hidden = !lessons.length;
    el.library.innerHTML = "";
    const q = el.librarySearch.value.trim();
    const visible = lessons.filter((l) => matches(l, q));
    if (!visible.length) {
      el.library.innerHTML = '<p class="muted small">Nothing found.</p>';
      return;
    }
    const subjectIds = [...Object.keys(SUBJECTS), "other"];
    for (const sid of subjectIds) {
      const inSubject = visible.filter((l) => (SUBJECTS[l.subject] ? l.subject : "other") === sid);
      if (!inSubject.length) continue;
      const sd = groupDetails("s:" + sid,
        `${subjectLabel(sid)} <span class="count">${inSubject.length}</span>`, true);
      sd.className = "lib-subject";
      const topics = [...new Set(inSubject.map((l) => l.topic || UNSORTED))]
        .sort((a, b) => (a === UNSORTED) - (b === UNSORTED) || a.localeCompare(b, "cs"));
      for (const topic of topics) {
        const items = inSubject.filter((l) => (l.topic || UNSORTED) === topic)
          .sort((a, b) => a.date.localeCompare(b.date));
        const td = groupDetails(`t:${sid}:${topic}`,
          `📁 ${escapeHtml(topic)} <span class="count">${items.length}</span>`,
          !!q || (current && current.subject === sid && current.topic === topic));
        td.className = "lib-topic";
        const ul = document.createElement("ul");
        ul.className = "lessons";
        for (const l of items) ul.append(lessonItem(l));
        td.append(ul);
        sd.append(td);
      }
      el.library.append(sd);
    }
  }

  function lessonItem(l) {
    const li = document.createElement("li");
    if (current && current.id === l.id) li.classList.add("current");
    const open = document.createElement("button");
    open.className = "link";
    const marks = (l.kind === "note" ? "✍️ " : "") + ((l.annotations || []).length ? "📝 " : "");
    open.textContent = marks + l.title;
    open.title = l.title;
    open.addEventListener("click", () => {
      current = l; renderResult(); renderLibrary();
      el.result.scrollIntoView({ behavior: "smooth" });
    });
    const date = document.createElement("span");
    date.className = "muted small";
    date.textContent = new Date(l.date).toLocaleDateString();
    const del = document.createElement("button");
    del.className = "icon";
    del.title = "Delete lesson";
    del.textContent = "✕";
    del.addEventListener("click", async () => {
      if (!confirm(`Delete “${l.title}”? This cannot be undone.`)) return;
      await LessonDB.remove(l.id);
      lessons = lessons.filter((x) => x.id !== l.id);
      if (current && current.id === l.id) { current = null; renderResult(); }
      renderLibrary();
    });
    li.append(open, date, del);
    return li;
  }

  el.librarySearch.addEventListener("input", renderLibrary);

  el.exportBtn.addEventListener("click", () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(`zapisky-zaloha-${stamp}.json`, JSON.stringify({ app: "lesson-notes", version: 1, lessons }, null, 1),
      "application/json");
  });

  el.importInput.addEventListener("change", async () => {
    const f = el.importInput.files[0];
    el.importInput.value = "";
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const incoming = (data.lessons || []).filter((l) => l && l.id && typeof l.transcript === "string");
      for (const l of incoming) await LessonDB.put(l);
      lessons = await loadLessons();
      renderLibrary();
      alert(`Imported ${incoming.length} lesson(s).`);
    } catch (e) {
      showError("Import failed: " + e.message);
    }
  });

  async function loadLessons() {
    // One-time migration from the old localStorage history
    const old = store.get("tv.history", null);
    if (Array.isArray(old) && old.length) {
      for (const l of old) {
        await LessonDB.put(Object.assign({ topic: UNSORTED }, l, { subject: SUBJECTS[l.subject] ? l.subject : "other" }));
      }
      store.remove("tv.history");
    }
    const all = await LessonDB.all();
    return all.sort((a, b) => b.date.localeCompare(a.date));
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

  /* ---------- Setup link: #openai=…&eleven=… ----------
   * The URL fragment is never sent to the web server. Keys from it are saved
   * to this browser and the fragment is removed from the address bar/history. */
  function importKeysFromHash() {
    if (!location.hash || location.hash.length < 2) return;
    const params = new URLSearchParams(location.hash.slice(1));
    const openai = (params.get("openai") || "").trim();
    const eleven = (params.get("eleven") || "").trim();
    if (!openai && !eleven) return;
    if (openai) settings.openaiKey = openai;
    if (eleven) settings.elevenKey = eleven;
    saveSettings();
    window.history.replaceState(null, "", location.pathname + location.search);
    el.setupNotice.hidden = false;
  }

  function buildSetupLink() {
    const p = new URLSearchParams();
    const o = el.openaiKey.value.trim(), e = el.elevenKey.value.trim();
    if (o) p.set("openai", o);
    if (e) p.set("eleven", e);
    return location.origin + location.pathname + "#" + p.toString();
  }

  el.copySetupLink.addEventListener("click", async () => {
    if (!el.openaiKey.value.trim()) { alert("Enter the OpenAI API key first."); return; }
    try {
      await navigator.clipboard.writeText(buildSetupLink());
      flash(el.copySetupLink, "Link copied ✓");
    } catch {
      prompt("Copy this setup link:", buildSetupLink());
    }
  });

  /* ---------- Init ---------- */
  importKeysFromHash();
  if (settings.subject !== "auto" && !SUBJECTS[settings.subject]) settings.subject = "auto";
  renderSubjects();
  refreshInfo();
  loadLessons().then((all) => {
    lessons = all;
    renderLibrary();
    if (lessons[0] && !current) { current = lessons[0]; renderResult(); renderLibrary(); }
  }).catch((e) => showError("Could not load saved lessons: " + e.message));
})();
