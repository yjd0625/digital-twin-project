import pathlib
p = pathlib.Path("D:/DesktopFile/digital-twin-project/frontend/src/main.js")
c = p.read_text("utf-8")
# Find the DXF import section
idx = c.find('if (ext === "dxf"')
if idx >= 0:
    print(f"Found DXF import at {idx}")
    print(c[idx:idx+80])
else:
    # Try other patterns
    idx = c.find('ext === "dxf"')
    if idx >= 0:
        print(f"Found partial at {idx}: {c[idx-10:idx+80]}")
    else:
        print("DXF not found")
