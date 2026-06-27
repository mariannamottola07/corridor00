import math
from pathlib import Path

import bpy
from mathutils import Vector


PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = PROJECT_ROOT / "web_viewer" / "renders"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

NODES = [
    {
        "id": "entrance",
        "title": "Ingresso",
        "position": (0.0, 1.15, 1.62),
        "target": (0.0, 12.6, 1.58),
    },
    {
        "id": "corridor_mid",
        "title": "Meta Corridoio",
        "position": (0.35, 8.8, 1.55),
        "target": (0.2, 18.2, 1.42),
    },
    {
        "id": "wheelchair",
        "title": "Sedia a Rotelle",
        "position": (0.95, 13.0, 1.45),
        "target": (0.2, 14.8, 0.94),
    },
    {
        "id": "doorway",
        "title": "Porta Segreta",
        "position": (0.7, 19.0, 1.55),
        "target": (2.55, 20.72, 1.35),
    },
    {
        "id": "vending_end",
        "title": "Fondo Corridoio",
        "position": (0.28, 23.85, 1.5),
        "target": (0.0, 26.55, 1.35),
    },
    {
        "id": "secret_room",
        "title": "Stanza Segreta",
        "position": (3.45, 20.7, 1.5),
        "target": (4.55, 20.8, 1.15),
    },
]


def ensure_camera(scene):
    camera = bpy.data.objects.get("OfflineViewerCam")
    if camera is None or camera.type != "CAMERA":
        camera_data = bpy.data.cameras.new("OfflineViewerCam_Data")
        camera = bpy.data.objects.new("OfflineViewerCam", camera_data)
        scene.collection.objects.link(camera)

    scene.camera = camera
    camera.data.lens = 22
    camera.data.clip_start = 0.01
    camera.data.clip_end = 250.0
    return camera


def look_at(camera, target):
    direction = Vector(target) - camera.location
    rotation = direction.to_track_quat("-Z", "Y")
    camera.rotation_euler = rotation.to_euler()


def configure_render(scene):
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in {
        item.identifier for item in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items
    } else "BLENDER_EEVEE"
    scene.render.image_settings.file_format = "PNG"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    if hasattr(scene, "eevee"):
        eevee = scene.eevee
        if hasattr(eevee, "use_bloom"):
            eevee.use_bloom = True
        if hasattr(eevee, "bloom_intensity"):
            eevee.bloom_intensity = 0.08


def render_views():
    scene = bpy.context.scene
    configure_render(scene)
    camera = ensure_camera(scene)

    for node in NODES:
        camera.location = Vector(node["position"])
        look_at(camera, node["target"])
        scene.render.filepath = str(OUTPUT_DIR / f"{node['id']}.png")
        bpy.ops.render.render(write_still=True)
        print(f"[offline-viewer] rendered {node['id']}")


if __name__ == "__main__":
    render_views()
