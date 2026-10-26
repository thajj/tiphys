## Summary

A concise description of the problem solved, proposed behavior, and changes introduced.

## Related issues

Closes #

## Validation performed

List all checks run locally and in test environments:

- [ ] `pnpm lint` (TypeScript checks)
- [ ] `pnpm test` (Unit and integration tests)
- [ ] `pnpm build` (Browser bundle and server build)
- [ ] `pnpm audit:check` (Dependency vulnerability policy)
- [ ] `pnpm e2e` (Playwright browser suite)
- [ ] `pnpm test:oidc` (OAuth2 Proxy integration test)
- [ ] Container build verification (`docker build -t tiphys:local .`)

If any of the above checks were not run, state the reason:

## Screenshots / captures

If this change alters UI behavior, attach updated screenshots or captures demonstrating the flow. Ensure sample data contains no real tokens or sensitive information.

## Operational & configuration changes

Note any changes to environment variables, Kustomize manifests, gateway headers, or permissions.
