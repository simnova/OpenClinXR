"""Hair key-light geometry sweep built on the repaired image-refl scene/ID pass."""
from pathlib import Path


BASE = Path(__file__).with_name("image-refl.py")
source = BASE.read_text()
source = source.replace('"row-refl.json"', '"row-key.json"')
source = source.replace('"front-refl.png"', '"front-key.png"')
source = source.replace('"mask-overlay-refl.png"', '"mask-overlay-key.png"')

start_marker = "        # Pinned controls plus four requested one-change cells."
end_marker = "\n\n    except _SocketReadbackMismatch:"
start = source.index(start_marker)
end = source.index(end_marker, start)

replacement = r'''        # Pinned controls; the experimental lever is key elevation only.
        exposure_default = -0.375
        light_scale = 0.7711054127039704
        sc.view_settings.exposure = exposure_default
        specs = (
            {"label": "control", "elevation": None, "roughness": 0.25},
            {"label": "elevation 55 / roughness 0.25", "elevation": 55.0, "roughness": 0.25},
            {"label": "elevation 55 / roughness 0.12", "elevation": 55.0, "roughness": 0.12},
            {"label": "elevation 65 / roughness 0.12", "elevation": 65.0, "roughness": 0.12},
        )
        cells = []
        beauty_paths = []
        id_paths = []
        import math
        from mathutils import Vector
        key = bpy.data.objects.get("OCLX_key")
        if key is None or key.data is None:
            raise RuntimeError("Error: missing scene light OCLX_key")
        aim = Vector((head_cx, 0.0, crown_z - 0.12))
        control_location = key.location.copy()
        control_vector = control_location - aim
        control_distance = float(control_vector.length)
        control_elevation = math.degrees(math.asin(control_vector.z / control_distance))
        control_horizontal = math.hypot(control_vector.x, control_vector.y)
        azimuth_x = control_vector.x / control_horizontal
        azimuth_y = control_vector.y / control_horizontal

        def beauty_metrics(beauty_path, id_path):
            beauty = _np.asarray(PILImage.open(beauty_path).convert("RGB"), dtype=_np.float64) / 255.0
            alpha = _np.asarray(PILImage.open(id_path).convert("RGBA"), dtype=_np.float64)[..., 3] / 255.0
            covered = alpha >= 0.9
            count = int(covered.sum())
            if not count:
                return 0, {"mean": 0.0, "p10": 0.0, "p50": 0.0, "p90": 0.0,
                           "rbRatio": 0.0}, 1.0, 0.0, covered
            rgb = beauty[covered]
            full_lum = 0.2126 * beauty[..., 0] + 0.7152 * beauty[..., 1] + 0.0722 * beauty[..., 2]
            lum = full_lum[covered]
            vals = _np.percentile(lum, [10, 50, 90])
            stats = {"mean": float(lum.mean()), "p10": float(vals[0]),
                     "p50": float(vals[1]), "p90": float(vals[2]),
                     "rbRatio": float(rgb[:, 0].mean() / max(rgb[:, 2].mean(), 1e-9))}
            spread = float(_np.abs(rgb[:, 0] - rgb[:, 2]).mean())
            ys, xs = _np.nonzero(covered)
            top, bottom = int(ys.min()), int(ys.max())
            band_bottom = top + max(1, int(math.ceil(0.30 * (bottom - top + 1))))
            sheen = covered & (full_lum > stats["p90"])
            sheen_count = int(sheen.sum())
            band_fraction = float((sheen & (_np.indices(covered.shape)[0] < band_bottom)).sum()) / max(1, sheen_count)
            return count, stats, spread, band_fraction, sheen

        def render_beauty(path, exposure):
            sc.view_settings.exposure = exposure
            configure_render(1024, 128, transparent=False)
            sc.render.filepath = path
            sc.render.image_settings.file_format = "PNG"
            sc.render.image_settings.color_mode = "RGBA"
            bpy.ops.render.render(write_still=True)
            return run_measure(path)

        for ci, spec in enumerate(specs):
            stage = "sweep"
            for lname, watts in (("OCLX_key", 150.0), ("OCLX_fill", 40.0), ("OCLX_rim", 40.0)):
                light = bpy.data.objects.get(lname)
                if light is None or light.data is None:
                    raise RuntimeError("Error: missing scene light %s" % lname)
                light.data.energy = watts * light_scale
                light["nominalWatts"] = watts
            world_bg = sc.world.node_tree.nodes.get("Background")
            if world_bg is None:
                raise RuntimeError("Error: world Background node missing")
            world_bg.inputs["Strength"].default_value = 0.3
            hair.inputs["Roughness"].default_value = spec["roughness"]
            hair.inputs["Radial Roughness"].default_value = 0.2
            hair.inputs["Coat"].default_value = 0.1
            shader_readback = {
                "melanin": float(hair.inputs["Melanin"].default_value),
                "redness": float(hair.inputs["Melanin Redness"].default_value),
                "roughness": float(hair.inputs["Roughness"].default_value),
                "radial": float(hair.inputs["Radial Roughness"].default_value),
                "coat": float(hair.inputs["Coat"].default_value),
            }
            expected_shader = {"melanin": 0.95, "redness": 0.5,
                               "roughness": spec["roughness"], "radial": 0.2,
                               "coat": 0.1}
            if any(abs(shader_readback[k] - v) > 1e-7 for k, v in expected_shader.items()):
                raise RuntimeError("Error: hair socket read-back mismatch wrote=%s got=%s" %
                                   (expected_shader, shader_readback))
            if spec["elevation"] is None:
                key.location = control_location
            else:
                elev_rad = math.radians(spec["elevation"])
                horizontal = 2.06 * math.cos(elev_rad)
                key.location = aim + Vector((azimuth_x * horizontal, azimuth_y * horizontal,
                                             2.06 * math.sin(elev_rad)))
            track_cam(key, aim)
            bpy.context.view_layer.update()
            key_vector = key.location - aim
            key_distance = float(key_vector.length)
            elevation_readback = math.degrees(math.asin(key_vector.z / key_distance))
            requested_elevation = control_elevation if spec["elevation"] is None else spec["elevation"]
            if abs(elevation_readback - requested_elevation) > 1.0:
                raise RuntimeError("Error: key elevation read-back %.6f differs from requested %.6f" %
                                   (elevation_readback, requested_elevation))
            ro = restore_base(curves)
            profile_readback = apply_cell_ro(4, 0.002, 0.0003, ro)
            ro.data.materials.clear()
            ro.data.materials.append(mat)
            after = strand_count(ro)
            beauty_name = "key-%d.png" % (ci + 1)
            id_name = "hair-id-key-%d.png" % (ci + 1)
            beauty_path = os.path.join(out_dir, beauty_name)
            id_path = os.path.join(out_dir, id_name)
            exposure = exposure_default
            meas = render_beauty(beauty_path, exposure)
            calibration_iterations = 0
            if not (0.55 <= float(meas["faceMeanLuminance"]) <= 0.70):
                low, high = -3.0, 2.0
                for calibration_iterations in range(1, 7):
                    exposure = (low + high) / 2.0
                    meas = render_beauty(beauty_path, exposure)
                    face = float(meas["faceMeanLuminance"])
                    if face < 0.55:
                        low = exposure
                    elif face > 0.70:
                        high = exposure
                    else:
                        break
            render_id(ro, id_path, 1024)
            coverage_pixels, coverage_lum, mask_rb_spread, band_fraction, sheen = beauty_metrics(
                beauty_path, id_path)
            checks = {
                "hairP50": coverage_lum["p50"] <= 0.12,
                "hairP90": coverage_lum["p90"] <= 0.24,
                "hairP10": coverage_lum["p10"] >= 0.03,
                "meanRB": coverage_lum["rbRatio"] >= 1.2,
                "face": 0.55 <= float(meas["faceMeanLuminance"]) <= 0.70,
                "background": 0.45 <= float(meas["backgroundLuminance"]) <= 0.55,
                "volume": abs(float(meas["volume"]) - 0.224) <= 0.01,
                "strands": after == 50265,
                "maskPixels": coverage_pixels >= 100000,
                "maskRBSpread": mask_rb_spread < 0.20,
                "sheenBand": band_fraction >= 0.60,
            }
            cell = {
                "index": ci + 1, "label": spec["label"],
                "requestedElevationDegrees": requested_elevation,
                "elevationDegrees": elevation_readback,
                "roughness": spec["roughness"], "exposureStops": exposure,
                "exposureCalibrationIterations": calibration_iterations,
                "rimWatts": 40.0, "keyWatts": 150.0, "fillWatts": 40.0,
                "lightScale": light_scale, "worldStrength": 0.3,
                "radius": 0.0003, "amount": 4, "profileRadiusReadBack": profile_readback,
                "surfaceSocketNames": surface_socket_names, "surfaceReadBack": shader_readback,
                "lightReadBack": {
                    "keyLocation": [float(v) for v in key.location],
                    "keyEnergy": float(key.data.energy), "keyNominalWatts": float(key["nominalWatts"]),
                    "keySize": float(key.data.size), "keyDistance": key_distance,
                    "keyElevationDegrees": elevation_readback,
                    "fillEnergy": float(bpy.data.objects["OCLX_fill"].data.energy),
                    "rimEnergy": float(bpy.data.objects["OCLX_rim"].data.energy),
                    "roughness": float(hair.inputs["Roughness"].default_value),
                },
                "strandsAfter": after, "volume": float(meas["volume"]),
                "faceMeanLuminance": float(meas["faceMeanLuminance"]),
                "backgroundLuminance": float(meas["backgroundLuminance"]),
                "coveragePixels": coverage_pixels, "coverageHairLuminance": coverage_lum,
                "meanRBSpread": mask_rb_spread, "sheenBandFraction": band_fraction,
                "beautyPng": beauty_name, "idPng": id_name, "checks": checks,
                "ok": bool(all(checks.values())),
            }
            cells.append(cell)
            beauty_paths.append(beauty_path)
            id_paths.append(id_path)
            print("KEY cell=%d elevation=%.3f roughness=%.3f exposure=%.4f metrics=%s ok=%s" % (
                ci + 1, elevation_readback, spec["roughness"], exposure,
                json.dumps(coverage_lum, sort_keys=True), cell["ok"]))

        print("TABLE " + json.dumps(cells, sort_keys=True))
        from PIL import ImageDraw
        sheet = PILImage.new("RGB", (512 * len(cells), 512), (20, 20, 20))
        for ci, (cell, path) in enumerate(zip(cells, beauty_paths)):
            panel = PILImage.open(path).convert("RGB").resize((512, 512), PILImage.Resampling.LANCZOS)
            draw = ImageDraw.Draw(panel)
            draw.rectangle((0, 0, 511, 96), fill=(12, 12, 12))
            draw.text((6, 5), "elev=%.2f rough=%.2f exp=%.3f" % (
                cell["elevationDegrees"], cell["roughness"], cell["exposureStops"]), fill=(255, 255, 0))
            draw.text((6, 23), "p10=%.3f p50=%.3f p90=%.3f" % (
                cell["coverageHairLuminance"]["p10"], cell["coverageHairLuminance"]["p50"],
                cell["coverageHairLuminance"]["p90"]), fill=(255, 255, 0))
            draw.text((6, 41), "R/B=%.3f spread=%.3f band=%.3f" % (
                cell["coverageHairLuminance"]["rbRatio"], cell["meanRBSpread"],
                cell["sheenBandFraction"]), fill=(255, 255, 0))
            draw.text((6, 59), "face=%.3f bg=%.3f px=%d" % (
                cell["faceMeanLuminance"], cell["backgroundLuminance"],
                cell["coveragePixels"]), fill=(255, 255, 0))
            draw.text((6, 77), "ok=%s" % cell["ok"],
                      fill=(0, 255, 0) if cell["ok"] else (255, 80, 80))
            sheet.paste(panel, (ci * 512, 0))
        sheet.save(os.path.join(out_dir, "sweep-key.png"), compress_level=1)

        stage = "select"
        passing = [c for c in cells if c["ok"]]
        selected = (min(passing, key=lambda c: (c["elevationDegrees"], c["index"]))
                    if passing else min(cells, key=lambda c: c["coverageHairLuminance"]["p50"]))
        selected_index = cells.index(selected)
        front_path = os.path.join(out_dir, "front-key.png")
        PILImage.open(beauty_paths[selected_index]).save(front_path, compress_level=1)
        PILImage.open(id_paths[selected_index]).save(
            os.path.join(out_dir, "hair-id-key.png"), compress_level=1)
        beauty_rgba = PILImage.open(beauty_paths[selected_index]).convert("RGBA")
        id_alpha = PILImage.open(id_paths[selected_index]).convert("RGBA").getchannel("A")
        red = PILImage.new("RGBA", beauty_rgba.size, (255, 0, 0, 96))
        overlay = PILImage.composite(red, PILImage.new("RGBA", beauty_rgba.size, (0, 0, 0, 0)), id_alpha)
        PILImage.alpha_composite(beauty_rgba, overlay).save(
            os.path.join(out_dir, "mask-overlay-key.png"), compress_level=1)
        _, _, _, _, selected_sheen = beauty_metrics(beauty_paths[selected_index], id_paths[selected_index])
        sheen_image = _np.asarray(beauty_rgba.convert("RGB"), dtype=_np.uint8).copy()
        sheen_image[selected_sheen] = (255, 0, 0)
        PILImage.fromarray(sheen_image, "RGB").save(
            os.path.join(out_dir, "hair-sheen-key.png"), compress_level=1)
        light_count = len([o for o in bpy.context.scene.objects if o.type == "LIGHT"])
        if light_count != 3:
            raise RuntimeError("Error: rig light count %d != 3" % light_count)
        falsifier = ("floor is not R geometry; global tone transform legitimate"
                     if cells[3]["coverageHairLuminance"]["p50"] > 0.14 else "")
        row_ok = bool(passing)
        row = {
            "ok": row_ok, "stage": "measure",
            "error": "" if row_ok else "Error: no key-geometry cell satisfies every bar; lowest p50 selected",
            "blenderVersion": blender_version, "lightCount": light_count,
            "targetTriple": {"p10": 0.039, "p50": 0.078, "p90": 0.159},
            "cells": cells, "selected": selected, "falsifier": falsifier,
            "front": "front-key.png", "selectedIdPng": "hair-id-key.png",
            "maskOverlay": "mask-overlay-key.png", "hairSheen": "hair-sheen-key.png",
            "sweep": "sweep-key.png",
        }
        with open(os.path.join(out_dir, "row-key.json"), "w") as h:
            json.dump(row, h, indent=1)
        print("SELECTED cell=%d elevation=%.3f p50=%.4f ok=%s" % (
            selected["index"], selected["elevationDegrees"],
            selected["coverageHairLuminance"]["p50"], selected["ok"]))
        return'''

source = source[:start] + replacement + source[end:]
scope = {"__name__": "__main__", "__file__": str(BASE)}
exec(compile(source, str(Path(__file__)), "exec"), scope)
