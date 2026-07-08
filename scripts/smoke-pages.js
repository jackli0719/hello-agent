#!/usr/bin/env node

const { spawn } = require("node:child_process");

const HOST = "127.0.0.1";
const PORT = Number(process.env.SMOKE_PORT || 3211);
const BASE_URL = `http://${HOST}:${PORT}`;

const server = spawn(
  "npm",
  ["run", "start", "--", "--hostname", HOST, "--port", String(PORT)],
  {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(PORT) },
  },
);

let output = "";
server.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

function stop() {
  if (!server.killed) server.kill("SIGTERM");
}

async function waitForReady() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/login`, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {
      // server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`smoke server did not become ready:\n${output}`);
}

async function expectPage(path, expectedText) {
  const res = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
  if (res.status !== 200) {
    throw new Error(`${path} expected 200, got ${res.status}`);
  }
  const html = await res.text();
  if (!html.includes(expectedText)) {
    throw new Error(`${path} did not contain expected text: ${expectedText}`);
  }
}

async function expectProtected(path) {
  const res = await fetch(`${BASE_URL}${path}`, { redirect: "manual" });
  const location = res.headers.get("location") || "";
  if (![307, 308].includes(res.status) || !location.includes("/login")) {
    throw new Error(
      `${path} expected redirect to /login, got ${res.status} ${location}`,
    );
  }
}

(async () => {
  try {
    await waitForReady();
    await expectPage("/login", "登录");
    await expectPage("/customer", "下单");
    await expectProtected("/orders");
    await expectProtected("/worker");
    console.log(
      "✅ smoke-pages: login/customer render and protected routes redirect",
    );
  } finally {
    stop();
  }
})().catch((err) => {
  stop();
  console.error(err.message);
  process.exit(1);
});
