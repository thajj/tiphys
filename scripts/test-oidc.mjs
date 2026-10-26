// Test the pinned login proxy against an ephemeral OIDC issuer. No real credentials.
import { createServer } from "node:http";
import { generateKeyPairSync, createHash, randomUUID, sign } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const run = promisify(execFile);
const name = `tiphys-oidc-test-${process.pid}`;
const directory = await mkdtemp(path.join(tmpdir(), "tiphys-oidc-"));
const secret = "oidc-integration-only-proxy-secret-at-least-32-characters";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };
const codes = new Map();
let user = "editor";
let issuer;
let idpPort;
const body = async req => { const chunks = []; for await (const chunk of req) chunks.push(chunk); return new URLSearchParams(Buffer.concat(chunks).toString()); };
const reply = (res, data) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data)); };
const idp = createServer(async (req, res) => {
  const url = new URL(req.url, issuer);
  if (url.pathname === "/.well-known/openid-configuration") {
    reply(res, { issuer, authorization_endpoint: `http://127.0.0.1:${idpPort}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, userinfo_endpoint: `${issuer}/userinfo`, response_types_supported: ["code"], subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"], code_challenge_methods_supported: ["S256"] });
  } else if (url.pathname === "/jwks") reply(res, { keys: [jwk] });
  else if (url.pathname === "/authorize") {
    const code = randomUUID();
    codes.set(code, { nonce: url.searchParams.get("nonce"), challenge: url.searchParams.get("code_challenge"), user });
    const callback = new URL(url.searchParams.get("redirect_uri"));
    callback.searchParams.set("code", code); callback.searchParams.set("state", url.searchParams.get("state"));
    res.writeHead(302, { Location: callback.href }); res.end();
  } else if (url.pathname === "/token") {
    const form = await body(req); const code = codes.get(form.get("code")); codes.delete(form.get("code"));
    if (!code || createHash("sha256").update(form.get("code_verifier") || "").digest("base64url") !== code.challenge) { res.writeHead(400); reply(res, { error: "invalid_grant" }); return; }
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: issuer, aud: "test-client", sub: `test-${code.user}`, email: `${code.user}@example.com`, email_verified: true, groups: [code.user === "editor" ? "workflow-editors" : "workflow-viewers"], iat: now, exp: now + 3600, nonce: code.nonce };
    const unsigned = `${Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
    reply(res, { access_token: "test-access-token", token_type: "Bearer", expires_in: 3600, id_token: `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")}` });
  } else if (url.pathname === "/userinfo") reply(res, { sub: `test-${user}`, email: `${user}@example.com`, email_verified: true });
  else { res.writeHead(404); res.end(); }
});
const upstream = createServer((req, res) => reply(res, { user: req.headers["x-auth-request-user"], groups: req.headers["x-auth-request-groups"], proof: req.headers["x-auth-proxy-secret"] }));
const listen = async server => { await new Promise(resolve => server.listen(0, "0.0.0.0", resolve)); return server.address().port; };
let containerCreated = false;
try {
  idpPort = await listen(idp); issuer = `http://host.docker.internal:${idpPort}`;
  const upstreamPort = await listen(upstream);
  const reservation = createServer(); const proxyPort = await listen(reservation); await new Promise(resolve => reservation.close(resolve));
  const base = `http://127.0.0.1:${proxyPort}`;
  const configuration = (await readFile("deploy/kubernetes/oauth2-proxy.yaml", "utf8")).replace("http://127.0.0.1:3000", `http://host.docker.internal:${upstreamPort}`);
  await writeFile(path.join(directory, "proxy.yaml"), configuration);
  await writeFile(path.join(directory, "secret"), secret);
  await run("docker", ["run", "-d", "--name", name, "--add-host=host.docker.internal:host-gateway", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "-p", `127.0.0.1:${proxyPort}:4180`, "-v", `${directory}/proxy.yaml:/config.yaml:ro`, "-v", `${directory}/secret:/secrets/auth-proxy-secret:ro`, "-e", "OIDC_CLIENT_ID=test-client", "-e", "OIDC_CLIENT_SECRET=test-client-secret", "-e", `OIDC_ISSUER_URL=${issuer}`, "-e", `OAUTH2_PROXY_COOKIE_SECRET=${Buffer.alloc(32, 7).toString("base64")}`, "quay.io/oauth2-proxy/oauth2-proxy:v7.14.0", "--alpha-config=/config.yaml", `--redirect-url=${base}/oauth2/callback`, "--reverse-proxy=true", "--email-domain=*", "--cookie-secure=true", "--cookie-httponly=true", "--cookie-samesite=lax", "--skip-provider-button=true", "--request-logging=false", "--api-route=^/api/"]);
  containerCreated = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { ready = (await fetch(`${base}/ready`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* startup */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(ready, "OIDC proxy did not become ready");
  const forged = { "X-Auth-Request-User": "attacker", "X-Auth-Request-Groups": "workflow-editors", "X-Auth-Proxy-Secret": "attacker-proof" };
  assert.equal((await fetch(`${base}/api/platform/config`, { headers: forged })).status, 401);
  const login = async () => {
    const jar = new Map(); let target = `${base}/oauth2/start?rd=/api/platform/config`;
    for (let step = 0; step < 12; step++) {
      const response = await fetch(target, { redirect: "manual", headers: { Cookie: Array.from(jar, ([key, value]) => `${key}=${value}`).join("; "), ...forged }, signal: AbortSignal.timeout(5000) });
      for (const cookie of response.headers.getSetCookie()) {
        const part = cookie.split(";")[0]; const index = part.indexOf("="); jar.set(part.slice(0, index), part.slice(index + 1));
        if (part.startsWith("_oauth2_proxy=")) assert(cookie.includes("Secure") && cookie.includes("HttpOnly"), "Session cookie protections are missing");
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) { target = new URL(response.headers.get("location"), target).href; await response.arrayBuffer(); continue; }
      assert.equal(response.status, 200, `OIDC login failed: ${await response.clone().text()}`);
      return response.json();
    }
    throw new Error("OIDC redirect loop");
  };
  const editor = await login(); assert.equal(editor.user, "test-editor"); assert.equal(editor.groups, "workflow-editors"); assert.equal(editor.proof, secret);
  user = "viewer";
  const viewer = await login(); assert.equal(viewer.user, "test-viewer"); assert.equal(viewer.groups, "workflow-viewers"); assert.equal(viewer.proof, secret);
  console.log("OIDC login passed for editor and viewer; forged identities, groups, and proxy proof were overwritten; unauthenticated requests were rejected.");
} catch (error) {
  if (containerCreated) console.error((await run("docker", ["logs", name]).catch(() => ({ stdout: "", stderr: "" }))).stderr);
  throw error;
} finally {
  if (containerCreated) await run("docker", ["rm", "-f", name]);
  idp.closeAllConnections(); upstream.closeAllConnections(); await Promise.all([new Promise(resolve => idp.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
  await rm(directory, { recursive: true, force: true });
}
