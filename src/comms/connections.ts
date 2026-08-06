/**
 * A player's sphere of influence (§4.3) — no persistent global graph, just per-edge
 * connection strength. The rumour mill reads this; the eventual renderer would too
 * (as proximity/transit pulses and clustering, never as drawn edges).
 */
export class ConnectionGraph {
  private edges = new Map<string, Map<string, number>>();

  connect(a: string, b: string, weight: number): void {
    if (weight <= 0 || weight > 1) {
      throw new Error(`connection weight must be in (0, 1], got ${weight}`);
    }
    this.edge(a).set(b, weight);
    this.edge(b).set(a, weight);
  }

  neighbors(playerId: string): Array<{ id: string; weight: number }> {
    const edges = this.edges.get(playerId);
    if (!edges) return [];
    return [...edges.entries()].map(([id, weight]) => ({ id, weight }));
  }

  private edge(playerId: string): Map<string, number> {
    let m = this.edges.get(playerId);
    if (!m) {
      m = new Map();
      this.edges.set(playerId, m);
    }
    return m;
  }
}
