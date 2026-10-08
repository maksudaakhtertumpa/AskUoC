# Data map

What personal or potentially personal data exists, where it goes, why, and for how long. The public
[Privacy Policy](../frontend/src/app/privacy/page.tsx) is written from this document - keep them in sync when the code changes.

| Data | Where it lives | Why | Retention | Who can see it |
|---|---|---|---|---|
| **Chat questions & answers** (text) | API -> `chat_logs` table (question, answer, outcome, source URLs, latency, cache flag, thread id). **No IP address, no user agent.** | Answer quality review, unanswered-question analysis, abuse investigation | Deleted automatically after `LOG_RETENTION_DAYS` (default 90) | Staff/admins (admin console) |
| **Chat history in your browser** | Browser `localStorage` (`askuoc_history_v1`) | Show your past conversations | Until you delete it or clear browser data | Only you (on that device) |
| **Signed-in chat sync** | `user_conversations` (only for signed-in users) | Same history on your other devices | Until you delete a chat / your account | Only you (staff cannot read it in the UI) |
| **Account** | `accounts`: username, display name, avatar, role, password hash (scrypt), timestamps | Sign-in, role-based access | Until you delete the account | Admins see username/role/created date only |
| **Session token** | Browser `localStorage` (`askuoc_session_v1` (token + public profile fields)) | Keep you signed in (30 days for members, 12 h for staff and admins) | Expires; removed on sign-out | You |
| **Feedback** (thumbs up/down) | `feedback` (rating + chat log id) | Measure answer quality | With the chat log | Staff/admins |
| **Shared conversations** | `shared_chats` (title + messages + source links; no attachments) | The public link you chose to create | 90 days, or until you delete the link | Anyone with the link |
| **Attachments** (images / PDF pages) | Rendered/resized **in your browser**, sent once to the API, transcribed by the AI provider, then discarded. Only the resulting text is used for that answer | Let you ask about a document/photo | Not stored by the API | The AI provider processes them |
| **Read-aloud text** | Sent to Microsoft's text-to-speech service via the API; audio cached (Redis/memory) by text hash | Read answers aloud | Cache TTL 7 days | - |
| **Voice dictation** | Handled by **your browser's** speech-recognition service (e.g. Google for Chrome). The app only receives the text | Dictate a question | Not stored by the app | Your browser vendor |
| **IP address** | Used transiently as a rate-limit key (Redis/memory, ~1 minute). Hosting providers (Vercel / Hugging Face / Supabase) keep their own access logs | Abuse prevention | Rate-limit keys expire in ~1 min | Hosting providers |
| **Cache entries** | Redis/memory: answers, query embeddings, retrieval results, audio - keyed by hashed question text; never tied to a user | Speed, cost, quota | TTL 1 h - 7 days | Operator |
| **Admin audit log** | `audit_log`: who changed settings / uploaded / deleted / restored (no secret values) | Accountability | 1 year | Admins |
| **Knowledge base** | `documents` / `chunks`: text from the University's public website and staff uploads (embeddings) | Answer questions | Until replaced or deleted; snapshots kept per admin | Staff/admins |

## Third parties that receive data

| Provider | What they receive | When |
|---|---|---|
| **Google (Gemini API)** | Your question, retrieved passages, prior turns, and (if attached) images/PDF pages | When the language model / embeddings provider is set to Gemini. Free-tier terms may allow Google to use submitted content to improve its products - use a paid key if that matters |
| **Any OpenAI-compatible provider** | Same as above | When the operator configures one (OpenAI, Groq, OpenRouter, a self-hosted Ollama, ...) |
| **Microsoft (Edge text-to-speech)** | The text of the answer you ask to be read aloud | When you press "Read aloud" |
| **Supabase** | All database content above | Hosting the database |
| **Redis provider (e.g. Upstash / Redis Cloud)** | Cache entries and rate-limit counters | If Redis caching is enabled |
| **Vercel / Hugging Face** | Standard request logs (IP, user agent, URL) | Hosting the web app / API |
| **Your browser vendor** | Voice audio for dictation | If you use the microphone button |

## Rights and controls built in

* **Delete**: delete individual chats, all chats, shared links, and your whole account (Profile page).
* **Export**: "Download my data" on the Profile page (account + synced conversations as JSON).
* **Retention**: chat logs are purged automatically (configurable).
* **No tracking**: no advertising or analytics cookies, no third-party trackers, no fingerprinting.
