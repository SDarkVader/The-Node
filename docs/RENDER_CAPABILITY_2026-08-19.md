# What the dev environment can actually render (2026-08-19)

Godot 4.3 was installed into the development environment so the client could be **run and
looked at** rather than written blind. This document records what that environment can and
cannot do, measured by probe rather than assumed, because it determines which visual work can
be built-and-verified here versus written-and-shipped-unseen.

Re-run the probes in `scratchpad` if the environment changes; the numbers below are from
llvmpipe (Mesa 25.2.8) software rendering under `xvfb`, with no GPU.

---

## Works, verified by screenshot

| Capability | Status | Notes |
|---|---|---|
| **2D rendering, full client** | ✅ | The shipped `WorldView.gd` runs and draws correctly |
| **Isometric 3D** (`Camera3D`, `PROJECTION_ORTHOGONAL`) | ✅ | The reference image's viewpoint is reachable |
| **DirectionalLight3D / OmniLight3D** | ✅ | Real shading and falloff, visible in probe |
| **Emissive materials** (`emission_energy_multiplier`) | ✅ | Stations-as-light-sources works in 3D |
| **Glow / bloom** (`Environment.glow_enabled`) | ✅ | **Works in GL Compatibility.** This is the effect the reference leans on hardest |
| **Custom shaders** (`shader_type spatial`, canvas) | ✅ | Compile and render; no shader compiler limitation found |
| **GPUParticles3D** | ✅ | Constructs and emits |
| **CPUParticles3D** | ✅ | The safe fallback; visibly renders |
| **MultiMesh** (`MultiMeshInstance3D`) | ✅ | 62 buildings + 65 people as two draw calls — the real population scale |
| **Offscreen screenshot** (`get_viewport().get_texture().get_image()`) | ✅ | How every render in this session was checked |
| **Headless smoke test** (`--headless`) | ✅ | Runs scripts and sockets; does **not** call `_draw` |

## Does not work here

| Capability | Status | Why, and does it matter |
|---|---|---|
| **Forward+ / Vulkan** | ❌ | `VK_KHR_surface` missing under xvfb — no window-system surface for the software Vulkan driver. **Does not affect the user's PC**, which has a real GPU. It only means advanced Forward+-only effects (SDFGI, volumetric fog, SSIL) cannot be *verified here* |
| **Judging motion or feel** | ❌ | See the performance number below |

---

## The performance number, and what it actually limits

**64.8 ms/frame — about 15 fps — at full scale** (62 buildings + 65 people via MultiMesh,
240 particles, glow enabled, 1280×800, software renderer).

Read this correctly. It is **not** a statement about NODE's performance; it is a statement about
a CPU pretending to be a GPU. On any machine with real graphics hardware this scene is trivial.
What it means practically:

- **Still frames are reliable.** Composition, palette, contrast, legibility — all verifiable
  here, and every rendering decision this session was checked that way.
- **Motion is not.** Animation timing, camera feel, particle liveliness, whether movement reads
  as people walking or things teleporting — none of that can be judged at 15 fps. Those
  judgements have to happen on the PC.

That split is the honest boundary of what I can validate.

---

## What this makes buildable, against the reference image

The target shared 2026-08-19 (see `DESIGN_NODE_VISUAL_FOUNDATION_2026-08-19.md` §5b) is an
isometric city with a glowing monolith on a circular plaza, coloured emissive districts, smoke
plumes, and floating role icons. Against the probe results:

| Element of the target | Buildable here? | Note |
|---|---|---|
| Isometric viewpoint, 3-floor buildings with real height | **Yes** | `floors` is already 3 in the data (§2 of the visual brief) — the vertical dimension exists and is simply unrendered |
| The Wall as a lit monolith on a circular plaza | **Yes** | Emissive mesh + OmniLight + glow all verified |
| Stations as emissive light sources, blending between regions | **Yes** | Already true in 2D; 3D adds real light falloff instead of a drawn approximation |
| Smoke / haze plumes over a district under pressure | **Yes** | Particles work. Prefer `CPUParticles3D` while iterating here; GPU on the PC |
| Floating role icons above buildings and people | **Yes** | Either billboarded `Sprite3D` or a 2D overlay projected from 3D positions |
| Per-district identity hue (amber / cyan / magenta zones) | **Yes, but it is a design question first** | Colour is currently spent on heat and tension; a third channel risks collapsing "under strain" and "hidden from the record" into one gradient, which the visual brief §3 explicitly warns against |
| Dense multi-storey architecture, streets with depth | **Yes** | MultiMesh handles the instance count comfortably |

**Nothing in the target is blocked by the simulation.** Every signal it displays is already
computed and already on the wire. The gap is rendering work, and the probe says that work can be
done and visually checked in this environment — with the single exception of anything that has
to be judged in motion.

---

## Practical guidance for building it

- Run with `--rendering-method gl_compatibility`. Forward+ will not initialise here.
- Keep `xvfb-run -a` for anything that must call `_draw`; `--headless` skips rendering entirely.
- Always pass `--quit-after N`. Killing the process by timeout discards buffered `print` output
  and makes a working scene look silent — this cost real debugging time once already.
- Prefer `MultiMeshInstance3D` for buildings and people from the start. At 62 + 65 instances it
  is not yet a performance necessity on a real GPU, but it is here, and it costs nothing to
  structure that way early.
- `CPUParticles3D` while iterating in this environment; switch to `GPUParticles3D` for the PC.
- Screenshot pattern that works (used throughout this session):
  ```gdscript
  await RenderingServer.frame_post_draw
  get_viewport().get_texture().get_image().save_png("/tmp/shot.png")
  ```
