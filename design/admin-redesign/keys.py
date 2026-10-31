import re, glob, sys
EN={}
for f in glob.glob('i18n/*-en.ts')+glob.glob('i18n/en*.ts'):
    t=open(f).read()
    for m in re.finditer(r"'([\w.]+)':\s*\n?\s*('(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\"|`[^`]*`)", t):
        EN[m.group(1)]=m.group(2)[1:-1]
for p in sys.argv[1:]:
    t=open(p).read()
    keys=[]
    for m in re.finditer(r"t\(\s*['`]([\w.]+)", t):
        k=m.group(1)
        if k not in keys: keys.append(k)
    # template prefixes like `x.${y}` 
    pref=set(re.findall(r"t\(\s*`([\w.]+)\.\$\{", t))
    print('#####', p)
    for k in keys: print(k, '=', EN.get(k,'?'))
    for pr in pref:
        for k,v in EN.items():
            if k.startswith(pr+'.'): print(k,'=',v)
