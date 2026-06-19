// Regenerates frontend/package-lock.json inside a Linux container so the lock
// is identical no matter which operating system you run this on.
//
// Why this exists: when you run "npm install" directly on Windows (and possibly
// Mac), npm drops the optional package entries that other platforms need. The
// lock it writes then fails "npm ci" on the Linux CI runner, because the entries
// Linux needs are missing. Running the install inside a fixed Linux image
// (node:22, the same major the CI workflow uses) avoids that and gives everyone
// the same complete lock.
//
// Run it from the repository root with: npm run lock
// It needs Docker Desktop installed and running.

const path = require("path");
const childProcess = require("child_process");

// The lock file we care about lives in the frontend workspace, one level up
// from this scripts directory.
const frontendDir = path.resolve(__dirname, "..", "frontend");

// Docker bind mount: the host path on the left of the colon, the in-container
// path on the right. On Windows this becomes something like
// "C:\...\frontend:/host", which Docker Desktop understands.
const volumeMount = frontendDir + ":/host";

// This runs inside the container. It copies the two manifest files into a
// fresh, empty directory (no node_modules), regenerates the lock there, and
// copies only the new lock back out. Starting from an empty directory makes the
// result match what the CI runner produces from a clean checkout.
const containerScript =
  "set -e\n" +
  "mkdir /work\n" +
  "cp /host/package.json /host/package-lock.json /work/\n" +
  "cd /work\n" +
  "npm install --package-lock-only\n" +
  "cp /work/package-lock.json /host/package-lock.json\n";

const dockerArgs = [
  "run",
  "--rm",
  "-v",
  volumeMount,
  "node:22",
  "bash",
  "-c",
  containerScript,
];

console.log("Regenerating frontend/package-lock.json inside node:22 (Linux)...");
console.log("This needs Docker Desktop running. The first run pulls the image.");
console.log("");

// stdio "inherit" sends Docker's output straight to this terminal so you can
// see the image pull, npm progress, and any errors.
const result = childProcess.spawnSync("docker", dockerArgs, { stdio: "inherit" });

if (result.error) {
  console.error("");
  console.error("Could not run docker. Is Docker Desktop installed and running?");
  console.error(result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  console.error("");
  console.error("Lock regeneration failed (docker exited with code " + result.status + ").");
  process.exit(result.status);
}

console.log("");
console.log("Done. Review and commit the change:");
console.log("  git diff frontend/package-lock.json");
