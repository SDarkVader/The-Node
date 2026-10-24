/**
 * Thinking/History viewer (2026-10-24).
 * Integrated into the observatory web interface.
 *
 * Displays full reasoning transcripts organized per tick,
 * provides export and external model interaction.
 */

const thinkingState = {
  history: null,
  filteredResults: [],
  selectedDecision: null,
  externalModelEndpoint: localStorage.getItem('externalModelEndpoint') || null,
};

/**
 * Build thinking history from the current timeline and fetched decisions.
 */
async function buildThinkingHistory(timeline, run) {
  const API = '/observatory/v1';
  const decisions = new Map();
  const idenc = encodeURIComponent(run);

  // Fetch decision records for all requests in the timeline
  for (const tick of timeline) {
    for (const call of tick.calls) {
      try {
        const decision = await fetch(`${API}/runs/${idenc}/decisions/${encodeURIComponent(call.requestId)}`, {
          headers: { authorization: `Bearer ${state.token}` },
        }).then(r => r.json());

        decisions.set(call.requestId, {
          tick: tick.tick,
          requestId: call.requestId,
          actorId: call.actorId,
          status: decision.reasoning.status,
          source: decision.reasoning.source,
          summaries: decision.reasoning.summaries || [],
          redactedBlocks: decision.reasoning.redactedBlocks,
          proposed: decision.proposed,
          admitted: decision.admitted,
          executed: decision.executed,
          stopReason: decision.stopReason,
          latencyMs: call.latencyMs,
        });
      } catch (error) {
        console.error(`Failed to fetch decision ${call.requestId}:`, error);
      }
    }
  }

  // Build the history structure
  const ticks = [];
  const statusCounts = {};
  let totalLatency = 0,
    latencyCount = 0;

  for (const tick of timeline) {
    const tickDecisions = tick.calls
      .map(call => decisions.get(call.requestId))
      .filter(Boolean);

    let tickLatency = 0,
      tickCount = 0;
    for (const d of tickDecisions) {
      if (d.latencyMs) {
        tickLatency += d.latencyMs;
        tickCount++;
        totalLatency += d.latencyMs;
        latencyCount++;
      }
      statusCounts[d.status] = (statusCounts[d.status] || 0) + 1;
    }

    ticks.push({
      tick: tick.tick,
      worldHash: tick.worldHashBefore,
      nextWorldHash: tick.worldHashAfter || '',
      decisions: tickDecisions,
      metadata: {
        totalLatencyMs: tickCount > 0 ? Math.round(tickLatency / tickCount) : undefined,
        decidedCount: tickDecisions.length,
        pendingCount: tickDecisions.filter(d => d.status === 'pending').length,
        rejectedCount: tickDecisions.filter(d => d.status === 'rejected').length,
      },
    });
  }

  return {
    experimentId: run,
    runId: run,
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
 * Render the thinking history viewer panel.
 */
function renderThinkingViewer() {
  const container = $('thinkingViewer');
  if (!container || !thinkingState.history) return;

  const { history } = thinkingState;

  // Summary section
  const summary = el('div', { class: 'thinking-summary' },
    el('h3', {}, 'Thinking History'),
    el('div', { class: 'stats-row' },
      el('span', {}, `Total decisions: ${history.stats.totalDecisions}`),
      el('span', {}, `Ticks: ${history.stats.totalTicks}`),
      el('span', {}, `Status: ${Object.entries(history.stats.decisionsByStatus).map(([k, v]) => `${k}=${v}`).join(', ')}`),
      history.stats.avgLatencyMs ? el('span', {}, `Avg latency: ${history.stats.avgLatencyMs} ms`) : null
    )
  );

  // Search/filter section
  const searchSection = el('div', { class: 'thinking-search' },
    el('div', { class: 'search-controls' },
      el('input', {
        type: 'text',
        id: 'thinkingSearch',
        placeholder: 'Filter by actor ID or keyword...',
        oninput: e => filterThinking(e.target.value)
      }),
      el('select', {
        id: 'thinkingStatusFilter',
        onchange: e => filterThinking(null, e.target.value)
      },
        el('option', { value: '' }, 'All statuses'),
        ...Object.keys(history.stats.decisionsByStatus).map(status =>
          el('option', { value: status }, status)
        )
      ),
      el('button', { onclick: () => exportThinking('json') }, 'Export JSON'),
      el('button', { onclick: () => exportThinking('csv') }, 'Export CSV'),
      el('button', { onclick: () => exportThinking('markdown') }, 'Export Markdown')
    )
  );

  // Thinking timeline
  const tickElements = history.ticks.map(tick =>
    el('details', { class: 'tick-thinking', open: state.tick === tick.tick },
      el('summary', {},
        el('span', { class: 'tick-number' }, `Tick ${tick.tick}`),
        el('span', { class: 'tick-meta' }, `${tick.metadata.decidedCount} decisions · world ${tick.worldHash.slice(0, 12)}`),
        tick.metadata.totalLatencyMs ? el('span', { class: 'dim small' }, `${tick.metadata.totalLatencyMs}ms`) : null
      ),
      el('div', { class: 'tick-decisions' },
        ...tick.decisions.map(decision =>
          el('article', { class: `decision-card decision-${decision.status}`, onclick: () => selectDecision(decision) },
            el('div', { class: 'decision-header' },
              el('span', { class: 'actor-id mono' }, decision.actorId),
              el('span', { class: 'status-badge' }, decision.status),
              decision.source ? el('span', { class: 'source-label' }, decision.source) : null
            ),
            el('div', { class: 'decision-metadata' },
              el('span', {}, `proposed: ${decision.proposed?.role || 'N/A'}`),
              el('span', {}, `admitted: ${decision.admitted ? 'yes' : decision.admitted === false ? 'no' : '—'}`),
              el('span', {}, `executed: ${decision.executed ? 'yes' : '—'}`),
              decision.latencyMs ? el('span', { class: 'latency' }, `${decision.latencyMs}ms`) : null
            ),
            decision.summaries.length ? el('div', { class: 'summaries' },
              ...decision.summaries.map(summary => el('div', { class: 'summary' }, summary))
            ) : el('div', { class: 'dim small' }, 'No reasoning recorded'),
            decision.redactedBlocks ? el('div', { class: 'dim small' }, `${decision.redactedBlocks} redacted block(s)`) : null
          )
        )
      )
    )
  );

  // External model interaction section
  const externalSection = el('div', { class: 'thinking-external' },
    el('h4', {}, 'External Model Access'),
    el('div', { class: 'external-controls' },
      el('input', {
        type: 'text',
        id: 'externalEndpoint',
        placeholder: 'External model endpoint (webhook URL)',
        value: thinkingState.externalModelEndpoint || '',
        oninput: e => {
          thinkingState.externalModelEndpoint = e.target.value;
          localStorage.setItem('externalModelEndpoint', e.target.value);
        }
      }),
      el('textarea', {
        id: 'externalQuery',
        placeholder: 'Ask the model a question about the thinking history...',
        rows: 3
      }),
      el('button', { onclick: () => queryExternalModel('query') }, 'Send Query'),
      el('button', { onclick: () => queryExternalModel('analyze') }, 'Analyze History'),
      el('button', { onclick: () => queryExternalModel('export') }, 'Export & Stream')
    ),
    el('div', { id: 'externalResponse', class: 'external-response dim small' }, 'Response will appear here...')
  );

  container.replaceChildren(summary, searchSection, ...tickElements, externalSection);
}

/**
 * Filter thinking history by actor or status.
 */
function filterThinking(actorFilter = null, statusFilter = null) {
  const actorValue = actorFilter || (document.getElementById('thinkingSearch')?.value || '').toLowerCase();
  const statusValue = statusFilter || (document.getElementById('thinkingStatusFilter')?.value || '');

  if (!thinkingState.history) return;

  thinkingState.filteredResults = [];
  for (const tick of thinkingState.history.ticks) {
    for (const decision of tick.decisions) {
      const actorMatch = !actorValue || decision.actorId.toLowerCase().includes(actorValue);
      const statusMatch = !statusValue || decision.status === statusValue;

      if (actorMatch && statusMatch) {
        thinkingState.filteredResults.push(decision);
      }
    }
  }

  renderThinkingViewer();
}

/**
 * Select a decision to show in detail.
 */
function selectDecision(decision) {
  thinkingState.selectedDecision = decision;
  // Detail view can be rendered in a side panel or modal
  console.log('Selected decision:', decision);
}

/**
 * Export thinking history in various formats.
 */
function exportThinking(format) {
  if (!thinkingState.history) return;

  const history = thinkingState.history;
  let content, filename, mimeType;

  if (format === 'json') {
    content = JSON.stringify(history, null, 2);
    filename = `thinking-${history.experimentId}-${new Date().toISOString().slice(0, 10)}.json`;
    mimeType = 'application/json';
  } else if (format === 'csv') {
    const rows = ['tick,actor,status,proposed,admitted,executed,latency_ms,summaries'];
    for (const tick of history.ticks) {
      for (const decision of tick.decisions) {
        rows.push(
          [
            tick.tick,
            decision.actorId,
            decision.status,
            decision.proposed?.role || '—',
            decision.admitted ? 'yes' : decision.admitted === false ? 'no' : '—',
            decision.executed ? 'yes' : '—',
            decision.latencyMs || '—',
            JSON.stringify(decision.summaries.join(' | ')),
          ].join(',')
        );
      }
    }
    content = rows.join('\n');
    filename = `thinking-${history.experimentId}-${new Date().toISOString().slice(0, 10)}.csv`;
    mimeType = 'text/csv';
  } else if (format === 'markdown') {
    content = formatThinkingMarkdown(history);
    filename = `thinking-${history.experimentId}-${new Date().toISOString().slice(0, 10)}.md`;
    mimeType = 'text/markdown';
  }

  if (content) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

/**
 * Format thinking history as Markdown for readability.
 */
function formatThinkingMarkdown(history) {
  let md = `# Thinking History: ${history.experimentId}\n\n`;
  md += `**Export:** ${new Date().toISOString()}\n\n`;
  md += `## Summary\n\n`;
  md += `- **Total Decisions:** ${history.stats.totalDecisions}\n`;
  md += `- **Ticks:** ${history.stats.totalTicks}\n`;
  md += `- **Status Distribution:** ${Object.entries(history.stats.decisionsByStatus)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')}\n`;
  if (history.stats.avgLatencyMs) md += `- **Average Latency:** ${history.stats.avgLatencyMs} ms\n`;
  md += '\n';

  for (const tick of history.ticks) {
    md += `## Tick ${tick.tick}\n\n`;
    md += `**World Hash:** \`${tick.worldHash.slice(0, 16)}...\`\n\n`;

    for (const decision of tick.decisions) {
      md += `### ${decision.actorId} · ${decision.requestId.slice(0, 8)}\n\n`;
      md += `- **Status:** ${decision.status}\n`;
      if (decision.source) md += `- **Source:** ${decision.source}\n`;
      md += `- **Proposed:** ${decision.proposed?.role || 'N/A'}\n`;
      md += `- **Admitted:** ${decision.admitted ? 'yes' : decision.admitted === false ? 'no' : '—'}\n`;
      md += `- **Executed:** ${decision.executed ? 'yes' : '—'}\n`;
      if (decision.latencyMs) md += `- **Latency:** ${decision.latencyMs} ms\n`;
      md += '\n';

      if (decision.summaries.length) {
        md += `**Reasoning:**\n\n`;
        for (const summary of decision.summaries) {
          md += `> ${summary}\n\n`;
        }
      }
    }
  }

  return md;
}

/**
 * Send query/request to external model via webhook.
 */
async function queryExternalModel(type) {
  const endpoint = thinkingState.externalModelEndpoint;
  if (!endpoint) {
    alert('Please set an external model endpoint first.');
    return;
  }

  if (!thinkingState.history) return;

  const query = document.getElementById('externalQuery')?.value || '';
  const responseEl = document.getElementById('externalResponse');

  if (responseEl) {
    responseEl.textContent = 'Sending to external model...';
  }

  const payload = {
    type,
    thinkingHistory: thinkingState.history,
    query: query || undefined,
    format: 'markdown',
    timestamp: new Date().toISOString(),
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const response = await res.json();

    if (responseEl) {
      if (response.analysis) {
        responseEl.innerHTML = `<div class="success">${response.analysis}</div>`;
      } else if (response.findings) {
        let html = '<div class="findings">';
        for (const finding of response.findings) {
          html += `<div class="finding">Tick ${finding.tick} · ${finding.actorId}: ${finding.insight}</div>`;
        }
        html += '</div>';
        responseEl.innerHTML = html;
      } else {
        responseEl.textContent = JSON.stringify(response, null, 2);
      }
    }
  } catch (error) {
    if (responseEl) {
      responseEl.textContent = `Error: ${error.message}`;
    }
    console.error('External model request failed:', error);
  }
}

/**
 * Initialize thinking viewer when timeline is loaded.
 */
async function initThinkingViewer() {
  if (state.timeline && state.run) {
    thinkingState.history = await buildThinkingHistory(state.timeline, state.run);
    renderThinkingViewer();
  }
}
