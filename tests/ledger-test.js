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

const ROOT = path.join(__dirname, "..");
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
const POT_POWER = 12;

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

/**
 * Acceptance script for the Ledger circuit (hidden-balance channel move).
 *
 * Usage:
 *   node tests/ledger-test.js vectors   # prove/verify the three vector cases
 *   node tests/ledger-test.js compile   # compile and report constraint count
 *   node tests/ledger-test.js lint      # run circomspect on the Ledger files
 *
 * Each mode prints exactly one JSON line to stdout; it judges nothing
 * itself — the exophial acceptance spec for arx-799 reads these fields.
 */

const snarkjs = require("snarkjs");

async function buildWitness({
  poseidon,
  balance0Prev,
  balance1Prev,
  balance0Next,
  balance1Next,
  saltPrev,
  saltNext,
  nextCommitmentOverride,
}) {
  const F = poseidon.F;
  const hash3 = (a, b, c) => F.toString(poseidon([a, b, c]));

  const prevCommitment = hash3(balance0Prev, balance1Prev, saltPrev);
  const nextCommitment =
    nextCommitmentOverride !== undefined
      ? nextCommitmentOverride
      : hash3(balance0Next, balance1Next, saltNext);

  return {
    prevCommitment,
    nextCommitment,
    balance0Prev,
    balance1Prev,
    balance0Next,
    balance1Next,
    saltPrev,
    saltNext,
  };
}

async function runVectors() {
  ensureCompiled();
  ensureDevZkey();
  const poseidon = await getPoseidon();

  // Case 1: valid move — 30 moves from party 0 to party 1. Must verify.
  let valid_move_verifies = false;
  {
    const input = await buildWitness({
      poseidon,
      balance0Prev: "100",
      balance1Prev: "50",
      balance0Next: "70",
      balance1Next: "80",
      saltPrev: "111",
      saltNext: "222",
    });
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input,
      LEDGER_PATHS.wasm,
      LEDGER_PATHS.zkey,
    );
    const vkey = JSON.parse(fs.readFileSync(LEDGER_PATHS.vkey, "utf-8"));
    valid_move_verifies = await snarkjs.groth16.verify(
      vkey,
      publicSignals,
      proof,
    );
  }

  // Case 2: conservation violated — 20 created from nothing. Witness
  // generation must fail the === constraint.
  let conservation_violation_rejected = false;
  {
    const input = await buildWitness({
      poseidon,
      balance0Prev: "100",
      balance1Prev: "50",
      balance0Next: "70",
      balance1Next: "90",
      saltPrev: "111",
      saltNext: "222",
    });
    try {
      await snarkjs.groth16.fullProve(
        input,
        LEDGER_PATHS.wasm,
        LEDGER_PATHS.zkey,
      );
    } catch {
      conservation_violation_rejected = true;
    }
  }

  // Case 3: commitment mismatch — valid, conserving balances, but the public
  // nextCommitment does not match Poseidon(balance0Next, balance1Next,
  // saltNext). Witness generation must fail the === constraint.
  let commitment_mismatch_rejected = false;
  {
    const wrongNextCommitment = await (async () => {
      const F = poseidon.F;
      return F.toString(poseidon(["70", "80", "999999"]));
    })();
    const input = await buildWitness({
      poseidon,
      balance0Prev: "100",
      balance1Prev: "50",
      balance0Next: "70",
      balance1Next: "80",
      saltPrev: "111",
      saltNext: "222",
      nextCommitmentOverride: wrongNextCommitment,
    });
    try {
      await snarkjs.groth16.fullProve(
        input,
        LEDGER_PATHS.wasm,
        LEDGER_PATHS.zkey,
      );
    } catch {
      commitment_mismatch_rejected = true;
    }
  }

  console.log(
    JSON.stringify({
      valid_move_verifies,
      conservation_violation_rejected,
      commitment_mismatch_rejected,
    }),
  );
}

function runCompile() {
  ensureCompiled();
  const main_ledger_r1cs_exists = fs.existsSync(LEDGER_PATHS.r1cs);
  const r1cs_constraints = main_ledger_r1cs_exists
    ? countConstraints(LEDGER_PATHS.r1cs)
    : 0;
  console.log(JSON.stringify({ r1cs_constraints, main_ledger_r1cs_exists }));
}

function runLint() {
  const scratchDir = path.join(ROOT, ".scratch");
  fs.mkdirSync(scratchDir, { recursive: true });
  const sarifPath = path.join(scratchDir, "ledger-test-lint.sarif");
  fs.rmSync(sarifPath, { force: true });

  const files = ["src/operations/Ledger.circom", "src/main/main_ledger.circom"];

  let lintExit = 0;
  try {
    execFileSync("circomspect", ["-l", "WARNING", "-s", sarifPath, ...files], {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch (err) {
    lintExit = err.status;
  }

  // circomspect exits 1 when it reports a finding — that is data for this
  // probe to report, not a script failure. Any other exit code is a real
  // tool failure (e.g. a parse error) and must propagate.
  if (lintExit !== 0 && lintExit !== 1) {
    throw new Error(`circomspect exited with unexpected code ${lintExit}`);
  }

  if (!fs.existsSync(sarifPath)) {
    throw new Error(`circomspect did not write a SARIF file at ${sarifPath}`);
  }

  const sarif = JSON.parse(fs.readFileSync(sarifPath, "utf-8"));
  const lint_problems = (sarif.runs || []).reduce(
    (n, run) => n + (run.results || []).length,
    0,
  );
  console.log(JSON.stringify({ lint_problems }));
}

async function main() {
  const mode = process.argv[2];
  if (mode === "vectors") return runVectors();
  if (mode === "compile") return runCompile();
  if (mode === "lint") return runLint();
  throw new Error(`Unknown mode: ${mode}. Use vectors|compile|lint.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.stack || String(err));
    process.exit(1);
  });
