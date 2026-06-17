import pathlib
p = pathlib.Path("D:/DesktopFile/digital-twin-project/frontend/src/main.js")
c = p.read_text("utf-8")

# 1) Faster lerp
c = c.replace("camera.position.lerp(_targetCamPos, 0.06)", "camera.position.lerp(_targetCamPos, 0.12)")
c = c.replace("controls.target.lerp(_targetCtrlTarget, 0.06)", "controls.target.lerp(_targetCtrlTarget, 0.12)")

# 2) Cancel on pointerdown
c = c.replace("_ptrDown.x = e.clientX; _ptrDown.y = e.clientY;\n  _targetCamPos = null; // user input",
              "_ptrDown.x = e.clientX; _ptrDown.y = e.clientY;")

old_ptr = "_ptrDown.x = e.clientX; _ptrDown.y = e.clientY;"
new_ptr = "_ptrDown.x = e.clientX; _ptrDown.y = e.clientY;\n    _targetCamPos = null; // user input cancels transition"
c = c.replace(old_ptr, new_ptr)

# 3) Rewrite importModelFile with DXF support
old_import = "    function importModelFile(file) {"
# Find the exact import function boundaries
idx_start = c.find("    function importModelFile(file) {")
idx_end = c.find("    function savePositions() {", idx_start)
if idx_start >= 0 and idx_end > idx_start:
    new_func = '''    function importModelFile(file) {
      const name = file.name;
      const ext = name.split(".").pop().toLowerCase();
      const label = name.replace(/\\.[^.]+$/, "");
      function addToScene(obj, sizeY) {
        const div = document.createElement("div");
        div.textContent = label;
        div.style.cssText = "color:white;font:bold 13px Arial;text-shadow:1px 1px 3px rgba(0,0,0,0.8);background:rgba(0,0,0,0.5);padding:2px 8px;border-radius:10px;border:1px solid #00aaff";
        const lbl = new CSS2DObject(div); lbl.position.set(0, sizeY / 2 + 0.5, 0); obj.add(lbl);
        scene.add(obj); allModelInstances.push(obj); selectObject(obj);
        console.log("Imported:", name);
      }
      if (ext === "dxf") {
        const reader = new FileReader();
        reader.onload = function(e) {
          import("three/addons/loaders/DXFLoader.js").then(function(m) {
            try {
              const group = new m.DXFLoader().parse(e.target.result);
              group.rotation.x = -Math.PI / 2;
              group.updateMatrixWorld(true);
              const box = new THREE.Box3().setFromObject(group);
              const center = box.getCenter(new THREE.Vector3());
              const size = box.getSize(new THREE.Vector3());
              const maxDim = Math.max(size.x, size.y, size.z);
              const sc = maxDim > 0 ? 3 / maxDim : 1;
              group.scale.set(sc, sc, sc);
              group.position.set(-center.x * sc, -box.min.y * sc, -center.z * sc);
              addToScene(group, size.y * sc);
            } catch(e) { console.error("DXF load failed:", e); }
          });
        };
        reader.readAsText(file);
      } else {
        const reader = new FileReader();
        reader.onload = async function() {
          const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
          try {
            const gltf = await (new GLTFLoader()).loadAsync(URL.createObjectURL(file));
            const mdl = gltf.scene;
            const box = new THREE.Box3().setFromObject(mdl);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const sc = maxDim > 0 ? 3 / maxDim : 1;
            mdl.scale.set(sc, sc, sc);
            mdl.position.set(-center.x * sc, -box.min.y * sc, -center.z * sc);
            mdl.traverse(function(ch) { if (ch.isMesh) { ch.castShadow = true; ch.receiveShadow = true; } });
            addToScene(mdl, size.y * sc);
          } catch(e) { console.error(e); }
          URL.revokeObjectURL(reader.result);
        };
        reader.readAsDataURL(file);
      }
    }
'''
    c = c[:idx_start] + new_func + c[idx_end:]
    p.write_text(c, "utf-8")
    print("main.js updated")
else:
    print(f"idx_start={idx_start} idx_end={idx_end}")
