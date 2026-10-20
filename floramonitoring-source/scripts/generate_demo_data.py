"""
Generate FloraScope's synthetic demo datasets.

These are procedurally generated drone orthomosaics + canopy height models
(CHMs) that mimic two Flora project archetypes:

  1. ARR dryland plantation (Thar / Oran-style), two survey dates one year apart
  2. Mangrove plantation on a tidal mudflat (Sundarbans-style)

They are SYNTHETIC. They exist so the app can be demoed end-to-end without a
real flight. Ground truth (every planted position, alive/dead, crown, height)
is written next to each image so detection accuracy can be measured.

Usage:  python3 scripts/generate_demo_data.py   (writes to public/demo/)
Requires: numpy, scipy, rasterio, pyproj
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, asdict

import numpy as np
import rasterio
from rasterio.transform import from_origin
from pyproj import Transformer
from scipy import ndimage

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "demo")
os.makedirs(OUT, exist_ok=True)


# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------

def value_noise(shape, scale_px, rng, octaves=4, persistence=0.5):
    """Smooth multi-octave value noise in [-1, 1]."""
    h, w = shape
    out = np.zeros(shape, np.float32)
    amp, total = 1.0, 0.0
    s = scale_px
    for _ in range(octaves):
        gh, gw = max(2, int(h / s) + 2), max(2, int(w / s) + 2)
        grid = rng.standard_normal((gh, gw)).astype(np.float32)
        up = ndimage.zoom(grid, (h / (gh - 1), w / (gw - 1)), order=3)[:h, :w]
        if up.shape != shape:
            up = np.pad(up, ((0, h - up.shape[0]), (0, w - up.shape[1])), mode="edge")
        out += amp * up
        total += amp
        amp *= persistence
        s = max(1.5, s / 2)
    out /= total
    return np.clip(out / (np.abs(out).max() + 1e-6), -1, 1)


@dataclass
class TreeTruth:
    id: int
    row: int
    col: int
    x_m: float  # map x (UTM easting)
    y_m: float  # map y (UTM northing)
    px: float
    py: float
    alive: bool
    crown_d_m: float
    height_m: float
    health: str  # healthy | watch | weak | dead


def draw_crowns(img, chm, trees_px, gsd, rng, sun=(0.6, -0.8), palette=None, chm_gsd=None):
    """Draw shadows then crowns into img (float32 HxWx3, 0-255) and the CHM."""
    h, w, _ = img.shape
    fine = value_noise((h, w), 3, rng, octaves=2)
    sx, sy = sun
    # --- shadows first (cast away from the sun)
    for t in trees_px:
        if not t["alive"]:
            continue
        r = t["r"]
        L = t["h"] * 0.55 / gsd  # shadow length px
        cx, cy = t["px"] - sx * L, t["py"] - sy * L
        rr = r * 1.05
        x0, x1 = int(max(0, cx - rr - 3)), int(min(w, cx + rr + 4))
        y0, y1 = int(max(0, cy - rr - 3)), int(min(h, cy + rr + 4))
        if x1 <= x0 or y1 <= y0:
            continue
        yy, xx = np.mgrid[y0:y1, x0:x1]
        d = np.hypot((xx - cx) / 1.15, yy - cy)
        a = np.clip((rr - d) / 2.5, 0, 1) * 0.42
        img[y0:y1, x0:x1] *= (1 - a)[..., None]
    # --- crowns
    for t in trees_px:
        if not t["alive"]:
            continue
        r = t["r"]
        cx, cy = t["px"], t["py"]
        x0, x1 = int(max(0, cx - r * 1.4 - 2)), int(min(w, cx + r * 1.4 + 3))
        y0, y1 = int(max(0, cy - r * 1.4 - 2)), int(min(h, cy + r * 1.4 + 3))
        if x1 <= x0 or y1 <= y0:
            continue
        yy, xx = np.mgrid[y0:y1, x0:x1]
        dx, dy = xx - cx, yy - cy
        d = np.hypot(dx, dy)
        th = np.arctan2(dy, dx)
        ph = t["phase"]
        R = r * (1 + 0.12 * np.sin(3 * th + ph[0]) + 0.07 * np.sin(5 * th + ph[1]) + 0.05 * np.sin(8 * th + ph[2]))
        R = R * (1 + 0.10 * fine[y0:y1, x0:x1])
        alpha = np.clip((R - d) / 1.6, 0, 1)
        if t["health"] == "weak":
            # sparse, patchy canopy
            holes = fine[y0:y1, x0:x1] < -0.15
            alpha = alpha * np.where(holes, 0.25, 1.0)
        base = np.array(t["color"], np.float32)
        dome = 1 + 0.18 * np.clip(1 - (d / np.maximum(R, 1)) ** 2, 0, 1)
        light = 1 + 0.22 * np.clip((dx * sx + dy * sy) / max(r, 1), -1, 1)
        tex = 1 + 0.16 * fine[y0:y1, x0:x1]
        col = base[None, None, :] * (dome * light * tex)[..., None]
        img[y0:y1, x0:x1] = img[y0:y1, x0:x1] * (1 - alpha[..., None]) + col * alpha[..., None]
    # --- CHM (lower resolution grid)
    if chm is not None:
        ch, cw = chm.shape
        f = gsd / chm_gsd
        for t in trees_px:
            if not t["alive"]:
                continue
            cx, cy, r = t["px"] * f, t["py"] * f, t["r"] * f
            x0, x1 = int(max(0, cx - r - 2)), int(min(cw, cx + r + 3))
            y0, y1 = int(max(0, cy - r - 2)), int(min(ch, cy + r + 3))
            if x1 <= x0 or y1 <= y0:
                continue
            yy, xx = np.mgrid[y0:y1, x0:x1]
            d = np.hypot(xx - cx, yy - cy) / max(r, 0.5)
            # photogrammetric CHMs of saplings are smoothed & slightly underestimated
            prof = t["h"] * 0.92 * np.clip(1 - d ** 2.2, 0, 1)
            chm[y0:y1, x0:x1] = np.maximum(chm[y0:y1, x0:x1], prof)


def write_rgb(path, img, transform, crs):
    arr = np.clip(img, 0, 255).astype(np.uint8).transpose(2, 0, 1)
    with rasterio.open(
        path, "w", driver="GTiff", height=arr.shape[1], width=arr.shape[2], count=3,
        dtype="uint8", crs=crs, transform=transform, compress="JPEG", jpeg_quality=88,
        photometric="RGB", tiled=True, blockxsize=256, blockysize=256,
    ) as dst:
        dst.write(arr)


def write_chm(path, chm, transform, crs):
    with rasterio.open(
        path, "w", driver="GTiff", height=chm.shape[0], width=chm.shape[1], count=1,
        dtype="float32", crs=crs, transform=transform, compress="DEFLATE", predictor=3,
        tiled=True, blockxsize=256, blockysize=256, nodata=-9999.0,
    ) as dst:
        dst.write(np.round(chm, 2).astype(np.float32), 1)


# ----------------------------------------------------------------------------
# 1. ARR dryland plantation — two survey dates
# ----------------------------------------------------------------------------

def make_arr():
    rng = np.random.default_rng(2026)
    gsd = 0.05
    W = H = 1800  # 90 m x 90 m
    chm_gsd = 0.10
    epsg = 32643  # WGS84 / UTM 43N
    lon0, lat0 = 73.3372, 27.7905  # near Deshnoke, Bikaner (illustrative)
    tf = Transformer.from_crs(4326, epsg, always_xy=True)
    e0, n0 = tf.transform(lon0, lat0)
    e0, n0 = round(e0, 2), round(n0, 2)
    transform = from_origin(e0, n0, gsd, gsd)
    chm_transform = from_origin(e0, n0, chm_gsd, chm_gsd)

    # --- planting design: 3 m x 3 m grid, rotated 4 deg
    spacing = 3.0
    ang = math.radians(4)
    nrow = ncol = 29
    origin = np.array([4.5, 4.5])
    positions = []
    for i in range(nrow):
        for j in range(ncol):
            lx, ly = j * spacing, i * spacing
            x = origin[0] + lx * math.cos(ang) - ly * math.sin(ang) + rng.normal(0, 0.18)
            y = origin[1] + lx * math.sin(ang) + ly * math.cos(ang) + rng.normal(0, 0.18)
            if 1.2 < x < W * gsd - 1.2 and 1.2 < y < H * gsd - 1.2:
                positions.append((i, j, x, y))

    # --- fates. Year 1 (2025 survey): 6% mortality. Year 2 adds 9% + a termite gap.
    gap_c = np.array([62.0, 28.0])
    species_cols = [(66, 108, 52), (78, 112, 58), (88, 118, 64), (70, 104, 60)]
    trees = []
    for k, (i, j, x, y) in enumerate(positions):
        dead_y1 = rng.random() < 0.06
        in_gap = np.hypot(x - gap_c[0], y - gap_c[1]) < 9.5
        dead_y2 = dead_y1 or (rng.random() < (0.85 if in_gap else 0.09))
        vigor = rng.lognormal(0, 0.22)
        cd1 = float(np.clip(1.2 * vigor, 0.55, 2.1))
        cd2 = float(np.clip(cd1 * rng.lognormal(math.log(1.42), 0.12), 0.75, 2.9))
        h1 = float(np.clip(0.9 + 0.7 * cd1 + rng.normal(0, 0.12), 0.8, 3.0))
        h2 = float(np.clip(h1 + 0.5 * (cd2 - cd1) + 0.4 + rng.normal(0, 0.1), 1.0, 4.0))
        u = rng.random()
        health2 = "healthy" if u < 0.84 else ("watch" if u < 0.94 else "weak")
        if health2 == "weak":
            cd2 *= 0.75
            h2 *= 0.85
        trees.append(dict(id=k + 1, row=i, col=j, x=x, y=y, dead1=dead_y1, dead2=dead_y2,
                          cd1=cd1, cd2=cd2, h1=h1, h2=h2, health2=health2,
                          sp=int(rng.integers(0, len(species_cols))),
                          phase=rng.uniform(0, 6.28, 3)))

    # --- native shrubs (not planted): off-grid confounders
    shrubs = []
    for _ in range(14):
        shrubs.append(dict(x=rng.uniform(3, 87), y=rng.uniform(3, 87), cd=rng.uniform(1.2, 2.6),
                           h=rng.uniform(0.6, 1.3), phase=rng.uniform(0, 6.28, 3)))

    def background(seed):
        r2 = np.random.default_rng(seed)
        n1 = value_noise((H, W), 220, r2, octaves=5)
        n2 = value_noise((H, W), 18, r2, octaves=3)
        base = np.array([206, 182, 143], np.float32)
        img = np.empty((H, W, 3), np.float32)
        shade = 1 + 0.07 * n1 + 0.05 * n2
        img[:] = base[None, None, :] * shade[..., None]
        # gravel / darker interdune patches
        patch = value_noise((H, W), 120, r2, octaves=3) > 0.45
        img[patch] *= np.array([0.9, 0.88, 0.86], np.float32)
        # sand speckle
        speck = r2.random((H, W)) < 0.03
        img[speck] *= 0.82
        # vehicle track
        yy, xx = np.mgrid[0:H, 0:W]
        track = np.abs((yy - (0.12 * xx + 1450))) < 22
        track2 = np.abs((yy - (0.12 * xx + 1500))) < 14
        img[track | track2] *= np.array([0.93, 0.92, 0.9], np.float32)
        # dry grass tufts (small, yellowish)
        for _ in range(900):
            cx, cy = r2.uniform(0, W), r2.uniform(0, H)
            rr = r2.uniform(2, 5)
            x0, x1 = int(max(0, cx - rr - 1)), int(min(W, cx + rr + 2))
            y0, y1 = int(max(0, cy - rr - 1)), int(min(H, cy + rr + 2))
            yy2, xx2 = np.mgrid[y0:y1, x0:x1]
            a = np.clip((rr - np.hypot(xx2 - cx, yy2 - cy)) / 1.2, 0, 1) * 0.8
            img[y0:y1, x0:x1] = img[y0:y1, x0:x1] * (1 - a[..., None]) + np.array([150, 150, 86], np.float32) * a[..., None]
        return img

    meta_trees = {}
    for year, (date, cdk, hk, deadk) in enumerate([("2025-10-14", "cd1", "h1", "dead1"),
                                                   ("2026-10-12", "cd2", "h2", "dead2")]):
        r3 = np.random.default_rng(100 + year)
        img = background(10 + year)
        chm = np.abs(r3.normal(0, 0.04, (int(H * gsd / chm_gsd), int(W * gsd / chm_gsd)))).astype(np.float32)
        # small georeferencing offset between flights (realistic ~10-15 cm)
        off = np.array([0.0, 0.0]) if year == 0 else np.array([0.12, -0.08])
        items = []
        for t in trees:
            alive = not t[deadk]
            health = t["health2"] if year == 1 else ("healthy" if rng.random() < 0.9 else "watch")
            col = species_cols[t["sp"]]
            if health == "watch":
                col = (92, 116, 60)
            elif health == "weak":
                col = (118, 120, 66)
            items.append(dict(px=(t["x"] + off[0]) / gsd, py=(t["y"] + off[1]) / gsd, r=t[cdk] / 2 / gsd,
                              h=t[hk], alive=alive, health=health if alive else "dead", color=col,
                              phase=t["phase"]))
        for s in shrubs:
            items.append(dict(px=(s["x"] + off[0]) / gsd, py=(s["y"] + off[1]) / gsd, r=s["cd"] / 2 / gsd,
                              h=s["h"], alive=True, health="healthy", color=(122, 128, 92), phase=s["phase"]))
        draw_crowns(img, chm, items, gsd, r3, palette=None, chm_gsd=chm_gsd)
        # slight vignetting / exposure variation like real orthomosaics
        img *= (1 + 0.035 * value_noise((H, W), 600, r3, octaves=2))[..., None]
        tag = "y1" if year == 0 else "y2"
        write_rgb(os.path.join(OUT, f"arr-thar-{tag}-rgb.tif"), img, transform, f"EPSG:{epsg}")
        write_chm(os.path.join(OUT, f"arr-thar-{tag}-chm.tif"), chm, chm_transform, f"EPSG:{epsg}")
        truth = []
        for t, it in zip(trees, items):
            truth.append(asdict(TreeTruth(
                id=t["id"], row=t["row"], col=t["col"],
                x_m=round(e0 + it["px"] * gsd, 3), y_m=round(n0 - it["py"] * gsd, 3),
                px=round(it["px"], 1), py=round(it["py"], 1), alive=it["alive"],
                crown_d_m=round(t[cdk], 3), height_m=round(t[hk], 3), health=it["health"])))
        meta_trees[tag] = dict(date=date, planted=len(trees), alive=int(sum(1 for x in truth if x["alive"])),
                               native_shrubs=len(shrubs), truth=truth)
        with open(os.path.join(OUT, f"arr-thar-{tag}-truth.json"), "w") as f:
            json.dump(dict(epsg=epsg, gsd=gsd, date=date, planting_spacing_m=[3.0, 3.0],
                           planted=len(trees), alive=meta_trees[tag]["alive"], native_shrubs=len(shrubs),
                           trees=truth), f)
        print(tag, "planted", len(trees), "alive", meta_trees[tag]["alive"])
    return dict(epsg=epsg, origin=[e0, n0], gsd=gsd, size=[W, H])


# ----------------------------------------------------------------------------
# 2. Mangrove plantation on a tidal mudflat
# ----------------------------------------------------------------------------

def make_mangrove():
    rng = np.random.default_rng(4242)
    gsd = 0.04
    W = H = 1750  # 70 m x 70 m
    chm_gsd = 0.08
    epsg = 32645  # UTM 45N
    lon0, lat0 = 88.7710, 21.8640  # Sundarbans fringe (illustrative)
    tf = Transformer.from_crs(4326, epsg, always_xy=True)
    e0, n0 = tf.transform(lon0, lat0)
    e0, n0 = round(e0, 2), round(n0, 2)
    transform = from_origin(e0, n0, gsd, gsd)
    chm_transform = from_origin(e0, n0, chm_gsd, chm_gsd)

    yy, xx = np.mgrid[0:H, 0:W]
    # winding tidal creek
    creek_c = 0.62 * W + 0.09 * W * np.sin(yy / H * 2.6 * math.pi) + 0.03 * W * np.sin(yy / H * 7.1)
    creek_w = 0.045 * W + 0.012 * W * np.sin(yy / H * 4.0)
    dist_creek = np.abs(xx - creek_c) - creek_w
    water = dist_creek < 0

    n1 = value_noise((H, W), 260, rng, octaves=5)
    n2 = value_noise((H, W), 14, rng, octaves=3)
    img = np.empty((H, W, 3), np.float32)
    mud = np.array([112, 103, 88], np.float32)
    img[:] = mud[None, None, :] * (1 + 0.08 * n1 + 0.05 * n2)[..., None]
    # wet sheen near creek
    wet = np.clip(1 - dist_creek / (0.08 * W), 0, 1)
    img *= (1 - 0.18 * wet)[..., None]
    # algal film patches on mud (low-intensity green confounder)
    algae = value_noise((H, W), 90, rng, octaves=3) > 0.5
    img[algae] = img[algae] * 0.7 + np.array([88, 100, 66], np.float32) * 0.3
    # water
    wcol = np.array([58, 74, 80], np.float32) * (1 + 0.05 * n2)[..., None]
    a = np.clip(-dist_creek / 6, 0, 1)
    img = img * (1 - a[..., None]) + wcol * a[..., None]
    # crab-hole speckle
    speck = rng.random((H, W)) < 0.02
    img[speck] *= 0.78

    # planting: 1.5 m x 1.5 m staggered, avoiding the creek (+1.5 m buffer)
    spacing = 1.5
    trees = []
    k = 0
    for i in range(int(70 / spacing)):
        for j in range(int(70 / spacing)):
            x = 1.0 + j * spacing + (0.75 if i % 2 else 0) + rng.normal(0, 0.12)
            y = 1.0 + i * spacing + rng.normal(0, 0.12)
            if not (0.8 < x < 69.2 and 0.8 < y < 69.2):
                continue
            px, py = x / gsd, y / gsd
            dc = dist_creek[int(min(H - 1, py)), int(min(W - 1, px))] * gsd
            if dc < 1.5:
                continue
            k += 1
            # erosion-driven mortality near the creek bank, plus background loss
            p_dead = 0.12 + (0.45 if dc < 4.5 else 0.0)
            alive = rng.random() > p_dead
            vigor = rng.lognormal(0, 0.2)
            cd = float(np.clip(1.0 * vigor, 0.45, 1.55))
            hgt = float(np.clip(0.6 + 0.95 * cd + rng.normal(0, 0.1), 0.7, 2.4))
            u = rng.random()
            health = "healthy" if u < 0.86 else ("watch" if u < 0.95 else "weak")
            col = (42, 84, 40) if rng.random() < 0.6 else (52, 92, 46)  # Avicennia vs Rhizophora tone
            if health == "watch":
                col = (60, 96, 44)
            elif health == "weak":
                col = (104, 108, 60)
            trees.append(dict(id=k, row=i, col=j, x=x, y=y, px=px, py=py, r=cd / 2 / gsd, h=hgt, cd=cd,
                              alive=alive, health=health if alive else "dead", color=col,
                              phase=rng.uniform(0, 6.28, 3)))
    chm = np.abs(rng.normal(0, 0.035, (int(H * gsd / chm_gsd), int(W * gsd / chm_gsd)))).astype(np.float32)
    draw_crowns(img, chm, trees, gsd, rng, sun=(0.55, -0.83), chm_gsd=chm_gsd)
    img *= (1 + 0.03 * value_noise((H, W), 500, rng, octaves=2))[..., None]
    write_rgb(os.path.join(OUT, "mangrove-sundarbans-rgb.tif"), img, transform, f"EPSG:{epsg}")
    write_chm(os.path.join(OUT, "mangrove-sundarbans-chm.tif"), chm, chm_transform, f"EPSG:{epsg}")
    truth = [dict(id=t["id"], row=t["row"], col=t["col"], x_m=round(e0 + t["x"], 3), y_m=round(n0 - t["y"], 3),
                  px=round(t["px"], 1), py=round(t["py"], 1), alive=t["alive"], crown_d_m=round(t["cd"], 3),
                  height_m=round(t["h"], 3), health=t["health"]) for t in trees]
    alive = sum(1 for t in trees if t["alive"])
    # planted area excludes the creek
    planted_area_ha = float((~water).sum() * gsd * gsd / 10000)
    with open(os.path.join(OUT, "mangrove-sundarbans-truth.json"), "w") as f:
        json.dump(dict(epsg=epsg, gsd=gsd, date="2026-09-28", planting_spacing_m=[1.5, 1.5], planted=len(trees),
                       alive=alive, planted_area_ha=round(planted_area_ha, 3), trees=truth), f)
    print("mangrove planted", len(trees), "alive", alive)


if __name__ == "__main__":
    make_arr()
    make_mangrove()
    for fn in sorted(os.listdir(OUT)):
        print(f"{fn:40s} {os.path.getsize(os.path.join(OUT, fn)) / 1e6:6.2f} MB")
