# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-25

### Added

- **Visual workflow designer:** Interactive canvas powered by React Flow for composing Argo Workflows with step configuration, dependency edges, conditions, retries, and multi-tab draft sessions.
- **Embedded YAML editor:** Monaco-powered manifest editor with locally served language workers and vendored Argo Workflows schema hints for synchronized visual-and-text editing.
- **Argo Workflows integration:** Server-side proxy for cluster operations including submitting workflows, tracking phases, streaming container logs, and suspending or resuming executions.
- **Template library:** WorkflowTemplate inspection, creation, update with optimistic locking/revision preservation, and direct submission.
- **Draft persistence:** Server-side disk persistence for active workflow sessions per authenticated user with browser storage fallback.
- **Optional AI assistance:** Server-mediated integration with Google Gemini for workflow drafting, natural language node modifications, and graph analysis.
- **Production Kubernetes packaging:** Multi-container deployment manifests pairing a Node.js gateway with an OAuth2 Proxy sidecar for OIDC authentication, group-based authorization, same-origin mutation checks, and restricted Pod Security compliance.
- **Automated verification & supply chain:** GitHub Actions CI suite, container isolation verification, multi-arch release pipeline with SLSA build provenance and SBOM generation.

### Known boundaries

- Single-replica deployment with single-writer draft filesystem semantics.
- Namespace-scoped operations within the configured Argo namespace.
- Visual canvas supports a core subset of Argo constructs; advanced or unsupported fields are preserved or edited directly in YAML.
