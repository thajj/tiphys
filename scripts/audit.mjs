import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
let output;
try { output = (await run("pnpm", ["audit", "--json"], { maxBuffer: 8 * 1024 * 1024 })).stdout; }
catch (error) { output = error.stdout; }
let audit;
try { audit = JSON.parse(output); } catch { throw new Error("Dependency audit could not be completed"); }
if (!audit.advisories || !audit.metadata?.vulnerabilities) throw new Error("Dependency audit returned no vulnerability report");
const blocked = [];
for (const advisory of Object.values(audit.advisories)) {
  if (["moderate", "high", "critical"].includes(advisory.severity)) blocked.push(`${advisory.github_advisory_id}: ${advisory.module_name} (${advisory.severity})`);
}
console.log(JSON.stringify(audit.metadata.vulnerabilities));
if (blocked.length) { console.error(blocked.join("\n")); process.exitCode = 1; }
