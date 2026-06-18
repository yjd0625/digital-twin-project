import pathlib
p = pathlib.Path("D:/DesktopFile/digital-twin-project/frontend/src/main.js")
c = p.read_text("utf-8")
print(f"Restored: {len(c)} bytes")
