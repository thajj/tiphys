# ArgoCanvas security

## Reporting a vulnerability

This project has not yet published a dedicated private vulnerability-reporting address or response-time commitment. Ask the repository owner for a private reporting channel before sharing sensitive findings. If GitHub offers **Report a vulnerability** in this repository's Security tab, use that private reporting flow.

Do not place credentials, personal data, or exploit details in a public issue. Once a private channel is established, include the affected commit or version, deployment mode, impact, and a minimal reproduction using dummy credentials and harmless workloads.

## Support status

No supported-release matrix or security maintenance schedule has been established yet. Review the current dependency audit and deployment requirements when preparing a release. The [dependency audit policy](docs/production.md#dependency-audits) fails on moderate-or-higher findings and incomplete audits, with no advisory exceptions.

## Deployment security model

ArgoCanvas's production configuration is intended for a trusted team within one Argo namespace. The OIDC proxy authenticates users, and the gateway checks the proxy proof and editor groups. Workflows, templates, and logs are shared across authorized namespace users; drafts are scoped to the authenticated subject.

Editor access allows submitting executable workloads. Kubernetes runner RBAC, admission policies, network isolation, and credential scope remain part of the deployment's security boundary. Follow the [production deployment guide](docs/production.md) and never expose the development server or gateway port directly to untrusted clients.
