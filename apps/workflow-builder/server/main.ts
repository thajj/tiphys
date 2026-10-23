import { loadServerConfig } from "./config";
import { createProductionServer } from "./app";
import type { AddressInfo } from "node:net";

const config = loadServerConfig(process.env);
const app = await createProductionServer(config);
app.server.listen(config.port, "0.0.0.0", () => {
  console.info(JSON.stringify({ event: "server.started", port: (app.server.address() as AddressInfo).port }));
});
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    console.info(JSON.stringify({ event: "server.stopping", signal }));
    const deadline = setTimeout(() => { app.server.closeAllConnections(); process.exit(1); }, 25000);
    deadline.unref();
    try { await app.close(); clearTimeout(deadline); process.exit(0); }
    catch { process.exit(1); }
  });
}
