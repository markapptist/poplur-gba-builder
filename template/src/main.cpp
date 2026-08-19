/*
 * Creature-collector engine.
 *
 * Hand-written and reviewed. Everything that varies between games arrives in
 * game_data.h, which the builder generates from a validated specification —
 * so this file is the same bytes for every ROM, and a prompt can only choose
 * data, never control flow.
 *
 * Presentation is text-only on purpose. Generated art is not something this
 * pipeline produces, and a game that renders its roster as text is playable
 * today, where one that waits on sprite sheets is not.
 */

#include "bn_core.h"
#include "bn_keypad.h"
#include "bn_random.h"
#include "bn_string.h"
#include "bn_vector.h"
#include "bn_bg_palettes.h"
#include "bn_sprite_ptr.h"
#include "bn_sprite_text_generator.h"
#include "common_variable_8x16_sprite_font.h"

#include "game_data.h"

namespace {

using poplur::CREATURES;
using poplur::MOVES;
using poplur::ZONES;
using poplur::TYPE_EFFECT;
using poplur::TYPE_NAMES;

constexpr int MAX_TEXT_SPRITES = 64;
constexpr int LINE_HEIGHT = 14;
constexpr int TOP = -68;

bn::random rng;

/** One creature the player owns or is fighting. Stats are derived from the
 *  species base plus level, so only the level and current HP are state. */
struct Mon
{
    int species = 0;
    int level = 1;
    int hp = 1;
    int attack_stage = 0;   // -2..2, reset when the battle ends
    int defense_stage = 0;

    int max_hp() const { return CREATURES[species].hp + level * 2; }
    int attack() const { return CREATURES[species].attack + level; }
    int defense() const { return CREATURES[species].defense + level; }
    int speed() const { return CREATURES[species].speed + level; }
    bool alive() const { return hp > 0; }
};

Mon make_mon(int species, int level)
{
    Mon m;
    m.species = species;
    m.level = level;
    m.hp = m.max_hp();
    return m;
}

/** Stage multipliers as x10 fixed point, so no float ever enters the maths. */
int staged(int value, int stage)
{
    static constexpr int MULT[5] = { 5, 7, 10, 14, 20 };
    int clamped = stage < -2 ? -2 : (stage > 2 ? 2 : stage);
    return value * MULT[clamped + 2] / 10;
}

struct Player
{
    bn::vector<Mon, 6> party;
    int zone = 0;
    int caught = 0;
    int balls = 15;

    Mon* lead()
    {
        for(Mon& m : party)
        {
            if(m.alive()) return &m;
        }
        return nullptr;
    }
};

// ---- text ------------------------------------------------------------------

class Screen
{
public:
    Screen() : _gen(common::variable_8x16_sprite_font) {}

    void clear() { _sprites.clear(); _y = TOP; }

    void line(const bn::string_view& text)
    {
        if(_sprites.available() < 12) return;      // text sprites are finite
        _gen.generate(-110, _y, text, _sprites);
        _y += LINE_HEIGHT;
    }

    void gap() { _y += LINE_HEIGHT / 2; }

    /** Centre a long string across several lines.
     *
     * The GBA screen is 240px and the bundled font averages ~8px a character,
     * so anything past roughly 28 characters runs off both edges when centred.
     * Descriptions come from a generated spec and are allowed to be a couple of
     * sentences, so wrapping is the engine's job, not the designer's.
     */
    void centre_wrapped(const char* text, int width = 28)
    {
        bn::string<64> line;
        int last_space = -1;

        for(const char* c = text; *c; ++c)
        {
            if(*c == ' ' && line.empty()) continue;      // no leading spaces
            line.append(*c);
            if(*c == ' ') last_space = line.size() - 1;

            if(int(line.size()) >= width)
            {
                if(last_space > 0)
                {
                    // Rewind to the last word boundary and carry the rest over.
                    bn::string<64> carry;
                    for(int i = last_space + 1; i < int(line.size()); ++i) carry.append(line[i]);
                    line.resize(last_space);
                    centre(line);
                    line = carry;
                }
                else
                {
                    centre(line);
                    line.clear();
                }
                last_space = -1;
            }
        }
        if(! line.empty()) centre(line);
    }

    void centre(const bn::string_view& text)
    {
        if(_sprites.available() < 12) return;
        _gen.set_alignment(bn::sprite_text_generator::alignment_type::CENTER);
        _gen.generate(0, _y, text, _sprites);
        _gen.set_alignment(bn::sprite_text_generator::alignment_type::LEFT);
        _y += LINE_HEIGHT;
    }

private:
    bn::sprite_text_generator _gen;
    bn::vector<bn::sprite_ptr, MAX_TEXT_SPRITES> _sprites;
    int _y = TOP;
};

/** Wait for one of the given keys, keeping the frame pump running. */
enum class Key { A, B, ANY };

void wait_release()
{
    while(bn::keypad::a_held() || bn::keypad::b_held() || bn::keypad::start_held())
    {
        bn::core::update();
    }
}

void wait_for_a()
{
    wait_release();
    while(! bn::keypad::a_pressed())
    {
        bn::core::update();
    }
}

bn::string<32> hp_bar(const Mon& m)
{
    bn::string<32> out;
    int filled = m.max_hp() > 0 ? (m.hp * 10 / m.max_hp()) : 0;
    if(filled < 0) filled = 0;
    if(filled > 10) filled = 10;
    out.append('[');
    for(int i = 0; i < 10; ++i) out.append(i < filled ? '=' : '.');
    out.append(']');
    return out;
}

bn::string<48> mon_line(const Mon& m)
{
    bn::string<48> out(CREATURES[m.species].name);
    out.append(" Lv");
    out.append(bn::to_string<8>(m.level));
    out.append(' ');
    out.append(hp_bar(m));
    return out;
}

// ---- battle ----------------------------------------------------------------

int damage_of(const Mon& attacker, const Mon& defender, int move_index)
{
    const auto& mv = MOVES[move_index];
    if(mv.power == 0) return 0;

    int atk = staged(attacker.attack(), attacker.attack_stage);
    int def = staged(defender.defense(), defender.defense_stage);
    if(def < 1) def = 1;

    // Classic shape: level and power scale the hit, defence divides it.
    int base = (((2 * attacker.level / 5 + 2) * mv.power * atk / def) / 50) + 2;

    int effect = TYPE_EFFECT[mv.type][CREATURES[defender.species].type];
    base = base * effect / 10;

    // Same-type attack bonus, integer only.
    if(mv.type == CREATURES[attacker.species].type) base = base * 3 / 2;

    // A little variance so identical turns are not identical.
    base = base * (90 + rng.get_int(11)) / 100;
    return base < 1 ? 1 : base;
}

void apply_effect(int move_index, Mon& user, Mon& target, Screen& screen)
{
    switch(MOVES[move_index].effect)
    {
    case 1: // lower_attack
        if(target.attack_stage > -2) { --target.attack_stage; screen.line("Its attack fell!"); }
        break;
    case 2: // lower_defense
        if(target.defense_stage > -2) { --target.defense_stage; screen.line("Its defence fell!"); }
        break;
    case 3: // raise_attack
        if(user.attack_stage < 2) { ++user.attack_stage; screen.line("Attack rose!"); }
        break;
    case 4: // raise_defense
        if(user.defense_stage < 2) { ++user.defense_stage; screen.line("Defence rose!"); }
        break;
    case 5: // heal
        user.hp += user.max_hp() / 4;
        if(user.hp > user.max_hp()) user.hp = user.max_hp();
        screen.line("It recovered health!");
        break;
    case 6: // poison
        target.hp -= target.max_hp() / 16;
        screen.line("It was poisoned!");
        break;
    case 7: // stun
        screen.line("It flinched!");
        break;
    default:
        break;
    }
}

void level_up(Mon& mon, Screen& screen)
{
    if(mon.level >= 60) return;
    ++mon.level;
    mon.hp = mon.max_hp();

    bn::string<48> msg(CREATURES[mon.species].name);
    msg.append(" grew to Lv");
    msg.append(bn::to_string<8>(mon.level));
    msg.append('!');
    screen.line(msg);

    const auto& def = CREATURES[mon.species];
    if(def.evolves_into >= 0 && mon.level >= def.evolve_level)
    {
        bn::string<48> evo(def.name);
        evo.append(" became ");
        evo.append(CREATURES[def.evolves_into].name);
        evo.append('!');
        mon.species = def.evolves_into;
        mon.hp = mon.max_hp();
        screen.line(evo);
    }
}

/** Returns true if the player won or caught; false if they fled or blacked out. */
bool battle(Player& player, Mon wild, Screen& screen, bool is_champion)
{
    int cursor = 0;

    while(true)
    {
        Mon* mine = player.lead();
        if(! mine)
        {
            screen.clear();
            screen.centre("You have no creature left.");
            screen.centre("You retreat to camp.");
            wait_for_a();
            for(Mon& m : player.party) m.hp = m.max_hp();
            return false;
        }

        const auto& my_def = CREATURES[mine->species];
        int move_count = my_def.move_count;
        if(cursor >= move_count) cursor = 0;

        // ---- draw ----
        screen.clear();
        screen.centre(is_champion ? poplur::CHAMPION_NAME : "Wild creature");
        screen.line(mon_line(wild));
        screen.gap();
        screen.line(mon_line(*mine));
        screen.gap();

        for(int i = 0; i < move_count; ++i)
        {
            const auto& mv = MOVES[my_def.moves[i]];
            bn::string<48> row(i == cursor ? "> " : "  ");
            row.append(mv.name);
            row.append(" (");
            row.append(TYPE_NAMES[mv.type]);
            row.append(')');
            screen.line(row);
        }
        screen.gap();
        if(! is_champion)
        {
            bn::string<32> throwing("B: throw ball (");
            throwing.append(bn::to_string<8>(player.balls));
            throwing.append(')');
            screen.line(throwing);
        }
        screen.line("START: run");

        // ---- input ----
        bool acted = false;
        int chosen = 0;
        bool threw = false;

        while(! acted)
        {
            bn::core::update();
            if(bn::keypad::up_pressed() && cursor > 0) { --cursor; break; }
            if(bn::keypad::down_pressed() && cursor < move_count - 1) { ++cursor; break; }
            if(bn::keypad::a_pressed()) { chosen = my_def.moves[cursor]; acted = true; }
            else if(bn::keypad::b_pressed() && ! is_champion && player.balls > 0) { threw = true; acted = true; }
            else if(bn::keypad::start_pressed())
            {
                if(is_champion) continue;              // no running from the champion
                for(Mon& m : player.party) { m.attack_stage = 0; m.defense_stage = 0; }
                return false;
            }
        }
        if(! acted) continue;

        // ---- resolve the player's action ----
        screen.clear();
        if(threw)
        {
            --player.balls;
            screen.centre("You throw a ball...");
            // Weaker and rarer creatures are harder; a hurt one is easier.
            int odds = CREATURES[wild.species].catch_rate + (wild.max_hp() - wild.hp) * 60 / wild.max_hp();
            if(rng.get_int(100) < odds && player.party.size() < poplur::PARTY_SIZE)
            {
                bn::string<48> got("Caught ");
                got.append(CREATURES[wild.species].name);
                got.append('!');
                screen.line(got);
                wild.attack_stage = 0;
                wild.defense_stage = 0;
                player.party.push_back(wild);
                ++player.caught;
                wait_for_a();
                return true;
            }
            screen.line(int(player.party.size()) >= poplur::PARTY_SIZE
                        ? "Your party is full!" : "It broke free!");
        }
        else
        {
            bn::string<48> used(my_def.name);
            used.append(" used ");
            used.append(MOVES[chosen].name);
            used.append('!');
            screen.line(used);

            int dmg = damage_of(*mine, wild, chosen);
            if(rng.get_int(100) >= MOVES[chosen].accuracy)
            {
                screen.line("It missed!");
            }
            else
            {
                int effect = TYPE_EFFECT[MOVES[chosen].type][CREATURES[wild.species].type];
                wild.hp -= dmg;
                if(effect > 10) screen.line("It's very effective!");
                else if(effect < 10) screen.line("It's not very effective.");
                apply_effect(chosen, *mine, wild, screen);
            }
        }

        if(wild.hp <= 0)
        {
            bn::string<48> down(CREATURES[wild.species].name);
            down.append(" was defeated!");
            screen.line(down);
            level_up(*mine, screen);
            for(Mon& m : player.party) { m.attack_stage = 0; m.defense_stage = 0; }
            wait_for_a();
            return true;
        }

        // ---- the wild creature answers ----
        const auto& wild_def = CREATURES[wild.species];
        int wild_move = wild_def.moves[rng.get_int(wild_def.move_count)];
        bn::string<48> reply(wild_def.name);
        reply.append(" used ");
        reply.append(MOVES[wild_move].name);
        reply.append('!');
        screen.line(reply);

        if(rng.get_int(100) < MOVES[wild_move].accuracy)
        {
            mine->hp -= damage_of(wild, *mine, wild_move);
            apply_effect(wild_move, wild, *mine, screen);
        }
        else
        {
            screen.line("It missed!");
        }

        if(mine->hp <= 0)
        {
            bn::string<48> fell(my_def.name);
            fell.append(" fainted!");
            screen.line(fell);
            mine->hp = 0;
        }

        wait_for_a();
    }
}

// ---- screens ---------------------------------------------------------------

void title_screen(Screen& screen)
{
    screen.clear();
    screen.gap();
    screen.centre(poplur::GAME_TITLE);
    screen.gap();
    screen.centre_wrapped(poplur::GAME_BLURB);
    screen.gap();
    screen.centre("Press A");
    wait_for_a();
}

int choose_starter(Screen& screen)
{
    int cursor = 0;
    while(true)
    {
        screen.clear();
        screen.centre("Choose your first creature");
        screen.gap();
        for(int i = 0; i < 3; ++i)
        {
            int species = poplur::STARTERS[i];
            bn::string<48> row(i == cursor ? "> " : "  ");
            row.append(CREATURES[species].name);
            row.append(" (");
            row.append(TYPE_NAMES[CREATURES[species].type]);
            row.append(')');
            screen.line(row);
        }
        screen.gap();
        screen.line("A: choose");

        while(true)
        {
            bn::core::update();
            if(bn::keypad::up_pressed() && cursor > 0) { --cursor; break; }
            if(bn::keypad::down_pressed() && cursor < 2) { ++cursor; break; }
            if(bn::keypad::a_pressed()) return poplur::STARTERS[cursor];
        }
    }
}

void party_screen(Player& player, Screen& screen)
{
    screen.clear();
    screen.centre("Your party");
    screen.gap();
    for(Mon& m : player.party) screen.line(mon_line(m));
    screen.gap();
    bn::string<32> tally("Caught: ");
    tally.append(bn::to_string<8>(player.caught));
    tally.append('/');
    tally.append(bn::to_string<8>(poplur::CREATURE_COUNT));
    screen.line(tally);
    screen.gap();
    screen.line("A: back");
    wait_for_a();
}

}  // namespace

int main()
{
    bn::core::init();
    bn::bg_palettes::set_transparent_color(bn::color(2, 4, 8));

    Screen screen;
    Player player;

    title_screen(screen);
    player.party.push_back(make_mon(choose_starter(screen), 5));

    bool champion_beaten = false;

    while(true)
    {
        const auto& zone = ZONES[player.zone];

        screen.clear();
        screen.centre(zone.name);
        screen.gap();
        screen.line(mon_line(player.party[0]));
        screen.gap();
        screen.line("A: search the grass");
        screen.line("B: party");
        if(player.zone > 0) screen.line("L: previous place");
        if(player.zone < poplur::ZONE_COUNT - 1) screen.line("R: next place");
        if(player.zone == poplur::ZONE_COUNT - 1 && ! champion_beaten)
        {
            bn::string<48> call("START: challenge ");
            call.append(poplur::CHAMPION_NAME);
            screen.line(call);
        }

        wait_release();
        bool moved = false;
        while(! moved)
        {
            bn::core::update();

            if(bn::keypad::a_pressed())
            {
                int species = zone.encounters[rng.get_int(zone.encounter_count)];
                int span = zone.level_max - zone.level_min + 1;
                int level = zone.level_min + rng.get_int(span);
                battle(player, make_mon(species, level), screen, false);
                moved = true;
            }
            else if(bn::keypad::b_pressed())
            {
                party_screen(player, screen);
                moved = true;
            }
            else if(bn::keypad::l_pressed() && player.zone > 0)
            {
                --player.zone;
                moved = true;
            }
            else if(bn::keypad::r_pressed() && player.zone < poplur::ZONE_COUNT - 1)
            {
                ++player.zone;
                moved = true;
            }
            else if(bn::keypad::start_pressed() && player.zone == poplur::ZONE_COUNT - 1 && ! champion_beaten)
            {
                // The champion fields the strongest creature in the game, near the cap.
                int best = 0;
                for(int i = 1; i < poplur::CREATURE_COUNT; ++i)
                {
                    const auto& c = CREATURES[i];
                    const auto& b = CREATURES[best];
                    if(c.hp + c.attack + c.defense + c.speed > b.hp + b.attack + b.defense + b.speed) best = i;
                }
                if(battle(player, make_mon(best, ZONES[poplur::ZONE_COUNT - 1].level_max + 4), screen, true))
                {
                    champion_beaten = true;
                    screen.clear();
                    screen.gap();
                    screen.centre("You beat");
                    screen.centre(poplur::CHAMPION_NAME);
                    screen.gap();
                    screen.centre("You are the champion!");
                    wait_for_a();
                }
                moved = true;
            }
        }
    }
}
