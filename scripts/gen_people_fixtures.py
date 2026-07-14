#!/usr/bin/env python3
"""Generate the synthetic BENIGN-people corpus for the vision harness.

Controlled attribute matrix: single individuals and groups, men/women, three age
bands, varied clothing colours (indoor + outdoor garments), countryside + urban
settings — everyone just STANDING, no activity of any kind. Purpose:
  1. isolate kön/ålder/klädfärg measurement from activity confounds;
  2. measure whether a VLM INVENTS activity/suspicion where none exists
     (hallucination pressure on the benign baseline).

Synthetic people → no GDPR concerns → fixtures are committable (unlike the
operator's real set, which stays gitignored).

Requires the imgen venv (SDXL-Turbo via diffusers on MPS), built by the setup
step in the session scratchpad. Run:

    <scratchpad>/imgen/bin/python scripts/gen_people_fixtures.py [--out DIR]

Output: plugin/test/fixtures/vision_people/persons_NN.jpg + manifest.json
(the prompt-derived DRAFT facit — each image must be VIEWED and the facit
corrected before scoring; diffusion models do not follow attribute prompts
perfectly, especially in groups).
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "plugin" / "test" / "fixtures" / "vision_people"

STYLE = (
    "photorealistic photo, full body visible, standing still doing nothing, "
    "relaxed neutral pose, looking around casually, overcast daylight, "
    "candid documentary style"
)
NEG = "cartoon, illustration, painting, low quality, deformed, cropped heads"

# (id, setting-prompt, people-prompt, draft facit)
CASES = [
    # --- singles, countryside -------------------------------------------------
    ("persons_01", "on a gravel road in open Swedish countryside, fields and forest edge",
     "a young man in a red jacket and dark jeans",
     [{"kon": "man", "alder": "ung", "klader": ["röd jacka", "mörka jeans"]}]),
    ("persons_02", "at the edge of a wheat field, rural landscape",
     "a young woman in a yellow raincoat and black trousers",
     [{"kon": "kvinna", "alder": "ung", "klader": ["gul regnjacka", "svarta byxor"]}]),
    ("persons_03", "on a forest path among pine trees",
     "a middle-aged man in a blue checked flannel shirt and grey trousers",
     [{"kon": "man", "alder": "medelålders", "klader": ["blå rutig skjorta", "grå byxor"]}]),
    ("persons_04", "beside a country fence with meadows behind",
     "a middle-aged woman in a green wool coat and a white scarf",
     [{"kon": "kvinna", "alder": "medelålders", "klader": ["grön kappa", "vit halsduk"]}]),
    ("persons_05", "on a dirt track near a red wooden barn",
     "an elderly man in a grey overcoat and a flat cap",
     [{"kon": "man", "alder": "äldre", "klader": ["grå rock", "keps"]}]),
    ("persons_06", "in a rural meadow with birch trees",
     "an elderly woman in a purple quilted jacket and dark trousers",
     [{"kon": "kvinna", "alder": "äldre", "klader": ["lila täckjacka", "mörka byxor"]}]),
    # --- singles, urban ---------------------------------------------------------
    ("persons_07", "on a city sidewalk with apartment buildings behind",
     "a young man in a black hoodie and white sneakers",
     [{"kon": "man", "alder": "ung", "klader": ["svart huvtröja", "vita skor"]}]),
    ("persons_08", "on a cobblestone square in a small town",
     "a young woman in a white blouse and beige chinos, indoor office clothing",
     [{"kon": "kvinna", "alder": "ung", "klader": ["vit blus", "beige byxor"]}]),
    ("persons_09", "at a bus stop on an ordinary street",
     "a middle-aged man in a brown leather jacket and blue jeans",
     [{"kon": "man", "alder": "medelålders", "klader": ["brun skinnjacka", "jeans"]}]),
    ("persons_10", "on a pedestrian street with shop windows",
     "a middle-aged woman in an orange puffer jacket and black leggings",
     [{"kon": "kvinna", "alder": "medelålders", "klader": ["orange täckjacka", "svarta byxor"]}]),
    ("persons_11", "in front of a brick apartment block",
     "an elderly man in a dark blue suit without tie, indoor clothing outdoors",
     [{"kon": "man", "alder": "äldre", "klader": ["mörkblå kostym"]}]),
    ("persons_12", "on a quiet residential street corner",
     "an elderly woman in a pink cardigan and grey skirt",
     [{"kon": "kvinna", "alder": "äldre", "klader": ["rosa kofta", "grå kjol"]}]),
    # --- groups, countryside ----------------------------------------------------
    ("persons_13", "on a country road between fields",
     "two women standing together, one young in a turquoise fleece, one elderly in a beige coat",
     [{"kon": "kvinna", "alder": "ung", "klader": ["turkos fleece"]},
      {"kon": "kvinna", "alder": "äldre", "klader": ["beige kappa"]}]),
    ("persons_14", "at a forest clearing",
     "three men standing loosely apart: young in a green parka, middle-aged in a black jacket, elderly in a brown coat",
     [{"kon": "man", "alder": "ung", "klader": ["grön parkas"]},
      {"kon": "man", "alder": "medelålders", "klader": ["svart jacka"]},
      {"kon": "man", "alder": "äldre", "klader": ["brun rock"]}]),
    ("persons_15", "by a lakeside in open countryside",
     "a man in a grey sweater and a woman in a red wool coat standing side by side",
     [{"kon": "man", "klader": ["grå tröja"]},
      {"kon": "kvinna", "klader": ["röd kappa"]}]),
    # --- groups, urban ------------------------------------------------------------
    ("persons_16", "on a city square",
     "four people standing in a loose group: two men in dark jackets, a woman in a blue coat, a woman in a yellow jacket",
     [{"kon": "man", "klader": ["mörk jacka"]}, {"kon": "man", "klader": ["mörk jacka"]},
      {"kon": "kvinna", "klader": ["blå kappa"]}, {"kon": "kvinna", "klader": ["gul jacka"]}]),
    ("persons_17", "on a bridge over a canal in a town",
     "two young men standing, one in a white t-shirt, one in a navy windbreaker",
     [{"kon": "man", "alder": "ung", "klader": ["vit t-shirt"]},
      {"kon": "man", "alder": "ung", "klader": ["mörkblå vindjacka"]}]),
    ("persons_18", "outside a suburban supermarket",
     "a middle-aged woman in a black coat and an elderly man in a green jacket standing near each other",
     [{"kon": "kvinna", "alder": "medelålders", "klader": ["svart kappa"]},
      {"kon": "man", "alder": "äldre", "klader": ["grön jacka"]}]),
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--steps", type=int, default=4)  # sdxl-turbo: 1-4 steps
    ap.add_argument("--size", type=int, default=768)
    ap.add_argument("--seed", type=int, default=77)
    ap.add_argument("--only", help="generate a single case id (e.g. persons_03)")
    args = ap.parse_args()

    import torch
    from diffusers import AutoencoderKL, AutoPipelineForText2Image

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    # SDXL's stock VAE NaN-poisons in float16 on MPS → solid-black images after
    # the first decode. The community fp16-fix VAE is the canonical cure.
    vae = AutoencoderKL.from_pretrained("madebyollin/sdxl-vae-fp16-fix", torch_dtype=torch.float16)
    pipe = AutoPipelineForText2Image.from_pretrained(
        "stabilityai/sdxl-turbo", vae=vae, torch_dtype=torch.float16, variant="fp16"
    ).to(device)
    pipe.enable_attention_slicing()

    args.out.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, dict] = {}
    for cid, setting, people, facit in CASES:
        if args.only and cid != args.only:
            continue
        prompt = f"{people}, {setting}, {STYLE}"
        g = torch.Generator(device="cpu").manual_seed(args.seed + int(cid.split("_")[1]))
        img = pipe(
            prompt=prompt, negative_prompt=NEG, num_inference_steps=args.steps,
            guidance_scale=0.0, width=args.size, height=args.size, generator=g,
        ).images[0]
        f = args.out / f"{cid}.jpg"
        img.save(f, "JPEG", quality=90)
        manifest[f.name] = {
            "persons": facit, "behaviour": [], "activity": "ingen — står bara",
            "prompt": prompt,
            "verified": False,  # flips true once a human has checked image vs facit
        }
        print(f"wrote {f.name}")

    mf = args.out / "manifest.json"
    existing = json.loads(mf.read_text()) if mf.exists() else {}
    existing.update(manifest)
    mf.write_text(json.dumps(existing, indent=2, ensure_ascii=False) + "\n")
    print(f"manifest: {mf} ({len(existing)} entries) — VIEW each image and correct facit before scoring")


if __name__ == "__main__":
    main()
