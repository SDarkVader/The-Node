# Thinking/History Display Adapter (2026-10-24)

## Overview

The Thinking/History interface provides longitudinal organization of decision reasoning with full transparency and external model access. Unlike sanitized or abstracted summaries, this view shows the actual reasoning output from authorized model API calls during experiment execution.

## Key Features

### 1. **Longitudinal Organization by Tick**

Reasoning is organized chronologically, grouped by:
- **Tick number** — kernel transition number
- **World hash** — deterministic state identifier
- **Per-decision metadata:**
  - Actor ID
  - Request ID (reference link)
  - Reasoning status (pending, received, accepted, rejected, unavailable)
  - Model source/provider (if recorded)
  - Latency (ms)
  - Proposed decision (role, action)
  - Admission verdict (yes/no/—)
  - Execution status (yes/—)

### 2. **Full Reasoning Transcripts**

Every decision record preserves:
- **Complete reasoning summaries** — unredacted text from the model's response
- **Proposal → Admitted → Executed progression** — shows the decision pipeline
- **Redaction markers** — notes when blocks were withheld (never the content itself)
- **No sanitization** — shows what the model actually returned

### 3. **Export Capabilities**

Three formats for different use cases:

#### JSON Export
```json
{
  "experimentId": "continuation-pilot-2026-10-23",
  "exportedAt": "2026-10-24T14:32:00Z",
  "tickRange": { "from": 0, "to": 18 },
  "stats": {
    "totalDecisions": 36,
    "totalTicks": 19,
    "decisionsByStatus": { "received": 36 },
    "avgLatencyMs": 245
  },
  "ticks": [
    {
      "tick": 0,
      "worldHash": "...",
      "decisions": [
        {
          "tick": 0,
          "requestId": "...",
          "actorId": "Baker",
          "status": "received",
          "source": "claude-opus-5-5",
          "summaries": ["Proposed price override based on..."],
          "proposed": { "role": "price-setter" },
          "admitted": true,
          "executed": true,
          "latencyMs": 245
        }
      ]
    }
  ]
}
```

#### CSV Export
```
tick,actor,status,proposed,admitted,executed,latency_ms,summaries
0,Baker,received,price-setter,yes,yes,245,"Proposed price override based on..."
0,Miller,received,output,yes,yes,198,"Decided to increase production..."
```

#### Markdown Export
```markdown
# Thinking History: continuation-pilot-2026-10-23

**Total Decisions:** 36  
**Ticks:** 19  
**Status Distribution:** received: 36  
**Average Latency:** 245 ms

## Tick 0

**World Hash:** `61ae622c38dd6a55...`  
**Decisions:** 36 decided, 0 pending, 0 rejected

### Baker · 5f7d2a4c

**Status:** received  
**Source:** claude-opus-5-5  
**Proposed:** price-setter  
**Admitted:** yes  
**Executed:** yes  
**Latency:** 245 ms

**Reasoning:**

> Proposed price override based on market demand signals and peer behaviour analysis.
> Current inventory at 42% of max, demand trend +3.2% daily.
```

### 4. **Interactive Search & Filter**

- **Actor filter** — find all decisions from a specific actor
- **Status filter** — show only pending, received, rejected, etc.
- **Keyword search** — search reasoning text for specific concepts
- **Tick range** — focus on a specific time window

### 5. **External Model Access**

Global endpoint for authorized external models to:
- **Query the history** — natural language questions about reasoning patterns
- **Analyze reasoning** — comparative analysis across ticks/actors
- **Stream transcripts** — receive full thinking history for further processing
- **No rate limits** — observatory remains read-only, external model integration is one-way ingest

#### Webhook Payload Structure

```json
{
  "type": "query" | "analyze" | "export" | "stream",
  "thinkingHistory": { /* full history object */ },
  "query": "What patterns emerged in price-setter reasoning over time?",
  "tickRange": { "from": 0, "to": 18 },
  "actorIds": ["Baker", "Miller"],
  "format": "markdown",
  "timestamp": "2026-10-24T14:32:00Z"
}
```

#### Expected Response

```json
{
  "type": "analysis",
  "queryProvided": "What patterns emerged in price-setter reasoning?",
  "analysis": "Three distinct reasoning phases detected:\n1. Ticks 0-5: Conservative price strategy...\n2. Ticks 6-12: Adaptive pricing...\n3. Ticks 13-18: Risk mitigation...",
  "findings": [
    {
      "tick": 5,
      "actorId": "Baker",
      "insight": "Inflection point where reasoning shifted from cost-focused to demand-aware"
    }
  ],
  "metadata": { "analysisModel": "claude-opus-5-5", "tokensUsed": 1247 }
}
```

## Interface Integration

### Web View

The thinking viewer integrates into the observatory web interface as a dedicated panel:

1. **Summary metrics** — decision counts, status distribution, avg latency
2. **Search/filter controls** — actor, status, keyword filters
3. **Per-tick accordion** — expandable view of decisions grouped by tick
4. **Decision cards** — visual status indicators, reasoning summaries, metadata
5. **External model interface** — endpoint input, query field, response viewer

### Styling

Status-based visual indicators (no colour-based interpretation):
- **Pending** — amber left border (orange #fbbf24)
- **Received** — blue left border (#60a5fa)
- **Accepted** — green left border (#34d399)
- **Rejected** — red left border (#f87171)
- **Unavailable** — grey left border (#9ca3af)

## API Routes Used

### Fetch Decision Reasoning
```
GET /observatory/v1/runs/{id}/decisions/{requestId}
```

Returns:
```json
{
  "tick": 0,
  "requestId": "...",
  "reasoning": {
    "status": "received",
    "source": "claude-opus-5-5",
    "summaries": ["..."],
    "redactedBlocks": 0
  },
  "proposed": { /* decision object */ },
  "admitted": true,
  "executed": true,
  "stopReason": null
}
```

### Fetch Timeline (calls list)
```
GET /observatory/v1/runs/{id}/timeline
```

Returns calls with `requestId` and `actorId` for each decision.

## Usage Workflow

### In the Observatory Web View

1. **Open a run** → Select from dropdown
2. **Browse timeline** → Thinking History panel auto-populates
3. **Search decisions** → Filter by actor or keyword
4. **Export for analysis** → Choose format (JSON/CSV/Markdown)
5. **Query external model** → Set endpoint URL, ask questions

### Programmatic Access

```typescript
import { buildThinkingHistory, exportThinkingJSON, formatForExternalModel } from './thinkingHistory';

// Build history from timeline and decisions
const history = buildThinkingHistory(experimentId, timeline, decisionsMap);

// Export for download
const json = exportThinkingJSON(history, { from: 0, to: 18 });

// Format for external model
const markdown = formatForExternalModel(history, 'markdown');

// Send to external endpoint
const response = await fetch(externalEndpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    type: 'analyze',
    thinkingHistory: history,
    query: 'What reasoning patterns emerged?',
    format: 'markdown'
  })
});
```

## Design Principles

### No Sanitization
- Shows actual reasoning output, not abstractions
- Preserves model response quality (good and poor reasoning both visible)
- Enables readers to assess reasoning quality independently

### Longitudinal Visibility
- Organized by time (tick) for pattern detection
- Supports cross-tick comparison and trend analysis
- Facilitates hypothesis about decision evolution

### Information Asymmetry Preserved
- Renderer token sees public decisions only
- Researcher token sees full actor state and all decisions
- External model sees what the requesting system permits

### Immutable Records
- Each decision record includes its request ID, tick, actor, world hash
- No retroactive editing or filtering of reasoning
- Audit trail for reasoning quality evaluation

## Open Observations

1. **Training efficiency** — can reasoning summaries be used to predict decision success?
2. **Reasoning drift** — do reasoning patterns change significantly over the run?
3. **Model comparison** — comparing reasoning from different models/versions on same scenario
4. **Failure analysis** — which reasoning features correlate with rejected decisions?
5. **External validation** — can external evaluators independently verify reasoning quality?

## Files

- `src/observatory/thinkingHistory.ts` — TypeScript adapter (build, search, export)
- `src/observatory/web/thinkingViewer.js` — Web interface component
- `src/observatory/web/style.css` — Styling for thinking history panel
- `src/observatory/web/index.html` — HTML structure (thinking panel)
