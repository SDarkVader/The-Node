# Price evidence: claude-haiku-5-5 (excerpt)

- Source: https://platform.claude.com/docs/en/about-claude/pricing.md
- Retrieved (UTC): 2026-10-22T16:04:58Z
- Full page as retrieved: 50718 bytes, sha256 88ae8282a9d5e48bc3aa7cde98c80b468454abaaa348de5baf09ef27f1a05c6f
- Only the lines below are kept, verbatim. The project books at 2x list: 200000 / 1000000 micro-USD per million input / output tokens.
- Our requests are capped at 36,864 input tokens (the allowance limit), so the over-100,000-token band cannot apply.

```
| Model                                                                                                                                | Base input tokens     | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens          |
| :----------------------------------------------------------------------------------------------------------------------------------- | :-------------------- | :-------------- | :-------------- | :----------------------- | :--------------------- |
| Claude Haiku 5.5 (for prompts up to 100,000 tokens)                                                                                  | $0.10 / MTok          | $0.125 / MTok   | $0.20 / MTok    | $0.01 / MTok             | $0.50 / MTok           |
| Claude Haiku 5.5 (for prompts over 100,000 tokens)                                                                                   | $0.50 / MTok          | $0.625 / MTok   | $1 / MTok       | $0.05 / MTok             | $2.50 / MTok           |

Claude Haiku 5.5 is priced by prompt length: a request whose prompt is over 100,000 tokens pays higher prices. A request's prompt length counts all of its input tokens, including cache reads and cache writes. Each request is priced on its own: a request over the threshold pays the higher prices even when part of its prompt is a cache hit, and earlier requests keep the prices they were billed at. The [model pricing](https://platform.claude.com/docs/en/about-claude/pricing#model-pricing) and [batch processing pricing](https://platform.claude.com/docs/en/about-claude/pricing#batch-processing) sections list both sets of prices.
```
