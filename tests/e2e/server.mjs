// Exercise the built production server. This fixture never runs in deployment images.
import { createServer, request } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createArgoFixture } from "./argo-fixture.mjs";
import { geminiFixtureKey, geminiFixtureModel } from "./integration-fixtures.mjs";

const directory = await mkdtemp(path.join(tmpdir(), "argo-browser-test-"));
await promisify(execFile)("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1", "-keyout", path.join(directory, "key.pem"), "-out", path.join(directory, "cert.pem")]);
// Model TLS termination at the ingress while keeping the real gateway on HTTP.
let gatewayPort = 0;
const edge = createHttpsServer({ key: await readFile(path.join(directory, "key.pem")), cert: await readFile(path.join(directory, "cert.pem")) }, (req, res) => {
  const upstream = request({ hostname: "127.0.0.1", port: gatewayPort, path: req.url, method: req.method, headers: req.headers }, response => {
    res.writeHead(response.statusCode, response.headers); response.pipe(res);
  });
  upstream.on("error", () => { res.writeHead(502); res.end(); });
  req.pipe(upstream);
});
const argo = createServer(createArgoFixture());
await new Promise(resolve => argo.listen(0, "127.0.0.1", resolve));
const child = spawn(process.execPath, ["--import", "./tests/e2e/gemini-preload.mjs", "apps/workflow-builder/dist-server/main.js"], {
  stdio: ["ignore", "pipe", "inherit"],
  env: {
    ...process.env, NODE_ENV: "production", PUBLIC_URL: "https://127.0.0.1:3000",
    ARGO_ENDPOINT: `http://127.0.0.1:${argo.address().port}`, ARGO_NAMESPACE: "workflows",
    ARGO_TOKEN: "e2e-server-only-argo-token", AUTH_PROXY_SECRET: "e2e-proxy-proof-at-least-32-characters",
    AUTH_EDITOR_GROUPS: "editors", DATA_DIR: directory, PORT: "0",
    GEMINI_API_KEY: geminiFixtureKey, GEMINI_MODEL: geminiFixtureModel,
  },
});
let stopping = false;
const stop = () => { if (!stopping) { stopping = true; child.kill("SIGTERM"); } };
process.on("SIGTERM", stop); process.on("SIGINT", stop);
child.on("exit", async code => { edge.closeAllConnections(); edge.close(); argo.closeAllConnections(); argo.close(); await rm(directory, { recursive: true, force: true }); process.exit(code || 0); });
gatewayPort = await new Promise((resolve, reject) => {
  let pending = "";
  child.once("exit", () => reject(new Error("Gateway failed to start")));
  child.stdout.on("data", chunk => {
    process.stdout.write(chunk);
    pending += chunk.toString();
    let newline;
    while ((newline = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
      try { const event = JSON.parse(line); if (event.event === "server.started") resolve(event.port); } catch { /* non-JSON dependency output */ }
    }
  });
});
await new Promise(resolve => edge.listen(3000, "127.0.0.1", resolve));
