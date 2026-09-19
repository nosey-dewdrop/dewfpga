// minimal vcd parser: scopes, vars, value changes. good enough for lab-sized dumps.
export function parseVcd(text) {
  const signals = [];        // {id, name, width, scope}
  const byId = new Map();    // id -> [{t, v}]
  let timescale = '1s';
  const scope = [];
  let tmax = 0;
  const lines = text.split('\n');
  let i = 0;
  // header
  for (; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    if (l.startsWith('$timescale')) { const m = /\$timescale\s+([^$]+)/.exec(l + ' ' + (lines[i + 1] || '')); if (m) timescale = m[1].trim(); }
    else if (l.startsWith('$scope')) { const p = l.split(/\s+/); scope.push(p[2]); }
    else if (l.startsWith('$upscope')) scope.pop();
    else if (l.startsWith('$var')) {
      const p = l.split(/\s+/); // $var type width id name [range] $end
      const width = Number(p[2]); const id = p[3]; let name = p[4];
      if (p[5] && p[5].startsWith('[')) name += p[5];
      if (!byId.has(id)) { byId.set(id, []); signals.push({ id, name, width, scope: scope.join('.') }); }
      else signals.push({ id, name, width, scope: scope.join('.'), alias: true });
    } else if (l.startsWith('$enddefinitions')) { i++; break; }
  }
  let t = 0;
  for (; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l || l.startsWith('$')) continue;
    if (l[0] === '#') { t = Number(l.slice(1)); if (t > tmax) tmax = t; continue; }
    if (l[0] === 'b' || l[0] === 'B') { const sp = l.indexOf(' '); const v = l.slice(1, sp); const id = l.slice(sp + 1); const a = byId.get(id); if (a) a.push({ t, v }); continue; }
    if (l[0] === 'r' || l[0] === 'R') { const sp = l.indexOf(' '); const a = byId.get(l.slice(sp + 1)); if (a) a.push({ t, v: l.slice(1, sp) }); continue; }
    const v = l[0]; const id = l.slice(1); const a = byId.get(id); if (a) a.push({ t, v });
  }
  return { signals: signals.filter((s) => !s.alias), changes: byId, tmax, timescale };
}
