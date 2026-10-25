# Production deployment

The production image runs the compiled Node.js gateway and static browser build. `pnpm dev` is for development only. Production configuration is injected at runtime; the same image works across namespaces without rebuilding.

## Deployment model

Use the Kustomize manifests in `deploy/kubernetes`. They run one gateway and an OAuth2 Proxy 7.14.0 sidecar in a pod. The Service exposes only the proxy port. TLS terminates at the ingress controller. The gateway requires the proxy's shared secret plus an authenticated subject on every browser and API request. The proxy overwrites incoming identity, group, and secret headers with values from the verified OIDC session. Never expose port 3000 through a Service or public ingress.

The OIDC provider must issue a stable `sub`, verified email, and a `groups` claim. Register an application with callback `https://YOUR_HOST/oauth2/callback` and PKCE S256 support. Restrict login to the `workflow-viewers` and `workflow-editors` groups, or edit the proxy's allow-list for your organization. The gateway grants writes only to groups in `AUTH_EDITOR_GROUPS`; other authenticated users can inspect the namespace. Workflow definitions, logs, and templates are shared within that namespace. Drafts and browser backups are isolated by subject. This deployment is a trusted-team application, not a multi-tenant cluster control plane.

Cookies are configured to expire after 8 hours and refresh after 10 minutes. The proxy uses [stateless client-cookie sessions](https://oauth2-proxy.github.io/oauth2-proxy/7.14.x/configuration/session_storage/); refresh can renew the session, so this is not an absolute login limit. Revocation timing depends on the provider's token and claim refresh behavior; test it with your IdP. To invalidate all existing deployment sessions, rotate the proxy cookie secret and restart the proxy; every user must sign in again. The sidecar configuration follows the [pinned OAuth2 Proxy header-injection format](https://oauth2-proxy.github.io/oauth2-proxy/7.14.x/configuration/alpha-config/); revalidate it before upgrading the proxy.

## Prepare the environment

1. Tagged releases publish signed, multi-architecture images to GitHub Packages under `ghcr.io/thajj/argocanvas:<version>` with SBOM and build provenance attestations. Verify the published image before deployment:
   ```sh
   gh attestation verify oci://ghcr.io/thajj/argocanvas:0.1.0 -R thajj/ArgoCanvas
   ```
   You can also build and publish your own image from `Dockerfile` under an immutable commit tag or digest. Adjust `deploy/kubernetes/kustomization.yaml` to reference the image you intend to deploy.
2. Set the public origin, Argo endpoint and namespace, OIDC issuer/client ID, and editor groups in the ConfigMap generator. Set the same hostname in `ingress.yaml`. Replace the ingress class and NetworkPolicy namespace/pod selectors for your actual ingress controller. Use a CNI that enforces NetworkPolicy, and provision the referenced TLS Secret.
3. Create `argocanvas-secrets` in namespace `argocanvas` with keys `auth-proxy-secret`, `argo-token`, `oidc-client-secret`, and `cookie-secret`. Generate at least 32 random bytes for the proxy secret and encode them as a header-safe string. The cookie secret is a base64-encoded 32-byte random value. Use a secret manager or files with `kubectl create secret generic --from-file`; keep secret values out of Git, shell history, and deployment logs. The proxy reads `auth-proxy-secret` from the mounted file and the gateway reads the same value from its environment. Generate it without a trailing newline.
4. Enable Argo Server's client authentication. Use the namespaced service account and Role in `deploy/argo-rbac.example.yaml`, adjusted to the actual execution namespace, to obtain the gateway credential. Do not grant cluster-admin or reuse an administrator token. Rotate the credential before expiration and restart the Deployment after environment-backed secret changes. Argo's own authorization remains authoritative. See [Argo access-token guidance](https://argo-workflows.readthedocs.io/en/latest/access-token/).
5. Ensure workflow runner service accounts have only the permissions required by submitted jobs. Set namespace Pod Security restrictions, resource quotas, image/admission policies, and Argo workflow defaults appropriate to your workloads. Editor access allows submitting executable workloads, including resource templates; the gateway's namespace check does not replace Kubernetes admission or runner RBAC. Do not mount production administrative credentials into workflow pods.
6. Provision a persistent volume with a StorageClass suitable for the cluster. The pod uses `fsGroup: 1000`; the volume must support this or be provisioned with UID/GID 1000 ownership. The file store is a single-writer design: keep one replica and the `Recreate` update strategy. This entails brief downtime during updates. Use a shared database before introducing horizontal scaling.
7. For Argo HTTPS with a private CA, mount the CA PEM and set `NODE_EXTRA_CA_CERTS`. Certificate verification stays enabled. HTTP Argo endpoints are supported for trusted in-cluster transport; encrypt traffic with your service mesh where required.

Render the exact manifests before applying them:

```sh
kubectl kustomize deploy/kubernetes > rendered.yaml
# Apply to the chosen context after replacing the example values and provisioning secrets.
kubectl --context YOUR_CONTEXT apply -f rendered.yaml
kubectl --context YOUR_CONTEXT -n argocanvas rollout status deployment/argocanvas
```

No Secret resources with usable credentials are checked in. The example manifests deliberately contain placeholders and cannot log in or access an Argo cluster until configured.

## Optional integrations

AI is off unless `GEMINI_API_KEY` and a supported `GEMINI_MODEL` are provided. It has input limits, request deadlines, editor-only access, and a per-user limit of 10 requests/minute. Model output is a draft for review; submitting it uses the normal Argo API and Kubernetes admission.

The app focuses on workflow authoring and execution. Notebook management, object-storage browsing, and Argo Events sensors and subscriptions are outside its scope.

The YAML editor and its Argo schema are served locally and require no CDN access. `apps/workflow-builder/public/schemas/argo-workflows.json` is vendored from the official Argo Workflows schema; update it alongside the cluster's Argo version. Workflows and templates are validated by Argo on submission; browser schema hints are advisory.

Template updates require the current `metadata.resourceVersion` from Argo; missing revisions and concurrent changes return HTTP 409. The pipeline's **Update** action reads the current revision before replacing the named template. **Publish** creates a template, and the **Templates** library provides access to stored templates. Resources returned by Argo REST are normalized to include Kubernetes type metadata. Resubmitting a completed run clears old IDs, versions, status, execution labels, and shutdown state so the controller treats it as a fresh run.

## Verification and operation

Use Node.js 24 and pnpm 10.29.3. Run `pnpm install --frozen-lockfile`, `pnpm audit:check`, `pnpm lint`, `pnpm test`, `pnpm build`, then `pnpm exec playwright install chromium` and `pnpm e2e`. Browser tests run the compiled production server with a local Argo fixture. Unit tests cover proxy proof, permissions, CSRF, namespace restrictions, upstream request envelopes, failure propagation, request limits, template revision conflicts, and persisted drafts. Integration fixtures do not prove compatibility with a particular live cluster or identity provider.

### Recorded live compatibility check

On October 23, 2026, the compiled production gateway was checked against **Argo Workflows 4.1.6 and Kubernetes 1.37.0** in an isolated kind 0.33.0 cluster. The cluster used [kind's official node image](https://github.com/kubernetes-sigs/kind/releases/tag/v0.33.0), pinned to `kindest/node:v1.37.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5`. Argo used the [v4.1.6 installation manifest](https://github.com/argoproj/argo-workflows/releases/tag/v4.1.6), with matching controller, server, and executor versions and client-token authentication.

The check passed gateway readiness, authentication and permission boundaries; echo-workflow submission, completion, listing and retrieval; plain logs and log-event cursors; resuming a suspended workflow; completed-workflow resubmission; template creation, retrieval, listing, revision updates, stale-write rejection and execution; and workflow and template deletion. Four echo workflows completed successfully. The gateway used a namespace-scoped service account, and workflow containers ran without root privileges. The bundled editor schema was also verified byte-for-byte against Argo 4.1.6.

This is a compatibility smoke test. Artifact archiving and a real OIDC provider were outside its scope. Run the deployment-specific checks below with your own identity provider, policies, storage and representative workloads.

### Deployment checks

**Execute** submits a workflow to Argo. The editor's **Submitted** state confirms acceptance; use **View runs** or **Workflows** to check the controller's phase and logs. **Dry run** only simulates graph execution. The development gateway also has simulated fallbacks, so verify cluster integration through the production gateway.

Before exposing the deployment, verify an actual OIDC login for both a viewer and editor, forged-header rejection at the proxy, a harmless workflow run through completion, logs, template creation/update/run/deletion, and draft recovery after a pod replacement. Confirm the gateway port cannot be reached from untrusted pods. Record cluster version and these results in the release record.

`/healthz` reports process liveness. `/readyz` performs a bounded, authenticated read of the configured Argo namespace; upstream failures remove the pod from service without causing liveness restarts. Both routes are unauthenticated for kubelet probes, while the public proxy still protects normal application requests. Configure request-based alerts for gateway 5xx rates, readiness failures, latency, restarts, and persistent-volume capacity. Structured gateway logs include request IDs, method, route category, response code, and duration; they omit bodies, query strings, upstream credentials, and authenticated subjects. SIGTERM stops new work and drains connections for up to 25 seconds within Kubernetes' 30-second grace period.

Back up the drafts PVC with your storage provider's snapshot mechanism. Draft files are per-user, atomically replaced, and fsynced before returning success; draft autosave uses last-save-wins semantics. Browser backups provide local recovery when remote persistence fails, and the UI reports failed remote saves. Treat backups as sensitive workflow content. Test restore into an isolated deployment. Roll back the image and ConfigMap to the previous release; preserve the PVC and Secrets. Rotate both proxy copies together, and restart the pod after secret changes.

## Dependency audits

`pnpm audit:check` evaluates the current pnpm dependency audit and fails on any moderate, high, or critical finding. It also fails if the audit cannot be completed. There are no advisory exceptions. Run it for each release and after dependency updates; a previously passing result does not establish the current dependency state.
