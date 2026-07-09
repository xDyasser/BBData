#!/usr/bin/env python3
"""Bundle index.html + css + js + vendored libs into one standalone HTML file.
Run from the repo root:  python3 tools/build_single.py
"""
import os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def read(p): return open(os.path.join(root, p), encoding="utf-8").read()

html  = read("index.html")
css   = read("styles.css")
seed  = read("data-seed.js")
appjs = read("app.js")
chart = read("vendor/chart.umd.js")
xlsx  = read("vendor/xlsx.full.min.js")
jszip = read("vendor/jszip.min.js")
tmpl  = read("template-embed.js")

html = html.replace('<link rel="stylesheet" href="styles.css">', "<style>\n"+css+"\n</style>")

old_scripts = '''<script src="vendor/chart.umd.js"></script>
<script src="vendor/xlsx.full.min.js"></script>
<script src="vendor/jszip.min.js"></script>
<script src="data-seed.js"></script>
<script src="template-embed.js"></script>
<script src="app.js"></script>'''
new_scripts = (
    "<script>\n"+chart+"\n</script>\n"
    "<script>\n"+xlsx+"\n</script>\n"
    "<script>\n"+jszip+"\n</script>\n"
    "<script>\n"+seed+"\n</script>\n"
    "<script>\n"+tmpl+"\n</script>\n"
    "<script>\n"+appjs+"\n</script>"
)
assert old_scripts in html, "expected script block not found in index.html"
html = html.replace(old_scripts, new_scripts)

out = os.path.join(root, "BloodBankStatistics.html")
open(out, "w", encoding="utf-8").write(html)
print("wrote", out, f"({len(html)} bytes)")
