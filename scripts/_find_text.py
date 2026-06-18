import pathlib
p = pathlib.Path("D:/DesktopFile/digital-twin-project/frontend/src/main.js")
c = p.read_text("utf-8")
# Find key markers
for term in ["importModelFile", "addToScene", "dxf", "dwg", "allModelInstances", "Function importModelFile"]:
    idx = c.find(term)
    if idx >= 0:
        print(f"FOUND '{term}' at {idx}: {c[idx:idx+80]}")
    else:
        print(f"NOT FOUND: {term}")
# Also check file length
print(f"File length: {len(c)}")
