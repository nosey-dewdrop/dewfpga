"""Surfer's first view of a .vcd: the commands Surfer runs after loading it (surfer file.vcd --command-file x).

The same view as the browser page (templates/wave/wave.js, startVars): the testbench's own signals, without its
checking (the TEST_ONLY rule, read from wave.js, so the two viewers cannot drift apart), and the design under it as
folded groups to expand. Only the declarations are read, not a value dump that may be gigabytes; nothing is written
here, wave_page.py puts the commands in a file beside the page.
"""
import math
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
MAX_HEADER = 4 * 1024 * 1024
# a name Surfer takes on its command line as it is: escaped identifiers and the like are left to its Scope pane
SAFE = re.compile(r'[A-Za-z0-9_.$\[\]:-]+')


# *-*-*-*-*-*-*-*-*-*-*-* the rule, from wave.js *-*-*-*-*-*-*-*-*-*-*-*
def test_only_rule():
    with open(os.path.join(HERE, 'wave.js'), encoding='utf-8') as f:
        m = re.search(r'^\s*const TEST_ONLY = /(.+)/i;$', f.read(), re.M)
    if not m:
        raise ValueError('templates/wave/wave.js has no TEST_ONLY rule')
    # JavaScript's \w is ASCII; so is this one
    return re.compile(m[1], re.I | re.A)


# *-*-*-*-*-*-*-*-*-*-*-* declarations *-*-*-*-*-*-*-*-*-*-*-*
def header(path):
    data = bytearray()
    with open(path, 'rb') as stream:
        while len(data) < MAX_HEADER:
            block = stream.read(min(65536, MAX_HEADER - len(data)))
            if not block:
                break
            data.extend(block)
            if b'$enddefinitions' in data:
                break
    text = data.decode('utf-8', errors='replace')
    if '$enddefinitions' not in text:
        raise ValueError(f'{path} has no $enddefinitions in its first 4 MB: not a VCD, or its declarations are too long')
    return text.split('$enddefinitions', 1)[0]


def scopes(text):
    # the scope tree as wave.js's parseVcd builds it: whitespace-separated words, $scope/$var/$upscope ... $end
    top = {'name': '', 'type': 'root', 'path': '', 'children': [], 'vars': [], 'parent': None}
    scope, words, k = top, text.split(), 0
    while k < len(words):
        w = words[k]
        k += 1
        if not w.startswith('$'):
            continue
        fields = []
        while k < len(words) and words[k] != '$end':
            fields.append(words[k])
            k += 1
        k += 1
        if w == '$scope':
            name = fields[1] if len(fields) > 1 else '?'
            sc = {'name': name, 'type': fields[0] if fields else 'module', 'children': [], 'vars': [], 'parent': scope,
                  'path': scope['path'] + '.' + name if scope['path'] else name}
            scope['children'].append(sc)
            scope = sc
        elif w == '$upscope':
            scope = scope['parent'] or scope
        elif w == '$var' and len(fields) >= 3:
            name = fields[3] if len(fields) > 3 else fields[2]
            scope['vars'].append({'name': re.sub(r'\[[^\]]*\]$', '', name) or name, 'type': fields[0], 'scope': scope})
    return top


# *-*-*-*-*-*-*-*-*-*-*-* the first view *-*-*-*-*-*-*-*-*-*-*-*
def start_vars(top, rule):
    # wave.js startVars: down to the first scope with signals, its signals but parameters and the testbench's checking
    sc = top
    while not sc['vars'] and sc['children']:
        sc = next((c for c in sc['children'] if c['vars']), sc['children'][0])

    def test_only(v):
        return v['scope']['parent'] is not None and v['scope']['parent']['type'] == 'root' and rule.search(v['name'])
    pick = [v for v in sc['vars'] if v['type'] != 'parameter' and not test_only(v)]
    return sc, (pick or sc['vars'])[:200]


def zoom(path):
    # bounded samples, not the whole run: an overview of thousands of changes is a solid block. About 16 of the
    # testbench's steps fill the window; scroll_to_start puts time 0 at its left edge
    with open(path, 'rb') as stream:
        prefix = stream.read(1024 * 1024)
        stream.seek(max(0, os.path.getsize(path) - 1024 * 1024))
        tail = stream.read(1024 * 1024)
    first = [int(t) for t in re.findall(rb'^#(\d+)\s*$', prefix, re.M)[:32]]
    last = re.findall(rb'^#(\d+)\s*$', tail, re.M)
    if not (first and last and first[-1] > 0):
        return []
    ratio = int(last[-1]) / first[-1]
    steps = min(32, max(0, math.floor(math.log2(ratio)))) if ratio > 0 else 0
    return ['zoom_in'] * steps + ['scroll_to_start']


def commands(path):
    sc, shown = start_vars(scopes(header(path)), test_only_rule())
    if not shown and not sc['children']:
        raise ValueError(f'{path} declares no signal')
    lines = []
    for name in dict.fromkeys(sc['path'] + '.' + v['name'] for v in shown):
        if SAFE.fullmatch(name):
            lines.append('variable_add ' + name)
    # the design below the testbench, one folded group per instance, every level of it there to expand
    for child in sc['children']:
        if child['type'] == 'module' and SAFE.fullmatch(child['path']):
            lines.append('scope_add_as_group_recursive ' + child['path'])
    lines += ['group_fold_all', 'zoom_fit'] + zoom(path)
    return '\n'.join(lines) + '\n'
