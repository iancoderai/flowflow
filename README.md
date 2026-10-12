# SpokFlow

Speak freely. SpokFlow turns your voice into ideas, information and practical
checklists. Speech stays on the phone. New recordings require internet access to
verify the 3-day free trial or a store purchase; existing notes remain available
offline.

## Requirements

Node.js **22.13 or newer**, as required by [Expo SDK 57](https://docs.expo.dev/versions/latest/).

JDK **17 or 21**, compatible with the generated Gradle/Android toolchain. Prebuild pins Gradle to
`C:/Program Files/Eclipse Adoptium/jdk-17.0.20.101-hotspot` when it exists; on
another machine set `SPOKFLOW_JDK` to your JDK 17/21 folder (a wrong path fails
the prebuild).

Android libraries inherit the project's NDK version, including SQLCipher's
SQLite module.

## Build and install (Android)

```bash
npm ci                         # exact versions and hashes from package-lock.json
npm run fetch-model            # verifies Whisper (264 MB), Silero VAD (0.89 MB), summary (1.67 GB)
adb devices -l                 # serial of a connected phone, USB debugging on
npm run android -- --device
```

`npm run android` checks the release configuration and the model, prebuilds,
assembles the **release** APK signed with your upload key, verifies it, then
installs it. The APK carries the Hermes bundle and the model, so the installed
app never talks to this computer again — no Metro, no Wi-Fi. It needs the real
store keys and legal details (Release configuration) and your upload key
(Release signing); for a quick test on your own phone see Local test builds.

Do not run `npx expo run:android --device` directly: it installs a *debug*
build under the same application ID (`com.spokflow.app`) and replaces your
standalone install with one that needs Metro on the PC.

Other entry points:

| Command | Does |
| --- | --- |
| `npm run apk` | Rebuild the release APK without a device |
| `npm run install-apk` | Verify + install the existing APK (no Gradle) |
| `npm run verify-apk` | Check the expected signing fingerprint, manifest, permissions/exports, backup rules, shipped config, bytecode, native libraries and model hash |
| `npm run open:android` | Launch the installed app over ADB |
| `npm run android:dev` + `npm start` | Metro dev loop — tethered to this laptop |
| `npm run ios` / `npm run ios:dev` | Release / dev build on macOS |

Keep the same Android signing key and install over the current app to
preserve local notes. Never uninstall or clear app storage — that deletes them.
Android refuses an update signed with a different key: a phone holding a
debug-signed build (every build made before release signing existed) cannot
take an upload-signed one without uninstalling, which deletes its notes. Keep
using test builds on that phone, or export an encrypted backup before reinstalling.

### Release configuration

`app.json` → `expo.extra` holds the RevenueCat **public** SDK keys
(`revenueCat.ios` starts with `appl_`, `revenueCat.android` with `goog_`) and
the publisher details the legal texts show (`legal.controller`, `legal.email`,
`legal.address`). `npm run apk`, `npm run ios` and EAS builds first run
`scripts/check-release-config.cjs`, which refuses to build while a required value
is missing or blank, a `REPLACE_` placeholder is left, an SDK key or contact email
has an invalid format, or any value is a RevenueCat
**secret** key (`sk_…`; if one was ever committed, revoke it in the dashboard).
`npm run verify-apk` repeats these checks on the config
packaged inside the APK.

### Release signing

Release builds are signed with your upload key and stop without it; they never
fall back to the public debug key. Create the key once, then back it up with its
passwords outside the repository — losing it means no more updates:

```bash
keytool -genkeypair -v -keystore spokflow-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

Add to `~/.gradle/gradle.properties` (forward slashes), or set as environment
variables:

```properties
SPOKFLOW_UPLOAD_STORE_FILE=C:/Users/you/keys/spokflow-upload.jks
SPOKFLOW_UPLOAD_STORE_PASSWORD=...
SPOKFLOW_UPLOAD_KEY_ALIAS=upload
SPOKFLOW_UPLOAD_KEY_PASSWORD=...
```

On Google Play, enrol in Play App Signing so Google holds the app signing key
and this key only uploads. Set `SPOKFLOW_SIGNING_SHA256` to the independently verified
SHA-256 fingerprint of the release/upload certificate. For an existing published app,
use its existing key; do not generate a replacement through the example above.

### Local test builds

`SPOKFLOW_TEST_BUILD=1` lets a local build keep the placeholders and sign with
the debug key, for your own phone only. Every check prints
`TEST BUILD ONLY - do not distribute`: anyone could re-sign such an APK, and it
sells nothing (no store keys). EAS builds refuse test signing.

```powershell
$env:SPOKFLOW_TEST_BUILD = "1"; npm run android -- --device
Remove-Item Env:SPOKFLOW_TEST_BUILD
```

### Building elsewhere

`eas.json` has a standalone `preview` APK profile:

```bash
npx eas-cli build --platform android --profile preview
```

EAS checks the release configuration, then downloads and verifies the model at
build time. It signs with the credentials it manages (`npx eas-cli credentials`):
give it your existing upload key rather than a new one, or Android rejects the
update. EAS Android uses the required `verifySpokflowRelease` Gradle task, which
builds and verifies artifacts before EAS can upload the application archive. Production builds
produce an AAB and a companion APK from the same release variant for verification.
The expected certificate fingerprint must also be configured in EAS.
The AAB signature check trusts only that pinned public certificate and uses
strict JDK verification to reject unsigned additions to an otherwise signed archive.

## How it works

- **Capture** — `@fugood/react-native-audio-pcm-stream`, 16 kHz mono PCM, kept
  in memory: no audio file is written.
- **Transcription** — `whisper.rn` runs multilingual Whisper Small Q8_0 from the
  [whisper.cpp model repo](https://huggingface.co/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1),
  pinned to that commit and embedded as a native APK asset. The download uses
  HTTPS to Hugging Face hosts only, redirects included. Size and SHA-256 are
  verified at download and prebuild; a truncated or substituted model fails the
  build.
- **Language** — French and English share one model. Detection selects the
  language automatically for each batch, including when the speaker switches.
  Unusable results are retried in the other supported language; a language
  already returned by detection is not decoded again for the same batch.
  Failed recognition is not saved as a note. No translation.
- **Accuracy** — every pass uses the model's full audio context and the original
  PCM, including quiet words and pauses. Shortened context and amplitude-based
  silence removal are disabled; short notes can take longer to process.
  Pause batches wait for at least 12 seconds of speech context, reducing short
  passes. Vocabulary hints and up to 250 trailing characters from this note
  guide the fast decoder. Saved transcripts share guarded clock-time formatting;
  word substitutions, negations and missing list items require recognition from
  audio and are not guessed by text cleanup.
- **Speech boundaries** — the existing native engine runs
  [Silero VAD](https://huggingface.co/ggml-org/whisper-vad/tree/9ffd54a1e1ee413ddf265af9913beaf518d1639b)
  on the final two seconds for pause checks, six for full-window cuts, at most
  once per captured second after 12 seconds.
  Its pinned 885,098-byte model uses one CPU thread and is bundled and verified
  like Whisper. Loudness drives only the meter. Cuts use detected speech gaps;
  continuous speech uses complete-word timestamps, leaving the final second
  queued for the next pass. Neither VAD nor word timestamps guarantee perfect
  boundaries, and VAD never removes quiet audio. Both contexts are released
  before the summary model loads.
- **Silence and pacing** — every pass, including stop and backlog, stays at or
  below 30 seconds. `noSpeechThold: 0.95` makes native silence skipping more
  conservative; an empty pass retries identical PCM once at `1` to disable
  that skip. Existing decoder reliability checks still apply. Detected English
  uses 500 ms item / 650 ms flush gaps; French and initially unknown language
  use 700 / 850 ms. These are initial defaults requiring calibration on real
  recordings, including quiet voices and background noise. Pauses alone cannot
  establish the speaker's intended list structure.
- **Personal vocabulary** — Settings accepts up to 192 characters of names,
  acronyms and terms in English or French, held in the device's secure storage.
  These hints fit inside the existing decoder context budget and improve
  recognition without adding a dictionary or text model. They are hints, not
  guaranteed corrections; the guarded spelling rules remain conservative.
  Vocabulary is device-specific and is not included in note backups.
- **Scheduling** — the model loads on the first non-silent batch, not at start-up.
  Audio uses windows of at most 30 seconds, with the remainder finished on stop. Only the
  next window is assembled; queued buffers stay in place until consumed.
  Digital silence skips inference, including a zero-only tail inside the last
  capture buffer. The context is released when the app backgrounds;
  failed transcription or checkpoint writes stop capture. Microphone events target
  100 ms buffers. Recordings are capped at 10 minutes and queued audio at 90 seconds.
- **Idea summaries** — `src/lib/summaryEngine.ts` runs the multilingual
  [Qwen3 4B Instruct 2507, IQ3_XXS](https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF) through `llama.rn`, on this phone only. Its model
  file is pinned by revision, byte count and SHA-256, bundled alongside Whisper,
  and verified in release artifacts. Android copies it to private cache once
  (about 1.67 GB of additional disk space); iOS uses the bundled resource.
  Whisper is released before text inference, and text contexts are released
  after each summary or cancellation. Pitches such as Second Chance Food stay
  ideas through their hypothetical examples and launch plans. English is the
  default summary language; Settings also offers French. Older mixed-language
  preferences now use English, so every summary has one consistent language.
  Short bold headings,
  bullets, bold numeric figures and numbered sequences appear in the note.
  The internal prompt follows source order, preserves terms, names, figures,
  examples and every idea, removes filler and forbids outside facts or advice.
  Each related passage is summarized on its own: the model combines its statements
  into complete ideas instead of translating each sentence into a row. Separating
  topics prevents a quantity in one example from being attached to another idea.
  The model chooses a short category heading for the passage, and only explicit
  sequences receive numbers.
  Source token counts are reused, and completion
  receives the exact chat template, grammar and parser already used for its
  context-capacity check. In one local completion per passage, the model first
  quotes and interprets every source clause and list member in order, then builds
  the summary from those grounded meanings. Review input contains the original
  source and its fragments. Quotes are fixed by the schema; each meaning is
  checked against its own fragment's
  figures and units; the summary is also checked for concise formatting, order
  and language. An invalid reconstruction is retried at most twice with all detected
  issues and its untrusted draft, retaining source-supported details during
  repair. Once source meanings pass validation, bullet repairs reuse them instead
  of retranslating the passage. A failed source meaning is corrected on its own,
  without replacing other meanings or bullets. The original source remains the factual authority;
  reported corrections compare the actual generated and final text, including
  removed filler.
  A JSON schema provides one heading per passage and permits synthesis across
  source entries without imposing one output row per sentence.
  Deterministic checks reject
  changed or missing recognized project names, figures, common spoken quantities
  and units, changed discount meanings, lost numeric approximations, negations
  and explicit once/when conditions, proximity, intentions, obvious
  wrong-language output and incomplete JSON. Summary vocabulary must come from
  the source, its translated meanings or structural labels; short list members
  must be retained. This conservative check can reject a valid synonym and
  request the original wording. Long sources use token-sized batches with context-capacity
  checks. If a passage exceeds capacity or generation or verification fails, all source text is retained
  and the note labels it as a transcription. Regenerate summary
  rebuilds older notes using the saved transcript, without overwriting concurrent
  edits. These checks do not prove semantic accuracy; review important details.
  Local model latency and memory use still require device measurements.
  Keep transcription stops a long summary without losing the saved source.
- **Extraction** — `src/lib/checklistEngine.ts` splits dictation into tasks,
  ideas and information entries offline, and titles the note from its contents.
  An announced idea stays an idea through its action sentences; an explicit
  list heading switches back to tasks. The extractive idea fallback keeps all
  sentences instead of stopping at four. Generated titles are capped
  at eight words / 60 characters. Task destinations retain their verbs.
  English/French task extraction shares one model-independent pass: acknowledgments
  and unfinished fragments stay off checkboxes, related instructions share topic
  headings, and supported corrections replace times, retract cancelled tasks,
  remove list items, and retain conditions, deadlines and safety constraints.
  Independent actions keep separate checkboxes; interrupted sentences are joined.
  Prohibitions and no-op branches never become rows; available alternatives and
  conditional exceptions become positive tasks. Completed items are removed,
  groceries retain their quantities without verbs, and deferred work keeps its date.
  Shared timing and priorities appear once in the topic heading. Numbered or
  Markdown sections keep their dictated order. Supported relative dates and
  clock times order inferred topic sections. Evidence precedes conditional issue
  creation. A spoken "wait" keeps the candidate available for a following
  correction before saving.
  The full tomorrow-plan fixture checks all 49 actions and three dependency notes,
  including verified push before branch creation, both onboarding themes, all
  three meeting questions, and both approval outcomes. Run
  `npm run check-checklist -- --show-plan` to inspect its generated list.
  Headings are stored in the existing checklist JSON; older notes remain compatible.
  This remains deterministic cleanup: unclear names, numbers or misheard words
  are kept in the transcript rather than guessed. It does not guarantee semantic
  accuracy for arbitrary speech. Run `npm run check-checklist` for bilingual
  correction/grouping checks; native speech accuracy still needs device recordings.
- **Storage** — an encrypted SQLCipher database (`spokflow.db`) whose random
  256-bit key stays in the Android Keystore / iOS Keychain, on this device only.
  Deletion uses `secure_delete` and a WAL checkpoint; flash storage cannot guarantee
  physical erasure. Notes are
  excluded from cloud backup and phone-to-phone transfer, and iOS keeps them
  unreadable while the phone is locked. A plaintext `dotnote.db` from an older
  version is copied, checkpointed, cleared and deleted; migration failures and
  conflicting records are surfaced. Missing keys preserve existing database files.
  Settings offers passphrase-encrypted backup/export and restore for up to
  10,000 notes and 100 MB. Export validates restore compatibility; oversized or
  damaged legacy records are kept but need separate recovery. Export before
  reinstalling.

### Native patches

Both run on `postinstall` and before Android builds; both are idempotent and
fail if an upstream change makes a patch unsafe. Each was reviewed against one
version (`@fugood/react-native-audio-pcm-stream` 1.1.4, `whisper.rn` 0.7.2) and
stops on any other: review the patch again before upgrading. A JS-only reload
cannot apply them — rebuild natively.

- `scripts/fix-audio-capture.cjs` — awaits native start-up, propagates capture
  errors, removes listeners, keeps Android's first buffers, flushes iOS input
  before stopping, and passes decoded PCM buffers without a second copy.
- `scripts/fix-whisper-decoder.cjs` — bilingual detection and failed-decoder
  guards; reuses the first window's encoder result from language detection when
  offset and context are unchanged. CPU workers are reused across decoding
  graphs, sleep between graphs instead of polling, and are freed with the model.
  Android loads a matching dot-product / i8mm CPU variant when supported.
  Recovery is capped at two temperatures with one candidate each (previously
  six temperatures and two candidates), and the final attempt must pass the
  log-probability guard. An initial acronym vocabulary includes ATM; a nonzero
  text-context budget enables it. Model weights and full audio context stay intact.
  The silence check computes only the probability it reads, using the unchanged
  log-softmax. Native jobs move their audio through the worker queue instead of
  copying it at each handoff.
  Mel filters cache their nonzero group bounds once at model load. Audio
  preprocessing skips zero-only groups while keeping the original groups of
  four, accumulation order and remainder. Audio samples and filters stay intact.

Completed live batches are persisted as encrypted checkpoint notes. Finalization
reuses the checkpoint ID. Force termination can still lose audio that has not been
decoded; raw audio is never persisted. No on-device speedup has been measured.

## Security

- **Screens** — notes stay hidden until native capture and app-switcher
  protection initializes. Failed setup offers retry; verify behavior on devices.
- **Links** — every `spokflow://` link or outside intent opens the home screen
  only. Notes, the paywall and settings cannot be opened from outside.
- **Purchases** — each new recording requires a newly signed server response,
  newer than the SDK baseline and persisted last authorization. Cache dates in
  the future are rejected; an advancing clock enforces expiry during recording.
- **Trial** — 3 days, no card, from RevenueCat's signed `firstSeen` date, so
  the device clock can't extend it. A reinstall gets a new anonymous ID and a
  new trial. Store introductory offers still show on the paywall.

These checks run on the phone. A rooted phone or a repackaged app can still get
around them. Server-side authorization protects server operations, but attestation
cannot make an offline executable unpatchable. This app has no paid server operation.

## Development

```bash
npm run typecheck
npm run lint
npm run check-checklist
npm run check-summary
npm run check-whisper-filters
```

The Whisper filter check needs an installed Android NDK (or
`WHISPER_TEST_CLANG` and `WHISPER_TEST_LLD` pointing to LLVM tools with WASM
support) and the pinned speech model. It compiles the installed C++ filter
algorithm and compares 28,000 results bit for bit against the original dense
calculation, including empty filters, gaps, quiet input, remainder bins and the
actual model coefficients. `npm run check-whisper-filters -- --benchmark`
measures only that calculation on desktop WebAssembly: a local run took
34.3 ms before and 2.5 ms after for 3,000 frames (13.7×). This excludes FFT,
encoder/decoder inference, summary generation and phone battery use. It does
not establish an overall 5× speedup or perfect recognition.

Summary checks mock native inference to verify passage synthesis, classification,
source coverage, quantity/unit checks, missing-detail repair, rejection,
cancellation and storage. The fixture includes the full Second Chance Food
  example and a separate English interpretation fixture, including its opening
  details and every required team role. Mocked
checks exercise the pipeline; they do not measure the model's semantic accuracy.
Summary parsing caches live only during extraction and are cleared afterwards.
To compare summary content and desktop timings against a copy made before editing:

```bash
npm run check-checklist -- --compare /path/to/original/checklistEngine.ts --benchmark
```

All comparison fixtures must retain identical titles and item content (random
item IDs are excluded). The benchmark uses short plans and generated long English,
French and quoted notes; these timings do not represent native inference.

Postinstall also adapts `query-string` 7.1.3 to the fixed `decode-uri-component`
0.5.0 default export, and anchors Expo CLI 57.0.27's prebuild rename to the root
`app.json`, preventing a recursive scan and modification of dependency copies.
Both adapters stop on an unreviewed upstream version.
Before release, install the rebuilt APK
on the target phone and dictate short French/English phrases (including "go to
the cash machine" and "aller à l'ATM"), plus a longer note with pauses.
Compare time from stop to saved note and energy use against the previous build
on the same phone and recordings. Check the stored transcript as well
as the extracted tasks. The original failing audio is needed to confirm that
specific acoustic regression.

## Paywall

Weekly, monthly, yearly and lifetime offers use RevenueCat. Configure its public
SDK keys in `app.json` (Release configuration) and matching store products to
enable billing; prices always come from the store. Without a key a release
build refuses recording and shows no prices; release configuration checks reject
placeholder keys. Development builds without a key unlock Pro for testing.
