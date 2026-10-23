# Contributing to ArgoCanvas

ArgoCanvas helps people design workflows visually, inspect their YAML, and run them on Argo. Start with the [README](README.md) for setup and the [production guide](docs/production.md) for deployment behavior. For larger changes, open an issue describing the user problem and proposed scope before implementation. Keep pull requests focused enough to review and test independently.

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

Inspect every image for current ArgoCanvas branding, legible text, unclipped controls, and accurate sample content before committing it. Verify the supported actions through the test suite; an enabled control alone does not prove its request succeeds. Keep the README's fixture captions alongside the images. Capture only the supported workflow editor, templates, runs, and optional AI features.

### Captioned walkthrough

To re-record and encode the opt-in README walkthrough (`docs/media/argocanvas-showcase.gif` and `docs/media/argocanvas-showcase.mp4`), ensure `ffmpeg` (`libx264`), `ffprobe`, and `gifsicle` are on `PATH`, then run:

```sh
RUN_SHOWCASE=1 pnpm exec playwright test tests/e2e/showcase.spec.ts --workers=1
node scripts/render-showcase.mjs INPUT_WEBM --timing SHOWCASE_TIMING_JSON
```

Replace `INPUT_WEBM` and `SHOWCASE_TIMING_JSON` with the recording and `showcase-timing.json` attached to the same successful Playwright test. They are saved under that test's `test-results/` directory. The recording is opt-in and does not run during the regular browser suite. Its assertions verify the demonstrated actions through the production gateway before the clip is ready to publish; upstream responses still come from deterministic fixtures.

The timing file contains trim points, reading holds, and camera cues in the original recording's time and coordinate space. The renderer adds gentle zooms with smooth starts and stops inside a fixed, rounded frame; the caption footer stays stationary. The MP4 renders camera motion at 60 fps from a 25 fps UI recording. The GIF uses 12 fps, with its width adjusted to stay within the renderer's size limit. Keep both outputs and the static screenshots together.

Watch the complete MP4 and GIF before committing them. Check that the opening graph fits, focused controls remain visible, cursor paths and camera moves are smooth, and captions stay legible at the README's display size. Leave enough still time to read the YAML, AI response, and logs. Confirm that the sample-service disclosure remains visible and that every chapter reflects a supported feature. The renderer checks decoding, duration, and file size; it does not replace this visual review.

## Pull requests

Explain the problem, the resulting behavior, and the relevant validation. Include screenshots for UI changes and call out configuration or operational changes. Link the issue when one exists. Report checks that were not run, with the reason, rather than implying they passed.

For bugs, include a minimal reproduction, expected and actual behavior, commit identifier, runtime/browser versions, and development versus production mode. Redact private information from logs, manifests, and captures. Follow [SECURITY.md](SECURITY.md) for suspected vulnerabilities.

Contributions are covered by the project's [Apache License 2.0](LICENSE).
