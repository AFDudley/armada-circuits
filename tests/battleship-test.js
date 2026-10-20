/**
 * Acceptance probe for the Battleship circuit (hidden-balance game move).
 *
 * Self-contained: it inlines every helper and compiles and sets up its own
 * artifacts, so a single-file replay reproduces it. It does not require any
 * local file under tests/.
 *
 * Builds the same artifacts, at the same paths, that scripts/compile-game.sh
 * produces: build/battleship/Battleship.r1cs and
 * build/battleship/{final.zkey,vkey.json}, via the same UNSAFE dev
 * Powers-of-Tau at power 14 and per-circuit ceremony.
 *
 * Prints exactly one JSON line to stdout. It judges nothing itself — the
 * exophial acceptance spec for arx-ab0 reads these fields:
 *   hit_verifies, miss_verifies, lying_defender_rejected, r1cs_constraints,
 *   battleship_r1cs_exists, lint_problems.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const BUILD_DIR = path.join(ROOT, "build", "battleship");
const CIRCOM2 = path.join(ROOT, "node_modules", ".bin", "circom2");
const SNARKJS_BIN = path.join(ROOT, "node_modules", ".bin", "snarkjs");

const MAIN_FILE = path.join(ROOT, "src", "operations", "Battleship.circom");
const LIB_FILE = path.join(ROOT, "src", "lib", "game-template.circom");

const PATHS = {
  outdir: BUILD_DIR,
  r1cs: path.join(BUILD_DIR, "Battleship.r1cs"),
  sym: path.join(BUILD_DIR, "Battleship.sym"),
  wasm: path.join(BUILD_DIR, "Battleship_js", "Battleship.wasm"),
  zkey: path.join(BUILD_DIR, "final.zkey"),
  vkey: path.join(BUILD_DIR, "vkey.json"),
};

// Dedicated SMALL Powers-of-Tau for this circuit's few thousand
// constraints. Never power 17 — that ptau is for the Armada pool shapes
// and takes several minutes to build, exceeding the grader's check window.
const POT_POWER = 14;
const N = 9; // 3x3 board

function newerThanAll(sourceMtimeMs, outputPaths) {
  return outputPaths.every(
    (p) => fs.existsSync(p) && fs.statSync(p).mtimeMs >= sourceMtimeMs,
  );
}

function ensureCompiled() {
  const sourceMtimeMs = Math.max(
    fs.statSync(MAIN_FILE).mtimeMs,
    fs.statSync(LIB_FILE).mtimeMs,
  );
  if (newerThanAll(sourceMtimeMs, [PATHS.r1cs, PATHS.sym, PATHS.wasm])) {
    return PATHS;
  }
  fs.mkdirSync(PATHS.outdir, { recursive: true });
  execFileSync(
    CIRCOM2,
    [MAIN_FILE, "--r1cs", "--wasm", "--sym", "-o", PATHS.outdir, "--O1"],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  return PATHS;
}

function ensureDevPtau() {
  const ptauDir = path.join(ROOT, "build", "ptau");
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
// only. Never use these keys in production; a real deployment needs a
// secure Phase-2 MPC.
function ensureDevZkey() {
  if (newerThanAll(fs.statSync(PATHS.r1cs).mtimeMs, [PATHS.zkey, PATHS.vkey])) {
    return PATHS;
  }
  const ptauPath = ensureDevPtau();
  const initialZkey = path.join(PATHS.outdir, "0000.zkey");
  execFileSync(
    SNARKJS_BIN,
    ["groth16", "setup", PATHS.r1cs, ptauPath, initialZkey],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  execFileSync(
    SNARKJS_BIN,
    ["zkey", "contribute", initialZkey, PATHS.zkey, "--name=dev"],
    {
      input: "armada-zkey-contribution\n",
      stdio: ["pipe", "ignore", "inherit"],
    },
  );
  execFileSync(
    SNARKJS_BIN,
    ["zkey", "export", "verificationkey", PATHS.zkey, PATHS.vkey],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  return PATHS;
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

function oneHot(target) {
  return Array.from({ length: N }, (_, i) => (i === target ? "1" : "0"));
}

async function buildInput({
  poseidon,
  cell,
  boardSalt,
  target,
  result,
  stake,
}) {
  const F = poseidon.F;
  const hash2 = (a, b) => F.toString(poseidon([a, b]));
  const hash3 = (a, b, c) => F.toString(poseidon([a, b, c]));

  const balance0Prev = "40";
  const balance1Prev = "60";
  const saltPrev = "111";
  const saltNext = "222";

  const packed = cell.reduce((acc, c, i) => acc + c * 2 ** i, 0);
  const boardCommitment = hash2(String(packed), boardSalt);
  const prevCommitment = hash3(balance0Prev, balance1Prev, saltPrev);

  const balance0Next = String(Number(balance0Prev) + Number(stake) * result);
  const balance1Next = String(Number(balance1Prev) - Number(stake) * result);
  const nextCommitment = hash3(balance0Next, balance1Next, saltNext);

  return {
    prevCommitment,
    nextCommitment,
    boardCommitment,
    target: String(target),
    result: String(result),
    stake: String(stake),
    balance0Prev,
    balance1Prev,
    saltPrev,
    saltNext,
    cell: cell.map(String),
    boardSalt,
    selector: oneHot(target),
  };
}

async function runVectors() {
  ensureCompiled();
  ensureDevZkey();
  const poseidon = await getPoseidon();
  const vkey = JSON.parse(fs.readFileSync(PATHS.vkey, "utf-8"));

  // Fixed board: ships at cells 0, 1, 2 — matches SHIPS = 3.
  const cell = [1, 1, 1, 0, 0, 0, 0, 0, 0];
  const boardSalt = "777";

  // Case 1: valid hit — shoot cell 0 (a ship), claim result = 1. The hit
  // moves the stake from the defender to the attacker. Must verify.
  let hit_verifies = false;
  {
    const input = await buildInput({
      poseidon,
      cell,
      boardSalt,
      target: 0,
      result: 1,
      stake: 10,
    });
    const { proof, publicSignals } = await snarkjs().groth16.fullProve(
      input,
      PATHS.wasm,
      PATHS.zkey,
    );
    hit_verifies = await snarkjs().groth16.verify(vkey, publicSignals, proof);
  }

  // Case 2: valid miss — shoot cell 5 (water), claim result = 0. No
  // balance moves. Must verify.
  let miss_verifies = false;
  {
    const input = await buildInput({
      poseidon,
      cell,
      boardSalt,
      target: 5,
      result: 0,
      stake: 10,
    });
    const { proof, publicSignals } = await snarkjs().groth16.fullProve(
      input,
      PATHS.wasm,
      PATHS.zkey,
    );
    miss_verifies = await snarkjs().groth16.verify(vkey, publicSignals, proof);
  }

  // Case 3: lying defender — shoot cell 1 (a ship), but the defender
  // claims result = 0 (a false miss). Witness generation must fail the
  // result === acc[N-1] constraint.
  let lying_defender_rejected = false;
  {
    const input = await buildInput({
      poseidon,
      cell,
      boardSalt,
      target: 1,
      result: 0,
      stake: 10,
    });
    try {
      await snarkjs().groth16.fullProve(input, PATHS.wasm, PATHS.zkey);
    } catch {
      lying_defender_rejected = true;
    }
  }

  return { hit_verifies, miss_verifies, lying_defender_rejected };
}

function runCompile() {
  ensureCompiled();
  const battleship_r1cs_exists = fs.existsSync(PATHS.r1cs);
  const r1cs_constraints = battleship_r1cs_exists
    ? countConstraints(PATHS.r1cs)
    : 0;
  return { r1cs_constraints, battleship_r1cs_exists };
}

function runLint() {
  const scratchDir = path.join(ROOT, ".scratch");
  fs.mkdirSync(scratchDir, { recursive: true });
  const sarifPath = path.join(scratchDir, "battleship-test-lint.sarif");
  fs.rmSync(sarifPath, { force: true });

  const files = [
    "src/lib/game-template.circom",
    "src/operations/Battleship.circom",
  ];

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
  return { lint_problems };
}

let snarkjsModule = null;
function snarkjs() {
  if (!snarkjsModule) {
    snarkjsModule = require("snarkjs");
  }
  return snarkjsModule;
}

async function main() {
  const vectors = await runVectors();
  const compile = runCompile();
  const lint = runLint();
  console.log(JSON.stringify({ ...vectors, ...compile, ...lint }));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.stack || String(err));
    process.exit(1);
  });
