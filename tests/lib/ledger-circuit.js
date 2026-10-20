/**
 * Shared helpers for exercising the Ledger circuit shape from the
 * acceptance-test script tests/ledger-test.js. Self-contained: it compiles
 * and sets up whatever artifact it needs instead of assuming another script
 * ran first, so the acceptance test can run standalone.
 *
 * Builds the same artifacts, at the same paths, that scripts/compile-ledger.sh
 * and scripts/setup-dev.sh's ledger block produce: build/ledger/main_ledger.r1cs
 * and build/ledger/{final.zkey,vkey.json}, via the same UNSAFE dev
 * Powers-of-Tau and per-circuit ceremony setup-dev.sh uses.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const BUILD_ROOT = path.join(ROOT, "build");
const LEDGER_DIR = path.join(BUILD_ROOT, "ledger");
const CIRCOM2 = path.join(ROOT, "node_modules", ".bin", "circom2");
const SNARKJS_BIN = path.join(ROOT, "node_modules", ".bin", "snarkjs");

const MAIN_FILE = path.join(ROOT, "src", "main", "main_ledger.circom");
const OPERATIONS_FILE = path.join(ROOT, "src", "operations", "Ledger.circom");

const LEDGER_PATHS = {
  outdir: LEDGER_DIR,
  r1cs: path.join(LEDGER_DIR, "main_ledger.r1cs"),
  sym: path.join(LEDGER_DIR, "main_ledger.sym"),
  wasm: path.join(LEDGER_DIR, "main_ledger_js", "main_ledger.wasm"),
  zkey: path.join(LEDGER_DIR, "final.zkey"),
  vkey: path.join(LEDGER_DIR, "vkey.json"),
};

// Same Powers-of-Tau power and dev entropy scripts/setup-dev.sh uses, so the
// ledger-test.js setup path produces the identical artifacts a manual
// `compile-ledger.sh && setup-dev.sh` run would.
const POT_POWER = 17;

function newerThanAll(sourceMtimeMs, outputPaths) {
  return outputPaths.every(
    (p) => fs.existsSync(p) && fs.statSync(p).mtimeMs >= sourceMtimeMs,
  );
}

function ensureCompiled() {
  const sourceMtimeMs = Math.max(
    fs.statSync(MAIN_FILE).mtimeMs,
    fs.statSync(OPERATIONS_FILE).mtimeMs,
  );
  if (
    newerThanAll(sourceMtimeMs, [
      LEDGER_PATHS.r1cs,
      LEDGER_PATHS.sym,
      LEDGER_PATHS.wasm,
    ])
  ) {
    return LEDGER_PATHS;
  }
  fs.mkdirSync(LEDGER_PATHS.outdir, { recursive: true });
  execFileSync(
    CIRCOM2,
    [MAIN_FILE, "--r1cs", "--wasm", "--sym", "-o", LEDGER_PATHS.outdir, "--O1"],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  return LEDGER_PATHS;
}

function ensureDevPtau() {
  const ptauDir = path.join(BUILD_ROOT, "ptau");
  const finalPtau = path.join(ptauDir, `pot${POT_POWER}_final.ptau`);
  if (fs.existsSync(finalPtau)) {
    return finalPtau;
  }
  fs.mkdirSync(ptauDir, { recursive: true });
  const init = path.join(ptauDir, `pot${POT_POWER}_0000.ptau`);
  const contrib = path.join(ptauDir, `pot${POT_POWER}_0001.ptau`);
  execFileSync(
    SNARKJS_BIN,
    ["powersoftau", "new", "bn128", String(POT_POWER), init],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  execFileSync(
    SNARKJS_BIN,
    ["powersoftau", "contribute", init, contrib, "--name=dev"],
    {
      input: "armada-contribution-entropy\n",
      stdio: ["pipe", "ignore", "inherit"],
    },
  );
  execFileSync(
    SNARKJS_BIN,
    ["powersoftau", "prepare", "phase2", contrib, finalPtau],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  return finalPtau;
}

// UNSAFE dev ceremony — deterministic entropy, for local testing and CI
// only. Matches scripts/setup-dev.sh's per-shape block exactly. Never use
// these keys in production; a real deployment needs a secure Phase-2 MPC.
function ensureDevZkey() {
  if (
    newerThanAll(fs.statSync(LEDGER_PATHS.r1cs).mtimeMs, [
      LEDGER_PATHS.zkey,
      LEDGER_PATHS.vkey,
    ])
  ) {
    return LEDGER_PATHS;
  }
  const ptauPath = ensureDevPtau();
  const initialZkey = path.join(LEDGER_PATHS.outdir, "0000.zkey");
  execFileSync(
    SNARKJS_BIN,
    ["groth16", "setup", LEDGER_PATHS.r1cs, ptauPath, initialZkey],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  execFileSync(
    SNARKJS_BIN,
    ["zkey", "contribute", initialZkey, LEDGER_PATHS.zkey, "--name=dev"],
    {
      input: "armada-zkey-contribution\n",
      stdio: ["pipe", "ignore", "inherit"],
    },
  );
  execFileSync(
    SNARKJS_BIN,
    ["zkey", "export", "verificationkey", LEDGER_PATHS.zkey, LEDGER_PATHS.vkey],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  return LEDGER_PATHS;
}

function countConstraints(r1csPath) {
  const output = execFileSync(SNARKJS_BIN, ["r1cs", "info", r1csPath], {
    encoding: "utf-8",
  });
  const match = /# of Constraints:\s*(\d+)/.exec(output);
  if (!match) {
    throw new Error(`could not parse constraint count from: ${output}`);
  }
  return Number(match[1]);
}

let poseidonPromise = null;
function getPoseidon() {
  if (!poseidonPromise) {
    poseidonPromise = require("circomlibjs").buildPoseidon();
  }
  return poseidonPromise;
}

module.exports = {
  ROOT,
  BUILD_ROOT,
  LEDGER_PATHS,
  MAIN_FILE,
  OPERATIONS_FILE,
  ensureCompiled,
  ensureDevZkey,
  countConstraints,
  getPoseidon,
};
