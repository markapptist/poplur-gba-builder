// main.cpp is hand-written and game_data.h is generated; nothing compiles here,
// so the failure mode I can still catch is a NAME mismatch between the two.
// Every poplur:: symbol the engine reads must exist in the generated header.
import { readFileSync } from "node:fs";
import { generateGameData } from "./codegen.mjs";

const TYPE_CHART = {
  ember: { strongAgainst: ["bloom", "gale"], weakAgainst: ["tide", "stone"] },
  tide:  { strongAgainst: ["ember", "stone"], weakAgainst: ["bloom", "spark"] },
  bloom: { strongAgainst: ["tide", "stone"], weakAgainst: ["ember", "gale"] },
  spark: { strongAgainst: ["tide", "gale"], weakAgainst: ["stone", "bloom"] },
  stone: { strongAgainst: ["ember", "spark"], weakAgainst: ["tide", "bloom"] },
  gale:  { strongAgainst: ["bloom", "beast"], weakAgainst: ["ember", "spark"] },
  shade: { strongAgainst: ["beast", "spark"], weakAgainst: ["gale", "ember"] },
  beast: { strongAgainst: ["shade", "stone"], weakAgainst: ["gale", "shade"] },
};

const spec = JSON.parse(readFileSync("./sample-spec.json", "utf8"));
const header = generateGameData(spec, TYPE_CHART);
const cpp = readFileSync("./template/src/main.cpp", "utf8");

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

// Symbols the engine reaches for, however it spells the reference.
const used = new Set();
for (const m of cpp.matchAll(/poplur::([A-Za-z_][A-Za-z0-9_]*)/g)) used.add(m[1]);
for (const m of cpp.matchAll(/using poplur::([A-Za-z_][A-Za-z0-9_]*)/g)) used.add(m[1]);

const missing = [...used].filter((sym) => !new RegExp(`\\b${sym}\\b`).test(header));
check("every symbol main.cpp uses exists in game_data.h", missing.length === 0, missing.join(", "));

// Struct fields the engine reads, which the codegen must have declared.
const fields = ["evolves_into", "evolve_level", "catch_rate", "move_count", "encounter_count", "level_min", "level_max", "accuracy", "power", "rarity"];
const missingFields = fields.filter((f) => !header.includes(f));
check("every struct field the engine reads is declared", missingFields.length === 0, missingFields.join(", "));

// The engine indexes TYPE_EFFECT[move type][defender type]; both dimensions
// must equal TYPE_COUNT or a legal type index reads past the row.
const rows = header.split("\n").filter((l) => l.includes("attacking"));
const widths = new Set(rows.map((r) => r.match(/\{([^}]*)\}/)[1].split(",").length));
check("type table is square and matches TYPE_COUNT",
  rows.length === 8 && widths.size === 1 && [...widths][0] === 8, `${rows.length} rows, widths ${[...widths]}`);

// The engine writes into Creature::moves[4]; the codegen must never emit more.
const moveArrays = [...header.matchAll(/\{ (\d+(?:, \d+){3}) \}, (\d+),/g)];
check("creature move arrays are exactly 4 wide", moveArrays.length === spec.creatures.length,
  `${moveArrays.length} of ${spec.creatures.length}`);
check("declared move_count never exceeds 4", moveArrays.every((m) => Number(m[2]) <= 4));

// Party vector in the engine is bn::vector<Mon, 6>; a larger PARTY_SIZE overflows it.
const partySize = Number(header.match(/PARTY_SIZE = (\d+)/)[1]);
check("PARTY_SIZE fits the engine's fixed party vector", partySize <= 6, `PARTY_SIZE=${partySize}`);

console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
process.exit(failed ? 1 : 0);
