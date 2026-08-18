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

**What it honestly is not**: there is no avatar, nothing moves, and the ~third of the population
without a role has no coordinates in the engine at all, so they cannot appear on the map. It
uses the Ember palette chosen for `sim/playtestRenderer.ts` so both views read as one world.
