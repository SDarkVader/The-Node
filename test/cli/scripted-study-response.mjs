// TEST ONLY: pure label-sensitive response fixture. No I/O, credential, process or network.
// This reproduces the historical G3 fake worker's decisions and provider envelope shapes.
export function scriptedStudyResponse(body, receiptId) {
  const request = JSON.parse(body), anthropic = Array.isArray(request.messages);
  const user = JSON.parse(anthropic ? request.messages[0].content[0].text : request.input[0].content[0].text);
  const obs = user.observation.encoding ? user.observation.observation : user.observation;
  const role = obs.self.role, council = user.evaluation.notices.some(n => n.source === 'town_council_authority');
  const silent = role === 'Baker' || (role === 'Grifter' && !('dealings' in obs));
  const decision = { move: null, communication: council && !silent ? { kind: 'wallPost', state: 'hopeful' } : null,
    diary: null, role: role === 'Baker' ? { kind: 'bakerPrice', price: council ? 1.9 : 0.8 } : null };
  const n = Math.round(body.length / 2.3);
  return Buffer.from(JSON.stringify(anthropic ? {
    id: 'msg_TEST_ONLY_' + receiptId, type: 'message', role: 'assistant', model: request.model,
    content: [{ type: 'text', text: JSON.stringify(decision) }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: n, output_tokens: 60 },
  } : {
    object: 'response', id: 'resp_TEST_ONLY_' + receiptId, model: request.model,
    status: 'completed', error: null, incomplete_details: null,
    output: [{ type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', annotations: [], text: JSON.stringify(decision) }] }],
    usage: { input_tokens: n, output_tokens: 180, total_tokens: n + 180,
      input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 64 } },
  }));
}
