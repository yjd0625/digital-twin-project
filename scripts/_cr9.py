import pathlib, re
p = pathlib.Path("D:/DesktopFile/digital-twin-project/frontend/src/main.js")
c = p.read_text("utf-8")

# ==== 1) Ctrl key tracking ====
if "_ctrlDown" not in c:
    c = c.replace(
        'const MOVE_STEP = 0.1;',
        'const MOVE_STEP = 0.1;\nlet _ctrlDown = false;'
    )
    c = c.replace(
        'document.addEventListener("keydown", (e) => {',
        'document.addEventListener("keydown", (e) => { if (e.key === "Control") _ctrlDown = true;'
    )
    # Need to handle the function scope - will fix after

# Add Ctrl keyup
c = c.replace(
    'document.addEventListener("keyup", () => { if (isDragging) {',
    'document.addEventListener("keyup", (e) => { if (e.key === "Control") _ctrlDown = false; });\n    document.addEventListener("keyup", () => { if (isDragging) {'
)

# ==== 2) Refactor selection to support multi-select ====
# Replace selectObject and deselectObject
old_select = """    function selectObject(obj) {
      if (selectedObject === obj) return;
      deselectObject();
      selectedObject = obj;
      selectionBox = new THREE.BoxHelper(obj, 0x00ff00);
      selectionBox.update();
      scene.add(selectionBox);
    }
    function deselectObject() {
      if (selectionBox) { scene.remove(selectionBox); selectionBox = null; }
      selectedObject = null;
    }"""

new_select = """    const selectedObjects = [];
    const selectionBoxes = {};
    function selectObject(obj, multi) {
      if (multi) {
        if (selectedObjects.indexOf(obj) >= 0) {
          // remove from selection
          if (selectionBoxes[obj.id]) { scene.remove(selectionBoxes[obj.id]); delete selectionBoxes[obj.id]; }
          var i = selectedObjects.indexOf(obj);
          if (i >= 0) selectedObjects.splice(i, 1);
          return;
        }
        selectedObjects.push(obj);
      } else {
        deselectAll();
        selectedObjects.push(obj);
      }
      var bx = new THREE.BoxHelper(obj, 0x00ff00);
      bx.update();
      scene.add(bx);
      selectionBoxes[obj.id] = bx;
    }
    function deselectAll() {
      for (var k in selectionBoxes) { scene.remove(selectionBoxes[k]); }
      for (var k in selectionBoxes) delete selectionBoxes[k];
      selectedObjects.length = 0;
    }
    function updateSelectionBoxes() {
      for (var k in selectionBoxes) selectionBoxes[k].update();
    }"""

c = c.replace(old_select, new_select)

# ==== 3) Click handler: pass _ctrlDown to selectObject ====
old_click = """      if (_raycaster.intersectObject(m, true).length > 0) {
        selectObject(m); hit = true; break;
      }
    }
    if (!hit) deselectObject();"""

new_click = """      if (_raycaster.intersectObject(m, true).length > 0) {
        selectObject(m, _ctrlDown); hit = true; break;
      }
    }
    if (!hit) deselectAll();"""

c = c.replace(old_click, new_click)

# ==== 4) Arrow key handler: use selectedObjects array ====
old_keyboard = """    document.addEventListener("keydown", (e) => {
      if (!selectedObject) return;
      let moved = true;
      switch (e.key) {
        case "ArrowUp":    selectedObject.position.x += MOVE_STEP; break;
        case "ArrowDown":  selectedObject.position.x -= MOVE_STEP; break;
        case "ArrowLeft":  selectedObject.position.z -= MOVE_STEP; break;
        case "ArrowRight": selectedObject.position.z += MOVE_STEP; break;
        case "Delete":
    { const idx = allModelInstances.indexOf(selectedObject);
    if (idx >= 0) allModelInstances.splice(idx, 1);
    scene.remove(selectedObject);
    if (dataHandler.objects.cube === selectedObject)
      dataHandler.objects.cube = allModelInstances.length > 0 ? allModelInstances[0] : null;
    deselectObject(); }
          break;
        default: moved = false;
      }
      if (moved && selectionBox) selectionBox.update();
      if (moved) savePositions();
    });"""

new_keyboard = """    document.addEventListener("keydown", (e) => {
      if (e.key === "Control") { _ctrlDown = true; return; }
      if (e.key === "Delete" && selectedObjects.length) {
        for (var i = selectedObjects.length - 1; i >= 0; i--) {
          var obj = selectedObjects[i];
          var idx = allModelInstances.indexOf(obj);
          if (idx >= 0) allModelInstances.splice(idx, 1);
          scene.remove(obj);
          if (dataHandler.objects.cube === obj)
            dataHandler.objects.cube = allModelInstances.length > 0 ? allModelInstances[0] : null;
        }
        deselectAll();
        return;
      }
      if (!selectedObjects.length) return;
      var moved = true;
      var step = _ctrlDown ? MOVE_STEP * 0.5 : MOVE_STEP;
      switch (e.key) {
        case "ArrowUp":    selectedObjects.forEach(function(o) { o.position.x += step; }); break;
        case "ArrowDown":  selectedObjects.forEach(function(o) { o.position.x -= step; }); break;
        case "ArrowLeft":  selectedObjects.forEach(function(o) { o.position.z -= step; }); break;
        case "ArrowRight": selectedObjects.forEach(function(o) { o.position.z += step; }); break;
        default: moved = false;
      }
      if (moved) { updateSelectionBoxes(); savePositions(); }
    });"""

c = c.replace(old_keyboard, new_keyboard)

# ==== 5) Shift drag: use selectedObjects (first one) ====
old_drag = """    renderer.domElement.addEventListener("pointerdown", (e) => {
      if (e.shiftKey && selectedObject) {
        isDragging = true;
        controls.enabled = false;
      }
    });"""

new_drag = """    renderer.domElement.addEventListener("pointerdown", (e) => {
      if (e.shiftKey && selectedObjects.length) {
        isDragging = true;
        controls.enabled = false;
      }
    });
    renderer.domElement.addEventListener("pointermove", (e) => {
      if (!isDragging || !selectedObjects.length) return;"""

old_drag2 = """    renderer.domElement.addEventListener("pointermove", (e) => {
      if (!isDragging || !selectedObject) return;"""

# The old text might already include the selection check - replace the whole block
# Find the exact pointermove section
idx_move = c.find('renderer.domElement.addEventListener("pointermove"')
if idx_move >= 0:
    idx_pt = c.find("const pt", idx_move)
    # Build new version
    old_section = c[idx_move:c.find("\n    });\n    document.addEventListener(\"pointerup\"", idx_move)+6]
    
    new_section = """    renderer.domElement.addEventListener("pointermove", (e) => {
      if (!isDragging || !selectedObjects.length) return;
      const rect = renderer.domElement.getBoundingClientRect();
      _mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      _mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      _raycaster.setFromCamera(_mouse, camera);
      var pt = _raycaster.ray.intersectPlane(_dragPlane, new THREE.Vector3());
      if (pt) {
        var dx = pt.x - selectedObjects[0].position.x;
        var dz = pt.z - selectedObjects[0].position.z;
        selectedObjects.forEach(function(o) { o.position.x += dx; o.position.z += dz; });
        updateSelectionBoxes();
        savePositions();
      }
    });"""
    
    c = c.replace(old_section, new_section)

# ==== 6) Optimize DXF import (merged LineSegments + selection plane) ====
# Find the DXF import section and replace with optimized version
old_dxf_start = 'if (ext === "dxf" || ext === "dwg")'
dxf_start = c.find(old_dxf_start)
dxf_else = c.find('} else {', dxf_start)

if dxf_start >= 0 and dxf_else > dxf_start:
    old_dxf = c[dxf_start:dxf_else]
    
    new_dxf = """      if (ext === "dxf" || ext === "dwg") {
        var reader = new FileReader();
        reader.onload = function(e) {
          import("dxf-parser").then(function(mod) {
            try {
              var parser = new mod.default();
              var drawing = parser.parseSync(e.target.result);
              if (!drawing.entities || !drawing.entities.length) { console.warn("DXF has no entities"); return; }
              // Merge all entities into single LineSegments for performance
              var verts = [];
              var mx = -Infinity, nx = Infinity, my = -Infinity, ny = Infinity;
              function addSeg(x1, y1, x2, y2) { verts.push(x1, y1, 0, x2, y2, 0); if (x1 > mx) mx = x1; if (x1 < nx) nx = x1; if (x2 > mx) mx = x2; if (x2 < nx) nx = x2; if (y1 > my) my = y1; if (y1 < ny) ny = y1; if (y2 > my) my = y2; if (y2 < ny) ny = y2; }
              drawing.entities.forEach(function(ent) {
                try {
                  if (ent.type === "LINE" && ent.vertices && ent.vertices.length >= 2) {
                    addSeg(ent.vertices[0].x, ent.vertices[0].y, ent.vertices[1].x, ent.vertices[1].y);
                  } else if ((ent.type === "LWPOLYLINE" || ent.type === "POLYLINE") && ent.vertices && ent.vertices.length >= 2) {
                    for (var i = 1; i < ent.vertices.length; i++) addSeg(ent.vertices[i-1].x, ent.vertices[i-1].y, ent.vertices[i].x, ent.vertices[i].y);
                    if (ent.closed) { var v = ent.vertices; addSeg(v[v.length-1].x, v[v.length-1].y, v[0].x, v[0].y); }
                  } else if (ent.type === "CIRCLE" && ent.center && ent.radius) {
                    for (var a = 0; a < 64; a++) { var a1 = (a/64)*Math.PI*2, a2 = ((a+1)/64)*Math.PI*2; addSeg(ent.center.x+Math.cos(a1)*ent.radius, ent.center.y+Math.sin(a1)*ent.radius, ent.center.x+Math.cos(a2)*ent.radius, ent.center.y+Math.sin(a2)*ent.radius); }
                  } else if (ent.type === "ARC" && ent.center && ent.radius) {
                    var sa = (ent.startAngle||0)*Math.PI/180, ea = (ent.endAngle||360)*Math.PI/180;
                    for (var i = 0; i < 32; i++) { var a1 = sa+(ea-sa)*(i/32), a2 = sa+(ea-sa)*((i+1)/32); addSeg(ent.center.x+Math.cos(a1)*ent.radius, ent.center.y+Math.sin(a1)*ent.radius, ent.center.x+Math.cos(a2)*ent.radius, ent.center.y+Math.sin(a2)*ent.radius); }
                  }
                } catch(e2) {}
              });
              if (!verts.length) { console.warn("DXF no renderable entities"); return; }
              var group = new THREE.Group();
              var geo = new THREE.BufferGeometry();
              geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
              group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x00aaff })));
              // Transparent click plane for easier selection
              var pw = Math.max(mx - nx || 1, 1), ph = Math.max(my - ny || 1, 1);
              var pgeo = new THREE.PlaneGeometry(pw * 1.2, ph * 1.2);
              var pmat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.02, side: THREE.DoubleSide, depthWrite: false });
              var clickPlane = new THREE.Mesh(pgeo, pmat);
              clickPlane.position.set((mx + nx) / 2, (my + ny) / 2, 0);
              group.add(clickPlane);
              // Center, rotate to XZ, scale
              var box = new THREE.Box3().setFromObject(group);
              var center = box.getCenter(new THREE.Vector3());
              var size = box.getSize(new THREE.Vector3());
              var maxDim = Math.max(size.x, size.y, size.z);
              var sc = maxDim > 0 ? 3 / maxDim : 1;
              pgeo.scale(sc, sc, 1);  // scale click plane geometry too
              group.rotation.x = -Math.PI / 2;
              group.scale.set(sc, sc, sc);
              group.position.set(-center.x * sc, -box.min.y * sc, -center.z * sc);
              // Flatten click plane as a child already in group, scale applies
              addToScene(group, size.y * sc);
            } catch(e3) { console.error("DXF error:", e3); }
          });
        };
        reader.readAsText(file);
      } else {"""
    
    c = c.replace(old_dxf, new_dxf)
    print("main.js updated: multi-select + DXF optimization + click plane")
else:
    print(f"DXF section not found: start={dxf_start}, else={dxf_else}")

p.write_text(c, "utf-8")
