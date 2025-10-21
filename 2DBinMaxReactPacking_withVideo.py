# MaxRects + randomized initial packing + iterative optimize
#   inflate (uniform, AR-preserving) → slide → reflow (current sizes) → global uniform re-pack
# One master figure shows all iterations (bin panels) + a final Project overlay panel (outer=project, inner dashed=bin).
# No rotation anywhere.

from dataclasses import dataclass
from typing import List, Tuple, Optional, Dict, Sequence
import argparse, json, os, copy, random
from PIL import Image

# ---------- Core data types ----------
@dataclass
class Rect:
    x: int
    y: int
    w: int
    h: int
    rid: Optional[str]=None
    rot: bool=False

    @property
    def right(self) -> int: return self.x + self.w
    @property
    def bottom(self) -> int: return self.y + self.h
    @property
    def area(self) -> int: return self.w * self.h

def _rects_intersect(a: Rect, b: Rect) -> bool:
    return not (a.x >= b.x + b.w or a.right <= b.x or a.y >= b.y + b.h or a.bottom <= b.y)

def _contains(a: Rect, b: Rect) -> bool:
    return a.x <= b.x and a.y <= b.y and a.right >= b.right and a.bottom >= b.bottom

# ---------- MaxRects packer (no rotation) ----------
class MaxRectsBin:
    def __init__(self, bin_w:int, bin_h:int, allow_rotate:bool=False, rng: Optional[random.Random]=None) -> None:
        self.bin_w = int(bin_w)
        self.bin_h = int(bin_h)
        self.allow_rotate = False  # hard-disable rotation
        self.used: List[Rect] = []
        self.free: List[Rect] = [Rect(0,0,self.bin_w,self.bin_h)]
        self.rng = rng or random.Random()

    def _score_bssf(self, w:int, h:int, eps_prob:float=0.05, top_k:int=3):
        """
        Best Short Side Fit with randomness:
          - Random tie-breaks among equal (short,long) candidates.
          - With probability eps_prob, pick randomly among the top_k candidates.
        """
        best_ss = 1_000_000_000
        best_ls = 1_000_000_000
        candidates: List[Tuple[int,int,Rect]] = []  # (short,long,node)

        for fr in self.free:
            if fr.w >= w and fr.h >= h:
                leftover_h = fr.h - h
                leftover_w = fr.w - w
                short = leftover_h if leftover_h < leftover_w else leftover_w
                long  = leftover_h if leftover_h > leftover_w else leftover_w
                if short < best_ss or (short == best_ss and long < best_ls):
                    best_ss, best_ls = short, long
                    candidates = [(short, long, Rect(fr.x, fr.y, w, h, rot=False))]
                elif short == best_ss and long == best_ls:
                    candidates.append((short, long, Rect(fr.x, fr.y, w, h, rot=False)))

        if not candidates:
            return None, best_ss, best_ls

        candidates.sort(key=lambda t: (t[0], t[1]))
        k = min(top_k, len(candidates))
        # epsilon-greedy: sometimes try a near-best candidate
        if eps_prob > 0 and self.rng.random() < eps_prob:
            return candidates[self.rng.randrange(k)][2], best_ss, best_ls

        # random tie-break among the best score
        s0, l0 = candidates[0][0], candidates[0][1]
        tied = [c for c in candidates if c[0] == s0 and c[1] == l0]
        chosen = self.rng.choice(tied)[2]
        return chosen, best_ss, best_ls

    def _place(self, node: Rect) -> None:
        i = 0
        while i < len(self.free):
            fr = self.free[i]
            if self._split_free_node(fr, node):
                self.free.pop(i)
                i -= 1
            i += 1
        self._prune_free_list()
        self.used.append(node)

    def _split_free_node(self, free: Rect, used: Rect) -> bool:
        if not _rects_intersect(free, used):
            return False
        # left
        if used.x > free.x and used.x < free.x + free.w:
            self.free.append(Rect(free.x, free.y, used.x - free.x, free.h))
        # right
        if used.x + used.w < free.x + free.w:
            self.free.append(Rect(used.x + used.w, free.y,
                                  free.x + free.w - (used.x + used.w), free.h))
        # top
        if used.y > free.y and used.y < free.y + free.h:
            self.free.append(Rect(free.x, free.y, free.w, used.y - free.y))
        # bottom
        if used.y + used.h < free.y + free.h:
            self.free.append(Rect(free.x, used.y + used.h, free.w,
                                  free.y + free.h - (used.y + used.h)))
        return True

    def _prune_free_list(self) -> None:
        i = 0
        while i < len(self.free):
            j = i + 1
            remove_i = False
            while j < len(self.free):
                a = self.free[i]; b = self.free[j]
                if _contains(a, b):
                    self.free.pop(j); continue
                if _contains(b, a):
                    remove_i = True; break
                j += 1
            if remove_i:
                self.free.pop(i)
            else:
                i += 1

    def insert_many(self, items: Sequence[Tuple[str,int,int]]) -> List[Optional[Rect]]:
        # Randomize the initial order
        remaining = list(items)
        self.rng.shuffle(remaining)

        results: Dict[str, Optional[Rect]] = {rid: None for rid,_,_ in remaining}
        while remaining:
            best_idx = -1
            best_node: Optional[Rect] = None
            best_ss = 1_000_000_000
            best_ls = 1_000_000_000

            # Also randomize the per-round evaluation order
            order = list(range(len(remaining)))
            self.rng.shuffle(order)

            for idx in order:
                rid,w,h = remaining[idx]
                node, ss, ls = self._score_bssf(w, h, eps_prob=0.05, top_k=3)
                if node is not None and (ss < best_ss or (ss == best_ss and ls < best_ls)):
                    best_idx = idx
                    best_node = node
                    best_ss, best_ls = ss, ls
                    best_node.rid = rid

            if best_idx == -1:
                break

            self._place(best_node)
            results[best_node.rid] = best_node
            del remaining[best_idx]

        # Return in the original items' order
        return [results.get(rid) for rid,_,_ in items]

    def occupancy(self) -> float:
        used_area = sum(r.area for r in self.used)
        return used_area / (self.bin_w * self.bin_h) if self.bin_w and self.bin_h else 0.0

# ---------- Pack helpers ----------
def try_pack_at_scale(bin_w:int, bin_h:int, rects: Sequence[Tuple[str,int,int]],
                      scale: float, padding:int=0, seed: Optional[int]=None):
    scaled = []
    for rid, w, h in rects:
        sw = max(1, int(round(w * scale)))
        sh = max(1, int(round(h * scale)))
        pw = max(1, sw + 2*padding)
        ph = max(1, sh + 2*padding)
        scaled.append((rid, pw, ph, sw, sh, w, h))  # include originals

    rng = random.Random(seed) if seed is not None else random.Random()
    packer = MaxRectsBin(bin_w, bin_h, allow_rotate=False, rng=rng)
    placements_proxy = packer.insert_many([(rid, pw, ph) for (rid, pw, ph, sw, sh, w0, h0) in scaled])

    placements: List[Dict] = []
    placed_ids = set()
    for (rid, pw, ph, sw, sh, w0, h0), node in zip(scaled, placements_proxy):
        if node is None:
            continue
        x = node.x + padding
        y = node.y + padding
        s = sw / max(1, w0)  # actual scale used
        placements.append({"id": rid, "x": x, "y": y, "w": sw, "h": sh, "scale": s, "w0": w0, "h0": h0})
        placed_ids.add(rid)

    not_placed = [rid for (rid,_,_) in rects if rid not in placed_ids]
    return placements, not_placed, packer.occupancy()

def pack_scale_to_fit(bin_w:int, bin_h:int, rects: Sequence[Tuple[str,int,int]],
                      min_scale:float=0.6, max_scale=1.0, padding:int=0, tol:float=1e-3, max_iter:int=25,
                      seed: Optional[int]=None):
    lo, hi = min_scale, max_scale
    best_fit = None
    # First try 1.0 with randomness
    placements, leftovers, occ = try_pack_at_scale(bin_w, bin_h, rects, 1.0, padding, seed=seed)
    if not leftovers:
        return placements, leftovers, 1.0, occ

    # Binary-search scale; deterministic (or pass seed via try_pack_at_scale if desired)
    for _ in range(max_iter):
        mid = (lo + hi) / 2.0
        placements, leftovers, occ = try_pack_at_scale(bin_w, bin_h, rects, mid, padding)
        if not leftovers:
            best_fit = (placements, leftovers, mid, occ)
            lo = mid
        else:
            hi = mid
        if hi - lo <= tol:
            break

    if best_fit is not None:
        return best_fit
    placements, leftovers, occ = try_pack_at_scale(bin_w, bin_h, rects, min_scale, padding)
    return placements, leftovers, min_scale, occ

# ---------- Post-pack: inflate (uniform), slide, reflow, global uniform re-pack ----------
def _overlap_1d(a0, a1, b0, b1) -> bool:
    return not (a1 <= b0 or b1 <= a0)

def inflate_to_fill(bin_w:int, bin_h:int, placements:List[Dict],
                    padding:int=0, max_scale:float=1.0, passes:int=3):
    """Uniform inflation (AR-preserving). No rotation."""
    for _ in range(passes):
        grew_any = False
        placements.sort(key=lambda p: (p["y"], p["x"]))
        for u in placements:
            current_scale = float(u["scale"])
            target_scale  = float(max_scale)
            if current_scale >= target_scale:
                continue
            max_by_bin = min(
                (bin_w - u["x"] - padding) / max(1, u["w0"]),
                (bin_h - u["y"] - padding) / max(1, u["h0"])
            )
            max_by_neighbors = target_scale
            for v in placements:
                if v is u: continue
                if _overlap_1d(u["y"], u["y"] + u["h"], v["y"], v["y"] + v["h"]) and v["x"] >= u["x"]:
                    limit = (v["x"] - padding - u["x"]) / max(1, u["w0"])
                    max_by_neighbors = min(max_by_neighbors, limit)
                if _overlap_1d(u["x"], u["x"] + u["w"], v["x"], v["x"] + v["w"]) and v["y"] >= u["y"]:
                    limit = (v["y"] - padding - u["y"]) / max(1, u["h0"])
                    max_by_neighbors = min(max_by_neighbors, limit)
            new_scale = min(max_by_bin, max_by_neighbors, target_scale)
            if new_scale > current_scale:
                u["w"] = int(round(u["w0"] * new_scale))
                u["h"] = int(round(u["h0"] * new_scale))
                u["scale"] = new_scale
                grew_any = True
        if not grew_any:
            break
    return placements

def _max_left_gap(u, others, pad):
    limit = u["x"] - pad
    for v in others:
        if v is u: continue
        if _overlap_1d(u["y"], u["y"]+u["h"], v["y"], v["y"]+v["h"]):
            if v["x"] + v["w"] <= u["x"]:
                limit = min(limit, u["x"] - (v["x"] + v["w"]) - pad)
    return max(0, int(limit))

def _max_up_gap(u, others, pad):
    limit = u["y"] - pad
    for v in others:
        if v is u: continue
        if _overlap_1d(u["x"], u["x"]+u["w"], v["x"], v["x"]+v["w"]):
            if v["y"] + v["h"] <= u["y"]:
                limit = min(limit, u["y"] - (v["y"] + v["h"]) - pad)
    return max(0, int(limit))

def slide_compact(placements, padding=0):
    moved = False
    placements.sort(key=lambda p: (p["y"], p["x"]))
    for u in placements:
        left = _max_left_gap(u, placements, padding)
        up   = _max_up_gap(u, placements, padding)
        if left > 0: u["x"] -= left; moved = True
        if up   > 0: u["y"] -= up;   moved = True
    return moved

def reflow_with_maxrects(bin_w:int, bin_h:int, placements:List[Dict], padding:int=0):
    """Re-pack current sizes (w,h) to new x/y using MaxRects. No rotation."""
    items = []
    for p in placements:
        pw = max(1, p["w"] + 2*padding)
        ph = max(1, p["h"] + 2*padding)
        items.append((p["id"], pw, ph))
    packer = MaxRectsBin(bin_w, bin_h, allow_rotate=False)
    nodes = packer.insert_many(items)
    if any(n is None for n in nodes):
        return False
    id_to_node = {rid: node for (rid,_,_), node in zip(items, nodes)}
    for p in placements:
        node = id_to_node[p["id"]]
        p["x"] = node.x + padding
        p["y"] = node.y + padding
    return True

# ---- Global uniform re-pack (fresh MaxRects, single common scale) ----
def _pack_at_uniform_scale(bin_w:int, bin_h:int, placements:List[Dict], s:float, padding:int=0):
    """Attempt a from-scratch MaxRects placement of all rects at uniform scale s."""
    items = []
    for p in placements:
        w = max(1, int(round(p["w0"] * s)))
        h = max(1, int(round(p["h0"] * s)))
        pw = max(1, w + 2*padding)
        ph = max(1, h + 2*padding)
        items.append((p["id"], pw, ph, w, h))

    packer = MaxRectsBin(bin_w, bin_h, allow_rotate=False)
    nodes = packer.insert_many([(rid, pw, ph) for (rid, pw, ph, _, _) in items])
    if any(n is None for n in nodes):
        return False

    id_to_node = {rid: node for (rid, _, _, _, _), node in zip(items, nodes)}
    for p in placements:
        node = id_to_node[p["id"]]
        p["x"] = node.x + padding
        p["y"] = node.y + padding
        base = next(t for t in items if t[0] == p["id"])
        p["w"] = base[3]; p["h"] = base[4]; p["scale"] = s
    return True

def global_uniform_repack(bin_w:int, bin_h:int, placements:List[Dict],
                          padding:int=0, s_lo:float=1.0, s_hi:float=4.0, tol:float=1e-3, max_iter:int=25):
    """
    Binary-search the largest uniform scale s in [s_lo, s_hi] that fits when re-packed.
    Mutates placements to the best layout if found.
    """
    best_ss = copy.deepcopy(placements)
    best_s  = None
    lo, hi = s_lo, s_hi
    for _ in range(max_iter):
        mid = 0.5 * (lo + hi)
        trial = copy.deepcopy(placements)
        if _pack_at_uniform_scale(bin_w, bin_h, trial, mid, padding):
            best_ss, best_s = trial, mid
            lo = mid
        else:
            hi = mid
        if hi - lo <= tol:
            break
    if best_s is not None:
        placements[:] = best_ss
        return True, best_s
    return False, None

# ---------- Coverage ----------
def total_area(placements: Sequence[Dict]) -> int:
    return sum(p["w"] * p["h"] for p in placements)

def coverage_ratio(bin_w:int, bin_h:int, placements: Sequence[Dict]) -> float:
    bin_area = max(1, bin_w * bin_h)
    return total_area(placements) / bin_area

# ---------- Image IO ----------
_IMAGE_CACHE: Dict[str, Image.Image] = {}
def _load_image_cached(path: str) -> Optional[Image.Image]:
    if path in _IMAGE_CACHE:
        return _IMAGE_CACHE[path]
    if not os.path.exists(path):
        return None
    try:
        img = Image.open(path).convert("RGBA")
        _IMAGE_CACHE[path] = img
        return img
    except Exception:
        return None

def get_image_dimensions(directory_path):
    image_info = []
    for filename in os.listdir(directory_path):
        file_path = os.path.join(directory_path, filename)
        if os.path.isfile(file_path):
            try:
                with Image.open(file_path) as img:
                    width, height = img.size
                    image_info.append({'name': filename, 'width': width, 'height': height})
            except IOError:
                pass
    return image_info

# ---------- Media IO (images + videos) ----------
import subprocess, shlex

SUPPORTED_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff"}
SUPPORTED_VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm"}

def _lower_ext(name: str) -> str:
    _, ext = os.path.splitext(name)
    return ext.lower()

def _probe_video_dims_ffprobe(path: str):
    """
    Fallback probe using ffprobe if OpenCV not available.
    Returns (w, h, fps, duration) where fps/duration may be None if not found.
    """
    try:
        cmd = ('ffprobe -v error -select_streams v:0 -show_entries stream='
               'width,height,avg_frame_rate,duration -of default=noprint_wrappers=1 "{}"').format(path)
        out = subprocess.check_output(shlex.split(cmd), stderr=subprocess.STDOUT).decode("utf-8", errors="ignore")
        w = h = fps = duration = None
        for line in out.splitlines():
            if line.startswith("width="):
                w = int(line.split("=")[1])
            elif line.startswith("height="):
                h = int(line.split("=")[1])
            elif line.startswith("avg_frame_rate="):
                fr = line.split("=")[1].strip()
                if fr and fr != "0/0":
                    try:
                        num, den = fr.split("/")
                        num = float(num); den = float(den) if float(den) != 0 else 1.0
                        fps = num / den
                    except Exception:
                        fps = None
            elif line.startswith("duration="):
                try:
                    duration = float(line.split("=")[1])
                except Exception:
                    duration = None
        if isinstance(w, int) and isinstance(h, int) and w > 0 and h > 0:
            return w, h, fps, duration
    except Exception:
        pass
    return None, None, None, None

def _probe_video_dims_cv2(path: str):
    try:
        import cv2
        cap = cv2.VideoCapture(path)
        if not cap.isOpened():
            return None, None, None, None
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = cap.get(cv2.CAP_PROP_FPS) or None
        frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
        duration = (frames / fps) if (fps and fps > 0) else None
        cap.release()
        if w and h:
            return w, h, fps, duration
    except Exception:
        pass
    return None, None, None, None

def _probe_video_dims(path: str):
    # Try OpenCV first (fast if available), then ffprobe
    w, h, fps, dur = _probe_video_dims_cv2(path)
    if not (w and h):
        w, h, fps, dur = _probe_video_dims_ffprobe(path)
    return w, h, fps, dur

def get_media_inventory(directory_path: str):
    """
    Scans a folder for images/videos.
    Returns:
      rects: List[(id, w, h)] for the packer
      meta_by_id: Dict[id] = {"kind":"image"|"video", "src": filename, ...}
    """
    rects = []
    meta_by_id = {}
    for filename in os.listdir(directory_path):
        file_path = os.path.join(directory_path, filename)
        if not os.path.isfile(file_path):
            continue
        ext = _lower_ext(filename)

        if ext in SUPPORTED_IMAGE_EXTS:
            try:
                with Image.open(file_path) as img:
                    w, h = img.size
                rid = filename
                rects.append((rid, w, h))
                meta_by_id[rid] = {"kind": "image", "src": filename}
            except Exception:
                continue

        elif ext in SUPPORTED_VIDEO_EXTS:
            w, h, fps, duration = _probe_video_dims(file_path)
            if w and h:
                rid = filename
                rects.append((rid, w, h))
                meta_by_id[rid] = {
                    "kind": "video",
                    "src": filename,
                    "fps": fps,
                    "duration": duration
                }
    return rects, meta_by_id

# ---------- Parsers ----------
def _coverage_ratio(bin_w:int, bin_h:int, placements):
    bin_area = max(1, bin_w * bin_h)
    return sum(p["w"] * p["h"] for p in placements) / bin_area

def _parse_bin(s: str) -> tuple:
    # "1480x1080" -> (1480, 1080)
    if "x" not in s:
        raise argparse.ArgumentTypeError("Bin must be like 1480x1080")
    w, h = s.lower().split("x")
    return int(w), int(h)

def _parse_wh(s: str) -> tuple[int, int]:
    # "1920x1080" -> (1920, 1080)
    s = s.lower().strip()
    if "x" not in s:
        raise ValueError("Expected WxH like 1920x1080")
    w, h = s.split("x")
    return int(w), int(h)

def _build_rects_from_dir(images_dir: str):
    file_data = get_image_dimensions(images_dir)
    return [(im['name'], im['width'], im['height']) for im in file_data]

# ---------- Remap bin → project ----------
def remap_layout_to_project(
    placements,
    bin_w: int, bin_h: int,
    proj_w: int, proj_h: int,
    scale_mode: str = "none",      # "none" | "fit-width" | "fit-height" | "fit-best"
    align: str = "center",         # "topleft" | "top" | "topright" | "left" | "center" | "right" | "bottomleft" | "bottom" | "bottomright"
    offset_xy: Optional[Tuple[int,int]] = None  # overrides align if provided
):
    """
    Return (mapped_placements, meta) where mapped placements are in PROJECT coords.
    Scales uniformly per 'scale_mode' and offsets by 'align' or explicit offset.
    """
    out = copy.deepcopy(placements)

    # scale factor
    if scale_mode == "fit-width":
        s = proj_w / float(bin_w)
    elif scale_mode == "fit-height":
        s = proj_h / float(bin_h)
    elif scale_mode == "fit-best":
        s = min(proj_w / float(bin_w), proj_h / float(bin_h))
    else:
        s = 1.0

    lay_w = int(round(bin_w * s))
    lay_h = int(round(bin_h * s))

    # offset
    if offset_xy is not None:
        ox, oy = offset_xy
    else:
        # horizontal
        if "left" in align:   ax = 0
        elif "right" in align: ax = proj_w - lay_w
        else:                  ax = (proj_w - lay_w) // 2
        # vertical
        if "top" in align:     ay = 0
        elif "bottom" in align:ay = proj_h - lay_h
        else:                  ay = (proj_h - lay_h) // 2
        ox, oy = int(ax), int(ay)

    # transform
    for p in out:
        p["x"] = int(round(p["x"] * s)) + ox
        p["y"] = int(round(p["y"] * s)) + oy
        p["w"] = int(round(p["w"] * s))
        p["h"] = int(round(p["h"] * s))
        p["scale"] = float(p.get("scale", 1.0) * s)

    meta = {
        "bin": {"w": bin_w, "h": bin_h},
        "project": {"w": proj_w, "h": proj_h},
        "scale_mode": scale_mode,
        "align": align,
        "offset": {"x": ox, "y": oy},
        "uniform_scale": s,
    }
    return out, meta

# ---------- Snapshot builders ----------
def make_bin_snapshot(title: str, bin_w: int, bin_h: int, placements: List[Dict]) -> Dict:
    return {
        "mode": "bin",
        "frame_w": bin_w,
        "frame_h": bin_h,
        "title": title,
        "coverage": coverage_ratio(bin_w, bin_h, placements),
        "placements": copy.deepcopy(placements)
    }

def make_project_overlay_snapshot(
    title: str,
    bin_w: int, bin_h: int,
    proj_w: int, proj_h: int,
    placements: List[Dict],
    scale_mode: str = "none",
    align: str = "center"
) -> Dict:
    mapped, meta = remap_layout_to_project(
        placements, bin_w, bin_h, proj_w, proj_h,
        scale_mode=scale_mode, align=align
    )
    ox, oy = meta["offset"]["x"], meta["offset"]["y"]
    lay_w = int(round(meta["uniform_scale"] * bin_w))
    lay_h = int(round(meta["uniform_scale"] * bin_h))
    return {
        "mode": "project",
        "frame_w": proj_w,
        "frame_h": proj_h,
        "title": title,
        "coverage": coverage_ratio(proj_w, proj_h, mapped),
        "placements": mapped,
        "bin_rect": {"x": int(ox), "y": int(oy), "w": lay_w, "h": lay_h}
    }

# ---------- Renderer (mixed-size panels: bin and project) ----------
def render_snapshots_master(
    snapshots: List[Dict],
    images_dir: Optional[str],
    save_path: Optional[str] = None,
    draw_boxes: bool = True
):
    """
    Renders a row of panels. Each snapshot is a dict like:
      {
        "mode": "bin"|"project",
        "frame_w": int, "frame_h": int,
        "title": str,
        "coverage": float,            # [0,1]
        "placements": [...],
        # project-only:
        "bin_rect": {"x","y","w","h"}
      }
    """
    try:
        import os, tempfile
        os.environ.setdefault("MPLBACKEND", "Agg")                      
        os.environ.setdefault("MPLCONFIGDIR", os.path.join(tempfile.gettempdir(), "mpl_cache"))
        import matplotlib
        matplotlib.use("Agg", force=True)
        # if (os.name != "nt") and ("DISPLAY" not in os.environ):
        #     matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import matplotlib.patches as patches
        import numpy as np
    except Exception as e:
        print(f"[render_snapshots_master] Matplotlib unavailable: {e}")
        return

    if not snapshots:
        print("[render_snapshots_master] No snapshots to render.")
        return

    n = len(snapshots)
    fig_w = max(4, 6 * n)
    fig, axes = plt.subplots(1, n, figsize=(fig_w, 6), squeeze=False)
    axes = axes[0]

    for ax, snap in zip(axes, snapshots):
        mode    = snap.get("mode", "bin")
        fw      = int(snap.get("frame_w", 1))
        fh      = int(snap.get("frame_h", 1))
        title   = snap.get("title", "")
        cov     = float(snap.get("coverage", 0.0)) * 100.0
        places  = snap.get("placements", [])

        ax.set_xlim(0, fw); ax.set_ylim(fh, 0)
        ax.set_aspect('equal', adjustable='box')
        # outer frame (bin or project)
        ax.add_patch(patches.Rectangle((0,0), fw, fh, fill=False, linewidth=2))

        # inner bin rectangle for project mode
        if mode == "project" and "bin_rect" in snap:
            br = snap["bin_rect"]
            ax.add_patch(patches.Rectangle(
                (br["x"], br["y"]), br["w"], br["h"],
                fill=False, linewidth=1.5, linestyle="--"
            ))

        # draw images & boxes
        for p in places:
            x, y, w, h = p["x"], p["y"], p["w"], p["h"]
            if images_dir:
                img_path = os.path.join(images_dir, p["id"])
                img = _load_image_cached(img_path)
                if img is not None:
                    arr = np.asarray(img.resize((max(1,w), max(1,h)), Image.LANCZOS))
                    ax.imshow(arr, extent=(x, x+w, y+h, y), interpolation="nearest")
            if draw_boxes:
                ax.add_patch(patches.Rectangle((x, y), w, h, fill=False, linewidth=1.2))
            ax.text(x+4, y+14, f'{p["id"]}  s={p["scale"]:.2f}', fontsize=8,
                    color="black", bbox=dict(facecolor="white", alpha=0.5, pad=1.2))

        ax.set_title(f"{title}\nCoverage: {cov:.1f}%")

    fig.tight_layout()
    if save_path:
        save_dir = os.path.dirname(save_path)
        if save_dir:
            os.makedirs(save_dir, exist_ok=True)
        fig.savefig(save_path, dpi=150, bbox_inches='tight')
        print(f"Saved master figure: {save_path}")
    # import matplotlib.pyplot as plt
    # plt.show()
    plt.close(fig)
    plt.close('all')

# ---------- CLI / Main ----------
def main():
    ap = argparse.ArgumentParser(description="MaxRects layout → JSON for Premiere (with matplotlib snapshots)")
    ap.add_argument("--images-dir", type=str, required=True,
                    help="Folder containing images (ids are filenames)")
    ap.add_argument("--bin", type=_parse_bin, required=True,
                    help="Bin size, e.g. 1480x1080")
    ap.add_argument("--padding", type=int, default=6,
                    help="Padding (pixels) between items and bin edges")
    ap.add_argument("--iters", type=int, default=3,
                    help="Number of outer iterations (inflate→slide→reflow→global repack)")
    ap.add_argument("--max-scale", type=float, default=4.0,
                    help="Max uniform scale per item (inflate/global)")
    ap.add_argument("--seed", type=int, default=None,
                    help="Seed for randomized initial pack (omit for fresh randomness each run)")
    ap.add_argument("--out-json", type=str, required=True,
                    help="Output JSON path for Premiere (bin space)")
    ap.add_argument("--frames-json", type=str, default=None,
                    help="Optional: also write per-iteration frames (debug/visualization)")
    ap.add_argument("--display-output", action="store_true",
                    help="If set, render a matplotlib figure with all iterations + project overlay (if given)")
    ap.add_argument("--project", type=_parse_wh, default=None,
                    help="Project/sequence size WxH (e.g., 1920x1080). If given, also write a project-mapped JSON and add an overlay panel.")
    ap.add_argument("--project-scale-mode", type=str, default="none",
                    choices=["none","fit-width","fit-height","fit-best"],
                    help="How to scale the bin layout into the project frame.")
    ap.add_argument("--project-align", type=str, default="center",
                    choices=["topleft","top","topright","left","center","right","bottomleft","bottom","bottomright"],
                    help="Where to place the (scaled) bin layout within the project frame.")
    ap.add_argument("--project-out-json", type=str, default=None,
                    help="Optional path for the project-mapped layout JSON (if --project is provided).")
    ap.add_argument("--segment-number", type=int, default=1,
                    help="Optional segment number.")
    args = ap.parse_args()

    BIN_W, BIN_H = args.bin
    PADDING = int(args.padding)
    OUTER_ITERS = int(args.iters)
    MAX_SCALE = float(args.max_scale)
    SEED = args.seed
    DISPLAY_OUTPUT = args.display_output
    SEGMENT_NUMBER = int(args.segment_number)

    # 1) Load images → rects
    # 1) Load media → rects (images + videos)
    rects, meta_by_id = get_media_inventory(args.images_dir)
    if not rects:
        raise SystemExit(f"No supported media found under: {args.images_dir}")


    # 2) Initial randomized pack at scale 1.0
    placements, leftovers, used_scale, occ = pack_scale_to_fit(
        BIN_W, BIN_H, rects,
        min_scale=0.15, max_scale=1.0, padding=PADDING, seed=SEED
    )

    # --- snapshots (bin panels) ---
    frames: List[Dict] = []
    def snap_bin(label: str):
        frames.append(make_bin_snapshot(label, BIN_W, BIN_H, placements))

    snap_bin("iter0_random_pack")

    # 3) Iterate: inflate → slide → reflow → global uniform repack
    for i in range(1, OUTER_ITERS + 1):
        inflate_to_fill(BIN_W, BIN_H, placements, padding=PADDING,
                        max_scale=MAX_SCALE, passes=3)
        slide_compact(placements, padding=PADDING)
        reflow_with_maxrects(BIN_W, BIN_H, placements, padding=PADDING)
        # global uniform re-pack: largest common scale in [current min scale, MAX_SCALE]
        s_lo = min(p["scale"] for p in placements) if placements else 1.0
        global_uniform_repack(BIN_W, BIN_H, placements,
                              padding=PADDING, s_lo=s_lo, s_hi=MAX_SCALE)
        snap_bin(f"iter{i}")

    # 4) Write compact JSON for Premiere (final placements only, in BIN space)
    out = {
        "bin": {"w": BIN_W, "h": BIN_H},
        "padding": PADDING,
        "seed": SEED,
        "iters": OUTER_ITERS,
        "coverage": _coverage_ratio(BIN_W, BIN_H, placements),
        "placements": [
            {
                "id": p["id"],
                "x": int(p["x"]),
                "y": int(p["y"]),
                "w": int(p["w"]),
                "h": int(p["h"]),
                "scale": float(p["scale"]),
                "w0": int(p["w0"]),
                "h0": int(p["h0"]),
                # ---- NEW: media metadata so your downstream importer knows it's a video
                "kind": meta_by_id.get(p["id"], {}).get("kind", "image"),
                "media": {
                    "type": meta_by_id.get(p["id"], {}).get("kind", "image"),
                    "src": meta_by_id.get(p["id"], {}).get("src", p["id"]),
                    # Optional hints for NLEs/scripts:
                    "fps": meta_by_id.get(p["id"], {}).get("fps", None),
                    "duration": meta_by_id.get(p["id"], {}).get("duration", None)
                }
            }
            for p in placements
        ]

    }

    os.makedirs(os.path.dirname(args.out_json) or ".", exist_ok=True)
    with open(args.out_json, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    # OPTIONAL: also write a project-mapped JSON and add overlay panel
    if args.project is not None:
        PROJ_W, PROJ_H = args.project
        mapped, meta = remap_layout_to_project(
            placements=out["placements"],
            bin_w=BIN_W, bin_h=BIN_H,
            proj_w=PROJ_W, proj_h=PROJ_H,
            scale_mode=args.project_scale_mode,
            align=args.project_align
        )
        proj_out = {
            "project": {"w": PROJ_W, "h": PROJ_H},
            "from": meta,
            "placements": mapped
        }
        path = args.project_out_json or os.path.join(os.path.dirname(args.out_json) or ".", "layout_project.json")
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(proj_out, f, ensure_ascii=False, indent=2)
        print(f"Wrote project layout JSON: {path}")

        # Append a project overlay panel to the figure
        frames.append(
            make_project_overlay_snapshot(
                title="Project overlay (bin inside project)",
                bin_w=BIN_W, bin_h=BIN_H,
                proj_w=PROJ_W, proj_h=PROJ_H,
                placements=placements,                # final bin-space placements
                scale_mode=args.project_scale_mode,
                align=args.project_align
            )
        )

    # Optional: dump per-iteration frames as well (bin-space snapshots only)
    if args.frames_json:
        os.makedirs(os.path.dirname(args.frames_json) or ".", exist_ok=True)
        with open(args.frames_json, "w", encoding="utf-8") as f:
            json.dump({
                "bin": {"w": BIN_W, "h": BIN_H},
                "frames": frames
            }, f, ensure_ascii=False, indent=2)

    # Console summary
    print(f"Wrote layout JSON: {args.out_json}  | bin coverage={out['coverage']:.3f}")

    # Render master figure (bin iterations + optional project overlay)
    if DISPLAY_OUTPUT:
        default_png = os.path.join(os.path.dirname(args.out_json) or ".", f"all_iterations_{SEGMENT_NUMBER}.png")
        render_snapshots_master(
            snapshots=frames,
            images_dir=args.images_dir,
            save_path=default_png,
            draw_boxes=True
        )

# Run as script
if __name__ == "__main__":
    main()
