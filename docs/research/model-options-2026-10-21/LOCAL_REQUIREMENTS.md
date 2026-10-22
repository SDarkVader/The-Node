# Local model import requirements (owner's PC) — 2026-10-22

For the owner to install and run when ready. Everything here was checked by the local verifier
against tagged source, Hugging Face metadata or vendor docs (`verify-local.json`). Anything that
is an **estimate** or **unmeasured** is labelled. Assumed hardware: RTX 4070 Ti Super (16 GiB =
17.18 GB VRAM), Ryzen 7 7800X3D, 64 GB RAM, Windows.

## Hard limits set by our code

- **12,000 ms per call**, prefill plus output, enforced in protected `broker.ts` and `httpBody.ts`.
- **Request body ≤ 32,768 bytes** (about 9k tokens), plus up to 2,048 output tokens. Use a
  **16,384-token context**.
- **The schema is strict and rebuilt on every call.** The id enums change per call, so a new grammar
  is compiled each time; its cost is unmeasured.
- **Number `minimum`/`maximum` is silently ignored** by llama.cpp grammars. Our validator still
  rejects a price outside [0, 2], so such an output becomes a failed decision, not an impossible
  one.

## Runtime — pick one

### A. llama-server (llama.cpp) — most controllable, recommended for research

- Build **b11799**, commit `0756e83f`.
- Windows assets: `llama-b11799-bin-win-cuda-12.4-x64.zip` with
  `cudart-llama-bin-win-cuda-12.4-x64.zip`, or the 13.4 pair.
- Start it with every one of these flags. The defaults are wrong for us: training-length context,
  temperature 0.80, port 9931.
  ```
  llama-server -m <file.gguf> -c 16384 -np 1 -ngl 99 -fa on --temp 0 --no-cache-prompt ^
               --host 127.0.0.1 --port <port> --alias <id> -s <seed>
  ```
- **Thinking models** (Qwen3.5, Gemma 4): add `-rea off` or `--reasoning-budget 0`.
- **`--alias`:** the default model id is the file path, which fails our model-id check. Use an id
  that matches `^[A-Za-z0-9._:-]{1,128}$`.
- **Context shift:** leave it off, which is the default. An oversized prompt then **errors**
  instead of being truncated.
- **Endpoint:** use **`/v1/chat/completions`** with
  `response_format: {type:'json_schema', json_schema:{name, strict:true, schema}}`. Do **not**
  use its `/v1/responses`: it silently ignores `text.format`, so output would be unconstrained
  with no error.
- **Determinism:** `--temp 0` is argmax; with `-np 1` and `--no-cache-prompt` it is repeatable on
  the same build, driver and settings. Turning the cache off costs a full prefill per call.

### B. Ollama — least code change, weaker controls

- Pin **v0.40.7** (commit `2cd63f7a`, bundles llama.cpp b11738). Do not install "latest": v0.40.8
  and v0.40.9 release candidates already exist.
- Set `OLLAMA_CONTEXT_LENGTH=16384` (the default is 4,096), or `PARAMETER num_ctx 16384`.
  - **Overflow is silent.** Middle tokens are discarded; only the server log says
    "truncating input prompt".
- Create the model from the pinned file after checking its sha256 (`FROM ./file.gguf` in a
  Modelfile), with a name that matches the model-id rule above.
- Put a fixed `seed` in the Modelfile.
- `/v1/responses` honours `text.format` json_schema and compiles it to a llama.cpp grammar.
- **Caveats:**
  - Ollama forces **temperature 1.0** unless the request body sends `temperature: 0`; a
    Modelfile `PARAMETER temperature` is overridden.
  - Our fixed `reasoning.effort: 'low'` turns thinking **on** for Qwen3.5 and Gemma 4.
  - **Prompt caching cannot be disabled**, so bitwise repeatability is not guaranteed.

Not recommended:
- **LM Studio:** proprietary, and no verified `text.format` on `/v1/responses`.
- **vLLM:** no native Windows build.

## Models that fit (weights + 16k KV; compute buffers and Windows overhead come on top)

Only gpt-oss-20b has a measured anchor (on an RTX 4080 Super). **Every time below is an estimate.**

| Model (GGUF repo @ commit) | File / quant | Size | sha256 | Est. 9k prefill + 300 out | Notes |
|---|---|---|---|---|---|
| `ggml-org/gpt-oss-20b-GGUF` @ `15dcfc7e` | `gpt-oss-20b-MXFP4.gguf` | 12.11 GB | `27cd6c432c7672cb812a92f611cf3ba7bbc35928262bb1e1253ff4ee6ae35901` | ~3–7 s, plus reasoning | Best fit on every verified point. Whether the grammar leaves its analysis channel free is untested. Apache-2.0. |
| `mistralai/Ministral-3-8B-Instruct-2512-GGUF` @ `0102285a` | Q4_K_M / Q8_0 | 5.20 / 9.03 GB | `33e7a72cf5e6e2cfc2f2847075acc013d68bba023e35310cef86b5cf8fdca761` / `bd0ca58473b64618df4d08c1410cc25c910ca84e647833ebaf099e0fc0523b45` | ~4.5–8 / 6–10 s | No reasoning, so no thinking/grammar interplay. Apache-2.0. |
| `unsloth/Qwen3.5-9B-GGUF` @ `3885219b` | `Qwen3.5-9B-Q4_K_M.gguf` / `-Q8_0.gguf` | 5.68 / 9.53 GB | `03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8` / `809626574d0cb43d4becfa56169980da2bb448f2299270f7be443cb89d0a6ae4` | ~5–9 / 7–11 s | Thinking must be switched off. Apache-2.0. |
| `google/gemma-4-12B-it-qat-q4_0-gguf` @ `29d09777` | `gemma-4-12b-it-qat-q4_0.gguf` | 6.98 GB | `93567e57a8fe10b23569b9d9ec38cd005deedf71e29477c421a4b83f418a538b` | ~6–10 s | Architecture loading and the grammar with an empty thought block are untested. Apache-2.0. |
| `mistralai/Ministral-3-14B-Instruct-2512-GGUF` @ `74fac473` | `…-Q4_K_M.gguf` | 8.24 GB | `824e0f3373e69b84f2cae46fdcb9bd1ebc6ab3bfc7acc125d818b7b8178cc613` | ~7–12 s | Tight against 12 s. Its Q8_0 does **not** fit. |

Excluded: Qwen3.8-27B (no room left), Mistral-Small-3.2-24B (over 16 GiB with KV) and
Gemma-4-26B-A4B (borderline fit, no speed data).

## Changes our code needs (I implement these when you are ready)

1. **Transport.** Production `sendLiveResponses` hard-codes `https://api.openai.com/v1/responses`;
   only the test loopback accepts `127.0.0.1`. Add a local endpoint mode (127.0.0.1, explicit
   port) with no credential.
2. **Request builder.**
   - Send `temperature: 0`.
   - Send `reasoning.effort: 'none'` (or Ollama's `think: false`) for thinking models.
   - For llama-server, emit a Chat Completions body (`messages` plus `response_format`) instead of
     a Responses body.
3. **Response parser.** Accept the Chat Completions shape, and decide how a local model's
   reasoning text is handled. Today `recordedResponse.ts` rejects plaintext reasoning items.
4. **Accounting.** `ExperimentBudget` is bound to `gpt-5.4-nano-2026-03-17` and its prices. A
   local run needs a zero-price local profile, or a separate unaccounted local mode. This needs
   your decision.
5. **Provenance.** Record in every run manifest:
   - the runtime build (and Windows asset);
   - the GGUF sha256;
   - the quant;
   - `-c`, `-np`, `-fa`, the KV cache type, the seed;
   - the GPU driver version.
6. **Unchanged:** the 12,000 ms deadline and the request ceiling live in protected core files.
   They stay as they are unless you decide otherwise.

## Measure before any study call (no API cost)

1. **Speed:** `llama-bench -m <file> -ngl 99 -fa 1 -p 9000 -n 300 -r 3`.
2. **End-to-end:** run 20 real study-1 requests through the local endpoint. Record wall-clock
   time against 12 s, VRAM use, and prompt token count against expected, to catch truncation.
3. **Grammar acceptance:** every response must parse and pass `validateDecision`. Count failures.
4. **Determinism:** send the same request twice and require identical output on llama-server.
   Report how much it differs on Ollama, where the cache cannot be disabled.

Unmeasured until then: real throughput, real VRAM with buffers, grammar compile time per call,
gpt-oss analysis-channel behaviour under the grammar, and Gemma 4 loading.
