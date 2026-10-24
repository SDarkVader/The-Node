/**
 * Thinking/History display adapter (2026-10-24).
 * Longitudinal reasoning organization with external model access.
 *
 * Organizes decision reasoning by tick and agent, preserves full transcripts,
 * provides export for analysis and allows queries from authorized external models.
 * No sanitization — shows actual reasoning from API calls.
 */

export interface ReasoningRecord {
  tick: number;
  requestId: string;
  actorId: string;
  status: 'pending' | 'received' | 'accepted' | 'rejected' | 'unavailable';
  source?: string; // e.g., model identifier
  summaries: string[];
  redactedBlocks?: number;
  proposed?: { role?: string; [key: string]: unknown };
  admitted?: boolean;
  executed?: boolean;
  stopReason?: string;
  latencyMs?: number;
}

export interface TickThinking {
  tick: number;
  worldHash: string;
  nextWorldHash: string;
  decisions: ReasoningRecord[];
  metadata?: {
    totalLatencyMs?: number;
    decidedCount: number;
    pendingCount: number;
    rejectedCount: number;
  };
}

export interface ThinkingHistory {
  experimentId: string;
  runId: string;
  ticks: TickThinking[];
  stats: {
    totalDecisions: number;
    totalTicks: number;
    decisionsByStatus: Record<string, number>;
    avgLatencyMs?: number;
    tokenMetrics?: { input: number; output: number };
  };
}

/**
 * Build longitudinal thinking history from timeline and decision records.
 * Preserves full reasoning transcripts without modification.
 */
export function buildThinkingHistory(
  experimentId: string,
  timeline: Array<{
    tick: number;
    worldHashBefore: string;
    worldHashAfter?: string;
    calls: Array<{ actorId: string; requestId: string }>;
  }>,
  decisions: Map<string, ReasoningRecord>
): ThinkingHistory {
  const ticks: TickThinking[] = [];
  const statusCounts: Record<string, number> = {};
  let totalLatency = 0;
  let latencyCount = 0;

  for (const tick of timeline) {
    const tickDecisions: ReasoningRecord[] = [];
    let tickLatencyTotal = 0;
    let tickLatencyCount = 0;

    for (const call of tick.calls) {
      const decision = decisions.get(call.requestId);
      if (decision) {
        tickDecisions.push(decision);
        statusCounts[decision.status] = (statusCounts[decision.status] || 0) + 1;
        if (decision.latencyMs !== undefined) {
          tickLatencyTotal += decision.latencyMs;
          tickLatencyCount++;
          totalLatency += decision.latencyMs;
          latencyCount++;
        }
      }
    }

    ticks.push({
      tick: tick.tick,
      worldHash: tick.worldHashBefore,
      nextWorldHash: tick.worldHashAfter || '',
      decisions: tickDecisions,
      metadata: {
        totalLatencyMs: tickLatencyCount > 0 ? tickLatencyTotal : undefined,
        decidedCount: tickDecisions.length,
        pendingCount: tickDecisions.filter(d => d.status === 'pending').length,
        rejectedCount: tickDecisions.filter(d => d.status === 'rejected').length,
      },
    });
  }

  return {
    experimentId,
    runId: experimentId, // same as experimentId in observatory context
    ticks,
    stats: {
      totalDecisions: decisions.size,
      totalTicks: ticks.length,
      decisionsByStatus: statusCounts,
      avgLatencyMs: latencyCount > 0 ? Math.round(totalLatency / latencyCount) : undefined,
    },
  };
}

/**
 * Export thinking history as JSON. Can be sliced by tick range.
 */
export function exportThinkingJSON(
  history: ThinkingHistory,
  tickRange?: { from: number; to: number }
): string {
  const ticks = tickRange
    ? history.ticks.filter(t => t.tick >= tickRange.from && t.tick <= tickRange.to)
    : history.ticks;

  const export_data = {
    experimentId: history.experimentId,
    exportedAt: new Date().toISOString(),
    tickRange: tickRange || { from: history.ticks[0]?.tick, to: history.ticks[history.ticks.length - 1]?.tick },
    stats: history.stats,
    ticks,
  };

  return JSON.stringify(export_data, null, 2);
}

/**
 * Export thinking history as CSV (per-decision rows).
 * Useful for analysis and comparison across ticks/actors.
 */
export function exportThinkingCSV(
  history: ThinkingHistory,
  tickRange?: { from: number; to: number }
): string {
  const ticks = tickRange
    ? history.ticks.filter(t => t.tick >= tickRange.from && t.tick <= tickRange.to)
    : history.ticks;

  const rows: string[] = [
    'tick,requestId,actorId,status,proposed.role,admitted,executed,summaries,latencyMs,source',
  ];

  for (const tick of ticks) {
    for (const decision of tick.decisions) {
      const summaryText = decision.summaries.map(s => JSON.stringify(s)).join(' | ');
      rows.push(
        [
          tick.tick,
          decision.requestId,
          decision.actorId,
          decision.status,
          decision.proposed?.role || '—',
          decision.admitted ? 'yes' : decision.admitted === false ? 'no' : '—',
          decision.executed ? 'yes' : '—',
          JSON.stringify(summaryText),
          decision.latencyMs || '—',
          decision.source || '—',
        ].join(',')
      );
    }
  }

  return rows.join('\n');
}

/**
 * Search thinking history by actor, tick range, or reasoning status.
 */
export function searchThinking(
  history: ThinkingHistory,
  query: {
    actorId?: string;
    tickFrom?: number;
    tickTo?: number;
    status?: string;
    summaryKeyword?: string;
  }
): ReasoningRecord[] {
  const results: ReasoningRecord[] = [];

  for (const tick of history.ticks) {
    if (query.tickFrom !== undefined && tick.tick < query.tickFrom) continue;
    if (query.tickTo !== undefined && tick.tick > query.tickTo) continue;

    for (const decision of tick.decisions) {
      if (query.actorId && decision.actorId !== query.actorId) continue;
      if (query.status && decision.status !== query.status) continue;
      if (query.summaryKeyword) {
        const hasKeyword = decision.summaries.some(s =>
          s.toLowerCase().includes(query.summaryKeyword!.toLowerCase())
        );
        if (!hasKeyword) continue;
      }

      results.push(decision);
    }
  }

  return results;
}

/**
 * Prepare thinking history for external model interaction.
 * Structures data for query, analysis, or streaming to other systems.
 */
export interface ExternalModelRequest {
  type: 'query' | 'analyze' | 'export' | 'stream';
  thinkingHistory: ThinkingHistory;
  query?: string; // natural language query for analysis
  tickRange?: { from: number; to: number };
  actorIds?: string[];
  format?: 'json' | 'csv' | 'markdown' | 'text';
}

export interface ExternalModelResponse {
  type: string;
  queryProvided?: string;
  analysis?: string; // structured analysis result from external model
  findings?: Array<{ tick: number; actorId: string; insight: string }>;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

/**
 * Format thinking history for streaming to an external model.
 * Provides full transcript context without redaction.
 */
export function formatForExternalModel(
  history: ThinkingHistory,
  format: 'json' | 'markdown' | 'text' = 'markdown'
): string {
  if (format === 'json') {
    return JSON.stringify(history, null, 2);
  }

  if (format === 'markdown') {
    let md = `# Thinking History: ${history.experimentId}\n\n`;
    md += `**Total Decisions:** ${history.stats.totalDecisions}  \n`;
    md += `**Ticks:** ${history.stats.totalTicks}  \n`;
    md += `**Status Distribution:** ${Object.entries(history.stats.decisionsByStatus)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ')}\n\n`;

    if (history.stats.avgLatencyMs) {
      md += `**Average Latency:** ${history.stats.avgLatencyMs} ms\n\n`;
    }

    for (const tick of history.ticks) {
      md += `## Tick ${tick.tick}\n\n`;
      md += `- **World Hash:** \`${tick.worldHash.slice(0, 12)}\`\n`;
      md += `- **Decisions:** ${tick.metadata?.decidedCount || 0} decided, ${tick.metadata?.pendingCount || 0} pending, ${tick.metadata?.rejectedCount || 0} rejected\n\n`;

      for (const decision of tick.decisions) {
        md += `### ${decision.actorId} · ${decision.requestId.slice(0, 8)}\n\n`;
        md += `**Status:** ${decision.status}  \n`;
        if (decision.source) md += `**Source:** ${decision.source}  \n`;
        if (decision.latencyMs) md += `**Latency:** ${decision.latencyMs} ms  \n`;
        md += `**Proposed:** ${decision.proposed?.role || 'N/A'}  \n`;
        md += `**Admitted:** ${decision.admitted ? 'yes' : decision.admitted === false ? 'no' : '—'}  \n`;
        md += `**Executed:** ${decision.executed ? 'yes' : '—'}\n\n`;

        if (decision.summaries.length) {
          md += `**Reasoning:**\n`;
          for (const summary of decision.summaries) {
            md += `> ${summary}\n\n`;
          }
        }

        if (decision.redactedBlocks) {
          md += `*${decision.redactedBlocks} redacted block(s)*\n\n`;
        }
      }
    }

    return md;
  }

  // Plain text format
  let text = `THINKING HISTORY: ${history.experimentId}\n`;
  text += `Decisions: ${history.stats.totalDecisions} | Ticks: ${history.stats.totalTicks}\n`;
  text += `Status: ${Object.entries(history.stats.decisionsByStatus)
    .map(([k, v]) => `${k}=${v}`)
    .join(' | ')}\n\n`;

  for (const tick of history.ticks) {
    text += `\n=== TICK ${tick.tick} ===\n`;
    text += `World: ${tick.worldHash.slice(0, 12)}\n`;

    for (const decision of tick.decisions) {
      text += `\n${decision.actorId} [${decision.requestId.slice(0, 8)}]\n`;
      text += `  Status: ${decision.status}\n`;
      if (decision.source) text += `  Source: ${decision.source}\n`;
      text += `  Proposed: ${decision.proposed?.role || 'N/A'}\n`;
      text += `  Admitted: ${decision.admitted ? 'yes' : decision.admitted === false ? 'no' : '—'}\n`;

      if (decision.summaries.length) {
        text += `  Reasoning:\n`;
        for (const summary of decision.summaries) {
          text += `    ${summary}\n`;
        }
      }
    }
  }

  return text;
}

/**
 * Build a webhook payload for streaming thinking history to external systems.
 * Includes request/response structure for bidirectional communication.
 */
export function buildExternalModelPayload(
  history: ThinkingHistory,
  request: ExternalModelRequest
): ExternalModelRequest {
  return {
    type: request.type,
    thinkingHistory: history,
    query: request.query,
    tickRange: request.tickRange,
    actorIds: request.actorIds,
    format: request.format,
  };
}
