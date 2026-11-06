import json, sys
p = sys.argv[1] if len(sys.argv) > 1 else 'src/cases/case_06_wall/case.json'
d = json.load(open(p, encoding='utf-8'))
print('TOP KEYS', list(d.keys()))
print('PARTIES KEYS', list((d.get('parties') or {}).keys()))
for pid, pt in (d.get('parties') or {}).items():
    print('---', pid)
    for k, v in pt.items():
        if k in ('fallback', 'hidden', 'needs', 'triggers', 'baseline', 'name', 'role', 'job', 'age'):
            print('  ', k, '=', json.dumps(v, ensure_ascii=False)[:600])
print('SCENE0', json.dumps((d.get('scenes') or [{}])[0], ensure_ascii=False)[:1500])
print('FACTS sample', json.dumps((d.get('facts') or [])[:2], ensure_ascii=False)[:800])
print('DIMS sample', json.dumps((d.get('dimensions') or [])[:1], ensure_ascii=False)[:1200])
