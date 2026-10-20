const fs = require("fs");
const p = "src/operations/TransactOwned.circom";
let s = fs.readFileSync(p, "utf8");

// Fix the msgHash input assignments
s = s.replace("msgHash.inputs[1] <== boundParamsHash;", "for (var i = 0; i < N; i++) {\n    msgHash.inputs[1 + i] <== nullifiers[i];\n  }\n  for (var j = 0; j < M; j++) {\n    msgHash.inputs[1 + N + j] <== commitmentsOut[j];\n  }");

// Now remove the old for-loops that are now duplicated
s = s.replace(/  for \(var i = 0; i < N; i\) \{\n    msgHash\.inputs\[2 \+ i\] <== nullifiers\[i\];\n  \}\n  for \(var j = 0; j < M; j\) \{\n    msgHash\.inputs\[2 \+ N \+ j\] <== commitmentsOut\[j\];\n  \}/, "");

// Change boundParamsHash assignment to a constraint
s = s.replace("boundParamsHash <== msgHash.out;", "boundParamsHash === msgHash.out;");

fs.writeFileSync(p, s);
console.log("fixed");
