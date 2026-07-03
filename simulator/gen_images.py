#!/usr/bin/env python3
"""
Render synthetic PLACEHOLDER images for trial 7S messages.

These are NOT photographs. They are legible rendered stand-ins whose only
purpose is to exercise the image *pipeline* (attachment storage, referencing,
the vision adapter being invoked, OCR reading a clear rendered plate) — not to
test vision quality on messy field photos. Real photos can slot into the same
wiring later.

Corroborating-only: the plate shown is ALSO present in the message text, so the
image confirms an existing human-typed plate (tests §6.7 OCR-corroboration)
without detection ever depending on vision.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

# A Swedish-plate-like card: blue EU strip + black chars on white.
def _font(size):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"]:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def render_plate(plate_text: str, out_path: Path, note: str = ""):
    """A simple plate placeholder. plate_text shown with a space (ABC 123)."""
    W, H = 520, 150
    img = Image.new("RGB", (W, H), (245, 245, 245))
    d = ImageDraw.Draw(img)
    # plate body
    px0, py0, px1, py1 = 40, 40, 480, 120
    d.rounded_rectangle([px0, py0, px1, py1], radius=10,
                        fill=(255, 255, 255), outline=(20, 20, 20), width=4)
    # EU blue strip
    d.rectangle([px0, py0, px0 + 34, py1], fill=(0, 51, 153))
    d.text((px0 + 8, py0 + 28), "S", font=_font(28), fill=(255, 255, 0))
    # plate characters with a space in the middle (AAA NNN style display)
    disp = plate_text
    if len(plate_text) == 6:
        disp = plate_text[:3] + " " + plate_text[3:]
    d.text((px0 + 70, py0 + 18), disp, font=_font(46), fill=(15, 15, 15))
    # tiny caption (context note), not part of OCR target
    if note:
        d.text((40, 126), note, font=_font(14), fill=(120, 120, 120))
    img.save(out_path, "JPEG", quality=85)
    return out_path

def render_mark_panel(caption: str, out_path: Path):
    """A plain captioned panel standing in for a photo of a mark/person.
    The caption is a neutral label; the vision pipeline would 'describe' it."""
    W, H = 480, 320
    img = Image.new("RGB", (W, H), (60, 63, 70))
    d = ImageDraw.Draw(img)
    # crude silhouette block to suggest 'a photo of a subject'
    d.rectangle([170, 90, 310, 250], fill=(40, 42, 48))
    d.ellipse([205, 50, 275, 120], fill=(40, 42, 48))
    # wrap caption
    f = _font(20)
    words = caption.split()
    lines, cur = [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if d.textlength(t, font=f) > W - 40:
            lines.append(cur); cur = w
        else:
            cur = t
    lines.append(cur)
    y = 260
    for ln in lines:
        d.text((20, y), ln, font=f, fill=(220, 220, 220)); y += 26
    img.save(out_path, "JPEG", quality=85)
    return out_path

if __name__ == "__main__":
    # smoke test
    out = Path("_img_test"); out.mkdir(exist_ok=True)
    render_plate("RJK241", out / "plate.jpg", "trial – corroborating")
    render_mark_panel("mörk ryggsäck med ljust emblem", out / "mark.jpg")
    print("wrote", list(out.glob("*.jpg")))
