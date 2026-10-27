# Contributing to Tiphys

Tiphys helps people design workflows visually, inspect their YAML, and run them on Argo. Start with the [README](README.md) for setup, the [Code of Conduct](CODE_OF_CONDUCT.md) for community standards, and the [production guide](docs/production.md) for deployment behavior. For larger changes, open an issue describing the user problem and proposed scope before implementation. Keep pull requests focused enough to review and test independently.

## Local setup

Use Node.js 24 and pnpm 10.29.3, then run:

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

The development app listens on `http://127.0.0.1:3000`. Its gateway includes in-memory resources and workflow fallbacks; test cluster behavior through the compiled production gateway. Never commit `.env.local`, authentication tokens, or production data.

Read [AGENTS.md](AGENTS.md) when using a coding agent. Before changing Turborepo configuration or commands, read the docs bundled with the installed `turbo` package, as that file requires. Use the existing pnpm lockfile; do not introduce npm or Yarn lockfiles.

## Implementing a change

- Put domain parsing, generation, and validation in `packages/workflow-domain`; put UI behavior in `packages/workflow-editor` and shared UI in `packages/ui-platform`.
- Keep credentials and access checks in the gateway. Browser feature flags improve the experience but do not replace server authorization.
- Add regression coverage for changed behavior, especially draft persistence, workflow submission, permissions, and template revision conflicts. Prefer tests of visible behavior over implementation details.
- Update documentation and screenshots when user flows, configuration, or supported behavior change. Captures should identify fixtures and contain no sensitive data.
- Describe limitations accurately. Do not present development simulations as tested external integrations.

## Checks before opening a pull request

```sh
pnpm audit:check
pnpm lint
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm e2e
```

The browser suite uses the compiled production gateway, an ephemeral HTTPS certificate, and test upstream services. It requires `openssl` on `PATH` and port 3000 available. On Linux, install browser system dependencies with `pnpm exec playwright install --with-deps chromium`.

The lockfile resolves Monaco 0.52.2 because the worker API changes in 0.53+ break the current `monaco-worker-manager` integration used by `monaco-yaml` ([upstream report](https://github.com/microsoft/monaco-editor/issues/5310)). Before upgrading it, verify the documentation browser test: it must render a full-height editor, report invalid YAML, and produce no worker errors. Merely mounting the editor does not exercise validation.

For OIDC or deployment changes, also run `pnpm test:oidc` with Docker running and build the root `Dockerfile`. The CI workflow runs workspace checks, container checks, and the OIDC integration test. Review UI changes in the running app and exercise their behavior in the browser suite.

Use an explicitly selected, authorized test cluster for live integration checks. Prefer an echo-only workflow and narrowly scoped temporary credentials; remove test resources afterward. Record the date, Kubernetes and Argo versions, checked operations, and exclusions alongside the [compatibility record](docs/production.md#recorded-live-compatibility-check). Never treat a local test or fixture as proof of a production rollout.

## Updating README media

### Static screenshots

After building the app and installing Chromium, capture the actual running UI with:

```sh
UPDATE_DOC_SCREENSHOTS=1 pnpm exec playwright test tests/e2e/documentation.spec.ts
```

This runs the compiled production app with editor permissions and AI integration enabled through runtime configuration. Deterministic Argo and Gemini fixtures supply sample data and responses; the capture does not require external services or real credentials. The pipeline comes from `examples/hello-workflow.yaml`.

The capture updates three files:

- `docs/images/workflow-builder.png` — the visual pipeline and node settings.
- `docs/images/yaml-editor.png` — the editable manifest and local validation.
- `docs/images/ai-assistant.png` — the enabled workflow-generation assistant.

Inspect every image for current Tiphys branding, legible text, unclipped controls, and accurate sample content before committing it. Verify the supported actions through the test suite; an enabled control alone does not prove its request succeeds. Keep the README's fixture captions alongside the images. Capture only the supported workflow editor, templates, runs, and optional AI features.

### Live product walkthrough

The showcase records real browser interaction with the compiled app. It starts with an empty canvas, drags components from Library, types task settings, draws connections, then copies the official Argo diamond example and pastes it into a new draft. Normal app animations stay enabled. Do not replace these actions with a sequence of screenshots.

Install `ffmpeg` with `libvpx-vp9` and `libx264`, plus `ffprobe`, then run:

```sh
RUN_SHOWCASE=1 pnpm exec playwright test tests/e2e/showcase.spec.ts --workers=1
node scripts/render-showcase.mjs INPUT_WEBM --timing SHOWCASE_TIMING_JSON --poster-seconds POSTER_SECONDS
```

Use the recording and `showcase-timing.json` attached to the same successful test under `test-results/`. `POSTER_SECONDS` selects a frame within the trimmed output; choose a readable view of the connected graph. The recording is opt-in and needs access to GitHub for the official example. It uses temporary sample services and credentials, and does not execute workloads.

The renderer produces four files in `docs/media/`:

- `tiphys-showcase.webm`: primary VP9 video at 1600 × 1000.
- `tiphys-showcase.mp4`: H.264 fallback encoded from the same source.
- `tiphys-showcase-poster.png`: a full-resolution still for README and article previews.
- `tiphys-showcase.json`: chapter times, reading holds, source frame rate, source hash, and export details.

The source recording contains the live UI motion. Camera movement renders at 60 fps; this does not turn the browser capture into native 60 fps footage. Keep captions outside the app and use brief zooms only where they make a control or value easier to read. Preserve the whole drag or connection gesture. Allow time to read the resulting settings and YAML.

Use `--output DIRECTORY` to render a review copy before replacing the committed media. The renderer checks dimensions, codecs, duration, and complete decoding. Watch both exports in full and inspect the poster before committing. Check text legibility, cursor movement, visible drag previews, connection alignment, chapter timing, and the sample-service disclosure. Keep the three static screenshots alongside the video.

For local review, serve the repository over HTTP and open `docs/media/preview.html`. The player uses the same chapter metadata and provides playback controls, seeking, and fullscreen.

For GitHub playback, attach the reviewed WebM through the README editor and copy its stable `github.com/user-attachments/assets/…` URL. A standalone attachment URL renders a video player in Markdown. Keep the repository copies as downloads and verify anonymous playback after saving the README. Never use the temporary signed CDN URL from the player.

The poster supports article previews and the local chapter player. GitHub repository file links and arbitrary Medium video links do not provide an inline player. Use a supported video provider for inline Medium playback if one is available; otherwise link the poster to the video. A video preserves the recorded interaction, but it is not a clickable replica of the product.

## Pull requests

Explain the problem, the resulting behavior, and the relevant validation. Include screenshots for UI changes and call out configuration or operational changes. Link the issue when one exists. Report checks that were not run, with the reason, rather than implying they passed.

For bugs, include a minimal reproduction, expected and actual behavior, commit identifier, runtime/browser versions, and development versus production mode. Redact private information from logs, manifests, and captures. Follow [SECURITY.md](SECURITY.md) for suspected vulnerabilities.

Contributions are covered by the project's [Apache License 2.0](LICENSE).
