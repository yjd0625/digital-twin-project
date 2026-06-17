import pathlib
p = pathlib.Path("D:/DesktopFile/digital-twin-project/frontend/src/main.js")
content = p.read_text(encoding="utf-8")

# Find the right insertion point - right after the device creation and dataHandler
insertion = '''const device = createDefaultDevice(scene, { label: "\u8bbe\u5907 #1" });
const dataHandler = new DataHandler({ cube: device });'''

model_code = '''const device = createDefaultDevice(scene, { label: "\u8bbe\u5907 #1" });
const dataHandler = new DataHandler({ cube: device });

// --- load real 3D model in background, fallback to cube ---
import("./models.js").then(({ loadGLTFModel }) => {
  loadGLTFModel(scene, "/models/assembleStation.glb", { label: "\u7ec4\u88c5\u5de5\u4f4d" })
    .then((model) => {
      scene.remove(device);
      dataHandler.objects.cube = model;
      console.log("3D model loaded: assembleStation.glb");
    })
    .catch((e) => console.warn("Model load failed, keeping cube:", e));
});'''

content = content.replace(insertion, model_code)
p.write_text(content, encoding="utf-8")
print("main.js updated with model loading")
