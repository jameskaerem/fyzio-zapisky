# Lesson Notes

A small static web app that turns a recorded Czech chemistry lesson into a transcript and structured study notes.

## How it works

1. **Upload a video**: drag and drop, or pick a file. The video never leaves the device.
2. **Local audio extraction**: the browser pulls out the audio track and converts it to 16 kHz mono WAV in parts of about 10 minutes (about 19 MB each, under OpenAI's 25 MB limit). Each cut is placed at the quietest moment near the boundary.
   - MP4/MOV/M4A files use a streaming path: mp4box.js and WebCodecs read only the audio samples, so multi-GB videos work.
   - Other formats (WebM, MP3, …) use `decodeAudioData` and are loaded into memory whole.
3. **Transcription**: OpenAI `gpt-4o-transcribe` (configurable). It is called with `language=cs` and a Czech chemistry vocabulary prompt, plus the end of the previous part so the text stays continuous across parts.
4. **Study notes**: `gpt-4o-mini` (configurable) rewrites the transcript as Markdown with headings, callouts (💡 key, ⚠️ warning, 🧪 example), formulas with proper subscripts, step-by-step calculations, key points and review questions.
5. **Result**: shown on the page, with copy (it pastes cleanly into Notion) and download buttons. Recent lessons are kept in the browser's local storage.

## Setup

- No build step and no backend. The app is plain HTML/CSS/JS, and its libraries are vendored in `vendor/` (mp4box.js 0.5.2, marked 12.0.2, DOMPurify 3.1.6).
- Open the page, go to **Settings**, and paste an OpenAI API key. The key is stored only in that browser's `localStorage` and is sent only to `api.openai.com`.
- Use a dedicated OpenAI project key with a monthly hard limit.
- Recommended browser: Chrome or Edge on desktop. Large non-MP4 files can run out of memory, especially on phones.

Approximate cost: about $0.36 per hour of audio with `gpt-4o-transcribe`, plus a fraction of a cent for the notes.

## Deployment

Serve the repository root as a static site. Any static host works, for example Netlify, Vercel or Cloudflare Pages connected to this repo (free, and private repos are supported), or GitHub Pages.

For local use, run `python -m http.server` in the repo folder and open `http://localhost:8000`.
