const fs = require("fs");
const p = "scripts/compile.sh";
let s = fs.readFileSync(p, "utf8");

// 1. Use repo-installed circom2 (c9)
s = s.replace(
  "CIRCOM_BIN=\"${CIRCOM_BIN:-circom}\"",
  "CIRCOM_BIN=\"${CIRCOM_BIN:-node_modules/.bin/circom2}\""
);

// 2. Add OWNED_SHAPES array after SHAPES
const shapAnchor = "# All circuit shapes (must match VerifierModule key set)\nSHAPES=(\n  \"1,1\" \"1,2\" \"2,2\" \"2,3\" \"8,4\"\n  \"2,1\" \"3,1\" \"4,1\" \"5,1\" \"6,1\" \"7,1\" \"8,1\"\n  \"3,2\" \"4,2\" \"5,2\" \"6,2\"\n  \"1,3\" \"3,3\" \"4,3\"\n)";
const ownedBlock = shapAnchor + "\n\n# Owned Transact variants (contract owns the shielded note).\n# Each derives the note's npk as Poseidon(ownerField, random) with\n# ownerField = uint256(uint160(owner)) as a public input; no EdDSA check.\nOWNED_SHAPES=(\n  \"1x1_owned\" \"1x2_owned\" \"1x3_owned\"\n)";
if (!s.includes(shapAnchor)) { console.log("SHAPES anchor NOT FOUND"); }
else { s = s.replace(shapAnchor, ownedBlock); }

// 3. Add owned compile loop before the Done line
const doneLine = "echo \"Done. Compiled ${#SHAPES[@]} shapes.\"";
const ownedLoop =
  "# Compile owned variants — c1/c2: each owned shape produces an r1cs and a wasm.\n" +
  "for s in \"${OWNED_SHAPES[@]}\"; do\n" +
  "  main_file=\"$SRC_DIR/main/main_${s}.circom\"\n" +
  "  outdir=\"$BUILD_DIR/${s}\"\n" +
  "\n" +
  "  if [ ! -f \"$main_file\" ]; then\n" +
  "    echo \"  SKIP ${s} (no entry point at $main_file)\"\n" +
  "    continue\n" +
  "  fi\n" +
  "\n" +
  "  echo \"  Compiling ${s} (owned)...\"\n" +
  "  mkdir -p \"$outdir\"\n" +
  "  \"$CIRCOM_BIN\" \"$main_file\" \\\n" +
  "    --r1cs --wasm --sym \\\n" +
  "    -o \"$outdir\" \\\n" +
  "    --O1\n" +
  "\n" +
  "  echo \"    → $outdir/main_${s}.r1cs\"\n" +
  "  done\n" +
  "\n";
if (!s.includes(doneLine)) { console.log("Done line NOT FOUND"); }
else { s = s.replace(doneLine, ownedLoop); }

// 4. Update the final summary line to report both standard and owned counts
s = s.replace(
  "echo \"Done. Compiled ${#SHAPES[@]} shapes.\"",
  "echo \"Done. Compiled ${#SHAPES[@]} standard + ${#OWNED_SHAPES[@]} owned shapes.\""
);

fs.writeFileSync(p, s);
console.log("compile.sh updated");
