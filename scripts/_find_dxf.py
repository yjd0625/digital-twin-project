import pathlib, re
p = pathlib.Path("D:/DesktopFile/digital-twin-project/frontend/src/main.js")
c = p.read_text("utf-8")
# Find all dxf occurrences
for m in re.finditer(r'.{0,20}dxf.{0,30}', c, re.IGNORECASE):
    print(m.group().strip())
