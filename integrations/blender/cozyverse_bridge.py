bl_info = {
    "name": "Cozyverse Bridge",
    "author": "Wheelbarrow Studios",
    "version": (0, 1, 0),
    "blender": (3, 6, 0),
    "location": "View3D > Sidebar (N) > Cozyverse",
    "description": "Import a decomposed Cozyverse scene (scene.json + per-object GLBs) laid out on a ground plane.",
    "category": "Import-Export",
}

import json
import os

import bpy
from bpy.props import StringProperty, FloatProperty
from mathutils import Vector

# Room the diorama is spread across, in Blender units.
DEFAULT_ROOM = 4.0


def _load_image_size(path):
    try:
        img = bpy.data.images.load(path, check_existing=True)
        w, h = img.size[0], img.size[1]
        return (w, h) if w and h else (1024, 1024)
    except Exception:
        return (1024, 1024)


def _import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    if not new:
        return None
    # Join the imported hierarchy's meshes under a single empty for easy handling.
    roots = [o for o in new if o.parent is None] or new
    return roots[0] if len(roots) == 1 else _group(roots, os.path.basename(path))


def _group(objs, name):
    empty = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(empty)
    for o in objs:
        if o.parent is None:
            o.parent = empty
    return empty


def _world_bbox(obj):
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    if obj.children:
        for ch in obj.children:
            corners += [ch.matrix_world @ Vector(c) for c in ch.bound_box]
    mn = Vector((min(c[i] for c in corners) for i in range(3)))
    mx = Vector((max(c[i] for c in corners) for i in range(3)))
    return mn, mx


class COZY_OT_import_scene(bpy.types.Operator):
    bl_idname = "cozyverse.import_scene"
    bl_label = "Import Decomposed Scene"
    bl_description = "Read a Cozyverse scene.json and lay out its objects"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        props = context.scene.cozyverse
        path = bpy.path.abspath(props.scene_json)
        if not os.path.isfile(path):
            self.report({"ERROR"}, "scene.json not found: %s" % path)
            return {"CANCELLED"}

        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)

        room = props.room_size
        img_w, img_h = _load_image_size(data.get("sourceImage", ""))
        parent = bpy.data.objects.new("Cozyverse %s" % data.get("job", "scene"), None)
        context.scene.collection.objects.link(parent)

        placed = 0
        for obj in data.get("objects", []):
            models = obj.get("models", {})
            key = obj.get("preferred") or (next(iter(models), None))
            glb = models.get(key) if key else None
            if not glb or not os.path.isfile(glb):
                continue

            imported = _import_glb(glb)
            if imported is None:
                continue
            imported.name = obj.get("class", "object")
            imported.parent = parent

            x0, y0, x1, y1 = obj.get("bbox", [0, 0, img_w, img_h])
            cx = ((x0 + x1) / 2) / max(img_w, 1)
            cy = ((y0 + y1) / 2) / max(img_h, 1)
            bh = (y1 - y0) / max(img_h, 1)

            # Ground-plane placement: image X -> world X, image Y (down) -> world -Y.
            imported.location = ((cx - 0.5) * room, -(cy - 0.5) * room, 0.0)

            # Scale so the object's height roughly tracks its footprint in frame.
            mn, mx = _world_bbox(imported)
            cur_h = max(mx.z - mn.z, 1e-4)
            target_h = max(bh * room * 0.9, room * 0.05)
            s = target_h / cur_h
            imported.scale = (s, s, s)
            bpy.context.view_layer.update()
            mn, _ = _world_bbox(imported)
            imported.location.z -= mn.z  # sit on the floor
            placed += 1

        self.report({"INFO"}, "Cozyverse: placed %d object(s)" % placed)
        return {"FINISHED"}


class COZY_PT_panel(bpy.types.Panel):
    bl_label = "Cozyverse"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Cozyverse"

    def draw(self, context):
        layout = self.layout
        props = context.scene.cozyverse
        layout.prop(props, "scene_json", text="")
        layout.prop(props, "room_size")
        layout.operator("cozyverse.import_scene", icon="IMPORT")
        layout.label(text="Pick the scene.json from")
        layout.label(text="<project>/assets/decompose/<job>/")


class COZY_Props(bpy.types.PropertyGroup):
    scene_json: StringProperty(name="scene.json", subtype="FILE_PATH")
    room_size: FloatProperty(name="Room size", default=DEFAULT_ROOM, min=0.5, max=50.0)


_classes = (COZY_OT_import_scene, COZY_PT_panel, COZY_Props)


def register():
    for c in _classes:
        bpy.utils.register_class(c)
    bpy.types.Scene.cozyverse = bpy.props.PointerProperty(type=COZY_Props)


def unregister():
    del bpy.types.Scene.cozyverse
    for c in reversed(_classes):
        bpy.utils.unregister_class(c)


if __name__ == "__main__":
    register()
