export const meta = {
  name: 'verify-saved-model-research',
  description: 'Verification only: check the saved Anthropic, open-weight and local research claims (3 agents, no new research)',
  phases: [{ title: 'Verify', detail: 'one verifier per saved family file; no new model search' }],
}

const DIR = '/home/user/The-Node/docs/research/model-options-2026-10-21'
const FACTS = `REPOSITORY FACTS (ground truth about OUR schema and transport, read from the code):
- Decision schema rebuilt per call: objects with additionalProperties:false and all properties required; fixed values are one-value typed enums ({type:'string', enum:['wallPost']}, {type:'number', enum:[3]}) — NO const anywhere (changed 2026-10-22); string enums of 16-hex reference ids that differ per call; anyOf for nullability written anyOf:[{type:'null'}, ...] on up to ~6 fields; nested anyOf (communication -> proximityUtterance -> referent anyOf [room, player]); minimum/maximum on one number (price 0..2). No type arrays, $ref, allOf, pattern or string length bounds.
- Transport: OpenAI Responses API body (instructions + one input_text message, text.format {type:'json_schema', name:'node_inhabitant_v1', strict:true, schema}, reasoning {effort:'low'}, service_tier 'default', store:false, max_output_tokens 2048), body <= 32,768 bytes, ~16 s per call, ~5-9k input tokens. src/agent/responsesTransport.ts hard-codes https://api.openai.com/v1/responses; the model-id check /^[A-Za-z0-9._:-]{1,128}$/ rejects '/'.
- No provider has yet accepted this schema in a live request. Owner's PC: RTX 4070 Ti Super 16 GB, Ryzen 7 7800X3D, 64 GB RAM, Windows assumed.`

const RULES = `You are a VERIFIER ONLY. The owner has asked that no new research be done: do not search for additional models, providers or runtimes, and do not expand scope.
1. Read the saved researcher output: ${DIR}/research-FAMILY.unverified.json (the 'result' field).
2. For each claim that matters for a decision (prices, model ids/snapshots, deprecation dates, Responses API availability, schema enforcement and keyword support, and for local: runtime versions, endpoint behaviour, model file sizes/hashes, VRAM fit, throughput anchors, determinism settings), re-check it against the source the researcher cited, fetching that page directly (raw HTML/markdown/source file if a summary could mislead). Only search when a cited link is dead. Keep fetches to what is needed.
3. Record each check as confirmed / corrected / unverifiable / refuted, with the source and date read. Treat surprising claims with extra suspicion.
4. In schemaFit, judge OUR schema (REPOSITORY FACTS; note const is already gone) against each surviving option's documented subset.
5. Before returning, also write your full JSON result to ${DIR}/verify-FAMILY.json (that file only; touch nothing else in the repository).
Never fill a gap from memory.

${FACTS}`

const SCHEMA = {
  type: 'object',
  properties: {
    corrections: { type: 'array', items: { type: 'object', properties: {
      model: { type: 'string' }, claim: { type: 'string' }, verdict: { type: 'string', enum: ['confirmed', 'corrected', 'unverifiable', 'refuted'] },
      correctValue: { type: 'string' }, source: { type: 'string' } }, required: ['model', 'claim', 'verdict', 'source'] } },
    schemaFit: { type: 'array', items: { type: 'object', properties: {
      model: { type: 'string' }, fits: { type: 'string', enum: ['yes', 'no', 'needs_rewrite', 'unknown'] }, detail: { type: 'string' } }, required: ['model', 'fits', 'detail'] } },
    survivors: { type: 'array', items: { type: 'string' }, description: 'options that still meet the hard requirements after verification' },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['corrections', 'schemaFit', 'survivors', 'notes'],
}

const EXTRA = {
  anthropic: '',
  'open-weight': '',
  local: `\nFor LOCAL also verify the facts an install checklist needs, from the saved claims only: for Ollama and llama-server, the exact release, whether /v1/responses honours text.format json_schema (cite the source file and line at that tag), whether Chat Completions response_format json_schema is honoured, how context length is set and whether overflow truncates silently, and how to disable prompt caching; for each model listed, the GGUF file name, size and sha256 (LFS oid) at the cited commit, and whether weights + 16k KV fit in 16 GB.`,
}

phase('Verify')
const results = await parallel(['anthropic', 'open-weight', 'local'].map((fam) => () =>
  agent(RULES.replaceAll('FAMILY', fam) + EXTRA[fam], { label: `verify:${fam}`, phase: 'Verify', schema: SCHEMA, model: 'sonnet' })
    .then((r) => ({ family: fam, result: r }))))
return results
