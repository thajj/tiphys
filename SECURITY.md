# ArgoCanvas security

## Reporting a vulnerability

Report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose
**Report a vulnerability** (https://github.com/thajj/ArgoCanvas/security/advisories/new).
Do not open a public issue for suspected vulnerabilities.

Include the affected commit or release, deployment mode (development or production gateway), impact,
and a minimal reproduction using dummy credentials and harmless workloads. Do not include real tokens,
personal data, or production workflow content.

This is a volunteer-maintained project. The maintainer aims to acknowledge reports within 7 days and
will coordinate a fix and disclosure timeline with the reporter.

## Supported versions

Only the latest release receives security fixes while the project is pre-1.0. Review the current dependency audit and deployment requirements when preparing a release. The [dependency audit policy](docs/production.md#dependency-audits) fails on moderate-or-higher findings and incomplete audits, with no advisory exceptions.

## Deployment security model

ArgoCanvas's production configuration is intended for a trusted team within one Argo namespace. The OIDC proxy authenticates users, and the gateway checks the proxy proof and editor groups. Workflows, templates, and logs are shared across authorized namespace users; drafts are scoped to the authenticated subject.

Editor access allows submitting executable workloads. Kubernetes runner RBAC, admission policies, network isolation, and credential scope remain part of the deployment's security boundary. Follow the [production deployment guide](docs/production.md) and never expose the development server or gateway port directly to untrusted clients.
