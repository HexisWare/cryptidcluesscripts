#!/usr/bin/env python3
import os
import sys
import argparse
import shutil
from PIL import Image, ImageOps, ImageDraw

EXTS = {".jpg", ".jpeg", ".png", ".gif", ".tif", ".tiff", ".bmp", ".webp"}

def compute_stroke(w, h, stroke_px=None, pct=None):
    if stroke_px is not None and stroke_px > 0:
        s = int(stroke_px)
    elif pct is not None and pct > 0:
        s = int(round(min(w, h) * (pct / 100.0)))
    else:
        s = int(round(min(w, h) * 0.03))  # ~3% of shorter side
    return max(1, min(s, max(1, min(w, h) // 2)))

def draw_edge_border(img, stroke_px, color=(255, 255, 255, 255)):
    """Draw a white inner border flush with the image edges (fully inside)."""
    w, h = img.size
    s = int(stroke_px)
    if s <= 0 or w < 2 or h < 2:
        return img

    base_mode = img.mode
    work = ImageOps.exif_transpose(img).convert("RGBA")

    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    s = max(1, min(s, w // 2, h // 2))  # clamp

    # Top & Bottom
    draw.rectangle((0, 0, w, s), fill=color)
    draw.rectangle((0, h - s, w, h), fill=color)
    # Left & Right (avoid double-drawing the corners twice with top/bottom)
    draw.rectangle((0, s, s, h - s), fill=color)
    draw.rectangle((w - s, s, w, h - s), fill=color)

    out = Image.alpha_composite(work, overlay)
    if base_mode in ("RGB", "L"):
        out = out.convert(base_mode)
    return out

def has_any_transparency(pil_img):
    """
    Return True if the image has an alpha channel with any pixel alpha < 255.
    Works for RGBA/LA/P (with transparency) by converting to RGBA if needed.
    """
    try:
        bands = pil_img.getbands()
        if "A" in bands:
            alpha = pil_img.getchannel("A")
        elif pil_img.mode == "P":
            # Palette image may have transparency in info
            if "transparency" in pil_img.info:
                pil_img = pil_img.convert("RGBA")
                alpha = pil_img.getchannel("A")
            else:
                return False
        else:
            # Convert to RGBA to be certain (covers e.g. LA, or rare modes)
            pil_img = pil_img.convert("RGBA")
            alpha = pil_img.getchannel("A")

        mn, mx = alpha.getextrema()
        return mn < 255
    except Exception:
        # On any failure, assume no transparency so processing continues
        return False

def process_dir(src_dir, dst_dir, stroke_px=None, pct=None,
                overwrite=False, verbose=True, prefix_src=False,
                skip_if_transparent=True):
    src_dir = os.path.abspath(src_dir)
    if not os.path.isdir(src_dir):
        raise SystemExit(f"Not a directory: {src_dir}")

    os.makedirs(dst_dir, exist_ok=True)
    if verbose:
        print(f"Output folder: {dst_dir}")

    files = [f for f in sorted(os.listdir(src_dir))
             if os.path.isfile(os.path.join(src_dir, f))
             and os.path.splitext(f)[1].lower() in EXTS]

    if verbose:
        print(f"Source: {src_dir}")
        print(f"Found {len(files)} image(s).")

    if not files:
        print("No supported images found. Supported:", ", ".join(sorted(EXTS)))
        return

    src_tag = os.path.basename(os.path.normpath(src_dir))
    done = 0
    for name in files:
        in_path = os.path.join(src_dir, name)
        out_name = f"{src_tag}_{name}" if prefix_src else name
        out_path = os.path.join(dst_dir, out_name)
        ext = os.path.splitext(name)[1].lower()

        if (not overwrite) and os.path.exists(out_path):
            if verbose: print(f"skip (exists): {out_name}")
            continue

        try:
            with Image.open(in_path) as im:
                # If PNG (or anything with alpha) and has ANY transparency, copy as-is.
                if skip_if_transparent and (ext == ".png" or "A" in im.getbands() or im.mode in ("LA", "P")):
                    if has_any_transparency(im):
                        if verbose: print(f"→ transparent detected, copying: {out_name}")
                        shutil.copy2(in_path, out_path)
                        done += 1
                        continue

                # Otherwise, draw the inner edge border and save
                s = compute_stroke(im.width, im.height, stroke_px=stroke_px, pct=pct)
                out = draw_edge_border(im, s)

                save_kwargs = {}
                if ext in (".jpg", ".jpeg"):
                    save_kwargs["quality"] = 95
                    save_kwargs["optimize"] = True

                out.save(out_path, **save_kwargs)
                print(f"✔ {out_name}  (edge border {s}px)")
                done += 1

        except Exception as e:
            print(f"✖ {out_name}  ERROR: {e}")

    print(f"\nDone. Wrote {done} file(s) to {dst_dir}")

def main():
    ap = argparse.ArgumentParser(
        description="Copy images into a folder next to this script; draw a white inner edge border unless the PNG has transparency."
    )
    ap.add_argument("src_dir", help="Path to the source image directory")
    ap.add_argument("--stroke", type=int, default=None, help="Border thickness in pixels")
    ap.add_argument("--pct", type=float, default=None, help="Border thickness as % of the shorter side")
    ap.add_argument("--overwrite", action="store_true", help="Overwrite files in output folder")
    ap.add_argument("--outname", default="intro_images",
                    help="Name of the output folder created NEXT TO this script (default: intro_images)")
    ap.add_argument("--prefix-srcname", action="store_true",
                    help="Prefix output filenames with the source folder name (avoid collisions)")
    ap.add_argument("--no-skip-transparent", dest="skip_trans", action="store_false",
                    help="Do NOT skip stroking transparent PNGs (process them anyway)")
    ap.add_argument("--quiet", action="store_true", help="Less logging")
    args = ap.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    dst_dir = os.path.join(script_dir, args.outname)

    process_dir(
        args.src_dir,
        dst_dir=dst_dir,
        stroke_px=args.stroke,
        pct=args.pct,
        overwrite=args.overwrite,
        verbose=not args.quiet,
        prefix_src=args.prefix_srcname,
        skip_if_transparent=args.skip_trans
    )

if __name__ == "__main__":
    main()
