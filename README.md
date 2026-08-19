# gba-builder

Turns a validated creature-collector specification into a real `.gba` ROM.

This is the half of the arcade pipeline that Firebase Functions cannot do:
Butano needs devkitARM and a POSIX toolchain, and Functions is a short-lived
Node sandbox. The callable designs and stores a spec; this image builds it.

```
generateRetroGame (Functions)          this image (Cloud Run Job)
  Claude designs a spec        →       spec ──► game_data.h ──► make ──► game.gba
  validator accepts it                 (no Firebase credentials, no DB handle)
  writes the build doc         ←       artifact + build result
```

## What it does and does not trust

The builder receives a spec that already passed `validateCreatureCollectorSpec`,
so `codegen.mjs` resolves slugs to raw array indices without re-checking them —
the checking happened upstream. It has no Firebase credentials and no database
handle by design: whatever schedules the job owns the upload, so a compromised
build step cannot reach user data.

Claude never writes C++. `template/src/main.cpp` is hand-written and identical in
every ROM; only `game_data.h` varies. A prompt chooses data, not control flow.

## Run it

```bash
docker build -t poplur-gba-builder .
docker run --rm -i -v "$PWD/out:/out" poplur-gba-builder --out /out/game.gba < sample-spec.json
```

`sample-spec.json` is a real spec in the shape the validator emits, kept so the
image can be smoke-tested without calling the model.

## Status — read this before deploying

**The ROM has never been compiled.** There is no devkitARM, Butano or Docker on
the machine this was written on, so `main.cpp`, the `Makefile` and the Dockerfile
are unverified against a real toolchain. The first `docker build` is where
Butano API mismatches will surface, and some are likely.

What *is* verified, by `node codegen.check.mjs` and `node symbols.check.mjs`:

- slugs resolve to the correct indices, evolution to a species index, `""` to `-1`
- the type-effectiveness table is square, fixed-point, and matches `TYPE_COUNT`
- creature move arrays are exactly four wide and `move_count` never exceeds four
- every `poplur::` symbol `main.cpp` reads exists in generated `game_data.h`
- every struct field the engine reads is declared by the codegen
- `PARTY_SIZE` cannot overflow the engine's fixed party vector
- names containing a quote or backslash are escaped rather than emitted raw

Those cover the class of bug that would otherwise be an out-of-bounds read on
real hardware. They do not cover whether Butano's API is spelled correctly.

## Presentation

Text-only, deliberately. Generated sprite art is not something this pipeline
produces, so the engine renders creatures, battles and menus with Butano's
bundled font. A generated game is playable without waiting on art.

## Layout

| Path | What it is |
|---|---|
| `Dockerfile` | Pinned devkitARM + Butano 17.3.0 |
| `build.mjs` | Reads a spec, writes the header, runs make, emits the ROM |
| `codegen.mjs` | Spec → `game_data.h`. The only thing that writes C++ |
| `template/src/main.cpp` | The engine. Hand-written, same in every ROM |
| `template/Makefile` | Butano build, including `common/` for the font |
| `*.check.mjs` | What is verified without a compiler |
