import { writeFileSync } from 'node:fs';

// Real measured grid — createWorld(7, DEFAULT_WORLD_CONFIG) stepped 220 days.
// Token grammar: "." void | "_s" street | "_p" plaza | "GLYPH:STATE:HEAT" (F/B/V filled,
// backstopped, vacant; N = building carrying no role slot).
const GRID = [
  '. . . . D:F:0 . _s .:N:0 M:F:0.497 X:F:0 . . . .',
  '. . . . . . .:N:0 _s M:B:0 _s X:F:0 . . .',
  '. . _s _s .:N:0 _s .:N:0 D:F:0 X:F:0 J:B:0 J:F:0 _s _s .',
  '. C:F:0 . _s D:F:0 B:B:0 M:F:0.498 .:N:0 J:B:0 B:F:0.08 .:N:0 X:F:0 . J:F:0',
  'M:F:0.488 C:F:0 _s .:N:0 _s .:N:0 D:F:0 _p _s M:F:0.489 M:F:0.49 _s C:F:0 M:F:0.474',
  '_s C:B:0 _s . .:N:0 _s _s _s C:F:0 _s B:F:0.084 _s X:F:0 B:F:0.072',
  '@ . . _s . _s .:N:0 B:B:0 C:V:0 .:N:0 . _s D:F:0 .',
  '. . . . X:F:0 J:F:0 .:N:0 M:F:0.499 J:F:0 M:F:0.498 D:B:0 .:N:0 . .',
  '. . . . . _s .:N:0 _s B:F:0.086 _s C:F:0 . . .',
  '. . . . . . B:F:0.081 . _s . . . . .',
  '. . . . . . .:N:0 D:F:0 _s . . . . .',
  '. . . . . . . B:F:0.061 . . . . . .',
];

const STATUS = {
  day: 220, pop: 64, grifters: 26, filled: 38, slots: 46,
  flour: '0.050', health: 0.896, healthExp: 0.809, tension: 0.08, gini: 0.662,
};

const DIRECTIONS = [
  {
    file: 'Ember', title: 'Ember',
    blurb: 'Warm, low, lamplit. The settlement reads as a town at dusk; scarcity glows.',
    ground: '#0d0a08', panel: '#100c09', calm: '#14100c', tense: '#43170f',
    cool: '#4a6b7a', hot: '#ffab3e', street: '#2f2822', plain: '#4a4038',
    ink: '#d9c9b0', dim: '#7d6f5f', wall: '#efdcae', plaza: '#b09056',
    scan: false, font: "'JetBrains Mono', ui-monospace, monospace",
  },
  {
    file: 'Signal', title: 'Signal',
    blurb: 'Cold, clinical, observed. Reads like surveillance rather than habitation.',
    ground: '#06090d', panel: '#080c12', calm: '#0a1018', tense: '#123644',
    cool: '#2e5f78', hot: '#8ceaff', street: '#1a2430', plain: '#33414f',
    ink: '#bcd4e0', dim: '#5f7686', wall: '#e8f6ff', plaza: '#5a8296',
    scan: false, font: "'IBM Plex Mono', ui-monospace, monospace",
  },
  {
    file: 'Phosphor', title: 'Phosphor',
    blurb: 'One hue, brightness only — a CRT. Most authentically terminal; least literal.',
    ground: '#0a0700', panel: '#0c0900', calm: '#0e0a01', tense: '#33200a',
    cool: '#5a3d0a', hot: '#ffc247', street: '#241a05', plain: '#3d2c08',
    ink: '#ffb32e', dim: '#8a6318', wall: '#ffe9b0', plaza: '#a87d20',
    scan: true, font: "'JetBrains Mono', ui-monospace, monospace",
  },
  {
    file: 'Ledger', title: 'Ledger',
    blurb: 'Paper and ink. Breaks the terminal cliché entirely — a surveyor’s map of the node.',
    ground: '#efe9dc', panel: '#e8e1d1', calm: '#efe9dc', tense: '#dcc3b6',
    cool: '#8b9aa2', hot: '#b4451f', street: '#cfc7b6', plain: '#a9a091',
    ink: '#2a2622', dim: '#8a8175', wall: '#2a2622', plaza: '#93764a',
    scan: false, font: "'IBM Plex Mono', ui-monospace, monospace",
  },
];

const fontLink = (font) =>
  font.includes('JetBrains')
    ? '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap">'
    : '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&display=swap">';

function build(d) {
  const scanCss = d.scan
    ? `.scan{position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(180deg,rgba(0,0,0,.34) 0px,rgba(0,0,0,.34) 1px,transparent 1px,transparent 3px);}`
    : `.scan{display:none;}`;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  ${fontLink(d.font)}
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  ${fontLink(d.font)}
  <style>
    body { margin: 0; }
    a { color: ${d.hot}; } a:hover { color: ${d.ink}; }
    ${scanCss}
  </style>
</helmet>
<div style="position:relative;width:840px;height:600px;background:${d.ground};font-family:${d.font};padding:26px 28px;box-sizing:border-box;color:${d.ink}">
  <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
    <div style="font-size:15px;font-weight:700;letter-spacing:.16em;text-transform:uppercase">${d.title}</div>
    <div style="font-size:11px;color:${d.dim};letter-spacing:.08em">{{modeLabel}}</div>
  </div>
  <div style="font-size:11px;color:${d.dim};margin-bottom:16px;max-width:520px;line-height:1.5">${d.blurb}</div>

  <div style="display:flex;gap:30px;align-items:flex-start">
    <div style="position:relative">
      <sc-for list="{{rows}}" as="row" hint-placeholder-count="12">
        <div style="display:flex;line-height:1">
          <sc-for list="{{row.cells}}" as="c" hint-placeholder-count="14">
            <span style="{{c.style}}">{{c.ch}}</span>
          </sc-for>
        </div>
      </sc-for>
      <div class="scan"></div>
    </div>

    <div style="display:flex;flex-direction:column;gap:9px;font-size:11.5px;min-width:236px">
      <div style="font-size:22px;font-weight:700;letter-spacing:.04em;line-height:1">Day ${STATUS.day}</div>
      <div style="height:1px;background:${d.plain};opacity:.5"></div>
      <div style="display:flex;justify-content:space-between"><span style="color:${d.dim}">Population</span><span>${STATUS.pop}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:${d.dim}">Grifters</span><span>${STATUS.grifters}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:${d.dim}">Roles held</span><span>${STATUS.filled}/${STATUS.slots}</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:${d.dim}">Flour</span><span>${STATUS.flour}</span></div>
      <div style="height:1px;background:${d.plain};opacity:.5"></div>
      <sc-for list="{{meters}}" as="m" hint-placeholder-count="4">
        <div style="display:flex;flex-direction:column;gap:3px">
          <div style="display:flex;justify-content:space-between"><span style="color:${d.dim}">{{m.name}}</span><span>{{m.value}}</span></div>
          <div style="height:5px;background:${d.plain};opacity:.85;border-radius:1px;overflow:hidden">
            <div style="{{m.barStyle}}"></div>
          </div>
        </div>
      </sc-for>
      <div style="height:1px;background:${d.plain};opacity:.5"></div>
      <div style="color:${d.dim};line-height:1.7">
        <div><span style="color:${d.hot};font-weight:700">M</span> miller &nbsp; <span style="color:${d.ink}">B</span> baker &nbsp; <span style="color:${d.ink}">C</span> courier</div>
        <div><span style="color:${d.ink}">J</span> journalist &nbsp; <span style="color:${d.ink}">D</span> detective &nbsp; <span style="color:${d.ink}">X</span> import</div>
        <div><span style="color:${d.wall};font-weight:700">#</span> the Wall &nbsp; <span style="color:${d.plaza}">+</span> plaza</div>
        <div>UPPER held &nbsp; <span style="opacity:.5">dim backstopped</span> &nbsp; <span style="opacity:.3">lower vacant</span></div>
      </div>
    </div>
  </div>
</div>
</x-dc>
<script data-dc-script data-props='{
  "rangeMode": {"editor":"enum","options":["auto-ranged","raw 0-1"],"default":"auto-ranged","section":"Signal"},
  "showTension": {"editor":"boolean","default":true,"section":"Signal"},
  "hot": {"editor":"color","default":"${d.hot}","section":"Palette"},
  "cool": {"editor":"color","default":"${d.cool}","section":"Palette"},
  "cellW": {"editor":"range","min":12,"max":30,"step":1,"default":20,"unit":"px","section":"Grid"}
}'>
class Component extends DCLogic {
  hexToRgb(h) {
    const s = String(h).replace('#','');
    const n = s.length === 3 ? s.split('').map(c=>c+c).join('') : s;
    return [parseInt(n.slice(0,2),16), parseInt(n.slice(2,4),16), parseInt(n.slice(4,6),16)];
  }
  mix(a, b, t) {
    const A = this.hexToRgb(a), B = this.hexToRgb(b);
    const u = Math.max(0, Math.min(1, t));
    return 'rgb(' + A.map((v,i)=>Math.round(v+(B[i]-v)*u)).join(',') + ')';
  }
  renderVals() {
    const grid = ${JSON.stringify(GRID)};
    const hot = this.props.hot ?? '${d.hot}';
    const cool = this.props.cool ?? '${d.cool}';
    const w = this.props.cellW ?? 20;
    const ranged = (this.props.rangeMode ?? 'auto-ranged') === 'auto-ranged';
    const showTension = this.props.showTension !== false;
    // THE dynamic-range decision, made visible: observed heat tops out near 0.5 and
    // district tension sits near 0.08, so a naive 0..1 ramp renders the whole node flat.
    const HEAT_OBSERVED_MAX = 0.5;
    const TENSION_OBSERVED_MAX = 0.25;
    const tension = showTension ? (ranged ? ${STATUS.tension} / TENSION_OBSERVED_MAX : ${STATUS.tension}) : 0;
    const groundCell = this.mix('${d.calm}', '${d.tense}', tension);
    const base = 'display:inline-block;width:' + w + 'px;height:' + Math.round(w*1.35) + 'px;line-height:' + Math.round(w*1.35) + 'px;text-align:center;font-size:' + Math.round(w*0.78) + 'px;';
    const STATE_ALPHA = { F: 1, B: 0.5, V: 0.3, N: 0.42 };

    const rows = grid.map((line) => ({
      cells: line.split(' ').map((tok) => {
        if (tok === '.') return { ch: '\\u00a0', style: base + 'background:transparent' };
        if (tok === '@') return { ch: '#', style: base + 'background:' + groundCell + ';color:${d.wall};font-weight:700' };
        if (tok === '_s') return { ch: ':', style: base + 'background:' + groundCell + ';color:${d.street}' };
        if (tok === '_p') return { ch: '+', style: base + 'background:' + groundCell + ';color:${d.plaza}' };
        const [g, st, h] = tok.split(':');
        const heat = parseFloat(h) || 0;
        if (g === '.') return { ch: '.', style: base + 'background:' + groundCell + ';color:${d.plain}' };
        const t = ranged ? heat / HEAT_OBSERVED_MAX : heat;
        const colour = this.mix(cool, hot, t);
        const alpha = STATE_ALPHA[st] ?? 1;
        const weight = st === 'F' && t > 0.6 ? ';font-weight:700' : '';
        return {
          ch: st === 'V' ? g.toLowerCase() : g,
          style: base + 'background:' + groundCell + ';color:' + colour + ';opacity:' + alpha + weight,
        };
      }),
    }));

    const meter = (name, value, max) => ({
      name, value: value.toFixed(3),
      barStyle: 'height:100%;width:' + Math.round((value/max)*100) + '%;background:' + this.mix(cool, hot, value/max),
    });

    return {
      rows,
      modeLabel: ranged ? 'auto-ranged signal' : 'raw 0-1 signal',
      meters: [
        meter('Health', ${STATUS.health}, 1),
        meter('Health w/ exp', ${STATUS.healthExp}, 1),
        meter('Tension', ${STATUS.tension}, ranged ? 0.25 : 1),
        meter('Gini', ${STATUS.gini}, 1),
      ],
    };
  }
}
</script>
</body>
</html>
`;
}

for (const d of DIRECTIONS) {
  writeFileSync(`design/playtest-aesthetics/${d.file}.dc.html`, build(d));
  console.log('wrote', d.file);
}
