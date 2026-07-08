#!/usr/bin/env node

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const envPath = path.join(process.cwd(), ".env");

if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;

    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) {
  console.error(
    "DATABASE_URL is not set. Run npm run db:start after creating .env.",
  );
  process.exit(1);
}

let url;
try {
  url = new URL(rawUrl);
} catch {
  console.error("DATABASE_URL is invalid.");
  process.exit(1);
}

const host = url.hostname;
const port = Number(url.port || 5432);

const socket = net.createConnection({ host, port });
const timeout = setTimeout(() => {
  socket.destroy();
  console.error(
    `Postgres is not reachable at ${host}:${port}. Run npm run db:start.`,
  );
  process.exit(1);
}, 2000);

socket.once("connect", () => {
  clearTimeout(timeout);
  socket.end();
});

socket.once("close", () => {
  process.exit(0);
});

socket.once("error", () => {
  clearTimeout(timeout);
  console.error(
    `Postgres is not reachable at ${host}:${port}. Run npm run db:start.`,
  );
  process.exit(1);
});
