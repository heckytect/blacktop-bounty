"""
Export every vehicle in the open .blend (blender/vehicles.blend) to public/assets/vehicles/<id>.glb.

Use this after editing models by hand. Each vehicle is a root empty named <id> whose children are
named "<id>:body", "<id>:wheel_FL", ... (spec §8.1). During export the root is moved to the origin
and the "<id>:" prefix is stripped, so the .glb has the plain §8.1 names the game looks for.

Run inside Blender:  exec(open('<repo>/tools/blender/export_vehicles.py').read(), {'ROOT': '<repo>'})
or headless:        blender -b blender/vehicles.blend -P tools/blender/export_vehicles.py -- <repo>
"""
import bpy, os, sys

ROOT = globals().get('ROOT') or (sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else os.getcwd())
OUT = os.path.join(ROOT, 'public', 'assets', 'vehicles')
REQUIRED = ['body', 'wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR']


def tris(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs if o.type == 'MESH')


def export_all():
    os.makedirs(OUT, exist_ok=True)
    roots = [o for o in bpy.data.objects if o.parent is None and o.type == 'EMPTY' and any(c.name == f'{o.name}:body' for c in o.children)]
    report = []
    for root in sorted(roots, key=lambda o: o.name):
        vid = root.name
        kids = list(root.children_recursive)
        missing = [n for n in REQUIRED if not any(k.name == f'{vid}:{n}' for k in kids)]
        if missing:
            report.append(f'{vid}: SKIPPED, missing {missing}')
            continue
        saved = root.location.copy()
        root.location = (0, 0, 0)
        for k in kids:
            k.name = k.name.split(':', 1)[1]  # plain §8.1 names inside the file
        bpy.context.view_layer.update()
        bpy.ops.object.select_all(action='DESELECT')
        for o in [root, *kids]:
            o.hide_set(False)
            o.select_set(True)
        path = os.path.join(OUT, f'{vid}.glb')
        try:
            bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True, export_extras=False)
        finally:
            for k in kids:
                k.name = f'{vid}:{k.name}'
            root.location = saved
        report.append(f'{vid}: {tris(kids)} tris, {os.path.getsize(path) // 1024} KB')
    print('\n'.join(report))
    return report


export_all()
