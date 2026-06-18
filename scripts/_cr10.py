import pathlib
p = pathlib.Path("D:/DesktopFile/digital-twin-project/frontend/src/main.js")
c = p.read_text("utf-8")

# Find DXF section using dxf-parser as anchor
anchor = c.find("dxf-parser")
if anchor < 0:
    print("ERROR: dxf-parser not found")
else:
    # Go back to find the `if (ext === "dxf"` line
    dxf_start = c.rfind("if (ext ===", 0, anchor)
    if dxf_start < 0:
        print("ERROR: DXF if not found")
    else:
        # Find the end of DXF block: look for `} else {` after anchor
        dxf_end = c.find("} else {", anchor)
        if dxf_end < 0:
            print("ERROR: DXF else not found")
        else:
            dxf_end += 8  # include "} else {"
            old_dxf = c[dxf_start:dxf_end]
            
            new_dxf = '''      if (ext === "dxf" || ext === "dwg") {
        var reader = new FileReader();
        reader.onload = function(e) {
          import("dxf-parser").then(function(mod) {
            try {
              var parser = new mod.default();
              var drawing = parser.parseSync(e.target.result);
              if (!drawing.entities || !drawing.entities.length) { console.warn("DXF has no entities"); return; }
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
              var pw = Math.max(mx - nx || 1, 1), ph = Math.max(my - ny || 1, 1);
              var pgeo = new THREE.PlaneGeometry(pw * 1.2, ph * 1.2);
              var pmat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.02, side: THREE.DoubleSide, depthWrite: false });
              var clickPlane = new THREE.Mesh(pgeo, pmat);
              clickPlane.position.set((mx + nx) / 2, (my + ny) / 2, 0);
              group.add(clickPlane);
              var box = new THREE.Box3().setFromObject(group);
              var center = box.getCenter(new THREE.Vector3());
              var size = box.getSize(new THREE.Vector3());
              var maxDim = Math.max(size.x, size.y, size.z);
              var sc = maxDim > 0 ? 3 / maxDim : 1;
              group.rotation.x = -Math.PI / 2;
              group.scale.set(sc, sc, sc);
              group.position.set(-center.x * sc, -box.min.y * sc, -center.z * sc);
              addToScene(group, size.y * sc);
            } catch(e3) { console.error("DXF error:", e3); }
          });
        };
        reader.readAsText(file);
      } else {'''
            
            c = c[:dxf_start] + new_dxf + c[dxf_end:]
            p.write_text(c, "utf-8")
            print("main.js DXF section optimized")
