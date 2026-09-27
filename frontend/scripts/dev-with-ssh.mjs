import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";

const sshHost = process.env.SATQUERY_SSH_HOST ?? "3.110.104.33";
const sshUser = process.env.SATQUERY_SSH_USER ?? "ec2-user";
const sshKey = process.env.SATQUERY_SSH_KEY ?? path.join(homedir(), "Downloads", "SatQuery", "satquery-aws.pem");
const localRscovlmPort = Number(process.env.SATQUERY_RSCOVLM_LOCAL_PORT ?? "18001");
const localTerramindPort = Number(process.env.SATQUERY_TERRAMIND_LOCAL_PORT ?? "18002");

try {
  accessSync(sshKey, constants.R_OK);
} catch {
  console.error(`SSH key not found or unreadable: ${sshKey}`);
  process.exit(1);
}

const sshArgs = [
  "-N",
  "-T",
  "-i", sshKey,
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=15",
  "-o", "ExitOnForwardFailure=yes",
  "-o", "ServerAliveInterval=30",
  "-o", "ServerAliveCountMax=3",
  "-o", "StrictHostKeyChecking=accept-new",
  "-L", `127.0.0.1:${localRscovlmPort}:127.0.0.1:8001`,
  "-L", `127.0.0.1:${localTerramindPort}:127.0.0.1:8002`,
  `${sshUser}@${sshHost}`,
];

console.log(`Opening secure GPU tunnel to ${sshUser}@${sshHost}...`);
const ssh = spawn("ssh", sshArgs, { stdio: "inherit" });
let next;
let stopping = false;

function waitForPort(port, timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.setTimeout(1000);
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      const retry = () => {
        socket.destroy();
        if (Date.now() - started >= timeoutMs) {
          reject(new Error(`Local tunnel port ${port} was not ready within ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 250);
        }
      };
      socket.once("error", retry);
      socket.once("timeout", retry);
    };
    attempt();
  });
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  if (next && !next.killed) next.kill("SIGTERM");
  if (!ssh.killed) ssh.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300).unref();
}

process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(143));

ssh.once("error", (error) => {
  console.error(`Could not start SSH: ${error.message}`);
  stop(1);
});

ssh.once("exit", (code, signal) => {
  if (!stopping) {
    console.error(`SSH tunnel stopped unexpectedly (${signal ?? `exit ${code}`}).`);
    stop(code ?? 1);
  }
});

try {
  await Promise.all([
    waitForPort(localRscovlmPort),
    waitForPort(localTerramindPort),
  ]);
  console.log(`GPU tunnel ready: RSCoVLM localhost:${localRscovlmPort}, TerraMind localhost:${localTerramindPort}`);

  const nextBin = path.join(process.cwd(), "node_modules", ".bin", "next");
  next = spawn(nextBin, ["dev"], { stdio: "inherit" });
  next.once("error", (error) => {
    console.error(`Could not start Next.js: ${error.message}`);
    stop(1);
  });
  next.once("exit", (code, signal) => {
    if (!stopping) {
      if (signal) console.error(`Next.js stopped (${signal}).`);
      stop(code ?? 0);
    }
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  stop(1);
}
