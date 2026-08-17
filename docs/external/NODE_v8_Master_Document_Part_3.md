Right. [Reading PART 3: CLAUDE CODE INSTRUCTIONS — COMPLETE WITH FULL BINDINGS]


================================================================================
CLAUDE CODE: NODE BACKEND REBUILD FOR LOCAL GODOT INTEGRATION
BUILD ORDER: LEGIBLE NUMBERS PLUS VISUAL BINDINGS PLUS LOCAL GODOT WIRING
================================================================================


CONTEXT: The-Node repo is TypeScript slash Node. You can run simulations with npm run sim. The repo already has forty plus engine files building game mechanics. Your job is NOT to rebuild from scratch. Your job is to:


One: READ the current simulation code to understand what's working
Two: EXTEND it to output data that Godot can consume, numeric displays plus shader parameters
Three: CREATE local Godot bindings so Steven can connect them to his Godot scene
Four: DOCUMENT what each output variable maps to visually


================================================================================
STEP 1: READ AND UNDERSTAND CURRENT STATE
================================================================================


These files are the backbone. Read them in order:


One: docs slash CLAUDE dot md, session rules, build order, design constraints
Two: docs slash HANDOVER dot md, current state snapshot
Three: docs slash BLUEPRINT dot md, what's been built, what's been tested
Four: docs slash ECOSYSTEM underscore VISION underscore 2026 hyphen 08 hyphen 06 dot md, the six binding constraints


Then check the latest simulation output:


Five: Run npm run sim locally and save the output to understand what data flows


Then read the engine files that matter for v8:


Six: src slash engine slash player dot ts, player state structure
Seven: src slash engine slash space dot ts, spatial positioning
Eight: src slash engine slash reputation dot ts, velocity logic
Nine: src slash engine slash pressureDetection dot ts, squeeze detection
Ten: src slash engine slash identity dot ts, k-anonymity, role scrambling


This takes approximately two to three hours. Do not skip it. You need to know what's already there.


================================================================================
STEP 2: EXTEND OUTPUT FOR GODOT CONSUMPTION
================================================================================


Create a new file: src slash sim slash godotDataExport dot ts


This file exports ONE function: exportPlayerStateForGodot, player, shard, world


Returns a JSON object with EVERY numeric display Steven needs to see:


INVENTORY section: nodules, grain, flour, bread, stories, unitCapacity


PRICES section: nodule underscore buy, nodule underscore sell, grain underscore buy, grain underscore sell, flour underscore buy, flour underscore sell, bread underscore buy, bread underscore sell, story underscore buy, story underscore sell


REPUTATION AND VELOCITY section: reputationScore, zero to one thousand scale. velocityV underscore i, zero point zero to two point zero. draftShieldActive, boolean


SPATIAL AND K-ANONYMITY section: positionX, positionY, distanceFromCore, localIdentityDecayRate underscore T, interpolated five point five to fifteen point zero. visiblePlayersInViewport, kAnonymityMet, identityScrambled


DETECTION AND SQUEEZE section: suspicionAccumulation, zero to one hundred percent. daysUntilSqueezeTrigger. squeezeActive. throttleEfficiencyPenalty, negative fifty percent if active. rentSpikeMultiplier. gateLockoutActive


ROLE AND OCCUPATION section: assignedRole, string. contributionThisCycle. expectedContributionForRole. anomalyScore


BACKSTOP AND MOBILITY section: postcardProgress, zero to one. exitAttempted. illegalTransitInterceptionRoll. lockoutRemainingDays


SHARD HEALTH section: shardPopulation, target sixty-five, backstop fills if below, caps at eighty. currentMoneySupply. averageWealthPerPlayer. giniCoefficient, zero to one. economicTensionCount. shardHealth underscore H underscore s, zero to one hundred


================================================================================
STEP 3: CREATE GODOT DATA BINDINGS FILE — FULL BINDINGS EXPLICIT
================================================================================


Create a new file: src slash godot slash bindings dot ts


This file documents WHICH variable maps to WHICH shader or visual. ALL TWENTY THREE BINDINGS LISTED BELOW:


reputationScore maps to UI slash MomentumMeter. Type: normalized zero to one thousand. Shader parameter: momentum underscore input. Visual effect: momentum meter curve and glow.


velocityV underscore i maps to UI slash DraftIndicator. Type: decimal zero to two. Shader parameter: velocity underscore display. Threshold: zero point five.


distanceFromCore maps to Environment slash HazeSpectrum. Type: float meters. Shader parameter: distance underscore to underscore core. Visual effect: color interpolation from warm gold at core to red at periphery.


suspicionAccumulation maps to UI slash SqueezeFlare. Type: percent zero to one hundred. Shader parameter: suspicion underscore level. Visual effect: crimson flare radius and intensity.


personalResourceStock maps to UI slash ResourceSlots. Type: integer zero to five. Shader parameter: slot underscore fill underscore level. Visual effect: slot color gradient teal to copper to crimson.


visiblePlayersInViewport maps to Environment slash FogDensity. Type: integer count. Shader parameter: fog underscore density underscore multiplier. Visual effect: local haze thickness based on population density.


localIdentityDecayRate underscore T maps to Environment slash HazeSpectrum. Type: float five point five to fifteen point zero. Shader parameter: identity underscore decay underscore interpolation. Visual effect: haze color interpolation warm gold at core, red at periphery.


kAnonymityMet maps to UI slash IdentityLabel. Type: boolean. Shader parameter: identity underscore visible. Visual effect: role label visible if true, scrambled silhouette if false.


identityScrambled maps to UI slash IdentityLabel. Type: boolean. Shader parameter: scramble underscore effect. Visual effect: blur slash distortion on role label when k-anonymity threshold not met.


daysUntilSqueezeTrigger maps to UI slash DetectionCountdown. Type: float days. Shader parameter: squeeze underscore urgency. Visual effect: countdown timer intensity increases as days decrease.


squeezeActive maps to UI slash SqueezeFlare. Type: boolean. Shader parameter: squeeze underscore flare underscore active. Visual effect: crimson flare pulses and spreads when active.


throttleEfficiencyPenalty maps to UI slash EfficiencyMeter. Type: percent penalty. Shader parameter: efficiency underscore reduction. Visual effect: meter grays out, animations slow by fifty percent.


rentSpikeMultiplier maps to UI slash CostIndicator. Type: decimal multiplier. Shader parameter: cost underscore flash underscore intensity. Visual effect: cost numbers flash red, multiplier indicator appears.


gateLockoutActive maps to UI slash MapBarriers. Type: boolean. Shader parameter: barrier underscore visibility. Visual effect: visual barrier appears on map, shortcut UI physically barred.


postcardProgress maps to UI slash ExitTicketBar. Type: normalized zero to one. Shader parameter: postcard underscore fill. Visual effect: progress bar fills from left to right.


illegalTransitInterceptionRoll maps to UI slash TransitRisk. Type: probability zero to one. Shader parameter: intercept underscore risk underscore level. Visual effect: risk indicator color shifts, green safe to yellow caution to red danger.


lockoutRemainingDays maps to UI slash RejoinCountdown. Type: integer days. Shader parameter: lockout underscore timer. Visual effect: countdown timer, red glow increases as days approach zero.


shardPopulation maps to UI slash PopulationMeter. Type: integer target sixty-five max eighty. Shader parameter: population underscore level. Visual effect: meter shows current versus target, color shifts if below sixty-five or above eighty.


giniCoefficient maps to UI slash EconomicTension. Type: normalized zero to one. Shader parameter: inequality underscore tension. Visual effect: ambient wall color shifts stable white to amber to red with Gini.


economicTensionCount maps to UI slash TensionIndicator. Type: integer count. Visual effect: environmental haze intensity increases with tension count.


shardHealth underscore H underscore s maps to Environment slash GlobalTension. Type: composite zero to one hundred. Shader parameter: shard underscore health. Visual effect: global ambient glow and lighting intensity driven by H-s composite.


All twenty-three bindings explicitly defined. Export this as a constant so Steven can reference it in Godot.


================================================================================
STEP 4: CREATE A CLI COMMAND FOR GODOT EXPORT
================================================================================


Create: src slash sim slash godotCli dot ts


This runs the simulation and outputs:


One: A JSON file with every player's state every ten simulated days
Two: A summary stats file, population, grifter pool, discovery rate, et cetera
Three: A bindings reference, what maps where


Command: npm run godot hyphen export


Output goes to: dot slash output slash godot underscore export underscore timestamp dot json


Format: A JSON object with day number and shards array. Each shard contains shardId, a players array with every player's exported state, and a shardState object with population, money supply, Gini coefficient, and other economic metrics.


Write one of these files every ten simulated days for one thousand two hundred days.


================================================================================
STEP 5: CREATE GODOT INTEGRATION TEMPLATE
================================================================================


Create: src slash godot slash GodotDataBinder dot gd in GDScript, ready for Godot.


This is a minimal script Steven can drop into Godot that:


One: Reads the JSON export file
Two: Connects each player's state to a shader parameter
Three: Updates in real time as the simulation runs


Pseudo-code structure: The script extends Node3D. It has current underscore day as an integer, player underscore data as a Dictionary, and bindings as a Dictionary from the bindings dot ts file.


The underscore ready function loads the godot export file from output slash godot underscore export underscore latest dot json and connects all bindings.


The load underscore godot underscore export underscore file function takes a path, opens the file, and parses it as JSON into player underscore data.


The connect underscore all underscore bindings function iterates through player underscore data keys, gets each player, retrieves the binding, gets the shader node, and sets the shader parameter to the player's corresponding value. Repeat for all bindings.


The underscore process function with delta parameter updates bindings from the exported data each frame, simulating live data flow from backend to visuals.


You don't have to write perfect GDScript. Just the structure and comments. Steven will wire the actual Godot connections himself.


================================================================================
STEP 6: ACCEPTANCE CRITERIA
================================================================================


When you're done, deliver:


One: godotDataExport dot ts that exports all numeric displays from player and shard state.
Two: godotCli dot ts with CLI command npm run godot hyphen export that produces JSON exports.
Three: bindings dot ts that documents every variable to shader parameter mapping — all twenty three bindings explicit.
Four: GodotDataBinder dot gd, template script for Godot integration.
Five: Updated HANDOVER dot md documenting the new godot hyphen export workflow.
Six: Updated README dot md with a Local Development, Godot Integration section showing Steven how to run npm run godot hyphen export in one terminal, load the JSON in Godot using GodotDataBinder dot gd, connect shader parameters to the live variables, and walk around the world seeing the numbers update.
Seven: One full simulation run of one thousand two hundred plus days exported as JSON to output slash.


================================================================================
CONSTANTS, LOCKED, DO NOT DEVIATE
================================================================================


These are the eight load-bearing constants from v7 baseline verification. They are NOT negotiable. If the math doesn't work, escalate to Steven.


IDENTITY DECAY RATES, Spatial k-anonymity model:
T underscore max equals fifteen point zero days, core Plaza, slow identity decay.
T underscore min equals five point five days, Periphery, fast identity decay.
Linear interpolation by distance from core.


DETECTION WINDOW, Squeeze-and-Evict:
SQUEEZE underscore WINDOW equals thirty-five point four days, base window at core.
Scales by position: approximately thirty-five point four days at core to approximately thirteen days at periphery.
Proportional to T underscore max divided by T underscore min ratio.


ILLEGAL TRANSIT INTERCEPTION:
INTERCEPT underscore BASE underscore P equals zero point thirty-five, thirty-five percent base interception probability.
Target failure rate: fifteen percent, eighty-five percent escape through window.


POPULATION AND CAPACITY:
TARGET underscore POPULATION equals sixty-five, shard equilibrium, triggers backstop refill if below.
UNIT underscore CAP equals five, maximum resource units per player inventory.


REPUTATION AND VELOCITY:
VELOCITY underscore SHIELD underscore THRESHOLD equals zero point five. V underscore i greater than or equal to zero point five equals conscription shielded. If V underscore i less than zero point five, P of draft equals one hundred percent.


ANONYMITY:
K underscore ANONYMITY underscore THRESHOLD equals three, minimum same-role players in viewport. If k less than three, identity scrambles, role label hidden from other players.


================================================================================
CONSTRAINTS, DO NOT DEVIATE
================================================================================


Check mark: All numeric constants are LOCKED from v7 baseline: T underscore max equals fifteen point zero, T underscore min equals five point five, SQUEEZE underscore WINDOW equals thirty-five point four, et cetera.


Check mark: The export must show REAL NUMBERS, not abstracted symbols. For example, reputationScore: seven hundred forty-two, not reputation: high. suspicionAccumulation: forty-seven point three, not suspicion: moderate.


Check mark: Do not change the simulation logic itself. Extend output, don't rewrite mechanics.


Check mark: If you find the current code doesn't match v8 spec exactly, log it in DEVLOG dot md, flag it in HANDOVER dot md. Don't silently fix it without saying so.


Check mark: Every file you create must be documented. Include a header comment explaining what it does. Update BLUEPRINT dot md with why each new file exists. Update DEVLOG dot md chronologically.


================================================================================
TIMELINE
================================================================================


Estimated: one to two weeks to complete all steps. Depends on simulation run time.


Start with Step One, reading. That's the blocker. Everything else follows.


Report back when you've finished reading and understand the current state.


Do NOT start writing code until you've completed Step One.


================================================================================


END OF MASTER DOCUMENT
================================================================================
