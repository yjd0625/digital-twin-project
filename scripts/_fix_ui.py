import pathlib

# 1) index.html — 复位按钮移到俯视/正视/侧视后面
html = pathlib.Path("D:/DesktopFile/digital-twin-project/frontend/index.html")
c = html.read_text("utf-8")
c = c.replace(
    '<button id="btn-reset">\u590d\u4f4d</button>\n        <button id="btn-top">\u4fef\u89c6</button>',
    '<button id="btn-top">\u4fef\u89c6</button>\n        <button id="btn-front">\u6b63\u89c6</button>\n        <button id="btn-side">\u4fa7\u89c6</button>\n        <button id="btn-reset">\u590d\u4f4d</button>'
)
html.write_text(c, "utf-8")
print("1/3 index.html updated")

# 2) main.js — 移除按钮直接绑定，改为通过 extra 传入
main = pathlib.Path("D:/DesktopFile/digital-twin-project/frontend/src/main.js")
c2 = main.read_text("utf-8")
c2 = c2.replace(
    'document.getElementById("btn-reset")?.addEventListener("click", function() { importer.resetPositions(); });\n\n',
    ""
)
c2 = c2.replace(
    'const ui = setupUI(controls, sendCommand, { onView: importer.setView });',
    'const ui = setupUI(controls, sendCommand, { onView: importer.setView, onReset: importer.resetPositions });'
)
main.write_text(c2, "utf-8")
print("2/3 main.js updated")

# 3) ui.js — 添加复位按钮处理器
ui = pathlib.Path("D:/DesktopFile/digital-twin-project/frontend/src/ui.js")
c3 = ui.read_text("utf-8")
c3 = c3.replace(
    "  return { updateInfo };",
    '  // \u590d\u4f4d\u6309\u94ae\n  document.getElementById("btn-reset")?.addEventListener("click", () => extra?.onReset?.());\n\n  return { updateInfo };'
)
ui.write_text(c3, "utf-8")
print("3/3 ui.js updated")
