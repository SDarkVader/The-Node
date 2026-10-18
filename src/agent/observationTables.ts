import type { responsesObservation } from './responsesRequest.js';
type Projection = ReturnType<typeof responsesObservation>;
const PEOPLE = ['ref', 'x', 'y', 'role'] as const;
const PLOTS = ['x', 'y', 'kind'] as const;
const BUILDINGS = ['id', 'x', 'y'] as const;
const FACES = ['ref', 'hue', 'skinTone', 'faceShape', 'hairStyle', 'markCount'] as const;
const table = (rows: Record<string, unknown>[], columns: readonly string[]) => ({ columns: [...columns], rows: rows.map(row => columns.map(key => row[key])) });

/** Lossless presentation of the same whitelisted data; no truncation or new authority. */
export function packObservation(p: Projection) {
  return { encoding: 'node-observation-tables-v1' as const, observation: {
    ...p,
    city: { ...p.city, people: table(p.city.people, PEOPLE) },
    geometry: { ...p.geometry, districts: p.geometry.districts.map(d => ({ ...d, plots: table(d.plots, PLOTS), buildings: table(d.buildings, BUILDINGS) })) },
    recognition: table(p.recognition.map(r => ({ ref: r.ref, ...r.face })), FACES),
  } };
}

/** Round-trip verifier for generated tables, not an inbound game-action parser. */
export function unpackObservation(packed: ReturnType<typeof packObservation>): Projection {
  if (packed.encoding !== 'node-observation-tables-v1') throw Error('observation_encoding');
  const rows = (t: ReturnType<typeof table>, columns: readonly string[]) => {
    if (JSON.stringify(t.columns) !== JSON.stringify(columns) || !Array.isArray(t.rows) || t.rows.some(row => !Array.isArray(row) || row.length !== columns.length)) throw Error('observation_table_shape');
    return t.rows.map(row => Object.fromEntries(columns.map((key, i) => [key, row[i]])));
  };
  const p = packed.observation;
  return {
    ...p, city: { ...p.city, people: rows(p.city.people, PEOPLE) },
    geometry: { ...p.geometry, districts: p.geometry.districts.map(d => ({ ...d, plots: rows(d.plots, PLOTS), buildings: rows(d.buildings, BUILDINGS) })) },
    recognition: rows(p.recognition, FACES).map(r => ({ ref: r.ref, face: Object.fromEntries(FACES.slice(1).map(k => [k, r[k]])) })),
  } as Projection;
}
