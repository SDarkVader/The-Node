> This is a simulation-recording viewer, separate from the [current experiment](../research/CURRENT_EXPERIMENT.md). Read the repository results page for the live pilot; a web recording is not private experimental recovery state.

# Browser viewer — a recording of the node, not a game

A stopgap so the shard can be looked at from a phone, or anywhere without a terminal. The
interactive instrument is `npm run playtest`; being *inside* the place is the Godot client's
job. This is neither.

```
npm run web-export -- docs/web/world.json 7 180
node docs/web/build.mjs docs/web/world.json docs/web/viewer.template.html out.html
```

`world.json` is generated and deliberately not committed — regenerate it for whatever seed and
length you want. `viewer.template.html` carries a `/*__DATA__*/` placeholder the build step
substitutes.

This is a generated recording viewer, not a live subscription to the experiment. Use the
[Claude Design handover](../research/CLAUDE_DESIGN_OBSERVATORY_HANDOVER_2026-10-23.md) for the
proposed realtime evidence/world adapters and synchronized Godot connection. The current engine
has positioned Grifters; an older export's missing fields must not be described as missing
coordinates throughout the engine. Ember colours remain a visual reference, not reasoning scores.
