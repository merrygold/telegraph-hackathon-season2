// Runs the app, the miner and the comparator on this PC for testing.
//   node local.mjs        then open http://localhost:18787
// The watch loop is off here, so nothing is bought unless you press a button.
import { spawn } from "node:child_process";

const run = (dir, args, env) =>
  spawn(process.execPath, args, { cwd: new URL(dir, import.meta.url), env: { ...process.env, ...env }, stdio: "inherit" });

run("./gauge/", ["gauge.mjs"], { PORT: 18788 });
run("./measure/", ["runnable.mjs"], { PORT: 18789 });
run("./tripwire/", ["--env-file=.env", "server.mjs"], {
  PORT: 18787, WATCH_MINUTES: 0, GAUGE_URL: "http://localhost:18788", MEASURE_URL: "http://localhost:18789",
});
