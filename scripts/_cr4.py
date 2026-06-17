import pathlib
html = pathlib.Path("D:/DesktopFile/digital-twin-project/frontend/index.html").read_text("utf-8")
html = html.replace('accept=".glb,.gltf"', 'accept=".glb,.gltf,.dxf"')
pathlib.Path("D:/DesktopFile/digital-twin-project/frontend/index.html").write_text(html, "utf-8")
print("index.html updated")
