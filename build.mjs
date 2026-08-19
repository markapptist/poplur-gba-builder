#!/usr/bin/env node
/**
 * Build one ROM.
 *
 * Reads a validated CreatureCollectorSpec on stdin, writes game_data.h, runs
 * make, and writes the .gba to the path given by --out. It does not talk to
 * Firestore or Cloud Storage: whatever schedules this owns the credentials and
 * the upload, so a compromised build step cannot reach the database.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { generateGameData } from "./codegen.mjs";

const TEMPLATE = "/build/template";

// Mirrors creatureCollectorSpec.ts. Kept here rather than imported so the
// builder image has no dependency on the Functions codebase — if the two ever
// disagree, the ROM is wrong in a way the validator already ruled out, so this
// copy is asserted against the spec's own version field below.
const EXPECTED_SPEC_VERSION = 1;
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

const outFlag = process.argv.indexOf("--out");
const outPath = outFlag >= 0 ? process.argv[outFlag + 1] : "/out/game.gba";
const specPath = process.argv.includes("--spec")
  ? process.argv[process.argv.indexOf("--spec") + 1]
  : null;

const raw = specPath ? readFileSync(specPath, "utf8") : readFileSync(0, "utf8");
if (!raw.trim()) {
  // Almost always `docker run` without -i, which closes stdin before the
  // container reads it. Say that rather than failing on empty JSON.
  console.error("No specification on stdin.");
  console.error("If you are running this in Docker, pass -i so stdin stays open:");
  console.error("  docker run --rm -i -v \"$PWD/out:/out\" poplur-gba-builder --out /out/game.gba < spec.json");
  process.exit(2);
}

let spec;
try {
  spec = JSON.parse(raw);
} catch (error) {
  console.error(`The specification is not valid JSON: ${error.message}`);
  process.exit(2);
}

if (spec.version !== EXPECTED_SPEC_VERSION) {
  console.error(`spec version ${spec.version} but this image builds version ${EXPECTED_SPEC_VERSION}`);
  process.exit(2);
}

// Two levels under /opt/butano so the Makefile's relative ../../butano and
// ../../common resolve, matching the layout Butano's examples use.
const work = "/opt/butano/work/rom";
mkdirSync(join(work, "src"), { recursive: true });
mkdirSync(join(work, "include"), { recursive: true });

for (const f of ["Makefile"]) copyFileSync(join(TEMPLATE, f), join(work, f));
copyFileSync(join(TEMPLATE, "src", "main.cpp"), join(work, "src", "main.cpp"));

const header = generateGameData(spec, TYPE_CHART);
writeFileSync(join(work, "include", "game_data.h"), header);
console.error(`generated game_data.h (${header.split("\n").length} lines)`);

try {
  execFileSync("make", ["-j4"], {
    cwd: work,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, BUTANO: process.env.BUTANO ?? "/opt/butano/butano" },
    // A generated game that will not compile is a bug in the template, not a
    // reason to hang the job.
    timeout: 10 * 60 * 1000,
  });
} catch (error) {
  console.error("build failed:", error.message);
  process.exit(1);
}

// The Makefile names the ROM after its directory.
const built = join(work, "rom.gba");
if (!existsSync(built)) {
  console.error("make reported success but produced no .gba");
  process.exit(1);
}

mkdirSync(dirname(outPath), { recursive: true });
copyFileSync(built, outPath);
console.error(`wrote ${outPath}`);
