// The codegen turns slugs into raw array indices, and the C++ trusts them
// completely. A wrong index here is an out-of-bounds read on real hardware,
// so these check the resolution, not just that output appeared.
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

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const spec = {
  title: "Cinder Isles", description: "Tame a volcanic archipelago.",
  rivalName: "Wren", championName: "Ardo", partySize: 6,
  starters: ["reedling", "flintbug", "ashpup"],
  moves: [
    { id: "scratch", displayName: "Scratch", type: "beast", power: 40, accuracy: 100, effect: "none" },
    { id: "ember_spit", displayName: "Ember Spit", type: "ember", power: 60, accuracy: 90, effect: "none" },
    { id: "tide_slap", displayName: "Tide Slap", type: "tide", power: 55, accuracy: 95, effect: "lower_attack" },
  ],
  creatures: [
    { species: "ashpup", displayName: "Ashpup", type: "ember", baseHp: 45, baseAttack: 50, baseDefense: 40, baseSpeed: 60,
      moves: ["scratch", "ember_spit"], rarity: "common", catchRate: 45, evolvesInto: "ashhound", evolveLevel: 16 },
    { species: "ashhound", displayName: "Ashhound", type: "ember", baseHp: 70, baseAttack: 80, baseDefense: 60, baseSpeed: 85,
      moves: ["ember_spit"], rarity: "rare", catchRate: 12, evolvesInto: "", evolveLevel: 0 },
    { species: "reedling", displayName: "Reedling", type: "tide", baseHp: 50, baseAttack: 45, baseDefense: 50, baseSpeed: 45,
      moves: ["tide_slap"], rarity: "common", catchRate: 50, evolvesInto: "", evolveLevel: 0 },
    { species: "flintbug", displayName: "Flintbug", type: "stone", baseHp: 40, baseAttack: 55, baseDefense: 65, baseSpeed: 30,
      moves: ["scratch"], rarity: "common", catchRate: 55, evolvesInto: "", evolveLevel: 0 },
  ],
  zones: [
    { id: "ember_shore", displayName: "Ember Shore", encounters: ["ashpup", "flintbug"], levelMin: 3, levelMax: 7 },
    { id: "tide_caves", displayName: "Tide Caves", encounters: ["reedling"], levelMin: 8, levelMax: 14 },
  ],
};

const h = generateGameData(spec, TYPE_CHART);

check("emits a header guard and namespace", h.includes("#pragma once") && h.includes("namespace poplur"));
check("counts match the spec", h.includes("CREATURE_COUNT = 4") && h.includes("MOVE_COUNT = 3") && h.includes("ZONE_COUNT = 2"));

// ashpup(0) evolves into ashhound(1); the three others never evolve → -1.
check("evolution resolves to a species index", /Ashpup.*, 1, 16 },/.test(h), h.match(/.*Ashpup.*/)?.[0]);
check("a non-evolving creature is -1", /Reedling.*, -1, 0 },/.test(h));

// starters are reedling(2), flintbug(3), ashpup(0) — order preserved, not sorted.
check("starters resolve in the order given", h.includes("STARTERS[3] = { 2, 3, 0 }"), h.match(/STARTERS.*/)?.[0]);

// ashpup knows scratch(0) and ember_spit(1); slots pad to 4 with count 2.
check("move ids resolve to indices and pad", /\{ 0, 1, 0, 0 \}, 2,/.test(h));

// ember attacking bloom is strong (20); ember attacking tide is weak (5); vs beast neutral (10).
const emberRow = h.split("\n").find((l) => l.includes("// ember attacking"));
check("type chart row is fixed-point and correct", emberRow?.includes("20") && emberRow?.includes("5"), emberRow?.trim());

// zone encounter arrays must be padded to a single width or the C++ struct breaks.
const zoneLines = h.split("\n").filter((l) => l.includes("Ember Shore") || l.includes("Tide Caves"));
const widths = zoneLines.map((l) => (l.match(/\{ ([\d, ]+) \}/)?.[1].split(",").length));
check("every zone pads to the same encounter width", widths.length === 2 && widths[0] === widths[1], String(widths));

check("no unresolved slug leaked into the C++", !/ashpup"|"scratch"|"ember_shore"/.test(h));
// The validator's charset already bars quotes and backslashes, so this checks
// the codegen's own escaping holds if that charset is ever widened.
const hostile = JSON.parse(JSON.stringify(spec));
hostile.creatures[0].displayName = 'Ash"pup\\';
const hh = generateGameData(hostile, TYPE_CHART);
check("a quote or backslash in a name is escaped, not emitted raw",
  hh.includes('"Ash\\"pup\\\\"'), hh.split("\n").find((l) => l.includes("pup"))?.trim());

console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
process.exit(failed ? 1 : 0);
