export const meta = {
  name: 'cheaper-model-research',
  description: 'Verify current prices and strict-JSON support of models cheaper than gpt-5.4-nano for the accounted study workload',
  phases: [
    { title: 'Research', detail: 'one researcher per provider family, cited from official pricing/docs pages' },
    { title: 'Verify', detail: 'independent checker re-verifies each claimed price and capability' },
    { title: 'Synthesize', detail: 'cost per study and recommendation against the workload' },
  ],
}

const WORKLOAD = `WORKLOAD (an agent-behaviour research study, not a chat product):
- Each call: one controlled inhabitant of a simulated town decides one action. Input ~5,000-9,000 tokens of JSON (rules text ~650 tokens, a strict JSON schema ~2,000 tokens with enum lists of 64-hex or 16-hex reference strings, an observation ~3,000-6,000 tokens). Output: one small JSON object (~100-300 tokens) plus any reasoning tokens.
- Hard requirements: (1) strict structured output against a supplied JSON Schema with enums/const/anyOf/nullable (the model must not emit anything outside the schema); (2) low or minimal reasoning is acceptable; (3) deterministic temperature not required; (4) synchronous responses within ~16 s per call (one call per actor per tick, ticks are sequential), so 24-hour batch APIs are only usable if a whole tick could be batched and waited on.
- Volumes: study 1 = 630 calls (15 episodes x 7 actors x 6 ticks); a diary/recognition study would be ~3,000-4,000 calls.
- The current model is gpt-5.4-nano-2026-03-17 via the OpenAI Responses API; the project's accounting books conservative prices (2x list). The existing transport speaks only the OpenAI Responses API; other providers would need a new adapter.
- Today is 2026-10-21. Prices and model availability change often: cite the official pricing or docs page for EVERY number, with the date you read it. If you cannot verify a number from an official source, mark it unverified. Never fill a gap from memory.`

// Facts read from the repository on 2026-10-21 (src/agent/mockProvider.ts, src/agent/responsesRequest.ts,
// docs/recovery/EXPERIMENT_FIRST_PASS_RESULTS.md). Appended to the verify/synthesis prompts only, so the
// cached research prompts above are unchanged.
const REPO_FACTS = `REPOSITORY FACTS (read from the code today; treat as ground truth about OUR schema and transport):
- The decision schema is rebuilt for every call. Root: {type:'object', properties:{move, communication, diary, role}, required: all, additionalProperties:false}. Every object node has additionalProperties:false and all properties required.
- Keywords actually used: 'const' on STRINGS (kind discriminators such as {const:'wallPost', type:'string'}) AND on NUMBERS ({type:'number', const: 3} for each legal move's x and y); 'enum' of strings (16-hex reference ids on the current baseline, plus small vocabularies of 4-20 words); 'anyOf' for nullability written as anyOf:[{type:'null'}, ...alternatives] on up to ~6 fields (move, communication, diary, role, and two optional 'context' fields); NESTED anyOf (communication -> proximityUtterance -> referent anyOf [room, player]); 'minimum'/'maximum' on one number (price 0..2). No type arrays, no $ref, no allOf, no pattern, no string length bounds.
- The 'move' field is anyOf over one object per legal move (up to ~5 alternatives), each pinned with numeric const. Enum contents (present people, known subjects) and legal moves differ per actor and per tick, so any provider cache keyed on the schema (grammar compilation, prompt-prefix cache including the schema) will generally MISS across calls.
- Request: OpenAI Responses API body with instructions + one input_text user message, text.format {type:'json_schema', name:'node_inhabitant_v1', strict:true, schema}, reasoning:{effort:'low'}, service_tier:'default', store:false, max_output_tokens:2048. The body must be <= 32,768 bytes (fail-closed).
- NO live call has ever produced a decision. The only live attempt (2026-10-16, gpt-5.4-nano-2026-03-17) returned HTTP 401. So acceptance of THIS schema by ANY provider, including OpenAI (numeric const in particular), is itself unverified and must be tested by a first real request.
- Study 1 is pinned to gpt-5.4-nano-2026-03-17 in its manifest, its accounting allowance (714 requests, USD 5, 20,000 micro-USD per request ceiling, prices booked at 2x list) and its contract. Study 1 is postponed until the owner reactivates it.
- The owner also has local hardware: NVIDIA RTX 4070 Ti Super (16 GB VRAM), AMD Ryzen 7 7800X3D, 64 GB RAM, 8 TB NVMe. The project's native checks and CI run on Windows (PowerShell), so assume the owner's PC runs Windows unless shown otherwise.`

const RESULT = {
  type: 'object',
  properties: {
    models: { type: 'array', items: { type: 'object', properties: {
      provider: { type: 'string' }, model: { type: 'string', description: 'exact API model id, dated snapshot if one exists' },
      inputUsdPerM: { type: ['number', 'null'] }, cachedInputUsdPerM: { type: ['number', 'null'] }, outputUsdPerM: { type: ['number', 'null'] },
      strictJsonSchema: { type: 'string', description: 'yes/no/partial, and which schema features are unsupported' },
      reasoningControl: { type: 'string' }, contextTokens: { type: ['number', 'null'] },
      deprecation: { type: 'string' }, cheaperTiers: { type: 'string', description: 'batch/flex/priority tiers and their discounts and latency' },
      sources: { type: 'array', items: { type: 'string', description: 'URL + date read' } },
      unverified: { type: 'array', items: { type: 'string' } },
    }, required: ['provider', 'model', 'inputUsdPerM', 'outputUsdPerM', 'strictJsonSchema', 'sources', 'unverified'] } },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['models', 'notes'],
}

const VERIFIED = {
  type: 'object',
  properties: {
    models: RESULT.properties.models,
    corrections: { type: 'array', items: { type: 'object', properties: {
      model: { type: 'string' }, claim: { type: 'string' }, verdict: { type: 'string', enum: ['confirmed', 'corrected', 'unverifiable', 'refuted'] },
      correctValue: { type: 'string' }, source: { type: 'string' } }, required: ['model', 'claim', 'verdict', 'source'] } },
    schemaFit: { type: 'array', items: { type: 'object', properties: {
      model: { type: 'string' }, fits: { type: 'string', enum: ['yes', 'no', 'needs_rewrite', 'unknown'] }, detail: { type: 'string' } },
      required: ['model', 'fits', 'detail'] }, description: 'OUR schema (see REPOSITORY FACTS) against this provider/runtime documented subset' },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['models', 'corrections', 'schemaFit', 'notes'],
}

const FAMILIES = [
  { key: 'openai', brief: 'OpenAI: confirm the current list price of gpt-5.4-nano-2026-03-17 (input, cached input, output), and list EVERY OpenAI model that is cheaper per call for this workload and supports the Responses API with strict json_schema structured outputs (e.g. other nano/mini generations). Include the Flex processing tier and Batch API: which models support them, discount, latency/availability caveats. Include prompt-caching rules (minimum prefix length, discount, what counts as the prefix in the Responses API: instructions, input, text.format schema).' },
  { key: 'google', brief: 'Google Gemini API: the cheapest current Flash / Flash-Lite models. Prices (input, cached input/context caching, output), whether responseSchema / responseJsonSchema enforces enums/anyOf/nullable strictly, thinking-budget controls, batch mode discount, rate limits on paid tier 1.' },
  { key: 'anthropic', brief: 'Anthropic Claude API: the cheapest current Claude models (e.g. Haiku generations). Prices (input, cache write/read, output), structured outputs / strict JSON schema support (what schema features are supported), extended-thinking control, batch discount. Use docs.anthropic.com / anthropic.com pricing pages.' },
  { key: 'open-weight', brief: 'Open-weight models via their first-party or major hosted APIs (e.g. DeepSeek official API, Mistral La Plateforme small models, Qwen via Alibaba Cloud Model Studio, Llama via a major host such as Groq, Together, Fireworks, or OpenRouter routing). Prices and whether they enforce a supplied JSON Schema strictly by constrained decoding (not just JSON mode), and which keywords (const on strings and numbers, enum, anyOf incl. nested, type null, minimum/maximum) are supported. Whether any offers an OpenAI-compatible Responses API (/v1/responses) with text.format json_schema strict, so no new adapter would be needed. Note data-retention / training-use terms if stated on the pricing or terms page, and whether model versions can be pinned.' },
  { key: 'local', brief: `LOCAL open-weight inference on the owner's own PC: NVIDIA RTX 4070 Ti Super (16 GB VRAM), AMD Ryzen 7 7800X3D, 64 GB RAM, 8 TB NVMe; assume Windows 11 unless a runtime needs WSL2 (say so). There is no per-token price (report inputUsdPerM/outputUsdPerM as null and put throughput in notes). PART A, runtimes (Ollama, LM Studio, llama.cpp llama-server, vLLM, and any other mature option): from official docs, release notes or source (cite version and date) establish (1) whether it serves an OpenAI-compatible Responses API endpoint (/v1/responses) and whether that endpoint honours text.format {type:'json_schema', strict:true, schema}; if not, whether Chat Completions response_format json_schema is honoured; (2) whether enforcement is grammar-constrained decoding, and which JSON Schema keywords are supported vs silently ignored: const (string AND number), enum, anyOf (incl. nested), type 'null', minimum/maximum, additionalProperties:false; (3) known failure modes (schema conversion errors, ignored keywords, server-side fallback to unconstrained output). PART B, models: which current instruction-tuned open-weight models (consider e.g. the latest Qwen, Gemma, Llama, Mistral Small, Phi and gpt-oss releases; check what is current as of 2026-10-21) fit in 16 GB VRAM at Q4_K_M..Q8_0 with a 12k-16k context (weights + KV cache), and their expected prefill and decode throughput on an RTX 4070 Ti Super class GPU (cite benchmarks; label any estimate as an estimate), giving the time for a ~9,000-token prefill plus ~300 output tokens against the 16 s deadline. PART C, research suitability: pinning (exact weights file hash / quantisation / runtime version), whether temperature 0 + fixed seed gives repeatable outputs on the same hardware, and licence terms relevant to research use. Use the Hugging Face tools if available for model cards and file sizes.` },
]

phase('Research')
const found = await pipeline(
  FAMILIES,
  (f) => agent(`${WORKLOAD}

TASK: ${f.brief}
Use web search and fetch official pages. Report per model with sources. Prefer fewer, verified entries over many guessed ones.`, { label: `research:${f.key}`, phase: 'Research', schema: RESULT }),
  (r, f) => r && agent(`${WORKLOAD}

${REPO_FACTS}

You are an independent, adversarial verifier. The CLAIMS below came from another researcher and have NOT been checked. Your job is to try to REFUTE each one.
- Re-check every price, model id, release/deprecation/shutdown date, tier discount and capability claim against the official source yourself: fetch the cited pages (raw HTML if a summariser could mislead), search if a link is dead. Record each check in 'corrections' with verdict confirmed / corrected / unverifiable / refuted and the source + date read.
- Treat surprising claims with extra suspicion (for example a deprecation of the current study model, a newly released cheaper replacement, a price that halves). Confirm them from at least two official pages where possible, or mark them unverifiable.
- In 'schemaFit', judge OUR schema (REPOSITORY FACTS) against each surviving model's or runtime's documented schema subset: numeric const, string const, nested anyOf with null, minimum/maximum, per-call varying enums. Say exactly which keyword would be rejected, ignored or need rewriting (e.g. numeric const -> single-value enum).
- Drop models that do not meet the hard requirements, and say why in notes. Return the corrected list. Never fill a gap from memory.

CLAIMS (${f.key}): ${JSON.stringify(r)}`, { label: `verify:${f.key}`, phase: 'Verify', schema: VERIFIED }),
)
const verified = found.filter(Boolean)
log(`${verified.length}/${FAMILIES.length} families verified`)
const missing = FAMILIES.filter((f, i) => !found[i]).map(f => f.key)
if (missing.length) log(`not verified (agent failed or skipped): ${missing.join(', ')}`)

phase('Synthesize')
const synthesis = await agent(`${WORKLOAD}

${REPO_FACTS}

Below are VERIFIED model lists (JSON) with each verifier's corrections and schema-fit judgements. Use only numbers marked confirmed or corrected; carry 'unverifiable' items as unverified. Families not verified: ${JSON.stringify(missing)}.

Compute, for each hosted model meeting the hard requirements, the expected list cost of study 1 (630 calls) and of a 3,500-call diary study, at 7,000 and 5,000 input tokens per call, 250 output tokens plus reasoning (state the reasoning-token assumption per model: none/minimal/low). Assume NO prompt-cache hits, because our schema and enums change per call (REPOSITORY FACTS); show separately what a provider's default caching mode would ADD (e.g. implicit cache writes billed above input). Also show the project's 2x booked cost against the USD 5 study-1 allowance.

For LOCAL options: list the runtime + model combinations that (a) enforce our schema or need only a mechanical rewrite, (b) fit 16 GB, (c) plausibly meet the 16 s deadline at ~9k-token prefill; say what adapter the repo would need (none if the runtime serves /v1/responses with strict json_schema; otherwise Chat Completions or native), and the reproducibility advantages and limits.

Then give:
(a) the cheapest hosted option that needs NO new adapter (OpenAI Responses);
(b) the cheapest hosted option overall;
(c) the best local option;
(d) what the reported gpt-5.4-nano deprecation (if confirmed) means for study 1 (pinned model, removal date) and for a later diary study;
(e) risks: switching model changes the research subject (behaviour is model-specific, so a model change is a new condition, not a cost saving); schema-enforcement gaps; no dated snapshot for alias-only models; rate limits; data retention; the fact that no provider has yet accepted this schema in a real request;
(f) a concrete, minimal first-request test plan per candidate (what to send, what to check) before any study call.
Be explicit about every number's source. Do not invent prices.

VERIFIED: ${JSON.stringify(verified)}`, { label: 'synthesize', phase: 'Synthesize', schema: {
  type: 'object',
  properties: {
    table: { type: 'array', items: { type: 'object', properties: {
      model: { type: 'string' }, provider: { type: 'string' }, adapterNeeded: { type: 'boolean' },
      study1Usd7k: { type: ['number', 'null'] }, study1Usd5k: { type: ['number', 'null'] }, diaryStudyUsd5k: { type: ['number', 'null'] },
      reasoningAssumption: { type: 'string' }, schemaFit: { type: 'string' }, caveats: { type: 'string' } }, required: ['model', 'provider', 'adapterNeeded', 'schemaFit', 'caveats'] } },
    local: { type: 'array', items: { type: 'object', properties: {
      runtime: { type: 'string' }, model: { type: 'string' }, quant: { type: 'string' }, fits16GB: { type: 'string' },
      est9kPrefillPlus300OutSeconds: { type: 'string' }, schemaEnforcement: { type: 'string' }, adapter: { type: 'string' }, caveats: { type: 'string' } },
      required: ['runtime', 'model', 'schemaEnforcement', 'adapter', 'caveats'] } },
    cheapestNoAdapter: { type: 'string' }, cheapestOverall: { type: 'string' }, bestLocal: { type: 'string' },
    deprecationImpact: { type: 'string' }, risks: { type: 'array', items: { type: 'string' } },
    firstRequestTests: { type: 'array', items: { type: 'string' } },
    recommendation: { type: 'string' },
  },
  required: ['table', 'local', 'cheapestNoAdapter', 'cheapestOverall', 'bestLocal', 'deprecationImpact', 'risks', 'firstRequestTests', 'recommendation'],
} })
return { verified, missing, synthesis }
