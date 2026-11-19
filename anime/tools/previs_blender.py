# Grey 3D animatic, detailed version: run INSIDE Blender (blender -b -P previs_blender.py -- score.json out_dir start end width height fps).
# Reads the same score the Previs agent writes for StageFlow (entities, blocking, shots) and films it with real mannequins:
# an artist's mannequin with human proportions (shaped torso, tapered limbs on ball joints, an egg head with a brow line and a nose so
# facing reads, hands with four fingers that curl round what they hold, shoes), arms that reach by two-bone IK, legs that sit or stand,
# props modelled at their real sizes when their id says what they are (microphone, tambourine, glasses, seats, screen, door),
# the room as inward-facing walls (a wall between the camera and the room is not drawn), each shot through its own camera and lens.
# Nothing here is drawn by a model. Coordinates in the score: x right, y up, z toward the viewer; Blender: (x, -z, y).
import bpy, sys, json, math, os
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
score = json.load(open(argv[0], encoding="utf-8")); OUT = argv[1]
T0, T1, W, H, FPS = float(argv[2]), float(argv[3]), int(argv[4]), int(argv[5]), int(argv[6])
ONLY = [int(x) for x in argv[7].split(",")] if len(argv) > 7 and argv[7] else None  # a check sheet: only these frame numbers
V = lambda p: Vector((p[0], -p[2], p[1]))  # score -> Blender
smooth = lambda k: 0.0 if k <= 0 else 1.0 if k >= 1 else k * k * (3 - 2 * k)
hexc = lambda h: tuple(int(h.lstrip("#")[i:i + 2], 16) / 255 for i in (0, 2, 4))

ents = {e["id"]: e for e in score["entities"]}
moves = {}
for b in score.get("blocking", []): moves.setdefault(b["entity"], []).append(b)
for v in moves.values(): v.sort(key=lambda b: b["start"])

def state(eid, t):
    e = ents[eid]; pos = list(e["position"]); rot = float(e.get("rotation") or 0); vis = e.get("visible", True)
    for b in moves.get(eid, []):
        if t < b["start"]: break
        k = 1.0 if b.get("cut") else smooth((t - b["start"]) / max(1e-6, b["end"] - b["start"]))
        if "position" in b: pos = [pos[i] + (b["position"][i] - pos[i]) * k for i in range(3)]
        if "rotation" in b: rot = rot + (float(b["rotation"]) - rot) * k
        if "visible" in b and k >= 1: vis = b["visible"]
    return pos, rot, vis

# ---------- scene ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene; sc.render.engine = "CYCLES"  # the CPU renderer: it needs no screen, so it runs over a remote connection
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage, sc.render.fps = W, H, 100, FPS
sc.render.image_settings.file_format = "PNG"; sc.render.film_transparent = False
cy = sc.cycles; cy.device = "CPU"; cy.samples = 16; cy.use_adaptive_sampling = False; cy.use_denoising = True
if os.environ.get("PREVIS_DEVICE", "CPU").upper() == "GPU":  # on a rented pod: the same renderer on the graphics card
    pr = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA"):
        try:
            pr.compute_device_type = kind
            (pr.refresh_devices if hasattr(pr, "refresh_devices") else pr.get_devices)()
            if any(d.type == kind for d in pr.devices):
                for d in pr.devices: d.use = d.type == kind
                cy.device = "GPU"; print("PREVIS_GPU", kind, [d.name for d in pr.devices if d.use]); break
        except Exception as ex: print("PREVIS_GPU_FAIL", kind, ex)
cy.max_bounces = 2; cy.diffuse_bounces = 1; cy.glossy_bounces = 0; cy.transmission_bounces = 2; cy.transparent_max_bounces = 6; cy.caustics_reflective = cy.caustics_refractive = False
sc.render.threads_mode = "AUTO"; sc.render.use_persistent_data = True
world = bpy.data.worlds.new("w"); sc.world = world; world.use_nodes = True; bg = world.node_tree.nodes["Background"]; bg.inputs[0].default_value = (0.80, 0.81, 0.83, 1); bg.inputs[1].default_value = 1.0
try: sc.view_settings.view_transform = "Standard"
except Exception: pass
bpy.ops.object.light_add(type="SUN", location=(0, 0, 6)); sun = bpy.context.active_object; sun.data.energy = 1.7; sun.data.angle = math.radians(40); sun.rotation_euler = (math.radians(38), math.radians(-12), math.radians(25))
def material(name, one_sided=False, alpha=1.0):  # the colour comes from the object, so one material serves everything of a kind
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); info = nt.nodes.new("ShaderNodeObjectInfo"); dif = nt.nodes.new("ShaderNodeBsdfDiffuse"); nt.links.new(info.outputs["Color"], dif.inputs["Color"])
    last = dif.outputs[0]
    if one_sided or alpha < 1:
        tr = nt.nodes.new("ShaderNodeBsdfTransparent"); mix = nt.nodes.new("ShaderNodeMixShader"); nt.links.new(last, mix.inputs[1]); nt.links.new(tr.outputs[0], mix.inputs[2])
        if one_sided: geo = nt.nodes.new("ShaderNodeNewGeometry"); nt.links.new(geo.outputs["Backfacing"], mix.inputs[0])
        else: mix.inputs[0].default_value = 1 - alpha
        last = mix.outputs[0]
    nt.links.new(last, out.inputs["Surface"]); return m
MAT, MAT_WALL = material("solid"), material("wall", one_sided=True)
def glass_material():  # glass in a wall: faint from inside the room, not drawn at all from outside (like the wall it sits in)
    m = bpy.data.materials.new("glass"); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); info = nt.nodes.new("ShaderNodeObjectInfo"); dif = nt.nodes.new("ShaderNodeBsdfDiffuse"); nt.links.new(info.outputs["Color"], dif.inputs["Color"])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent"); mix = nt.nodes.new("ShaderNodeMixShader"); mix.inputs[0].default_value = 0.7; nt.links.new(dif.outputs[0], mix.inputs[1]); nt.links.new(tr.outputs[0], mix.inputs[2])
    geo = nt.nodes.new("ShaderNodeNewGeometry"); mix2 = nt.nodes.new("ShaderNodeMixShader"); nt.links.new(geo.outputs["Backfacing"], mix2.inputs[0]); nt.links.new(mix.outputs[0], mix2.inputs[1]); nt.links.new(tr.outputs[0], mix2.inputs[2])
    nt.links.new(mix2.outputs[0], out.inputs["Surface"]); return m
MAT_GLASS = glass_material()

def mesh_obj(name, verts, faces, color):
    m = bpy.data.meshes.new(name); m.from_pydata(verts, [], faces); m.update()
    o = bpy.data.objects.new(name, m); sc.collection.objects.link(o); o.color = (*color, 1) if len(color) == 3 else color; return o
def prim(kind, name, color):
    if kind == "sphere": bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=1)
    elif kind == "cyl": bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=1, depth=1)
    elif kind == "cone": bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=1, radius2=0, depth=1)
    else: bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.active_object; o.name = name; o.color = (*color, 1) if len(color) == 3 else color; o.data.materials.append(MAT)
    if kind in ("sphere", "cyl", "cone"): bpy.ops.object.shade_smooth()
    return o
def between(o, a, b, r):  # a limb: a unit cylinder (z axis) stretched from a to b
    a, b = Vector(a), Vector(b); d = b - a; L = max(d.length, 1e-4)
    o.location = (a + b) / 2; o.rotation_euler = d.to_track_quat("Z", "Y").to_euler(); o.scale = (r, r, L)

def loft(name, parts, color, mat=None):  # smooth tubes through rings of (z, half-width x, half-depth y[, y offset]); parts = [(rings, x offset)]
    vs, fs = [], []; seg = 16
    for rings, cx in parts:
        k = len(vs); n = len(rings)
        for z, rx, ry, *more in rings:
            cyo = more[0] if more else 0.0
            for i in range(seg): a = 2 * math.pi * i / seg; vs.append((cx + rx * math.cos(a), cyo + ry * math.sin(a), z))
        for j in range(n - 1):
            for i in range(seg): a = k + j * seg + i; b = k + j * seg + (i + 1) % seg; fs.append((a, b, b + seg, a + seg))
        fs.append(tuple(k + i for i in range(seg - 1, -1, -1))); fs.append(tuple(k + (n - 1) * seg + i for i in range(seg)))
    o = mesh_obj(name, vs, fs, color); o.data.materials.append(mat or MAT)
    for f in o.data.polygons: f.use_smooth = len(f.vertices) == 4
    return o
def box(name, size, color, bevel=0.0, shift=(0, 0, 0)):  # a block at its real size (Blender axes), edges softened
    bpy.ops.mesh.primitive_cube_add(size=1); o = bpy.context.active_object; o.name = name; o.color = (*color, 1); o.data.materials.append(MAT)
    o.data.transform(Matrix.Translation(Vector(shift)) @ Matrix.Diagonal(Vector((*size, 1))))
    bevel = min(bevel, min(size) * 0.3)
    if bevel > 0.002: m = o.modifiers.new("soft", "BEVEL"); m.width = bevel; m.segments = 2
    return o
KIDS = {}  # extra parts of a modelled prop: they follow their root and hide with it
def kid(root, o, at=(0, 0, 0)):
    o.parent = root; o.location = at; KIDS.setdefault(root.name, []).append(o); return o
def strip(parent, t, sign, u0, u1, z0, z1, color, proud):  # a flat one-sided band lying on a wall's inner face (local unit-cube coordinates)
    c = sign * (0.5 + proud); pt = lambda u, z: (c, u, z) if t == 0 else (u, c, z)
    vs = [pt(u0, z0), pt(u1, z0), pt(u1, z1), pt(u0, z1)]
    nrm = (Vector(vs[1]) - Vector(vs[0])).cross(Vector(vs[3]) - Vector(vs[0])); inward = Vector((-sign, 0, 0)) if t == 0 else Vector((0, -sign, 0))
    o = mesh_obj(parent.name + ".band", vs, [(0, 1, 2, 3) if nrm.dot(inward) > 0 else (3, 2, 1, 0)], color); o.data.materials.append(MAT_WALL); o.visible_shadow = False
    o.parent = parent; KIDS.setdefault(parent.name, []).append(o); return o
def grey(v): return (v, v, v * 1.01)

bpy.ops.mesh.primitive_plane_add(size=80); floor = bpy.context.active_object; floor.color = (0.62, 0.63, 0.65, 1); floor.location = (0, 0, -0.002); floor.data.materials.append(MAT)

chars = [e for e in score["entities"] if e["kind"] == "character"]
centre = Vector((0, 0, 0))
for c in chars: centre += V(c["position"])
centre /= max(1, len(chars))
PROXY = ("-cuff", "-hand", "-fist")
props = {}
for e in score["entities"]:
    if e["kind"] == "character" or e["id"].endswith(PROXY) or "-left-" in e["id"] and e["id"].endswith("cuff"): continue
    sx, sy, sz = e["size"]; col = hexc(e.get("color", "#999999")); st = e.get("style", "solid"); eid = e["id"]; long_x = sx >= sz
    if st in ("wireframe", "glass"):  # a wall, or glass in one: one inward-facing sheet, so what is on the camera's side of the room is not drawn
        thin = min(range(3), key=lambda i: e["size"][i]); o = prim("cube", eid, (0.86, 0.86, 0.84)); o.scale = (sx, sz, sy)
        me = o.data; p = V(e["position"]) + Vector((0, 0, sy / 2)); n = Vector((1, 0, 0)) if thin == 0 else Vector((0, -1, 0)) if thin == 2 else Vector((0, 0, 1))
        if (centre - p).dot(n) < 0: n = -n
        import bmesh
        bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
        for f in [f for f in bm.faces if f.normal.dot(n) < 0.9]: bm.faces.remove(f)
        bm.to_mesh(me); bm.free(); o.data.materials.clear(); o.data.materials.append(MAT_WALL); o.visible_shadow = False
        if thin != 1:
            t = 0 if thin == 0 else 1; sign = 1 if (n.x if t == 0 else n.y) > 0 else -1; thick = e["size"][thin]; wide_m = sz if t == 0 else sx
            if st == "wireframe" and e["position"][1] < 0.05 and sy > 1.5: strip(o, t, sign, -0.5, 0.5, -0.5, -0.5 + 0.09 / sy, grey(0.6), 0.004 / thick)  # skirting line
            if st == "glass":  # a framed pane: door or window
                fw = 0.045 if sy > 1.5 else 0.025; a, b = fw / wide_m, fw / sy; pr = 0.006 / thick; fc = grey(0.42)
                for u0, u1, z0, z1 in ((-0.5, 0.5, 0.5 - b, 0.5), (-0.5, 0.5, -0.5, -0.5 + b), (-0.5, -0.5 + a, -0.5, 0.5), (0.5 - a, 0.5, -0.5, 0.5)): strip(o, t, sign, u0, u1, z0, z1, fc, pr)
                if sy > 1.5: strip(o, t, sign, 0.5 - a - 0.09 / wide_m, 0.5 - a - 0.03 / wide_m, -0.5 + 0.95 / sy, -0.5 + 1.1 / sy, grey(0.25), pr * 2)  # the handle
    elif "microphone" in eid or eid.startswith("mic"):
        o = loft(eid, [([(-sy / 2, sx * 0.29, sx * 0.29), (sy * 0.22, sx * 0.38, sx * 0.38)], 0)], grey(0.2))
        kid(o, prim("cyl", eid + ".collar", grey(0.42)), (0, 0, sy * 0.25)).scale = (sx * 0.43, sx * 0.43, sy * 0.06)
        kid(o, prim("sphere", eid + ".grille", grey(0.58)), (0, 0, sy * 0.5 - sx * 0.52)).scale = (sx * 0.52,) * 3
    elif "tambourine" in eid:
        bpy.ops.mesh.primitive_torus_add(major_radius=sx / 2 - 0.008, minor_radius=0.008, major_segments=28, minor_segments=8); o = bpy.context.active_object; o.name = eid; o.color = (*grey(0.5), 1); o.data.materials.append(MAT)
        o.data.transform(Matrix.Diagonal(Vector((1, 1, sy / 0.016 * 0.9, 1)))); bpy.ops.object.shade_smooth()
        kid(o, prim("cyl", eid + ".skin", grey(0.86)), (0, 0, sy * 0.3)).scale = (sx / 2 - 0.012, sx / 2 - 0.012, 0.004)
        for i in range(6): a = math.pi * (i + 0.5) / 3; kid(o, prim("sphere", eid + ".jingle", grey(0.3)), ((sx / 2 - 0.006) * math.cos(a), (sx / 2 - 0.006) * math.sin(a), 0)).scale = (0.02, 0.02, 0.012)
    elif eid == "tea" or eid.startswith("glass") or "cup" in eid:
        o = loft(eid, [([(-sy / 2, sx * 0.38, sx * 0.38), (-sy / 2 + 0.006, sx * 0.41, sx * 0.41), (sy / 2, sx / 2, sx / 2)], 0)], grey(0.8))
        kid(o, prim("cyl", eid + ".drink", grey(0.38 if eid == "tea" else 0.55)), (0, 0, sy / 2 - 0.004)).scale = (sx / 2 - 0.005, sx / 2 - 0.005, 0.01)
    elif st == "solid" and "seat" in eid and sy > 0.3:  # a bench: a base with seat cushions
        n_c = max(1, round(max(sx, sz) / 0.62)); ch = 0.13; o = box(eid, (sx - 0.02, sz - 0.03, sy - ch), grey(0.46), 0.012, (0, 0, -ch / 2))
        for i in range(n_c):
            d = (i + 0.5) / n_c - 0.5
            kid(o, box(eid + ".cushion", (sx / n_c - 0.012, sz, ch) if long_x else (sx, sz / n_c - 0.012, ch), grey(0.66), 0.035), (d * sx, 0, sy / 2 - ch / 2) if long_x else (0, d * sz, sy / 2 - ch / 2))
    elif st == "solid" and eid.endswith("-back") and min(sx, sz) < 0.25:  # the bench's back cushions
        n_c = max(1, round(max(sx, sz) / 0.62)); o = box(eid, (sx, sz * 0.4, sy) if long_x else (sx * 0.4, sz, sy), grey(0.46), 0.01)
        for i in range(n_c):
            d = (i + 0.5) / n_c - 0.5; fw = 1 if ((centre - V(e["position"])).y if long_x else (centre - V(e["position"])).x) > 0 else -1
            kid(o, box(eid + ".cushion", (sx / n_c - 0.012, sz * 0.75, sy - 0.02) if long_x else (sx * 0.75, sz / n_c - 0.012, sy - 0.02), grey(0.64), 0.04), (d * sx, fw * sz * 0.2, 0) if long_x else (fw * sx * 0.2, d * sz, 0))
    elif "screen" in eid and min(sx, sz) < 0.15:  # a wall screen: a dark frame with a light picture area facing the room
        o = box(eid, (sx, sz, sy), grey(0.2), 0.012); fw = 1 if ((centre - V(e["position"])).x if sx < sz else (centre - V(e["position"])).y) > 0 else -1
        kid(o, box(eid + ".picture", (0.006, sz - 0.07, sy - 0.07) if sx < sz else (sx - 0.07, 0.006, sy - 0.07), (0.8, 0.83, 0.87)), (fw * sx / 2, 0, 0) if sx < sz else (0, fw * sz / 2, 0))
    elif e.get("shape") in ("cylinder", "capsule"): o = prim("cyl", eid, col); o.scale = (sx / 2, sz / 2, sy)
    else: o = box(eid, (sx, sz, sy), col, 0.012 if max(sx, sy, sz) < 3 else 0.0)
    if st == "glass": o.color = (0.72, 0.84, 0.92, 1); o.data.materials.clear(); o.data.materials.append(MAT_GLASS); o.visible_shadow = False
    props[e["id"]] = o

# ---------- mannequins ----------
HEAD = []
for i in range(11):
    th = -math.pi / 2 + math.pi * i / 10; z = math.sin(th); rr = max(math.cos(th), 0.03); dn = max(0.0, -z)
    HEAD.append((z, 0.80 * rr * (1 - 0.30 * dn ** 1.3), 0.90 * rr * (1 - 0.12 * dn), -0.10 * dn))  # an egg: the jaw narrows and sits a little forward (-y is the face)
TORSO = [(-0.56, 0.070, 0.050), (-0.45, 0.088, 0.058), (-0.2, 0.078, 0.052), (0.1, 0.092, 0.060), (0.35, 0.106, 0.063), (0.48, 0.108, 0.058), (0.55, 0.085, 0.048), (0.60, 0.04, 0.034)]  # hips, waist, ribs, shoulders, neck base
FOOT = [(-0.5, 0.22, 0.14), (-0.4, 0.42, 0.30), (-0.1, 0.5, 0.38), (0.25, 0.42, 0.5), (0.45, 0.36, 0.5), (0.5, 0.2, 0.35)]  # toe to heel: half-width, half-height
def limb(name, r2, col): return loft(name, [([(-0.5, 1, 1), (-0.2, 1.06, 1.06), (0.5, r2, r2)], 0)], col)
def shoe(name, col):
    o = loft(name, [([(y, w, hh, hh - 0.5) for y, w, hh in FOOT], 0)], col); o.data.transform(Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))); return o  # the loft's length becomes front-to-back, toe at -y
man = {}; BUILD = {}
for c in chars:
    col = hexc(c.get("color", "#8888aa")); dark = tuple(v * 0.72 for v in col); pale = tuple(v + (1 - v) * 0.3 for v in col); jt = col; o = {}; n_ = lambda p: c["id"] + "." + p
    o["pelvis"] = prim("sphere", n_("pelvis"), dark); o["torso"] = loft(n_("torso"), [(TORSO, 0)], col); o["neck"] = limb(n_("neck"), 0.85, col)
    o["head"] = loft(n_("head"), [(HEAD, 0)], col); o["nose"] = prim("cone", n_("nose"), col); o["brow"] = prim("sphere", n_("brow"), tuple(v * 0.5 for v in col))
    for tag in "LR":
        o["sh" + tag] = prim("sphere", n_("sh" + tag), col); o["el" + tag] = prim("sphere", n_("el" + tag), jt); o["wr" + tag] = prim("sphere", n_("wr" + tag), pale)
        o["uarm" + tag] = limb(n_("uarm" + tag), 0.78, col); o["farm" + tag] = limb(n_("farm" + tag), 0.7, col)
        o["hand" + tag] = loft(n_("hand" + tag), [([(-0.5, 0.34, 0.5), (-0.15, 0.5, 0.5), (0.5, 0.5, 0.45)], 0)], pale)
        o["fing" + tag] = loft(n_("fing" + tag), [([(-0.5, 0.11, 0.5), (0.5, 0.10, 0.45)], x) for x in (-0.375, -0.125, 0.125, 0.375)], pale)
        o["tip" + tag] = loft(n_("tip" + tag), [([(-0.5, 0.10, 0.5), (0.3, 0.095, 0.45), (0.5, 0.06, 0.3)], x) for x in (-0.375, -0.125, 0.125, 0.375)], pale)
        o["thumb" + tag] = limb(n_("thumb" + tag), 0.7, pale)
        o["thigh" + tag] = limb(n_("thigh" + tag), 0.72, dark); o["shin" + tag] = limb(n_("shin" + tag), 0.66, dark)
        o["kn" + tag] = prim("sphere", n_("kn" + tag), tuple(v * 0.9 for v in dark)); o["an" + tag] = prim("sphere", n_("an" + tag), dark); o["foot" + tag] = shoe(n_("foot" + tag), tuple(v * 0.55 for v in col))
    man[c["id"]] = o; BUILD[c["id"]] = max(0.92, min(1.25, c["size"][0] / 0.45))  # a broader person gets a broader chest and thicker limbs
def ball(o, at, r): o.location = at; o.scale = (r, r, r)

def slab(o, a, b, wide, w, th):  # a flat block from a to b: its width runs along `wide`
    a, b = Vector(a), Vector(b); z = (b - a); L = max(z.length, 1e-4); z = z / L
    x = wide - wide.dot(z) * z; x = x.normalized() if x.length > 1e-4 else z.orthogonal().normalized(); y = z.cross(x)
    o.location = (a + b) / 2; o.rotation_euler = Matrix((x, y, z)).transposed().to_euler(); o.scale = (w, th, L)
def ik(shoulder, target, l1, l2, pole):  # two-bone IK: elbow position, and the hand clamped to reach
    d = target - shoulder; L = d.length
    if L > (l1 + l2) * 0.999: d = d.normalized() * (l1 + l2) * 0.999; L = d.length
    if L < 1e-4: d = Vector((0, 0, -1)) * 0.01; L = d.length
    a = (l1 * l1 - l2 * l2 + L * L) / (2 * L); h = math.sqrt(max(l1 * l1 - a * a, 0.0)); u = d / L
    pl = pole - pole.dot(u) * u; pl = pl.normalized() if pl.length > 1e-4 else Vector((0, 0, -1))
    return shoulder + u * a + pl * h, shoulder + d

def hand_targets(t):  # what each hand reaches for: the score's own hand stand-ins, and small things that are lifted or carried
    out = {}; dt = 1.0 / FPS
    for e in score["entities"]:
        if e["kind"] == "character": continue
        pos, rot, vis = state(e["id"], t)
        if not vis: continue
        owner = next((c for c in chars if e["id"].startswith(c["id"] + "-") and e["id"].endswith(PROXY)), None)
        mid = V(pos) + Vector((0, 0, e["size"][1] / 2))
        if owner: out.setdefault(owner["id"], []).append((mid, "left" if "left" in e["id"] else "right" if "right" in e["id"] else "", e["id"]))
        elif max(e["size"]) < 0.3:
            prev = state(e["id"], max(0.0, t - 0.25))[0]; moving = (Vector(pos) - Vector(prev)).length > 1e-3
            resting = pos[1] < 0.04 or any(abs(pos[1] - (s["position"][1] + s["size"][1])) < 0.04 for s in score["entities"] if s["kind"] != "character" and max(s["size"]) > 0.5 and abs(pos[0] - s["position"][0]) < s["size"][0] / 2 and abs(pos[2] - s["position"][2]) < s["size"][2] / 2)
            if moving or not resting: out.setdefault("*", []).append((mid, "", e["id"]))
    return out

SEATS = [e for e in score["entities"] if e["kind"] != "character" and e.get("style") == "solid" and 0.3 <= e["position"][1] + e["size"][1] <= 0.65 and max(e["size"][0], e["size"][2]) >= 0.5 and "table" not in e["id"]]
def on_seat(pos):
    return any(abs(pos[0] - s["position"][0]) <= s["size"][0] / 2 + 0.12 and abs(pos[2] - s["position"][2]) <= s["size"][2] / 2 + 0.06 for s in SEATS)
def pose(c, t, targets):
    pos, rot, vis = state(c["id"], t); o = man[c["id"]]; Hh = c["size"][1]
    for p in o.values(): p.hide_render = not vis
    if not vis: return
    r = math.radians(rot); f = Vector((math.sin(r), -math.cos(r), 0)); side = Vector((math.cos(r), math.sin(r), 0)); up = Vector((0, 0, 1))  # side = the character's left
    prev = pose.last.get(c["id"]); base = V(pos); step = (Vector((base.x, base.y, 0)) - prev) if prev else Vector(); pose.last[c["id"]] = Vector((base.x, base.y, 0))
    if step.length > 2.0 / FPS * 1.5: step = Vector()  # a jump on a cut is not a walk
    pose.dist[c["id"]] = pose.dist.get(c["id"], 0.0) + step.length; walk = step.length * FPS > 0.25; wdir = step.normalized() if walk else Vector()
    drop = max(0.0, -pos[1]); seated = drop > 0.2 and on_seat(pos); ground = Vector((base.x, base.y, 0.0))
    if seated: pelvis = base + up * 0.53 * Hh; axis = (up + f * 0.07).normalized()
    else:  # standing; a lowered height with no seat under it is a forward lean with the knees a little bent
        pelvis = ground + up * (0.53 * Hh - drop * 0.72 - (abs(math.sin(pose.dist[c["id"]] / (0.38 * Hh) * math.pi)) * 0.012 * Hh if walk else 0)) - f * drop * 0.12
        cosv = max(0.7, min(1.0, (Hh - drop - pelvis.z) / (0.47 * Hh))); axis = up * cosv + f * math.sqrt(1 - cosv * cosv)
    chest = pelvis + axis * 0.29 * Hh; headc = pelvis + axis * 0.41 * Hh + f * 0.012 * Hh; wk = BUILD[c["id"]]; lk = wk ** 0.5
    l1, l2 = 0.165 * Hh, 0.155 * Hh
    mine = list(targets.get(c["id"], [])) + [m for m in targets.get("*", []) if pose.holder.get(m[2]) == c["id"]]
    far = [m[0] for m in mine if (m[0] - chest).length > (l1 + l2) * 0.95]  # something held out of reach: the body leans toward it
    if far:
        d = far[0] - chest; d.z = 0; lean = min(0.09 * Hh, max(0.0, d.length - (l1 + l2) * 0.8))
        if d.length > 1e-4: chest = chest + d.normalized() * lean; headc = headc + d.normalized() * lean * 1.05
    tz = (chest - pelvis).normalized(); tx = (side - side.dot(tz) * tz).normalized(); ty = tz.cross(tx)  # the torso keeps its shoulders square to the body while it tilts
    trot = Matrix((tx, ty, tz)).transposed().to_euler()
    o["pelvis"].location = pelvis - tz * 0.012 * Hh; o["pelvis"].scale = (0.094 * Hh * wk, 0.068 * Hh, 0.075 * Hh); o["pelvis"].rotation_euler = trot
    o["torso"].location = (pelvis + chest) / 2; o["torso"].scale = (Hh * wk, Hh, (chest - pelvis).length); o["torso"].rotation_euler = trot
    between(o["neck"], chest + tz * 0.01 * Hh, headc - up * 0.03 * Hh, 0.03 * Hh)
    o["head"].location = headc; o["head"].scale = (0.072 * Hh,) * 3; o["head"].rotation_euler = (0, 0, r)
    nose_a = headc + f * 0.057 * Hh - up * 0.014 * Hh; between(o["nose"], nose_a, nose_a + f * 0.022 * Hh + up * 0.004 * Hh, 0.011 * Hh)
    o["brow"].location = headc + f * 0.052 * Hh + up * 0.012 * Hh; o["brow"].scale = (0.04 * Hh, 0.011 * Hh, 0.006 * Hh); o["brow"].rotation_euler = (0, 0, r)
    sh = {1: chest + side * 0.118 * Hh * wk - axis * 0.02 * Hh, -1: chest - side * 0.118 * Hh * wk - axis * 0.02 * Hh}; want = {}
    pairs = sorted(((m[0] - sh[g]).length - (0.3 if m[1] == ("left" if g > 0 else "right") else 0), g, k) for k, m in enumerate(mine) for g in (1, -1) if not m[1] or m[1] == ("left" if g > 0 else "right"))
    used = set()
    for _, g, k in pairs:  # nearest hand takes each thing; one thing a hand
        if g in want or k in used: continue
        want[g] = mine[k][0]; used.add(k)
        if mine[k][2] in props and (mine[k][0] - sh[g]).length > (l1 + l2) * 1.02:  # carried but drawn out of reach in the score: it rides in the hand, held in front of the chest
            want[g] = chest + f * 0.2 * Hh - axis * 0.06 * Hh + side * g * 0.07 * Hh; pose.ride[mine[k][2]] = want[g]
    for sgn, tag in ((1, "L"), (-1, "R")):
        shoulder = sh[sgn]
        swing = wdir * math.sin(pose.dist[c["id"]] / (0.38 * Hh) * math.pi + (math.pi if sgn > 0 else 0)) * 0.1 * Hh if walk else Vector()
        tgt = want.get(sgn) or swing + ((pelvis + f * 0.21 * Hh + side * sgn * 0.075 * Hh + up * 0.055 * Hh) if seated else (shoulder + side * sgn * 0.03 * Hh + f * 0.04 * Hh - up * (l1 + l2) * 0.97))
        hold = sgn in want; pole = -up * 1.0 + side * sgn * 0.6 - f * 0.25; PL, FL = 0.05 * Hh, 0.026 * Hh  # palm and finger-joint lengths
        elbow, hand = ik(shoulder, tgt, l1, l2, pole); hd = (hand - elbow).normalized()
        if hold: elbow, hand = ik(shoulder, tgt - hd * PL, l1, l2, pole); hd = (hand - elbow).normalized()  # the thing sits at the end of the palm, in the fingers
        between(o["uarm" + tag], shoulder, elbow, 0.031 * Hh * lk); between(o["farm" + tag], elbow, hand, 0.024 * Hh * lk)
        ball(o["sh" + tag], shoulder, 0.031 * Hh * lk); ball(o["el" + tag], elbow, 0.0245 * Hh * lk); ball(o["wr" + tag], hand, 0.0175 * Hh * lk)
        wide = up - up.dot(hd) * hd; wide = wide.normalized() if wide.length > 0.2 else (f - f.dot(hd) * hd).normalized()  # the palm stands on edge, as in a handshake
        inward = -side * sgn; curl_axis = wide if hd.cross(wide).dot(inward) < 0 else -wide; curl = math.radians(62 if hold else 14)
        d1 = Matrix.Rotation(curl, 3, curl_axis) @ hd; d2 = Matrix.Rotation(curl * 2.1, 3, curl_axis) @ hd; p1 = hand + hd * PL; p2 = p1 + d1 * FL
        slab(o["hand" + tag], hand, p1, wide, 0.046 * Hh, 0.017 * Hh); slab(o["fing" + tag], p1, p2, wide, 0.045 * Hh, 0.012 * Hh); slab(o["tip" + tag], p2, p2 + d2 * FL * 0.95, wide, 0.045 * Hh, 0.011 * Hh)
        th0 = hand + hd * PL * 0.2 + wide * 0.013 * Hh; between(o["thumb" + tag], th0, th0 + (wide * 0.45 + hd * 0.75 + (Matrix.Rotation(curl * 0.7, 3, curl_axis) @ hd) * 0.4).normalized() * 0.042 * Hh, 0.0085 * Hh)
    t1, t2 = 0.245 * Hh, 0.245 * Hh
    for sgn, tag in ((1, "L"), (-1, "R")):
        hip = pelvis + side * sgn * 0.055 * Hh - up * 0.02 * Hh
        if seated: knee = hip + f * t1; ankle = Vector((knee.x + f.x * 0.02, knee.y + f.y * 0.02, max(0.04, knee.z - t2)))
        else:
            foot = ground + side * sgn * 0.06 * Hh + up * 0.04
            if walk: ph = pose.dist[c["id"]] / (0.38 * Hh) * math.pi + (0 if sgn > 0 else math.pi); foot = foot + wdir * math.sin(ph) * 0.2 * Hh + up * max(0.0, math.cos(ph)) * 0.05 * Hh  # steps: each foot swings ahead and plants in turn
            knee, ankle = ik(hip, foot, t1, t2, f)
        between(o["thigh" + tag], hip, knee, 0.05 * Hh * lk); between(o["shin" + tag], knee, ankle, 0.037 * Hh * lk)
        ball(o["kn" + tag], knee, 0.037 * Hh * lk); ball(o["an" + tag], ankle + up * 0.015, 0.026 * Hh * lk)
        o["foot" + tag].location = ankle + f * 0.045 * Hh - up * 0.005; o["foot" + tag].scale = (0.058 * Hh, 0.15 * Hh, 0.07); o["foot" + tag].rotation_euler = (0, 0, r)
pose.taken = set(); pose.holder = {}; pose.ride = {}; pose.last = {}; pose.dist = {}

HOLD = {}  # who carries each loose thing: it stays with them until someone else is clearly nearer (a hand-over), so the receiver does not grab early
def carrier(pid, t):  # during a move of a thing: the person who travels furthest in that time and ends beside it carries it
    b = next((x for x in reversed(moves.get(pid, [])) if x["start"] <= t and "position" in x), None)
    if not b or t > b["end"] + 0.05: return None
    if "who" not in b:  # first: a person whose own hand stand-in travels with the thing to the same place is the one moving it
        for c in chars:
            if HOLD.get(pid) not in (None, c["id"]): continue  # someone else has it in hand: a second hand arriving is a hand-over, not a carry
            for e in score["entities"]:
                if e["id"].startswith(c["id"] + "-") and e["id"].endswith(PROXY) and any("position" in x and x["start"] < b["end"] and x["end"] > b["start"] and (Vector(x["position"]) - Vector(b["position"])).length < 0.25 for x in moves.get(e["id"], [])): b["who"] = c["id"]
    if "who" not in b:
        best = None; endp = V(b["position"])
        for c in chars:
            a0, a1 = state(c["id"], b["start"])[0], state(c["id"], b["end"])[0]; dist = (Vector(a1) - Vector(a0)).length
            if dist > 0.6 and (endp - (V(a1) + Vector((0, 0, 0.8 * c["size"][1]))).to_3d()).length < 0.8 * c["size"][1] and (best is None or dist > best[0]): best = (dist, c["id"])
        b["who"] = best[1] if best else ""
    return b["who"] or None
def holders(t, tg):
    out = {}
    for m in tg.get("*", []):
        cw = carrier(m[2], t)
        if cw: out[m[2]] = HOLD[m[2]] = cw; continue
        ds = []
        for c in chars:
            cp, _, cv = state(c["id"], t)
            if cv: ds.append(((m[0] - (V(cp) + Vector((0, 0, 0.8 * c["size"][1] + min(0, cp[1]) * 0.0)))).length, c["id"], 0.62 * c["size"][1]))
        ds.sort(); cur = HOLD.get(m[2]); mine = next((d for d in ds if d[1] == cur), None)
        if mine and mine[0] < mine[2] * 1.15 and not (ds and ds[0][1] != cur and ds[0][0] < mine[0] - 0.28): out[m[2]] = cur
        elif ds and ds[0][0] < ds[0][2]: out[m[2]] = ds[0][1]
        if m[2] in out: HOLD[m[2]] = out[m[2]]
    for k in list(HOLD):
        if k not in out: del HOLD[k]
    return out
k = 0.0
while k < T0: holders(k, hand_targets(k)); k += 0.1  # who was carrying what before the first frame filmed
for c in chars: p0 = V(state(c["id"], max(0.0, T0 - 1.0 / FPS))[0]); pose.last[c["id"]] = Vector((p0.x, p0.y, 0))

cam_data = bpy.data.cameras.new("cam"); cam = bpy.data.objects.new("cam", cam_data); sc.collection.objects.link(cam); sc.camera = cam
cam_data.sensor_width = 36; cam_data.clip_start = 0.05; cam_data.clip_end = 200
def aim(target, t):
    if isinstance(target, (list, tuple)) and target and isinstance(target[0], (int, float)): return list(target)
    ids = target if isinstance(target, list) else [target]; pts = []
    for i in ids:
        if i in ents: p = state(i, t)[0]; pts.append([p[0], p[1] + ents[i]["size"][1] * 0.8, p[2]])
    return [sum(p[k] for p in pts) / len(pts) for k in range(3)] if pts else [0, 1, 0]
def camera_at(t):
    s = next((x for x in score["shots"] if x["start"] <= t < x["end"]), score["shots"][-1]); c = s["stage_camera"]
    k = smooth((t - s["start"]) / max(1e-6, s["end"] - s["start"])) if c.get("easing", "smooth") != "linear" else (t - s["start"]) / max(1e-6, s["end"] - s["start"])
    pick = lambda n: (lambda a, b: a + (b - a) * k)(float(c.get(n + "_start", c.get(n, 0)) or 0), float(c.get(n + "_end", c.get(n, 0)) or 0))
    ta, tb = aim(c.get("from", c["target"]) if c.get("from") is not None else c["target"], t), aim(c.get("target_end", c["target"]), t)
    tg = [ta[i] + (tb[i] - ta[i]) * k for i in range(3)]
    if c.get("rig") and isinstance(c["rig"].get("position"), list): p = c["rig"]["position"]
    else:
        d, pitch, yaw = pick("distance"), math.radians(pick("pitch")), math.radians(pick("yaw"))
        p = [tg[0] + d * math.cos(pitch) * math.sin(yaw), tg[1] + d * math.sin(pitch), tg[2] + d * math.cos(pitch) * math.cos(yaw)]
    cam.location = V(p); cam.rotation_euler = (V(tg) - V(p)).to_track_quat("-Z", "Y").to_euler()
    cam_data.lens = float(str(c.get("lens", "35")).lower().replace("mm", "") or 35)
    return s["id"]

os.makedirs(OUT, exist_ok=True); n0, n1 = round(T0 * FPS), round(T1 * FPS); log = []; frames = ONLY or list(range(n0, n1)); before = None
for i, n in enumerate(frames):
    t = (n + 0.5) / FPS
    if before is None or n != before + 1:  # a jump (check sheet): catch up on who carries what, and do not read the jump as a walk
        while k < t: holders(k, hand_targets(k)); k += 0.1
        for c in chars: p0 = V(state(c["id"], max(0.0, t - 1.0 / FPS))[0]); pose.last[c["id"]] = Vector((p0.x, p0.y, 0))
    before = n
    for eid, o in props.items():
        pos, rot, vis = state(eid, t); e = ents[eid]; o.hide_render = not vis
        for q in KIDS.get(o.name, ()): q.hide_render = not vis
        o.location = V(pos) + Vector((0, 0, e["size"][1] / 2)); o.rotation_euler = (0, 0, math.radians(rot))
    tg = hand_targets(t); pose.taken = set(); pose.ride = {}; pose.holder = holders(t, tg)
    for c in chars: pose(c, t, tg)
    for eid, at in pose.ride.items(): props[eid].location = at
    shot = camera_at(t); log.append(shot)
    sc.render.filepath = os.path.join(OUT, "f%05d.png" % i); bpy.ops.render.render(write_still=True)
json.dump({"frames": len(frames), "fps": FPS, "shots": log, "numbers": frames}, open(os.path.join(OUT, "frames.json"), "w"))
print("PREVIS_DONE", len(frames))
