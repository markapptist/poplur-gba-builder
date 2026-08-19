/**
 * Turn a validated CreatureCollectorSpec into game_data.h.
 *
 * Claude never writes C++. This file does, from a spec that already passed the
 * validator — so by the time anything here runs, every move id resolves, every
 * species is obtainable and every number is in range. That is why the code
 * below can index arrays without checking: the checking already happened.
 *
 * Slugs are resolved to indices here rather than in the game, so the ROM does
 * no string comparison at runtime and the GBA never stores the slug table.
 */

const TYPES = ["ember", "tide", "bloom", "spark", "stone", "gale", "shade", "beast"];
const EFFECTS = ["none", "lower_attack", "lower_defense", "raise_attack", "raise_defense", "heal", "poison", "stun"];
const RARITIES = ["common", "uncommon", "rare", "legendary"];

/** The validator's charset already excludes quotes and backslashes; this is
 *  belt-and-braces so a future charset change cannot produce broken C++. */
const cstr = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export function generateGameData(spec, typeChart) {
  const speciesIndex = new Map(spec.creatures.map((c, i) => [c.species, i]));
  const moveIndex = new Map(spec.moves.map((m, i) => [m.id, i]));

  const out = [];
  const w = (line = "") => out.push(line);

  w("// Generated from a validated game specification. Do not edit by hand.");
  w("// Every index in this file was resolved against the spec at build time.");
  w("#pragma once");
  w("#include <cstdint>");
  w("");
  w("namespace poplur {");
  w("");
  w(`constexpr const char* GAME_TITLE = ${cstr(spec.title)};`);
  w(`constexpr const char* GAME_BLURB = ${cstr(spec.description)};`);
  w(`constexpr const char* RIVAL_NAME = ${cstr(spec.rivalName)};`);
  w(`constexpr const char* CHAMPION_NAME = ${cstr(spec.championName)};`);
  w(`constexpr int PARTY_SIZE = ${spec.partySize};`);
  w("");
  w(`constexpr int TYPE_COUNT = ${TYPES.length};`);
  w(`constexpr const char* TYPE_NAMES[TYPE_COUNT] = { ${TYPES.map(cstr).join(", ")} };`);
  w("");

  // Effectiveness as a flat multiplier table in tenths, so battle maths stays
  // integer-only — the GBA has no FPU and a float multiply here would cost more
  // than the whole damage formula.
  w("// x10 fixed point: 20 = super effective, 5 = resisted, 10 = neutral.");
  w("constexpr uint8_t TYPE_EFFECT[TYPE_COUNT][TYPE_COUNT] = {");
  for (const attacker of TYPES) {
    const row = TYPES.map((defender) => {
      const entry = typeChart[attacker];
      if (entry.strongAgainst.includes(defender)) return 20;
      if (entry.weakAgainst.includes(defender)) return 5;
      return 10;
    });
    w(`  { ${row.join(", ")} }, // ${attacker} attacking`);
  }
  w("};");
  w("");

  w("struct Move { const char* name; uint8_t type; uint8_t power; uint8_t accuracy; uint8_t effect; };");
  w(`constexpr int MOVE_COUNT = ${spec.moves.length};`);
  w("constexpr Move MOVES[MOVE_COUNT] = {");
  for (const m of spec.moves) {
    w(`  { ${cstr(m.displayName)}, ${TYPES.indexOf(m.type)}, ${m.power}, ${m.accuracy}, ${EFFECTS.indexOf(m.effect)} },`);
  }
  w("};");
  w("");

  w("struct Creature {");
  w("  const char* name; uint8_t type;");
  w("  uint8_t hp; uint8_t attack; uint8_t defense; uint8_t speed;");
  w("  uint8_t moves[4]; uint8_t move_count;");
  w("  uint8_t rarity; uint8_t catch_rate;");
  w("  int8_t evolves_into; uint8_t evolve_level;  // evolves_into is -1 when it does not evolve");
  w("};");
  w(`constexpr int CREATURE_COUNT = ${spec.creatures.length};`);
  w("constexpr Creature CREATURES[CREATURE_COUNT] = {");
  for (const c of spec.creatures) {
    const moves = c.moves.map((id) => moveIndex.get(id));
    const padded = [...moves, ...Array(4 - moves.length).fill(0)];
    const evo = c.evolvesInto ? speciesIndex.get(c.evolvesInto) : -1;
    w(
      `  { ${cstr(c.displayName)}, ${TYPES.indexOf(c.type)}, ${c.baseHp}, ${c.baseAttack}, ` +
      `${c.baseDefense}, ${c.baseSpeed}, { ${padded.join(", ")} }, ${moves.length}, ` +
      `${RARITIES.indexOf(c.rarity)}, ${c.catchRate}, ${evo}, ${c.evolvesInto ? c.evolveLevel : 0} },`,
    );
  }
  w("};");
  w("");

  const maxEnc = Math.max(...spec.zones.map((z) => z.encounters.length));
  w("struct Zone { const char* name; uint8_t encounters[" + maxEnc + "]; uint8_t encounter_count; uint8_t level_min; uint8_t level_max; };");
  w(`constexpr int ZONE_COUNT = ${spec.zones.length};`);
  w("constexpr Zone ZONES[ZONE_COUNT] = {");
  for (const z of spec.zones) {
    const enc = z.encounters.map((s) => speciesIndex.get(s));
    const padded = [...enc, ...Array(maxEnc - enc.length).fill(0)];
    w(`  { ${cstr(z.displayName)}, { ${padded.join(", ")} }, ${enc.length}, ${z.levelMin}, ${z.levelMax} },`);
  }
  w("};");
  w("");

  w(`constexpr int STARTERS[3] = { ${spec.starters.map((s) => speciesIndex.get(s)).join(", ")} };`);
  w("");
  w("}  // namespace poplur");
  w("");

  return out.join("\n");
}
