import os, math, random, json
from datetime import datetime
from PIL import Image
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle, Circle
from matplotlib.lines import Line2D

# ---------------- Configuration ----------------
BIN_W, BIN_H = 1920, 1080
CENTRAL_W, CENTRAL_H = 320, 180
PADDING = 10
MAX_RECT_DIM = 280
RADIUS_STEP = 8
ANGLE_JITTER_DEG = 8
MAX_RETRIES_PER_ITEM = 40

# Images
IMG_DIR = r"C:/Users/12038/CryptidCluesScripting/test_images/seg03/"
CENTER_IMG = r"D:/Youtube/CryptidClues/Channel Art/CenterCard.png"

EXTS = {".jpg", ".jpeg", ".png", ".gif", ".tif", ".tiff", ".bmp", ".webp"}

# Underlying box size and overlap relative to image box
UNDERLY_SCALE_INIT = 0.80
UNDERLY_SCALE_MIN  = 0.60
UNDERLY_SCALE_STEP = 0.06
OVERLAP_FRAC       = 0.08     # 8% of underlay intrudes into image

# Visuals (matplotlib)
IMAGE_EDGE_W   = 1.6
UNDERLY_EDGE_W = 1.0
TEXTBOX_EDGE_W = 1.25

IMAGE_EDGE      = (0, 0, 0, 0.90)
UNDERLY_EDGE    = (0, 0, 0, 0.30)
UNDERLY_FACE    = (0, 0, 0, 0.12)

# Text box style (drawn inside "good zone" of underlay)
TEXTBOX_PAD_FRAC_X = 0.08
TEXTBOX_PAD_FRAC_Y = 0.08
TEXTBOX_EDGE    = (0, 0, 0, 0.55)
TEXTBOX_FACE    = (0, 0, 0, 0.00)   # hollow
TEXTBOX_DASH    = (0, (3, 3))       # dashed outline

# Outer dotted frame style (project aspect)
FRAME_EDGE      = (0, 0, 0, 0.75)
FRAME_EDGE_W    = 1.5
FRAME_DASH      = (0, (6, 6))
FRAME_MARGIN    = 8
# Extra "zoom-out" for the outer dotted frame
FRAME_EXTRA_PAD = 10     # extra pixels beyond FRAME_MARGIN
FRAME_SCALE_UP  = 1.06   # >1.0 grows the frame a tiny bit after aspect-fit

# Pins & links
TACK_RADIUS_FRAC = 0.020
TACK_FILL        = (1.00, 0.05, 0.05, 0.95)  # red
TACK_EDGE        = (0.30, 0.00, 0.00, 1.00)
TACK_EDGE_W      = 1.0

LINK_COLOR   = (1.0, 0.05, 0.05, 0.90)
LINK_WIDTH   = 1.2
LINKS_MIN    = 1
LINKS_MAX    = 3

# Title box (NEW) — small horizontal label box under the pin, over the image
TITLE_W_FRAC_MIN = 0.40   # relative to image width
TITLE_W_FRAC_MAX = 0.65
TITLE_H_FRAC_MIN = 0.10   # relative to image height
TITLE_H_FRAC_MAX = 0.16
TITLE_H_MIN_PX   = 22     # ensure never too small vertically
TITLE_H_MAX_PX   = 56
TITLE_OVERLAP_MIN = 0.30  # 30% of title box overlaps image (min)
TITLE_OVERLAP_MAX = 0.55  # 55% (max)
TITLE_EDGE_W     = 1.2
TITLE_EDGE       = (0, 0, 0, 0.85)
TITLE_FACE       = (1.00, 1.00, 0.86, 0.95)  # pale yellow

# ---- JSON output path ----
OUT_JSON = r"C:/Users/12038/CryptidCluesScripting/ConspBoardScripting/layout_export.json"

# ---- Premiere layering intent (z-order spec) ----
ZSPEC = {
    "underlay": 200,
    "text":     300,
    "image":    400,
    "frame":    410,
    "border":   420,
    "links":    550,
    "title":    580,   # NEW: title box sits above image & frame, below pin
    "pin":      600
}
# ------------------------------------------------

def list_image_files(dirpath):
    return [
        os.path.join(dirpath, n)
        for n in os.listdir(dirpath)
        if os.path.isfile(os.path.join(dirpath, n))
        and os.path.splitext(n)[1].lower() in EXTS
    ]

def get_image_size(path):
    with Image.open(path) as im:
        return im.width, im.height

def scale_to_max(w, h, max_dim):
    m = max(w, h)
    if m <= max_dim:
        return w, h
    s = max_dim / float(m)
    return int(round(w * s)), int(round(h * s))

def rects_overlap(a, b, pad=0):
    ax1, ay1, aw, ah = a
    bx1, by1, bw, bh = b
    ax2, ay2 = ax1 + aw, ay1 + ah
    bx2, by2 = bx1 + bw, by1 + bh
    ax1 -= pad; ay1 -= pad; ax2 += pad; ay2 += pad
    bx1 -= pad; by1 -= pad; bx2 += pad; by2 += pad
    return not (ax2 <= bx1 or bx2 <= ax1 or ay2 <= by1 or by2 <= ay1)

def rect_overlap_area(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ax2, ay2 = ax + aw, ay + ah
    bx2, by2 = bx + bw, by + bh
    ox1 = max(ax, bx); oy1 = max(ay, by)
    ox2 = min(ax2, bx2); oy2 = min(ay2, by2)
    if ox2 <= ox1 or oy2 <= oy1:
        return 0.0
    return float((ox2 - ox1) * (oy2 - oy1))

def in_bounds(r, W, H):
    x, y, w, h = r
    return x >= 0 and y >= 0 and (x + w) <= W and (y + h) <= H

def needed_start_radius(center_rect, pad):
    cx = center_rect[0] + center_rect[2] / 2.0
    cy = center_rect[1] + center_rect[3] / 2.0
    corners = [
        (center_rect[0], center_rect[1]),
        (center_rect[0] + center_rect[2], center_rect[1]),
        (center_rect[0], center_rect[1] + center_rect[3]),
        (center_rect[0] + center_rect[2], center_rect[1] + center_rect[3]),
    ]
    dist = max(math.hypot(x - cx, y - cy) for x, y in corners)
    return dist + pad

def polar_to_rect(cx, cy, r, theta, w, h):
    x = int(round(cx + r * math.cos(theta) - w / 2.0))
    y = int(round(cy + r * math.sin(theta) - h / 2.0))
    return (x, y, w, h)

def try_place_on_ring(w, h, theta, placed_rects, center_rect, W, H, pad, r0):
    r = max(r0, 0.5 * math.hypot(w, h) + r0)
    while r <= max(W, H) * 1.5:
        cand = polar_to_rect(W/2.0, H/2.0, r, theta, w, h)
        if in_bounds(cand, W, H) and not rects_overlap(cand, center_rect, pad):
            ok = True
            for rct in placed_rects:
                if rects_overlap(cand, rct, pad):
                    ok = False
                    break
            if ok:
                return cand
        r += RADIUS_STEP
    return None

def clamp(v, lo, hi):
    return max(lo, min(v, hi))

# ---------- Robust Underlying Box Placement ----------
def place_underlying_box(bin_w, bin_h, img_x, img_y, img_w, img_h,
                         center_rect,
                         scale_init=UNDERLY_SCALE_INIT,
                         scale_min=UNDERLY_SCALE_MIN,
                         scale_step=UNDERLY_SCALE_STEP,
                         overlap_frac=OVERLAP_FRAC,
                         max_tries=120,
                         MAX_OVERLAP_RATIO=0.35,
                         MIN_OUTSIDE_FRAC=0.60):
    sides_vert = ['left', 'right']
    sides_horz = ['top', 'bottom']

    def accept(bg_rect, img_rect):
        if not in_bounds(bg_rect, bin_w, bin_h): return False
        if rects_overlap(bg_rect, center_rect, pad=0): return False
        under_area = float(bg_rect[2] * bg_rect[3])
        if under_area <= 0: return False
        ov = rect_overlap_area(bg_rect, img_rect)
        outside_frac = 1.0 - (ov / under_area)
        if (ov / under_area) > MAX_OVERLAP_RATIO or outside_frac < MIN_OUTSIDE_FRAC:
            return False
        return True

    scale = scale_init
    tries = 0
    img_rect = (img_x, img_y, img_w, img_h)

    while scale >= scale_min and tries < max_tries:
        tries += 1
        bg_w = int(round(scale * img_w))
        bg_h = int(round(scale * img_h))

        for orient in (['vertical','horizontal'] if random.random() < 0.5 else ['horizontal','vertical']):
            if orient == 'vertical':
                overlap_px = max(1, int(round(overlap_frac * bg_w)))
                for side in random.sample(sides_vert, k=len(sides_vert)):
                    if side == 'left':
                        bg_x = img_x - (bg_w - overlap_px)
                    else:
                        bg_x = img_x + img_w - overlap_px

                    slide_min = clamp(int(img_y - 0.40 * img_h), 0, bin_h - bg_h)
                    slide_max = clamp(int(img_y + img_h - bg_h + 0.40 * img_h), 0, bin_h - bg_h)
                    if slide_max < slide_min: slide_min, slide_max = 0, bin_h - bg_h

                    for _ in range(16):
                        bg_y = random.randint(slide_min, slide_max)
                        bg_xc = clamp(bg_x, 0, bin_w - bg_w)
                        bg_rect = (bg_xc, bg_y, bg_w, bg_h)

                        if not accept(bg_rect, img_rect):
                            continue

                        if side == 'left':
                            good_x, good_y, good_w, good_h = bg_xc, bg_y, bg_w - overlap_px, bg_h
                        else:
                            good_x, good_y, good_w, good_h = bg_xc + overlap_px, bg_y, bg_w - overlap_px, bg_h
                        return (bg_xc, bg_y, bg_w, bg_h, good_x, good_y, good_w, good_h)

            else:
                overlap_px = max(1, int(round(overlap_frac * bg_h)))
                for side in random.sample(sides_horz, k=len(sides_horz)):
                    if side == 'top':
                        bg_y = img_y - (bg_h - overlap_px)
                    else:
                        bg_y = img_y + img_h - overlap_px

                    slide_min = clamp(int(img_x - 0.40 * img_w), 0, bin_w - bg_w)
                    slide_max = clamp(int(img_x + img_w - bg_w + 0.40 * img_w), 0, bin_w - bg_w)
                    if slide_max < slide_min: slide_min, slide_max = 0, bin_w - bg_w

                    for _ in range(16):
                        bg_x = random.randint(slide_min, slide_max)
                        bg_yc = clamp(bg_y, 0, bin_h - bg_h)
                        bg_rect = (bg_x, bg_yc, bg_w, bg_h)

                        if not accept(bg_rect, img_rect):
                            continue

                        if side == 'top':
                            good_x, good_y, good_w, good_h = bg_x, bg_yc, bg_w, bg_h - overlap_px
                        else:
                            good_x, good_y, good_w, good_h = bg_x, bg_yc + overlap_px, bg_w, bg_h - overlap_px
                        return (bg_x, bg_yc, bg_w, bg_h, good_x, good_y, good_w, good_h)

        scale -= scale_step

    # Fail-safe
    bg_w = int(round(max(scale_min, 0.5) * img_w))
    bg_h = int(round(max(scale_min, 0.5) * img_h))
    overlap_px = max(1, int(round(overlap_frac * bg_h)))
    bg_x = clamp(img_x, 0, bin_w - bg_w)
    bg_y = clamp(img_y + img_h - overlap_px, 0, bin_h - bg_h)
    bg_rect = (bg_x, bg_y, bg_w, bg_h)

    if rects_overlap(bg_rect, center_rect, pad=0):
        if bg_y + bg_h/2.0 < center_rect[1] + center_rect[3]/2.0:
            bg_y = clamp(center_rect[1] - bg_h - 2, 0, bin_h - bg_h)
        else:
            bg_y = clamp(center_rect[1] + center_rect[3] + 2, 0, bin_h - bg_h)
        bg_rect = (bg_x, bg_y, bg_w, bg_h)

    for _ in range(12):
        ov = rect_overlap_area(bg_rect, img_rect)
        under_area = float(bg_w * bg_h)
        outside_frac = 1.0 - (ov / under_area if under_area > 0 else 1.0)
        if (ov / under_area if under_area > 0 else 0.0) <= MAX_OVERLAP_RATIO and outside_frac >= MIN_OUTSIDE_FRAC:
            break
        bg_y = clamp(bg_y + max(2, int(0.04 * img_h)), 0, bin_h - bg_h)
        bg_rect = (bg_x, bg_y, bg_w, bg_h)

    good_x = bg_x
    good_y = bg_y + overlap_px
    good_w = bg_w
    good_h = bg_h - overlap_px
    return (bg_x, bg_y, bg_w, bg_h, good_x, good_y, good_w, good_h)

# ---------- Title box placement (NEW) ----------
def place_title_box(bin_w, bin_h, img_rect, pin_xy, pin_side,
                    w_frac_range=(TITLE_W_FRAC_MIN, TITLE_W_FRAC_MAX),
                    h_frac_range=(TITLE_H_FRAC_MIN, TITLE_H_FRAC_MAX),
                    overlap_frac_range=(TITLE_OVERLAP_MIN, TITLE_OVERLAP_MAX)):
    """Place a small HORIZONTAL rectangle under the pin.
       Overlaps the image box by 30–55% along the touching axis."""
    ix, iy, iw, ih = img_rect
    cx, cy = pin_xy

    # size (respect absolute min height)
    tw = int(round(random.uniform(*w_frac_range) * iw))
    th = int(round(random.uniform(*h_frac_range) * ih))
    th = clamp(th, TITLE_H_MIN_PX, TITLE_H_MAX_PX)
    if th >= tw:  # enforce horizontal
        tw = th + max(20, th)

    overlap_frac = random.uniform(*overlap_frac_range)

    # position depending on side; clamp to bin
    if pin_side in ('top', 'bottom'):
        overlap_h = int(round(overlap_frac * th))  # overlap along Y
        if pin_side == 'top':
            ty = iy - (th - overlap_h)   # mostly outside above image
        else:
            ty = iy + ih - overlap_h     # mostly outside below image
        tx = int(round(cx - tw / 2.0))
        tx = clamp(tx, 0, bin_w - tw)
        ty = clamp(ty, 0, bin_h - th)
    else:
        overlap_w = int(round(overlap_frac * tw))  # overlap along X
        if pin_side == 'left':
            tx = ix - (tw - overlap_w)   # mostly outside to the left
        else:
            tx = ix + iw - overlap_w     # mostly outside to the right
        ty = int(round(cy - th / 2.0))
        tx = clamp(tx, 0, bin_w - tw)
        ty = clamp(ty, 0, bin_h - th)

    return (int(tx), int(ty), int(tw), int(th), float(overlap_frac))

# ---------- OUTER FRAME (with extra pad & scale) ----------
def outer_frame_for_pair(img_rect, under_rect, bin_w, bin_h,
                         margin=FRAME_MARGIN,
                         extra_pad=FRAME_EXTRA_PAD,
                         expand_scale=FRAME_SCALE_UP):
    """
    Encompass image + underlay with (margin + extra_pad),
    adjust to project aspect (bin_w:bin_h),
    then grow slightly by expand_scale (zoom-out),
    clamp in-bounds, compute zoom % to fill screen.
    """
    ix, iy, iw, ih = img_rect
    ux, uy, uw, uh = under_rect

    pad = margin + max(0, extra_pad)
    x1 = min(ix, ux) - pad
    y1 = min(iy, uy) - pad
    x2 = max(ix + iw, ux + uw) + pad
    y2 = max(iy + ih, uy + uh) + pad

    fx, fy, fw, fh = x1, y1, x2 - x1, y2 - y1

    # Fit to project aspect
    ar = float(bin_w) / float(bin_h)
    cur_ar = fw / float(fh) if fh > 0 else ar
    cx, cy = fx + fw/2.0, fy + fh/2.0
    if cur_ar < ar:
        fw, fh = fh * ar, fh
    else:
        fw, fh = fw, fw / ar

    # Grow a tiny bit further (zoom-out)
    fw *= max(1.0, expand_scale)
    fh *= max(1.0, expand_scale)

    # Re-center & clamp
    fx, fy = cx - fw/2.0, cy - fh/2.0
    fx = clamp(fx, 0, bin_w - fw)
    fy = clamp(fy, 0, bin_h - fh)

    fw_i = int(round(fw)); fh_i = int(round(fh))
    fx_i = int(round(fx)); fy_i = int(round(fy))
    zoom = max(bin_w/float(fw_i), bin_h/float(fh_i)) * 100.0
    return (fx_i, fy_i, fw_i, fh_i, float(zoom))

# ---------- Image drawing ----------
def draw_image_in_rect(ax, path, rect, zorder=4):
    x, y, w, h = rect
    try:
        with Image.open(path) as im:
            img = im.convert("RGBA")
            iw, ih = img.size
    except Exception:
        ax.add_patch(Rectangle((x, y), w, h, fill=False, linewidth=1.0, edgecolor=(1,0,0,0.8), zorder=zorder))
        ax.add_line(Line2D([x, x+w], [y, y+h], linewidth=1.0, color=(1,0,0,0.8), zorder=zorder))
        ax.add_line(Line2D([x, x+w], [y+h, y], linewidth=1.0, color=(1,0,0,0.8), zorder=zorder))
        return
    s = min(w / float(iw), h / float(ih))
    dw = max(1.0, iw * s)
    dh = max(1.0, ih * s)
    x0 = x + (w - dw) / 2.0
    y0 = y + (h - dh) / 2.0
    # y-axis inverted (imshow extent: left, right, top, bottom)
    ax.imshow(img, extent=[x0, x0 + dw, y0 + dh, y0], zorder=zorder, interpolation='antialiased')

# ---------------- Main ----------------
def main():
    if not os.path.isdir(IMG_DIR):
        raise SystemExit(f"Folder not found: {IMG_DIR}")

    files = list_image_files(IMG_DIR)
    if not files:
        raise SystemExit("No images found in IMG_DIR.")

    items = []
    for p in files:
        w, h = get_image_size(p)
        dw, dh = scale_to_max(w, h, MAX_RECT_DIM)
        items.append({"path": p, "w": w, "h": h, "dw": dw, "dh": dh})
    random.shuffle(items)

    center_x = (BIN_W - CENTRAL_W) // 2
    center_y = (BIN_H - CENTRAL_H) // 2
    center_rect = (center_x, center_y, CENTRAL_W, CENTRAL_H)

    layout = {
        "meta": {
            "generated_at": datetime.now().isoformat(),
            "bin": {"width": BIN_W, "height": BIN_H, "aspect": BIN_W / float(BIN_H)},
            "central_box": {"x": center_rect[0], "y": center_rect[1],
                            "w": center_rect[2], "h": center_rect[3],
                            "image_path": CENTER_IMG},
            "zspec": ZSPEC
        },
        "items": [],
        "pins": [],
        "links": []
    }

    N = len(items)
    base_angles = [2 * math.pi * i / float(max(1, N)) for i in range(N)]
    angles = [(a + math.radians(random.uniform(-ANGLE_JITTER_DEG, ANGLE_JITTER_DEG))) % (2 * math.pi)
              for a in base_angles]
    for i, it in enumerate(items):
        it["theta"] = angles[i]
    items.sort(key=lambda x: x["theta"])

    r0 = needed_start_radius(center_rect, PADDING + 6)

    placed_rects = []
    image_boxes = []
    for it in items:
        w, h = it["dw"], it["dh"]
        theta = it["theta"]
        cand = None
        theta_try = theta
        for _ in range(MAX_RETRIES_PER_ITEM):
            cand = try_place_on_ring(w, h, theta_try, placed_rects, center_rect,
                                     BIN_W, BIN_H, PADDING, r0)
            if cand is not None:
                break
            delta = math.radians(random.uniform(4, 14))
            theta_try = (theta_try + (delta if random.random() < 0.5 else -delta)) % (2 * math.pi)
        if cand is not None:
            x, y, w2, h2 = cand
            placed_rects.append((x, y, w2, h2))
            image_boxes.append((x, y, w2, h2, it["path"]))
        else:
            image_boxes.append(None)

    fig = plt.figure(figsize=(BIN_W/160, BIN_H/160), dpi=160)
    ax = plt.gca()
    ax.set_xlim(0, BIN_W); ax.set_ylim(BIN_H, 0)
    ax.set_aspect('equal', adjustable='box'); ax.set_xticks([]); ax.set_yticks([])

    # Bin & center frame (visual)
    ax.add_patch(Rectangle((0, 0), BIN_W, BIN_H, fill=False, linewidth=2, zorder=0))
    ax.add_patch(Rectangle((center_rect[0], center_rect[1]), center_rect[2], center_rect[3],
                           fill=False, linewidth=2, zorder=0))

    # Center image + border
    draw_image_in_rect(ax, CENTER_IMG, center_rect, zorder=ZSPEC["image"])
    ax.add_patch(Rectangle((center_rect[0], center_rect[1]),
                           center_rect[2], center_rect[3],
                           fill=False, linewidth=IMAGE_EDGE_W,
                           edgecolor=IMAGE_EDGE, zorder=ZSPEC["border"]))

    tack_points = []
    placed_ok = 0

    for rec in image_boxes:
        if rec is None:
            continue
        placed_ok += 1
        x, y, w, h, path = rec

        (bg_x, bg_y, bg_w, bg_h,
         good_x, good_y, good_w, good_h) = place_underlying_box(
            BIN_W, BIN_H, x, y, w, h, center_rect,
            scale_init=UNDERLY_SCALE_INIT,
            scale_min=UNDERLY_SCALE_MIN,
            scale_step=UNDERLY_SCALE_STEP,
            overlap_frac=OVERLAP_FRAC,
            max_tries=120
        )

        # Underlay
        ax.add_patch(Rectangle(
            (bg_x, bg_y), bg_w, bg_h,
            linewidth=UNDERLY_EDGE_W, edgecolor=UNDERLY_EDGE, facecolor=UNDERLY_FACE,
            zorder=ZSPEC["underlay"]
        ))

        # Text box guide (dashed)
        pad_x = TEXTBOX_PAD_FRAC_X * good_w
        pad_y = TEXTBOX_PAD_FRAC_Y * good_h
        tx = good_x + pad_x
        ty = good_y + pad_y
        tw = max(1, good_w - 2 * pad_x)
        th = max(1, good_h - 2 * pad_y)
        ax.add_patch(Rectangle(
            (tx, ty), tw, th,
            linewidth=TEXTBOX_EDGE_W, edgecolor=TEXTBOX_EDGE, facecolor=TEXTBOX_FACE,
            zorder=ZSPEC["text"], linestyle=TEXTBOX_DASH
        ))

        # Image & border
        draw_image_in_rect(ax, path, (x, y, w, h), zorder=ZSPEC["image"])
        ax.add_patch(Rectangle((x, y), w, h, fill=False, linewidth=IMAGE_EDGE_W,
                               edgecolor=IMAGE_EDGE, zorder=ZSPEC["border"]))

        # Outer frame (project aspect) around image + underlay, with extra zoom-out
        fx, fy, fw, fh, zoom_percent = outer_frame_for_pair(
            (x, y, w, h), (bg_x, bg_y, bg_w, bg_h),
            BIN_W, BIN_H,
            margin=FRAME_MARGIN,
            extra_pad=FRAME_EXTRA_PAD,
            expand_scale=FRAME_SCALE_UP
        )
        ax.add_patch(Rectangle(
            (fx, fy), fw, fh,
            fill=False, linewidth=FRAME_EDGE_W, edgecolor=FRAME_EDGE,
            linestyle=FRAME_DASH, zorder=ZSPEC["frame"]
        ))

        # Pin (choose side first so we can place title box under it)
        tack_r = max(3, min(12, int(TACK_RADIUS_FRAC * min(w, h))))
        inset = tack_r + 2
        pin_side = random.choice(['top', 'bottom', 'left', 'right'])
        if pin_side in ('top', 'bottom'):
            cx = x + random.uniform(0.15, 0.85) * w
            cy = y + inset if pin_side == 'top' else y + h - inset
        else:
            cy = y + random.uniform(0.15, 0.85) * h
            cx = x + inset if pin_side == 'left' else x + w - inset
        cx = clamp(cx, x + inset, x + w - inset)
        cy = clamp(cy, y + inset, y + h - inset)

        # Title box (NEW): small horizontal rectangle under the pin, mostly outside image
        tbx, tby, tbw, tbh, tover = place_title_box(
            BIN_W, BIN_H, (x, y, w, h), (cx, cy), pin_side
        )
        ax.add_patch(Rectangle(
            (tbx, tby), tbw, tbh,
            linewidth=TITLE_EDGE_W, edgecolor=TITLE_EDGE, facecolor=TITLE_FACE,
            zorder=ZSPEC["title"]
        ))

        # Draw the pin above title
        ax.add_patch(Circle((cx, cy), tack_r, facecolor=TACK_FILL, edgecolor=TACK_EDGE,
                            linewidth=TACK_EDGE_W, zorder=ZSPEC["pin"]))
        tack_points.append((cx, cy))

        # JSON capture
        this_pin_index = len(layout["pins"])
        layout["items"].append({
            "image_path": path,
            "image_box": {"x": x, "y": y, "w": w, "h": h},
            "under_box": {"x": bg_x, "y": bg_y, "w": bg_w, "h": bg_h},
            "under_good_zone": {"x": good_x, "y": good_y, "w": good_w, "h": good_h},
            "text_box": {"x": tx, "y": ty, "w": tw, "h": th},
            "title_box": {  # NEW
                "x": tbx, "y": tby, "w": tbw, "h": tbh,
                "overlap_frac": tover, "pin_side": pin_side
            },
            "outer_box": {"x": fx, "y": fy, "w": fw, "h": fh, "aspect": BIN_W / float(BIN_H)},
            "zoom_percent": zoom_percent,
            "pin_index": this_pin_index,
            "layers": dict(ZSPEC)
        })
        layout["pins"].append({"x": float(cx), "y": float(cy)})

    # Center box pin
    c_x, c_y, c_w, c_h = center_rect
    c_r = max(3, min(12, int(TACK_RADIUS_FRAC * min(c_w, c_h))))
    c_inset = c_r + 2
    side = random.choice(['top', 'bottom', 'left', 'right'])
    if side in ('top', 'bottom'):
        ccx = c_x + random.uniform(0.2, 0.8) * c_w
        ccy = c_y + c_inset if side == 'top' else c_y + c_h - c_inset
    else:
        ccy = c_y + random.uniform(0.2, 0.8) * c_h
        ccx = c_x + c_inset if side == 'left' else c_x + c_w - c_inset
    ccx = clamp(ccx, c_x + c_inset, c_x + c_w - c_inset)
    ccy = clamp(ccy, c_y + c_inset, c_y + c_h - c_inset)
    ax.add_patch(Circle((ccx, ccy), c_r, facecolor=TACK_FILL, edgecolor=TACK_EDGE,
                        linewidth=TACK_EDGE_W, zorder=ZSPEC["pin"]))
    center_pin_index = len(layout["pins"])
    layout["meta"]["center_pin_index"] = center_pin_index
    layout["pins"].append({"x": float(ccx), "y": float(ccy)})

    # Links between tacks
    edges = set()
    n = len(layout["pins"])
    idxs = list(range(n))
    for i in idxs:
        k = random.randint(LINKS_MIN, min(LINKS_MAX, max(0, n - 1)))
        others = [j for j in idxs if j != i]
        random.shuffle(others)
        count = 0
        for j in others:
            a, b = (i, j) if i < j else (j, i)
            if (a, b) in edges:
                continue
            edges.add((a, b))
            count += 1
            if count >= k:
                break

    for (a, b) in edges:
        (x1, y1) = (layout["pins"][a]["x"], layout["pins"][a]["y"])
        (x2, y2) = (layout["pins"][b]["x"], layout["pins"][b]["y"])
        ax.add_line(Line2D([x1, x2], [y1, y2], linewidth=LINK_WIDTH, color=LINK_COLOR, zorder=ZSPEC["links"]))
        layout["links"].append([int(a), int(b)])

    # ---- WRITE JSON ----
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(layout, f, indent=2)
    print("Layout exported to:", OUT_JSON)

    # ---- ALSO WRITE a TRIAD TXT beside the JSON ----
    # For each item:
    #   <filename>
    #   <title>
    #   <multi-line description placeholder>
    #   <blank line>
    names_txt = os.path.splitext(OUT_JSON)[0] + "_names.txt"
    with open(names_txt, "w", encoding="utf-8") as tf:
        for it in layout["items"]:
            name = os.path.basename(it["image_path"])
            base = os.path.splitext(name)[0]
            title = base.replace("_", " ").title()
            tf.write(name + "\n")
            tf.write(title + "\n")
            tf.write("(Add multi-line description here...)\n")
            tf.write("\n")
    print("Names file written to:", names_txt)

    plt.title(f"Images + robust underlay + text box + title box + pins + links • {placed_ok} images")
    plt.tight_layout()
    plt.show()

if __name__ == "__main__":
    main()
