/**
 * Waits until the Liminal API (dev server) accepts TCP on PORT (default 3001).
 * Used so Vite's /api proxy does not hit ECONNREFUSED while Express is still
 * registering tools before listen().
 */
import net from "node:net";

const port = Number(process.env.PORT?.trim() || 3001);
const host = "127.0.0.1";
const deadlineMs = Date.now() + 120_000;
const intervalMs = 250;

function tryOnce() {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(2000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

for (;;) {
  if (Date.now() > deadlineMs) {
    console.error(`wait-for-dev-api: timed out waiting for ${host}:${port} (is dev:server running?)`);
    process.exit(1);
  }
  // eslint-disable-next-line no-await-in-loop
  if (await tryOnce()) {
    console.log(`wait-for-dev-api: ${host}:${port} is up — starting Vite`);
    process.exit(0);
  }
  // eslint-disable-next-line no-await-in-loop
  await new Promise((r) => setTimeout(r, intervalMs));
}
