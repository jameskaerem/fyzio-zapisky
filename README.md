# Lesson Notes

A small static web app (UI in Czech) that turns recorded Czech lessons into a transcript and structured study notes. It is tuned for university physiotherapy admission prep in four subjects: chemistry, physics, biology and somatology (human anatomy and physiology).

## How it works

1. **Upload a video**: drag and drop, or pick a file. The video never leaves the device.
2. **Local audio extraction**: the browser pulls out the audio track and converts it to 16 kHz mono WAV in parts of about 10 minutes (about 19 MB each, under OpenAI's 25 MB limit). Each cut is placed at the quietest moment near the boundary.
   - MP4/MOV/M4A files use a streaming path: mp4box.js and WebCodecs read only the audio samples, so multi-GB videos work.
   - Other formats (WebM, MP3, …) use `decodeAudioData` and are loaded into memory whole.
3. **Transcription**, with one of two engines:
   - **ElevenLabs Scribe v2** (`scribe_v2`): used automatically when an ElevenLabs key is set. It currently leads public STT accuracy leaderboards. Requests send `language_code=cs` and the subject's terms as `keyterms`.
   - **OpenAI `gpt-transcribe`**: requests send `language=cs`, the subject context as `prompt`, the terms as `keywords`, and the end of the previous part so the text stays continuous.
   - If either API rejects the term field, the request is retried without it.
   - **Automatic fallback**: if ElevenLabs fails for any part (credit or limit exhausted, invalid key, outage), that part and the remaining parts are transcribed with OpenAI. The status and the lesson metadata show that the fallback was used.
4. **Study notes**: written by an OpenAI model. *Auto* picks the strongest general GPT model the key can access via `/v1/models`, skipping mini, nano and luna tiers and the expensive pro and astra tiers. A specific model can also be chosen in Settings. Requests use Chat Completions and fall back to the Responses API if needed. The notes follow subject-specific rules from `subjects.js`: formulas and equations in chemistry, quantities with units in physics, comparison tables and genetics crosses in biology, and Czech + Latin anatomical names in somatology. Every set of notes ends with key points and 5 admission-test-style multiple-choice questions with answers.
5. **Auto-detect subject** (default): the first audio part is transcribed with a mixed term list (25 terms from each subject). A short GPT call then classifies the subject, and the remaining parts use that subject's terms. A subject can also be picked manually.
6. **Title and folder**: the notes model also returns a lesson title (`<Main topic> – <specific content>`) and a topic folder. It is given the subject's existing folders so names stay consistent, and near-duplicate folder names are merged automatically.
7. **Library**: lessons are stored in IndexedDB and shown as Subject → Topic folder → Lessons, with search, edit (rename or move to another subject/folder), delete, and JSON export/import for backups. Notes can be copied (they paste cleanly into Notion) or downloaded.
8. **Own notes**: separate from the AI output and visually distinct (pink, ✍️):
   - **My notes on a lesson**: personal notes added under the AI notes, each with a timestamp, editable and deletable. They are included, clearly marked, when the notes are copied or downloaded.
   - **Own note**: a standalone note written from scratch (Markdown), filed into a subject and topic folder like any lesson.
   - In the library, ✍️ marks an own note and 📝 marks a lesson with personal notes. Search covers both.

## Setup

- No build step and no backend. The app is plain HTML/CSS/JS, and its libraries are vendored in `vendor/` (mp4box.js 0.5.2, marked 12.0.2, DOMPurify 3.1.6).
- Open the page, go to **Settings**, and paste an OpenAI API key (required) and, optionally, an ElevenLabs API key. The keys are stored only in that browser's `localStorage` and are sent only to the respective APIs.
- **Setup link:** Settings → *Copy setup link* creates `https://…/#openai=…&eleven=…`. Opening it saves the keys in that browser and removes them from the address bar. The URL fragment is never sent to the web server and the keys are never stored in the repository. Share the link only privately.
- Subject presets (context, up to 100 key terms each, and notes rules) live in `subjects.js`.
- Use a dedicated OpenAI project key with a monthly hard limit.
- Recommended browser: Chrome or Edge on desktop. Large non-MP4 files can run out of memory, especially on phones.

Approximate cost per hour of audio: ElevenLabs Scribe v2 about $0.22, plus $0.05 for keyterm prompting; OpenAI `gpt-transcribe` about $0.27. Notes cost a few cents per lesson, depending on the model.

## Deployment

Serve the repository root as a static site. Any static host works, for example Netlify, Vercel or Cloudflare Pages connected to this repo (free, and private repos are supported), or GitHub Pages.

For local use, run `python -m http.server` in the repo folder and open `http://localhost:8000`.
