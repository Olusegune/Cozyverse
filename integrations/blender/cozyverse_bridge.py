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
import math
import os

import bpy
from bpy.props import StringProperty, FloatProperty, EnumProperty
from mathutils import Color, Vector

# Room the diorama is spread across, in Blender units.
DEFAULT_ROOM = 4.0

# Must match the keys Cozyverse Studio writes into scene.json's "lightingPresets"
# (src-tauri/src/decompose.rs's lighting_presets_json(), itself translated from
# src/lib/lightPresets.ts) — same one-click moods available in the in-app 3D viewer,
# recreated here as real Blender lights + world background instead of Blender's bare defaults.
LIGHTING_PRESET_ITEMS = [
    ("none", "None (Blender defaults)", "Don't touch lighting or world background"),
    ("studio", "Studio", "Neutral, even light — matches the in-app default"),
    ("goldenHour", "Golden Hour", "Warm low sun, long amber shadows"),
    ("cozyWarm", "Cozy Warm", "Soft warm interior glow"),
    ("moonlitBlue", "Moonlit Blue", "Cool blue night lighting"),
    ("overcast", "Overcast Soft", "Flat, soft, shadowless daylight"),
]


def _srgb_int_to_linear_color(value):
    """0xRRGGBB (sRGB, same as three.js hex colors) -> a linear-space Color Blender lights want."""
    r = ((value >> 16) & 0xFF) / 255.0
    g = ((value >> 8) & 0xFF) / 255.0
    b = (value & 0xFF) / 255.0
    c = Color((r, g, b))
    # Blender's Color has no built-in sRGB->linear; approximate with the standard gamma curve,
    # good enough for recreating a *mood*, not a colorimetrically exact match.
    to_linear = lambda ch: ch / 12.92 if ch <= 0.04045 else ((ch + 0.055) / 1.055) ** 2.4
    return Color((to_linear(c.r), to_linear(c.g), to_linear(c.b)))


def _three_to_blender(pos):
    """three.js/glTF is Y-up (x, y, z); Blender is Z-up. Swapping y/z (with the sign the rest of
    this add-on already uses for object placement) carries the same spatial layout across."""
    x, y, z = pos
    return Vector((x, z, y))


def _add_sun(name, preset_light, energy_scale):
    light_data = bpy.data.lights.new(name=name, type="SUN")
    light_data.color = _srgb_int_to_linear_color(preset_light["color"])
    light_data.energy = max(preset_light["intensity"] * energy_scale, 0.05)
    light_obj = bpy.data.objects.new(name, light_data)
    bpy.context.scene.collection.objects.link(light_obj)
    light_obj.location = _three_to_blender(preset_light["position"])
    direction = -light_obj.location.normalized() if light_obj.location.length > 1e-4 else Vector((0, 0, -1))
    light_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return light_obj


def apply_lighting_preset(preset_id, presets, room_size):
    """Create real Blender lights + set the world background from one of scene.json's
    lightingPresets — the Blender-side half of Cozyverse's one-click lighting. Sun lamps are used
    for all three (key/fill/rim) since they're directional like the app's own DirectionalLights;
    intensity is scaled by room_size so the mood holds regardless of diorama scale."""
    preset = presets.get(preset_id)
    if not preset:
        return None
    energy_scale = max(room_size / DEFAULT_ROOM, 0.1)
    group = bpy.data.objects.new("Cozyverse Lighting (%s)" % preset_id, None)
    bpy.context.scene.collection.objects.link(group)
    for role, energy_mul in (("key", 1.0), ("fill", 0.7), ("rim", 0.6)):
        light = _add_sun("Cozyverse %s" % role, preset[role], energy_scale * energy_mul)
        light.parent = group

    world = bpy.context.scene.world or bpy.data.worlds.new("Cozyverse World")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg is not None:
        if preset.get("background") is not None:
            linear = _srgb_int_to_linear_color(preset["background"])
            bg.inputs[0].default_value = (linear.r, linear.g, linear.b, 1.0)
        ambient = preset.get("ambient", {})
        # Ambient intensity roughly maps to the world's own light contribution.
        bg.inputs[1].default_value = max(ambient.get("intensity", 1.0) * 0.3, 0.02)
    return group


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
        credits = []
        for obj in data.get("objects", []):
            models = obj.get("models", {})
            attr = obj.get("attribution")
            if attr:
                credits.append(
                    "%s (%s, %s)"
                    % (
                        attr.get("author", "?"),
                        attr.get("source", "?"),
                        attr.get("license", "CC0"),
                    )
                )
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

        lit = False
        if props.lighting_preset != "none":
            presets = data.get("lightingPresets", {})
            lit = apply_lighting_preset(props.lighting_preset, presets, room) is not None
            if not lit:
                self.report({"WARNING"}, "This scene.json has no lightingPresets — re-export from a current Cozyverse Studio build to get lighting data.")

        msg = "Cozyverse: placed %d object(s)" % placed
        if lit:
            msg += " · lighting: %s" % props.lighting_preset
        if credits:
            uniq = sorted(set(credits))
            msg += " · library assets: " + ", ".join(uniq)
            print("[Cozyverse] Third-party assets in this scene:\n  " + "\n  ".join(uniq))
        self.report({"INFO"}, msg)
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
        layout.prop(props, "lighting_preset", text="Lighting")
        layout.operator("cozyverse.import_scene", icon="IMPORT")
        layout.label(text="Pick the scene.json from")
        layout.label(text="<project>/assets/decompose/<job>/")
        layout.separator()
        layout.label(text="For Twinmotion / Unreal:", icon="INFO")
        layout.label(text="File > Export > FBX after import —")
        layout.label(text="the lights above carry over with it.")


class COZY_Props(bpy.types.PropertyGroup):
    scene_json: StringProperty(name="scene.json", subtype="FILE_PATH")
    room_size: FloatProperty(name="Room size", default=DEFAULT_ROOM, min=0.5, max=50.0)
    lighting_preset: EnumProperty(
        name="Lighting",
        description="Recreate one of Cozyverse Studio's one-click lighting moods as real Blender lights + world background",
        items=LIGHTING_PRESET_ITEMS,
        default="studio",
    )


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
