(function () {
  "use strict";

  const { SUBJECTS, BASE_NOTES_PROMPT, SEGMENT_NOTES_PROMPT, FINAL_PROMPT, AUTO_CONTEXT, AUTO_TERMS, CLASSIFY_PROMPT } = window.Subjects;
  const SEGMENT_SECONDS = 30 * 60; // long lessons: notes are written per ~30 min segment
  const SINGLE_CALL_MAX_SECONDS = 40 * 60;
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
    exportBtn: $("exportBtn"), importInput: $("importInput"), libraryEmpty: $("libraryEmpty"),
    editDialog: $("editDialog"), editForm: $("editForm"), editTitle: $("editTitle"),
    editSubject: $("editSubject"), editTopic: $("editTopic"), topicOptions: $("topicOptions"),
    editHeading: $("editHeading"), editContentWrap: $("editContentWrap"), editContent: $("editContent"),
    newNoteBtn: $("newNoteBtn"), newNoteBtn2: $("newNoteBtn2"), ownBadge: $("ownBadge"), tabs: $("tabs"),
    myNotes: $("myNotes"), annotationList: $("annotationList"), annotationForm: $("annotationForm"),
    annotationText: $("annotationText"),
    homeView: $("homeView"), lessonView: $("lessonView"), backBtn: $("backBtn"),
    notesPane: $("notesPane"), toc: $("toc"), sectionTools: $("sectionTools"),
    expandAll: $("expandAll"), collapseAll: $("collapseAll"),
    tabMap: $("tabMap"), mapView: $("mapView"), mapSvg: $("mapSvg"), mapFit: $("mapFit"), mapExpand: $("mapExpand"),
  };

  function saveSettings() {
    if (!store.set("tv.settings", settings)) {
      showError("Nastavení se v tomto prohlížeči nepodařilo uložit (anonymní okno?). Po obnovení stránky se ztratí.");
    }
  }

  // Primary engine: ElevenLabs when its key is set (OpenAI is the automatic fallback), unless "only OpenAI" is chosen
  function activeEngine() {
    if (settings.engine === "openai") return "openai";
    return settings.elevenKey ? "elevenlabs" : "openai";
  }

  const ENGINE_LABEL = {
    elevenlabs: "ElevenLabs Scribe v2",
    openai: "OpenAI gpt-transcribe",
    fallback: "ElevenLabs → záložně OpenAI",
  };
  const subjectLabel = (id) => (SUBJECTS[id] ? `${SUBJECTS[id].icon} ${SUBJECTS[id].label}` : "📄 Ostatní");

  /* ---------- Subject picker ---------- */
  function renderSubjects() {
    el.subjects.innerHTML = "";
    const options = [["auto", "✨ Rozpoznat automaticky"], ...Object.entries(SUBJECTS).map(([id, s]) => [id, `${s.icon} ${s.label}`])];
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
    const notes = settings.notesModel === "auto" ? "nejlepší dostupný GPT" : settings.notesModel;
    const fb = eng === "elevenlabs" ? " (záloha OpenAI)" : "";
    el.engineInfo.textContent = `Přepis: ${ENGINE_LABEL[eng]}${fb} · Zápisky: ${notes}`;
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
    add("auto", auto ? `Automaticky – nejlepší dostupný (${auto})` : "Automaticky – nejlepší dostupný");
    const list = [...ids].sort();
    if (selected && selected !== "auto" && !list.includes(selected)) list.unshift(selected);
    for (const id of list) add(id, id);
    el.notesModel.value = selected || "auto";
  }

  el.settingsBtn.addEventListener("click", () => { fillSettingsForm(); el.settingsDialog.showModal(); });
  el.keyWarning.querySelector("button").addEventListener("click", () => el.settingsBtn.click());

  el.loadModels.addEventListener("click", async () => {
    const key = el.openaiKey.value.trim();
    if (!key) { alert("Nejdřív vlož OpenAI API klíč."); return; }
    el.loadModels.disabled = true;
    el.loadModels.textContent = "Načítám…";
    try {
      const ids = await listOpenAIModels(key, true);
      setNotesModelOptions(ids, el.notesModel.value);
    } catch (e) {
      alert(e.message);
    } finally {
      el.loadModels.disabled = false;
      el.loadModels.textContent = "Načíst moje modely";
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
        lastErr = new Error(`${label}: chyba sítě (${e.message}).`);
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
        continue;
      }
      if (res.ok) return res.json();
      let detail = "";
      try {
        const j = await res.json();
        detail = (j.error && j.error.message) || (j.detail && (j.detail.message || JSON.stringify(j.detail))) || "";
      } catch { /* ignore */ }
      if (res.status === 401) throw new Error(`${name} API klíč je neplatný nebo nemá oprávnění. Zkontroluj ho v Nastavení. ${detail}`);
      if (res.status === 402 || /quota|billing|credits|insufficient/i.test(detail)) {
        throw new Error(`${name}: kredit je vyčerpaný (nebo byl dosažen limit). ${detail}`);
      }
      lastErr = new Error(`${label} selhal (${res.status}): ${detail || res.statusText}`);
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
      }, "Přepis");
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
    if (!res.ok) throw new Error(`Nepodařilo se načíst modely OpenAI (${res.status}). Zkontroluj API klíč.`);
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
    const answer = stripDiacritics((await generateText(model, CLASSIFY_PROMPT, sample.slice(0, 6000), "Rozpoznání předmětu")).toLowerCase());
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

  // Group transcript parts (~10 min each) into ~30 min segments
  function segmentParts(parts) {
    const segs = [];
    for (const p of parts) {
      const last = segs[segs.length - 1];
      if (last && p.end - last.start <= SEGMENT_SECONDS + 120) {
        last.end = p.end; last.text += "\n\n" + p.text;
      } else {
        segs.push({ start: p.start, end: p.end, text: p.text });
      }
    }
    // A short tail (< 12 min) is merged into the previous segment
    const tail = segs[segs.length - 1];
    if (segs.length > 1 && tail.end - tail.start < 12 * 60) {
      const prev = segs[segs.length - 2];
      prev.end = tail.end; prev.text += "\n\n" + tail.text;
      segs.pop();
    }
    return segs;
  }

  // parts: [{start, end, text}] (seconds); onProgress(i, n) is called per segment
  async function writeNotes(parts, subject, model, onProgress) {
    const subj = SUBJECTS[subject];
    const total = parts.length ? parts[parts.length - 1].end : 0;
    let parsed;
    if (parts.length <= 1 || total <= SINGLE_CALL_MAX_SECONDS) {
      onProgress && onProgress(0, 1);
      const raw = await generateText(model, BASE_NOTES_PROMPT(subj, topicsFor(subject)),
        "Přepis hodiny:\n\n" + parts.map((p) => p.text).join("\n\n"), "Psaní zápisků");
      parsed = parseNotes(raw);
    } else {
      const segs = segmentParts(parts);
      const bodies = [];
      for (let i = 0; i < segs.length; i++) {
        onProgress && onProgress(i, segs.length + 1);
        const sg = segs[i];
        bodies.push(await generateText(model,
          SEGMENT_NOTES_PROMPT(subj, i + 1, segs.length, fmtMin(sg.start), fmtMin(sg.end)),
          "Přepis této části:\n\n" + sg.text, `Psaní zápisků (část ${i + 1})`));
      }
      onProgress && onProgress(segs.length, segs.length + 1);
      const sectionNotes = bodies.map((b) => b.replace(/^#\s.*$/m, "").trim()).join("\n\n");
      const raw = await generateText(model, FINAL_PROMPT(subj, topicsFor(subject)),
        "Zápisky z celé hodiny:\n\n" + sectionNotes, "Shrnutí hodiny");
      const fin = parseNotes(raw);
      // Intro (# title + summary) → detailed sections → key points, test questions, answers
      const idx = fin.notes.search(/^##\s/m);
      const intro = idx >= 0 ? fin.notes.slice(0, idx).trim() : fin.notes.trim();
      const tail = idx >= 0 ? fin.notes.slice(idx).trim() : "";
      parsed = { topic: fin.topic, title: fin.title, notes: [intro, sectionNotes, tail].filter(Boolean).join("\n\n") };
    }
    parsed.topic = parsed.topic ? canonicalTopic(subject, parsed.topic) : UNSORTED;
    return parsed;
  }

  // Older lessons have only a transcript string
  const partsOf = (l) => (l.parts && l.parts.length ? l.parts : [{ start: 0, end: 0, text: l.transcript || "" }]);

  /* ---------- Progress UI ---------- */
  const STEP_LABELS = ["Získávám zvuk (v tomto zařízení)", "Přepisuji", "Píšu zápisky"];

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
    const t = Math.round(sec), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    const mm = h ? String(m).padStart(2, "0") : String(m);
    return `${h ? h + ":" : ""}${mm}:${String(s).padStart(2, "0")}`;
  };

  /* ---------- Main pipeline ---------- */
  async function processFile(file) {
    if (busy) return;
    showError("");
    const engine = activeEngine();
    if (!settings.openaiKey) {
      showError("Nejdřív vlož v Nastavení OpenAI API klíč (je potřeba pro zápisky).");
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
        setStep(0, `Získávám zvuk (v tomto zařízení) – ${Math.round(f * 100)} %`, f * 0.25);
      });
      if (!chunks.length) throw new Error("V souboru nebyl nalezen žádný zvuk.");
      const totalSec = chunks.reduce((s, c) => s + c.durationSec, 0);
      const price = PRICE_PER_MIN[engine] * (totalSec / 60);
      const statusBase = `Zvuk ${fmtMin(totalSec)} · částí: ${chunks.length} · ${ENGINE_LABEL[engine]} ≈ $${price.toFixed(2)}`;
      el.status.textContent = statusBase;

      // 2. Transcription (first part decides the subject when on auto)
      const model = await resolveNotesModel();
      const texts = [];
      let usedEngine = engine, fallbackReason = "";
      for (let i = 0; i < chunks.length; i++) {
        setStep(1, `Přepisuji (${ENGINE_LABEL[usedEngine]}) – část ${i + 1} z ${chunks.length}`,
          0.25 + (0.55 * i) / chunks.length);
        let text;
        if (usedEngine === "elevenlabs") {
          try {
            text = await transcribeEleven(chunks[i], subject);
          } catch (err) {
            // ElevenLabs failed (limit, credit, outage…): continue with OpenAI for this and the remaining parts
            console.warn("ElevenLabs failed, falling back to OpenAI:", err);
            usedEngine = "openai";
            fallbackReason = err.message;
            el.status.textContent = `⚠️ ElevenLabs selhal (${err.message.slice(0, 120)}) – pokračuji záložně přes OpenAI. · ${statusBase}`;
            setStep(1, `Přepisuji (záložně OpenAI) – část ${i + 1} z ${chunks.length}`, 0.25 + (0.55 * i) / chunks.length);
          }
        }
        if (text === undefined) text = await transcribeOpenAI(chunks[i], texts[i - 1], subject);
        texts.push(text);
        if (i === 0 && subject === "auto") {
          setStep(1, "Rozpoznávám předmět…", 0.25 + 0.55 / chunks.length);
          subject = (await classifySubject(texts[0], model)) || "biologie";
        }
      }
      setStep(1, `Přepis hotový (${ENGINE_LABEL[fallbackReason ? "fallback" : engine]})`, 0.8);
      el.status.textContent = `${SUBJECTS[subject].label}${settings.subject === "auto" ? " (rozpoznáno)" : ""} · ${statusBase}` +
        (fallbackReason ? " · ⚠️ ElevenLabs selhal, použit záložní OpenAI" : "");
      const transcript = texts.join("\n\n");
      const parts = chunks.map((c, i) => ({ start: c.startSec, end: c.startSec + c.durationSec, text: texts[i] }));
      current = {
        id: Date.now().toString(36),
        title: file.name.replace(/\.[^.]+$/, ""),
        fileName: file.name,
        subject, topic: UNSORTED,
        engine: fallbackReason ? "fallback" : engine,
        date: new Date().toISOString(),
        transcript, parts,
        notes: "",
      };

      // 3. Notes + title + topic folder
      setStep(2, `Píšu zápisky (${model})`, 0.82);
      const out = await writeNotes(parts, subject, model, (i, n) => {
        setStep(2, n > 1 ? `Píšu zápisky (${model}) – krok ${i + 1} z ${n}` : `Píšu zápisky (${model})`, 0.82 + (0.18 * i) / n);
      });
      Object.assign(current, { notes: out.notes, topic: out.topic, notesModel: model });
      if (out.title) current.title = out.title;
      await saveCurrent();
      setStep(3, null, 1);
      el.status.textContent += " · Hotovo ✓";
      openLesson(current);
    } catch (e) {
      console.error(e);
      let msg = e && e.message ? e.message : String(e);
      if (msg === "NO_AUDIO_TRACK") msg = "Toto video nemá zvukovou stopu.";
      if (msg === "DECODE_FAILED") {
        msg = "Tento prohlížeč neumí přečíst tento formát. Zkus Chrome nebo Edge na počítači, nebo video ulož jako MP4.";
      }
      if (/allocation|memory|Array buffer/i.test(msg)) {
        msg = "Soubor je pro tento prohlížeč moc velký. Použij Chrome nebo Edge na počítači, nebo nahraj MP4.";
      }
      showError(msg);
      if (current && current.transcript && !current.notes) {
        await saveCurrent();
        el.status.textContent = "Přepis je uložený. Zápisky můžeš zkusit znovu tlačítkem „Vytvořit zápisky znovu“.";
        openLesson(current);
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

  /* ---------- Views: library (home) ↔ lesson ---------- */
  function showHome(push) {
    el.homeView.hidden = false;
    el.lessonView.hidden = true;
    if (!busy) el.progress.hidden = true; // finished progress card is no longer needed
    renderLibrary();
    if (push) window.history.pushState({ view: "home" }, "");
    window.scrollTo({ top: 0 });
  }

  function openLesson(l, opts = {}) {
    current = l;
    el.homeView.hidden = true;
    el.lessonView.hidden = false;
    activeTab = "notes";
    renderResult();
    if (opts.push !== false) window.history.pushState({ view: "lesson", id: l.id }, "");
    window.scrollTo({ top: 0 });
  }

  el.backBtn.addEventListener("click", () => {
    if (window.history.state && window.history.state.view === "lesson") window.history.back();
    else showHome(false);
  });

  window.addEventListener("popstate", (e) => {
    const st = e.state || {};
    if (st.view === "lesson") {
      const l = lessons.find((x) => x.id === st.id);
      if (l) { openLesson(l, { push: false }); return; }
    }
    showHome(false);
  });

  /* ---------- Lesson rendering ---------- */
  // Split notes Markdown into the intro (before the first "## ") and "## " sections (ignores code fences)
  function splitSections(md) {
    const lines = md.split("\n");
    const intro = [], sections = [];
    let inFence = false, cur = null;
    for (const line of lines) {
      if (/^```/.test(line.trim())) inFence = !inFence;
      const h = !inFence && /^##\s+(.+?)\s*#*$/.exec(line);
      if (h && !/^###/.test(line)) { cur = { title: h[1].trim(), body: [] }; sections.push(cur); continue; }
      (cur ? cur.body : intro).push(line);
    }
    return { intro: intro.join("\n").trim(), sections: sections.map((x) => ({ title: x.title, body: x.body.join("\n").trim() })) };
  }

  const ALWAYS_CLOSED = /^(řešení|reseni)/i;

  function renderNotes() {
    const own = current.kind === "note";
    el.notesView.classList.toggle("own", own);
    el.toc.innerHTML = "";
    if (!current.notes) {
      el.notesView.innerHTML = `<p class="muted">${own ? "Prázdný zápis – napiš ho přes ✎ Upravit." : "Zápisky se ještě připravují…"}</p>`;
      el.sectionTools.hidden = true;
      return;
    }
    const { intro, sections } = splitSections(current.notes);
    el.notesView.innerHTML = "";
    if (intro) {
      const d = document.createElement("div");
      d.className = "notes-intro";
      d.innerHTML = renderMarkdown(intro.replace(/^#\s+.*$/m, "").trim() || intro);
      el.notesView.append(d);
    }
    el.sectionTools.hidden = sections.length < 2;
    sections.forEach((sec, i) => {
      const det = document.createElement("details");
      det.className = "section";
      det.id = `sec-${i}`;
      if (sections.length < 3 && !ALWAYS_CLOSED.test(sec.title)) det.open = true;
      const sum = document.createElement("summary");
      sum.textContent = sec.title;
      const body = document.createElement("div");
      body.className = "section-body";
      body.innerHTML = renderMarkdown(sec.body);
      body.querySelectorAll("h3").forEach((h, j) => { h.id = `sec-${i}-${j}`; });
      det.append(sum, body);
      el.notesView.append(det);
      // Table of contents chip
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = sec.title;
      chip.addEventListener("click", () => openSection(i));
      el.toc.append(chip);
    });
    el.toc.hidden = true; // collapsed sections already work as the table of contents
  }

  function openSection(i, j) {
    setTab("notes");
    const det = document.getElementById(`sec-${i}`);
    if (!det) return;
    det.open = true;
    const target = (j !== undefined && document.getElementById(`sec-${i}-${j}`)) || det;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    det.classList.add("flash");
    setTimeout(() => det.classList.remove("flash"), 1200);
  }

  el.expandAll.addEventListener("click", () => el.notesView.querySelectorAll("details.section").forEach((d) => {
    if (!ALWAYS_CLOSED.test(d.querySelector("summary").textContent)) d.open = true;
  }));
  el.collapseAll.addEventListener("click", () => el.notesView.querySelectorAll("details.section").forEach((d) => { d.open = false; }));

  function renderTranscript() {
    el.transcriptView.innerHTML = "";
    const parts = current.parts && current.parts.length ? current.parts : null;
    if (!parts || parts.length === 1) {
      const pre = document.createElement("div");
      pre.className = "transcript-text";
      pre.textContent = current.transcript || "";
      el.transcriptView.append(pre);
      return;
    }
    parts.forEach((p, i) => {
      const det = document.createElement("details");
      det.className = "section";
      const sum = document.createElement("summary");
      sum.textContent = `Část ${i + 1} · ${fmtMin(p.start)}–${fmtMin(p.end)}`;
      const body = document.createElement("div");
      body.className = "transcript-text section-body";
      body.textContent = p.text;
      det.append(sum, body);
      el.transcriptView.append(det);
    });
  }

  /* ---------- Mind map (built from the note headings, linked to sections) ---------- */
  const SKIP_IN_MAP = /^(testové otázky|testove otazky|řešení|reseni|organizační|organizacni)/i;
  const shorten = (t, n = 60) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

  function buildMindmapData() {
    const { sections } = splitSections(current.notes || "");
    const node = (text, target, children = []) => ({
      content: escapeHtml(shorten(text)), children, payload: { target },
    });
    const boldTerms = (md) => [...new Set([...md.matchAll(/\*\*([^*\n]{2,40})\*\*/g)]
      .map((m) => m[1].replace(/[:：]\s*$/, "").trim())
      .filter((t) => !/^(klíčové|pozor|příklad|moje poznámka)/i.test(t)))].slice(0, 5);
    const children = [];
    sections.forEach((sec, i) => {
      if (SKIP_IN_MAP.test(sec.title)) return;
      let kids;
      if (/^klíčové body/i.test(sec.title)) {
        kids = sec.body.split("\n").filter((l) => /^\s*[-*]\s+/.test(l)).slice(0, 10)
          .map((l) => node(l.replace(/^\s*[-*]\s+/, "").replace(/\*\*/g, ""), { i }));
      } else {
        const subs = [...sec.body.matchAll(/^###\s+(.+)$/gm)];
        kids = subs.length
          ? subs.map((m, j) => {
            const start = m.index, end = j + 1 < subs.length ? subs[j + 1].index : sec.body.length;
            return node(m[1].trim(), { i, j }, boldTerms(sec.body.slice(start, end)).map((t) => node(t, { i, j })));
          })
          : boldTerms(sec.body).map((t) => node(t, { i }));
      }
      children.push(node(sec.title, { i }, kids));
    });
    return node(current.title, null, children);
  }

  let mm = null;

  function renderMindmap() {
    if (typeof markmap === "undefined" || !markmap.Markmap) {
      el.mapView.querySelector(".map-hint").textContent = "Mapu se nepodařilo načíst.";
      return;
    }
    const data = buildMindmapData();
    el.mapSvg.innerHTML = "";
    mm = markmap.Markmap.create(el.mapSvg, { duration: 300, maxWidth: 260, initialExpandLevel: 2, paddingX: 10 }, data);
    setTimeout(() => mm && mm.fit(), 350);
  }

  // Clicking a node's text opens the matching section in the notes
  el.mapSvg.addEventListener("click", (e) => {
    const fo = e.target.closest && e.target.closest("foreignObject");
    if (!fo) return;
    const g = fo.closest("g.markmap-node");
    const d = g && window.d3 && d3.select(g).datum();
    const target = d && (d.payload || (d.data && d.data.payload) || {}).target;
    if (target) { e.stopPropagation(); openSection(target.i, target.j); }
  }, true);

  el.mapFit.addEventListener("click", () => mm && mm.fit());
  el.mapExpand.addEventListener("click", () => {
    if (!mm) return;
    const walk = (n) => { n.payload = Object.assign({}, n.payload, { fold: 0 }); (n.children || []).forEach(walk); };
    walk(mm.state.data);
    mm.renderData().then(() => mm.fit());
  });

  function renderResult() {
    if (!current) return;
    el.resultTitle.textContent = current.title;
    el.resultPath.textContent = `${subjectLabel(current.subject)} › 📁 ${current.topic || UNSORTED}`;
    const own = current.kind === "note";
    el.resultMeta.textContent = own
      ? new Date(current.date).toLocaleDateString("cs-CZ") +
        (current.updated ? ` · upraveno ${new Date(current.updated).toLocaleDateString("cs-CZ")}` : "")
      : [new Date(current.date).toLocaleDateString("cs-CZ"),
        current.parts && current.parts.length ? `délka ${fmtMin(current.parts[current.parts.length - 1].end)}` : "",
        current.engine ? ENGINE_LABEL[current.engine] : "",
        current.notesModel || ""].filter(Boolean).join(" · ");
    el.ownBadge.hidden = !own;
    el.tabTranscript.hidden = own;
    el.regenBtn.hidden = own;
    el.regenBtn.disabled = !current.transcript;
    renderNotes();
    renderTranscript();
    renderAnnotations();
    setTab(own && activeTab === "transcript" ? "notes" : activeTab);
  }

  /* ---------- Personal notes attached to a lesson ---------- */
  const fmtDateTime = (iso) => new Date(iso).toLocaleString("cs-CZ", { dateStyle: "short", timeStyle: "short" });

  function renderAnnotations() {
    const list = current.annotations || [];
    el.myNotes.hidden = current.kind === "note";
    el.annotationList.innerHTML = "";
    for (const a of list) {
      const box = document.createElement("div");
      box.className = "annotation";
      const head = document.createElement("div");
      head.className = "annotation-head";
      head.innerHTML = `<span>✍️ Moje poznámka · ${fmtDateTime(a.date)}${a.updated ? " (upraveno)" : ""}</span>`;
      const edit = document.createElement("button");
      edit.className = "icon"; edit.type = "button"; edit.title = "Upravit poznámku"; edit.textContent = "✎";
      const del = document.createElement("button");
      del.className = "icon"; del.type = "button"; del.title = "Smazat poznámku"; del.textContent = "✕";
      head.append(edit, del);
      const body = document.createElement("div");
      body.className = "annotation-body";
      body.innerHTML = renderMarkdown(a.text);
      edit.addEventListener("click", () => {
        const ta = document.createElement("textarea");
        ta.rows = Math.max(3, a.text.split("\n").length + 1);
        ta.value = a.text;
        const save = document.createElement("button");
        save.type = "button"; save.textContent = "Uložit";
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
        if (!confirm("Smazat tuto poznámku?")) return;
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
    el.tabMap.setAttribute("aria-selected", String(tab === "map"));
    el.tabTranscript.setAttribute("aria-selected", String(tab === "transcript"));
    el.notesPane.hidden = tab !== "notes";
    el.mapView.hidden = tab !== "map";
    el.transcriptView.hidden = tab !== "transcript";
    el.copyBtn.hidden = tab === "map";
    el.downloadBtn.hidden = tab === "map";
    el.copyBtn.textContent = tab === "transcript" ? "Kopírovat přepis" : "Kopírovat zápisky";
    if (tab === "map") renderMindmap();
  }

  el.tabNotes.addEventListener("click", () => setTab("notes"));
  el.tabMap.addEventListener("click", () => setTab("map"));
  el.tabTranscript.addEventListener("click", () => setTab("transcript"));

  const currentText = () => (activeTab === "transcript" ? current.transcript : notesWithAnnotations(current));

  el.copyBtn.addEventListener("click", async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(currentText());
      flash(el.copyBtn, "Zkopírováno ✓");
    } catch {
      showError("Kopírování selhalo – označ text a zkopíruj ho ručně.");
    }
  });

  el.downloadBtn.addEventListener("click", () => {
    if (!current) return;
    const isNotes = activeTab !== "transcript";
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
    el.regenBtn.textContent = "Píšu…";
    try {
      const model = await resolveNotesModel();
      const subject = SUBJECTS[current.subject] ? current.subject
        : (await classifySubject(current.transcript, model)) || "biologie";
      const out = await writeNotes(partsOf(current), subject, model, (i, n) => {
        el.regenBtn.textContent = n > 1 ? `Píšu… (${i + 1}/${n})` : "Píšu…";
      });
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
      el.regenBtn.textContent = "Vytvořit zápisky znovu";
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
    el.editHeading.textContent = isNew ? "✍️ Nový zápis" : target.kind === "note" ? "✍️ Upravit můj zápis" : "Upravit hodinu";
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
    const isNew = editMode === "new";
    await saveCurrent();
    if (isNew || el.lessonView.hidden) openLesson(current);
    else renderResult();
  });

  /* ---------- Library ---------- */
  async function saveCurrent() {
    try {
      await LessonDB.put(current);
    } catch (e) {
      showError("Hodinu se v tomto prohlížeči nepodařilo uložit: " + e.message);
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
    el.libraryEmpty.hidden = lessons.length > 0;
    el.librarySearch.hidden = lessons.length < 4;
    el.library.innerHTML = "";
    if (!lessons.length) return;
    const q = el.librarySearch.value.trim();
    const visible = lessons.filter((l) => matches(l, q));
    if (!visible.length) {
      el.library.innerHTML = '<p class="muted small">Nic nenalezeno.</p>';
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
    open.addEventListener("click", () => openLesson(l));
    const date = document.createElement("span");
    date.className = "muted small";
    date.textContent = new Date(l.date).toLocaleDateString("cs-CZ");
    const del = document.createElement("button");
    del.className = "icon";
    del.title = "Smazat";
    del.textContent = "✕";
    del.addEventListener("click", async () => {
      if (!confirm(`Smazat „${l.title}“? Tohle nejde vrátit zpět.`)) return;
      await LessonDB.remove(l.id);
      lessons = lessons.filter((x) => x.id !== l.id);
      if (current && current.id === l.id) current = null;
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
      alert(`Obnoveno ze zálohy: ${incoming.length}.`);
    } catch (e) {
      showError("Obnovení ze zálohy selhalo: " + e.message);
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
    if (!el.openaiKey.value.trim()) { alert("Nejdřív vlož OpenAI API klíč."); return; }
    try {
      await navigator.clipboard.writeText(buildSetupLink());
      flash(el.copySetupLink, "Odkaz zkopírován ✓");
    } catch {
      prompt("Zkopíruj tento instalační odkaz:", buildSetupLink());
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
    window.history.replaceState({ view: "home" }, "");
  }).catch((e) => showError("Nepodařilo se načíst uložené hodiny: " + e.message));
})();
