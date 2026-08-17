Right. Reading the full expanded master document out loud now.


[Reading NODE v8 Master Document — EXPANDED]


================================================================================
NODE v8 INTEGRATED SPECIFICATION — MASTER DOCUMENT
COMPLETE HANDOFF FOR CLAUDE CODE PLUS LAYER IMPLEMENTATION
================================================================================


This document contains everything:
  • Layer 0 Execution Guide, what Claude Code builds now
  • v8 Integrated Spec Summary, design plus numeric slash visual split
  • Claude Code Instructions, step-by-step with all locked constants


Read this once. It covers the entire v8 build order.


================================================================================
PART 1: LAYER 0 EXECUTION GUIDE
================================================================================


NODE GAME, v8 INTEGRATED DESIGN SPECIFICATION, UPDATED.
BUILD ORDER: LEGIBLE NUMBERS FIRST, VISUAL ABSTRACTION SECOND.


CRITICAL CLARIFICATION FOR CLAUDE CODE HANDOFF.


The v8 spec has THREE implementation layers:


LAYER 0, IMMEDIATE, FOR CLAUDE CODE:
  Backend deterministic simulation with LEGIBLE NUMERIC OUTPUT.
  Every display is readable as a plain number or percentage.
  No visual abstraction yet. Focus is correctness, not appearance.


LAYER 1, MANUAL INTEGRATION, AFTER CLAUDE CODE:
  Data binding between Klotho dot NET backend and Godot 4 presentation variables.
  Requires engineer to wire up V-i of t, H-s, personalResourceStock to the engine.
  Claude Code cannot do this — it's outside the repo scope.


LAYER 2, VISUAL DESIGN, AFTER LAYER 1:
  Shader implementation, slot animations, momentum meter curves.
  Art slash Design responsibility. Claude Code doesn't touch this.


LAYER 3, ENVIRONMENTAL SYSTEM, AFTER LAYER 2:
  Global lighting, directional haze, k-anonymity spectrum rendering.
  Requires full integration with shard state and camera system.
  Claude Code doesn't implement this.


================================================================================
LAYER 0: WHAT CLAUDE CODE BUILDS RIGHT NOW
================================================================================


BACKEND SIMULATION WITH LEGIBLE NUMERIC DISPLAYS


Every variable Claude Code outputs must be human-readable and verifiable:


INVENTORY DISPLAY, per player:
  Nodules: integer
  Grain: integer
  Flour: integer
  Bread: integer
  Stories: integer
  Total carrying capacity check: zero to five units


PRICE BOARD, per shard, per resource type:
  Nodule underscore buy underscore price: decimal
  Nodule underscore sell underscore price: decimal
  Grain underscore buy underscore price: decimal
  Grain underscore sell underscore price: decimal
  Flour underscore buy underscore price: decimal
  Flour underscore sell underscore price: decimal
  Bread underscore buy underscore price: decimal
  Bread underscore sell underscore price: decimal
  Story underscore buy underscore price: decimal
  Story underscore sell underscore price: decimal


REPUTATION AND VELOCITY DISPLAY, per player:
  Reputation underscore score: integer, zero to one thousand scale for legibility
  Velocity underscore V underscore i: decimal, zero point zero to two point zero
  Draft underscore shield underscore active: boolean, true if V-i greater than or equal to zero point five


SPATIAL POSITION AND K-ANONYMITY DISPLAY, per player:
  Position underscore x, Position underscore y: float coordinates
  Distance underscore from underscore core: float, zero point zero to max underscore radius
  Local underscore identity underscore decay underscore rate underscore T: float, interpolated between five point five and fifteen point zero days
  Visible underscore players underscore in underscore viewport: integer count
  K underscore anonymity underscore met: boolean, true if count greater than or equal to three for this player's role
  Identity underscore scrambled: boolean, true if k-anonymity not met


DETECTION AND SQUEEZE DISPLAY, per player:
  Suspicion underscore accumulation: decimal, zero point zero to one hundred percent
  Days underscore until underscore squeeze underscore trigger: decimal, countdown
  Squeeze underscore active: boolean
  Throttle underscore efficiency underscore penalty: decimal, negative fifty percent if active
  Rent underscore spike underscore multiplier: decimal, cost multiplier if active
  Gate underscore lockout underscore active: boolean


ROLE AND OCCUPATION DISPLAY, per player:
  Assigned underscore role: string, Miller, Baker, Journalist, Detective, Grifter, Import slash Export
  Contribution underscore this underscore cycle: decimal
  Expected underscore contribution underscore for underscore role: decimal
  Anomaly underscore score: decimal, how far off normal for this role


BACKSTOP AND MOBILITY DISPLAY, per player:
  Postcard underscore progress: decimal, zero point zero to one point zero
  Exit underscore attempted: boolean
  Illegal underscore transit underscore interception underscore roll: decimal, zero point zero to one point zero compared to zero point thirty five threshold
  Lockout underscore remaining underscore days: integer


No abstraction — show the actual backstop fill, the actual interception roll, the exact countdown to re-entry.


SHARD HEALTH AND ECONOMIC STATE DISPLAY:
  Shard underscore population: integer, target sixty five, backstop fills if below, caps at eighty
  Current underscore money underscore supply: decimal
  Average underscore wealth underscore per underscore player: decimal
  Gini underscore coefficient: decimal, zero point zero to one point zero
  Economic underscore tension underscore count: integer, sum of role vacancies and scarcity alerts
  Shard underscore health underscore H underscore s: decimal, zero point zero to one hundred, composite metric


================================================================================
CLAUDE CODE IMPLEMENTATION CHECKLIST
================================================================================


MUST IMPLEMENT:
  ✓ Player class with all state variables, position, inventory, velocity, suspicion
  ✓ Spatial k-anonymity calculation, distance-based T decay
  ✓ Detection window and squeeze trigger logic, thirty five point four days base, scaled by position
  ✓ Role assignment and backstop refill when population drops below sixty five
  ✓ Seven day temporary lockout and re-entry
  ✓ Resource production, Nodules to Grain to Flour to Bread to Stories conversion
  ✓ Price dynamics, supply slash demand, scarcity signals
  ✓ Journalist slash Detective discovery redefined as spatial detection
  ✓ Illegal transit with k-anonymity decay and interception window
  ✓ Simulation loop, one thousand two hundred plus simulated days
  ✓ Output all numeric displays, see LAYER zero above, at regular intervals


MUST VERIFY:
  ✓ Population stabilizes around sixty five, backstop refill working
  ✓ Falls and rises balanced, approximately four hundred ninety eight slash five hundred eight over run
  ✓ Discovery rate stable, approximately one hundred forty three detections per year
  ✓ No permanent zero-state, economic collapse prevention
  ✓ Grifter pool stable, approximately thirty
  ✓ Resource flows correctly through production chain
  ✓ K-anonymity scrambling prevents role-based targeting below k equals three
  ✓ Squeeze-and-Evict triggers only on sustained anomalies, not random


MUST NOT IMPLEMENT, BLOCKED ON LAYER one slash two slash three:
  ✗ Godot four rendering, shaders, lighting
  ✗ Emissive slot animations, color transitions
  ✗ Momentum meter curves and visual feedback
  ✗ Environmental haze, directional lighting, global sentiment beacon
  ✗ Camera system, viewport culling, rendering optimization
  ✗ Audio design, particle effects, animation timing


These are manual integration tasks after Claude Code finishes.


================================================================================
ACCEPTANCE CRITERIA FOR CLAUDE CODE OUTPUT
================================================================================


When Claude Code finishes the backend rebuild, the output files should contain:


One: Complete simulation run log showing all numeric displays, see LAYER zero
  - Every ten simulated days: full shard state snapshot
  - Every thirty days: individual player state snapshots


Two: Summary statistics table:
  - Population over time, graph data, not just endpoints
  - Discovery rate, how many per year, when
  - Grifter pool size and stability
  - Economic metrics, Gini, money supply, tension count
  - Backstop refill frequency, when does it trigger, why
  - Lockout frequency and duration patterns


Three: Verification that all six design constraints are met:
  - Constraint one: k-anonymity decay by position, VERIFY: core slow, periphery fast
  - Constraint two: Detection window scales by position, VERIFY: thirty five point four at core, approximately thirteen at edge
  - Constraint three: Squeeze-and-Evict only on sustained anomalies, VERIFY: no false triggers
  - Constraint four: Illegal transit interception at thirty five percent base rate, VERIFY: fifteen percent target failure
  - Constraint five: Role vacancy triggers backstop refill, VERIFY: population never collapse
  - Constraint six: Resource production chain flows correctly, VERIFY: no permanent blockers


Four: Code comments and variable names that match the spec exactly:
  - T underscore max equals fifteen point zero, core identity decay
  - T underscore min equals five point five, periphery identity decay
  - SQUEEZE underscore WINDOW equals thirty five point four days
  - INTERCEPT underscore BASE underscore P equals zero point thirty five
  - TARGET underscore POPULATION equals sixty five
  - UNIT underscore CAP equals five
  - VELOCITY underscore SHIELD underscore THRESHOLD equals zero point five
  - K underscore ANONYMITY underscore THRESHOLD equals three


================================================================================
WHAT HAPPENS AFTER CLAUDE CODE
================================================================================


Once Claude Code delivers a passing simulation, the handoff is:


STEP ONE, Engineer: Wire Klotho output to Godot presentation variables
  - V-i of t maps to momentum meter input
  - H-s maps to ambient glow intensity
  - personalResourceStock maps to slot fill state
  - Distance underscore from underscore core maps to haze color interpolation
  - Suspicion underscore accumulation maps to squeeze UI localization


This is a data-binding task, not a logic redesign. Spec is locked.


STEP TWO, Art slash Design: Implement shaders and visual systems
  - Slot color transitions, teal to copper to crimson
  - Momentum meter curve and glow dynamics
  - Environmental lighting spectrum, warm core to red periphery
  - Fog density tied to occupantsWithin
  - Squeeze-and-Evict crimson flare shader


Reference is the Visual Contrast Contract mapping table, System six in Part one.


STEP THREE, Design slash Narrative: Integrate micro-interactions
  - Baker's Standoff UI, price competition display
  - Private Diary rendering, entry distortion over time
  - IdentityLedger slash Silhouette system, five encounter trust threshold
  - Radar viewport k-anonymity enforcement, role label scrambling


These are narrative layers on top of the backend. Backend locked by Claude Code.


================================================================================
CRITICAL: DO NOT DEVIATE FROM THE NUMBERS
================================================================================


Every constant above, T underscore max, T underscore min, SQUEEZE underscore WINDOW, etc., is derived from the v7 baseline that Steven verified. If Claude Code changes any of these to make implementation easier, the whole design falls apart.


T underscore max must be fifteen point zero. T underscore min must be five point five. That sets the spatial detection gradient.


SQUEEZE underscore WINDOW must be thirty five point four days. That's the maximum grifter survival window.


VELOCITY underscore SHIELD underscore THRESHOLD must be zero point five. Below that, conscription is one hundred percent.


K underscore ANONYMITY underscore THRESHOLD must be three. Below that, identity scrambles.


These are not implementation details. They are design constraints.


If Claude Code finds the math doesn't work, the spec is escalated, not changed. Steven is aware. Changes are only approved by Steven, not by convenience.


[End Part 1 — continuing to Part 2…]
