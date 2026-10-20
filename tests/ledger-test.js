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

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const snarkjs = require("snarkjs");
const {
  ROOT,
  LEDGER_PATHS,
  ensureCompiled,
  ensureDevZkey,
  countConstraints,
  getPoseidon,
} = require("./lib/ledger-circuit");

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

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exit(1);
});
