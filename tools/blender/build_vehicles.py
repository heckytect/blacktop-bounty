"""
Blacktop Bounty vehicle generator (spec §8.1) — the one-time BOOTSTRAP.

Builds all 10 roster vehicles as low-poly, flat-coloured models from tools/blender/vehicles.json
(exported from src/data/vehicles.ts by `node tools/export-vehicle-data.ts`), saves them to
blender/vehicles.blend, then exports public/assets/vehicles/<id>.glb via export_vehicles.py.

After that, edit blender/vehicles.blend by hand and re-export with export_vehicles.py.
If vehicles.blend exists, this script only ADDS vehicles from the JSON that are not in it yet
(new roster entries) and leaves every existing model untouched. FORCE=True / --force rebuilds all.

Run inside Blender:  exec(open('<repo>/tools/blender/build_vehicles.py').read(), {'ROOT': '<repo>', 'FORCE': False})
or headless:        blender -b -P tools/blender/build_vehicles.py -- <repo> [--force]

Naming per §8.1: body, wheel_FL, wheel_FR, wheel_RL, wheel_RR, muzzle_L, muzzle_R, special_mount, exhaust.
Materials are named c_<hex> / glow_<hex>; the game rebuilds flat Lambert materials from those names.
Axes: game +X forward, +Y up, +Z right  →  Blender (x, -z, y), exported Y-up.
"""
import bpy, bmesh, json, math, os, sys
from mathutils import Matrix, Vector

ROOT = globals().get('ROOT') or (sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else os.getcwd())
FORCE = globals().get('FORCE') or '--force' in sys.argv
DATA = os.path.join(ROOT, 'tools', 'blender', 'vehicles.json')
OUT = os.path.join(ROOT, 'public', 'assets', 'vehicles')
BLEND = os.path.join(ROOT, 'blender', 'vehicles.blend')

GLASS, DARK, CHROME = 0x3A6F80, 0x222222, 0xC9CCD1
HEADLIGHT, TAILLIGHT = 0xFFF3C4, 0xFF2A2A


def g2b(x, y, z):
    return Vector((x, -z, y))


def lin(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material(hexc, glow=False):
    name = f"{'glow' if glow else 'c'}_{hexc:06x}"
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    rgb = (lin(hexc >> 16 & 255), lin(hexc >> 8 & 255), lin(hexc & 255), 1)
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = rgb
    bsdf.inputs['Roughness'].default_value = 0.85
    if glow:
        bsdf.inputs['Emission Color'].default_value = rgb
        bsdf.inputs['Emission Strength'].default_value = 1.0
    m.diffuse_color = rgb
    return m


class Builder:
    """Accumulates pieces into one bmesh with a material slot per colour."""

    def __init__(self):
        self.bm = bmesh.new()
        self.mats = []

    def slot(self, hexc, glow=False):
        m = material(hexc, glow)
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def _finish(self, verts, slot, bevel):
        faces = {f for v in verts for f in v.link_faces}
        for f in faces:
            f.material_index = slot
        if bevel > 0:
            edges = list({e for v in verts for e in v.link_edges})
            try:
                bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, segments=1, affect='EDGES', profile=0.5)
            except TypeError:
                bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, segments=1, vertex_only=False, profile=0.5)

    def box(self, size, centre, hexc, glow=False, taper=0.0, bevel=None):
        """size/centre in game space (w along X, h along Y, d along Z)."""
        w, h, d = size
        verts = bmesh.ops.create_cube(self.bm, size=1.0)['verts']
        for v in verts:
            x, y, z = v.co.x * w, v.co.y * d, v.co.z * h  # blender y = game depth, z = height
            if taper and v.co.z > 0:
                x *= 1 - taper
                y *= 1 - taper * 0.5
            v.co = Vector((x, y, z)) + g2b(*centre)
        if bevel is None:
            bevel = min(0.08, min(size) * 0.12)
        self._finish(verts, self.slot(hexc, glow), bevel)

    def cyl(self, radius, length, centre, axis, hexc, segments=12, glow=False, half=False):
        """Cylinder along a game axis ('x' or 'z'). half=True keeps only the upper half (wheel arch)."""
        rot = Matrix.Rotation(math.pi / 2, 4, 'Y') if axis == 'x' else Matrix.Rotation(math.pi / 2, 4, 'X')
        m = Matrix.Translation(g2b(*centre)) @ rot
        verts = bmesh.ops.create_cone(self.bm, cap_ends=not half, segments=segments, radius1=radius, radius2=radius, depth=length, matrix=m)['verts']
        if half:
            cz = g2b(*centre).z
            drop = [v for v in verts if v.co.z < cz - 1e-4]
            bmesh.ops.delete(self.bm, geom=drop, context='VERTS')
            verts = [v for v in verts if v.is_valid]
        self._finish(verts, self.slot(hexc, glow), 0)

    def to_object(self, name, coll):
        mesh = bpy.data.meshes.new(name)
        self.bm.normal_update()
        self.bm.to_mesh(mesh)
        self.bm.free()
        for m in self.mats:
            mesh.materials.append(m)
        for p in mesh.polygons:
            p.use_smooth = False
        obj = bpy.data.objects.new(name, mesh)
        coll.objects.link(obj)
        return obj


def build_vehicle(v, coll):
    root = bpy.data.objects.new(v['id'], None)
    root.empty_display_type = 'ARROWS'
    coll.objects.link(root)
    before = set(coll.objects)
    _build_parts(v, coll)
    for o in set(coll.objects) - before:
        o.parent = root
        o.name = f"{v['id']}:{o.name}"
    return root


def _build_parts(v, coll):
    bike = v['id'] == 'thunder-pony'
    parts, half, wr = v['parts'], v['half'], v['wheelR']
    b = Builder()
    for p in parts:
        b.box(p['size'], p['pos'], p['color'], glow=p.get('glow', False), taper=0.18 if p['color'] == GLASS else 0.0)

    shell = parts[0]
    (sw, sh, sd), (px, py, pz) = shell['size'], shell['pos']
    hx, hy, hz = sw / 2, sh / 2, sd / 2
    front, rear = px + hx, px - hx
    if bike:
        b.box((0.25, 0.25, 0.3), (front + 0.15, py + 0.55, pz), HEADLIGHT, glow=True, bevel=0.03)
        b.cyl(0.07, 0.6, (rear + 0.1, py - 0.05, pz + 0.25), 'x', CHROME, segments=8)
    else:
        for s in (-1, 1):
            b.box((0.06, min(0.2, sh * 0.25), min(0.32, sd * 0.18)), (front + 0.03, py + hy * 0.3, pz + s * hz * 0.62), HEADLIGHT, glow=True, bevel=0.0)
            b.box((0.06, min(0.16, sh * 0.2), min(0.3, sd * 0.16)), (rear - 0.03, py + hy * 0.35, pz + s * hz * 0.65), TAILLIGHT, glow=True, bevel=0.0)
            b.cyl(0.06, 0.3, (rear - 0.1, py - hy * 0.75, pz + s * hz * 0.45), 'x', DARK, segments=8)
        b.box((0.05, sh * 0.4, sd * 0.42), (front + 0.03, py - hy * 0.05, pz), DARK, bevel=0.0)
        for x in (front + 0.08, rear - 0.08):
            b.box((0.16, min(0.18, sh * 0.25), sd + 0.06), (x, py - hy * 0.65, pz), CHROME, bevel=0.03)
        glass = next((p for p in parts if p['color'] == GLASS and p['size'][2] > 0.6), None)
        if glass:
            (gw, gh, gd), (gx, gy, gz) = glass['size'], glass['pos']
            for s in (-1, 1):
                b.box((0.14, 0.1, 0.16), (gx + gw / 2 - 0.1, gy - gh * 0.25, gz + s * (gd / 2 + 0.1)), DARK, bevel=0.02)
        for w in v['wheels']:
            out = 1 if w['z'] > 0 else -1
            b.cyl(wr + 0.1, 0.38, (w['x'], w['y'], w['z'] - out * 0.02), 'z', v['color'], segments=12, half=True)
    body = b.to_object('body', coll)

    names = {(True, -1): 'wheel_FL', (True, 1): 'wheel_FR', (False, -1): 'wheel_RL', (False, 1): 'wheel_RR'}
    for w in v['wheels']:
        wb = Builder()
        wb.cyl(wr, 0.34, (0, 0, 0), 'z', DARK, segments=16)
        wb.cyl(wr * 0.62, 0.36, (0, 0, 0), 'z', CHROME, segments=12)
        wb.cyl(wr * 0.22, 0.38, (0, 0, 0), 'z', v['color'], segments=8)
        for k in range(4):  # spokes make the spin readable
            a = k * math.pi / 4
            wb.box((wr * 1.1, 0.06, 0.37), (0, 0, 0), DARK, bevel=0.0)
            bmesh.ops.rotate(wb.bm, verts=wb.bm.verts[-8:], cent=(0, 0, 0), matrix=Matrix.Rotation(a, 3, 'Y'))
        obj = wb.to_object(names[(w['front'], 1 if w['z'] > 0 else -1)], coll)
        obj.location = g2b(w['x'], w['y'], w['z'])

    def empty(name, at):
        e = bpy.data.objects.new(name, None)
        e.empty_display_size = 0.2
        e.location = g2b(*at)
        coll.objects.link(e)

    zm = min(0.6, half['z'] * 0.7)
    empty('muzzle_L', (half['x'] + 0.3, 0.35, -zm))
    empty('muzzle_R', (half['x'] + 0.3, 0.35, zm))
    empty('special_mount', (0, half['y'] + 0.3, 0))
    empty('exhaust', (-half['x'] - 0.1, -half['y'] * 0.75, half['z'] * 0.45))


def add_missing(vehicles):
    """Existing .blend: build only vehicles it doesn't have yet, after the current line-up."""
    if os.path.abspath(bpy.data.filepath or '') != os.path.abspath(BLEND):
        bpy.ops.wm.open_mainfile(filepath=BLEND)
    have = {o.name for o in bpy.data.objects if o.parent is None}
    todo = [v for v in vehicles if v['id'] not in have]
    start = len(have)
    for i, v in enumerate(todo):
        coll = bpy.data.collections.new(v['id'])
        bpy.context.scene.collection.children.link(coll)
        root = build_vehicle(v, coll)
        k = start + i
        root.location = ((k % 5) * 9, -(k // 5) * 6, 0)
    if todo:
        bpy.ops.wm.save_mainfile()
    print(f"added {[v['id'] for v in todo] or 'nothing'} to {BLEND}")


def main():
    vehicles = json.load(open(DATA))
    if os.path.exists(BLEND) and not FORCE:
        add_missing(vehicles)
        exec(open(os.path.join(ROOT, 'tools', 'blender', 'export_vehicles.py')).read(), {'ROOT': ROOT, '__name__': 'export'})
        return
    os.makedirs(os.path.dirname(BLEND), exist_ok=True)
    # Fresh scene.
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)

    for i, v in enumerate(vehicles):
        coll = bpy.data.collections.new(v['id'])
        bpy.context.scene.collection.children.link(coll)
        root = build_vehicle(v, coll)
        root.location = ((i % 5) * 9, -(i // 5) * 6, 0)  # line-up; export moves each to the origin
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print(f'saved {BLEND}')
    exec(open(os.path.join(ROOT, 'tools', 'blender', 'export_vehicles.py')).read(), {'ROOT': ROOT, '__name__': 'export'})


main()
