import pathlib
p = pathlib.Path("D:/DesktopFile/digital-twin-project/frontend/src/main.js")
c = p.read_text("utf-8")
# Find the addToScene function
idx = c.find("function addToScene")
if idx >= 0:
    print(f"addToScene at {idx}")
    # Show what follows
    print(c[idx:idx+50])
else:
    print("addToScene not found")
# Also try to find importModelFile
idx2 = c.find("function importModelFile")
if idx2 >= 0:
    print(f"importModelFile at {idx2}")
    print(c[idx2:idx2+60])
else:
    print("importModelFile not found")
# Find if (ext 
idx3 = c.find("if (ext ")
if idx3 >= 0:
    print(f"if (ext at {idx3}")
    print(c[idx3:idx3+80])
