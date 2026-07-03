#!/usr/bin/env python3
"""
Generate synthetic 7S reports in the NEW Bin 1 format (Händelse free-prose,
signal_* frontmatter, MGRS grids, optional Symbol, no [[wikilinks]]).

Two interchangeable SITE profiles share the SAME scenario shape and the SAME
behavioural repertoire — only the geography, place names and the specific people
differ. This is deliberate: the plugin's fixed ruleset (suspicion RECON_INDICATORS,
vocab.ts mark categories) must detect the recon cell at EITHER site without being
re-tuned per corpus.

  --site vallinge   HvSS Vällinge (default)
  --site tierp      Tierp flygfält (ESKT), fyra plutoner runt fältet

Usage:
  python3 generate_reports_newformat.py --site tierp --preview
  python3 generate_reports_newformat.py --site tierp --n 600 --days 14 --seed 2026 --no-images
"""
import argparse, json, random, uuid as _uuid
from datetime import datetime, timedelta
from pathlib import Path
from mgrs_forward import latlon_to_mgrs

LETTERS = "ABCDEFGHJKLMNPRSTUWXYZ"
def rid(): return _uuid.UUID(int=random.getrandbits(128), version=4)
def gen_plate():
    a = "".join(random.choice(LETTERS) for _ in range(3))
    if random.random() < 0.5:
        return a + "".join(random.choice("0123456789") for _ in range(3))
    return a + "".join(random.choice("0123456789") for _ in range(2)) + random.choice(LETTERS)

CARS = ["Volvo V70","VW Golf","Toyota Corolla","Audi A4","Skoda Octavia","Ford Focus",
        "Kia Ceed","Tesla Model 3","Volvo XC60","Renault Clio","Hyundai i30","Dacia Duster"]
DOGS = ["en hund","två hundar","en labrador","en liten terrier"]
COLOURS = ["ljus","gul","röd","blå","grön","orange"]

# The recon behaviour repertoire — the FIXED vocabulary the deterministic scorer
# keys on (suspicion.ts RECON_INDICATORS). Reused at both sites (real recon does
# these things anywhere); only the place nouns change.

# --- Vällinge profile --------------------------------------------------------
VALLINGE = {
    "name": "HvSS Vällinge",
    "protected": (59.2622, 17.712),
    "near_sectors": ("Nordsektorn", "Västsektorn"),
    "locations": [
        ("Nordsektorn","AQ","Vällingevägen vid grindarna",59.2615,17.7135),
        ("Nordsektorn","AQ","Vällingevägen norr om säteriet",59.264,17.71),
        ("Nordsektorn","AQ","Infart Vällinge säteri",59.263,17.7109),
        ("Nordsektorn","AQ","Gång- och cykelväg mot Norsborg",59.27,17.715),
        ("Nordsektorn","AQ","Grusparkering vid motionsspåret",59.266,17.705),
        ("Östsektorn","BQ","Parkering vid Bornsjöns norra strand",59.247,17.736),
        ("Östsektorn","BQ","Skogsbilväg öster om Bornsjön",59.242,17.756),
        ("Östsektorn","BQ","Åkerkant norr om Bornsjön",59.251,17.73),
        ("Östsektorn","BQ","Strandpromenaden Bornsjön",59.2455,17.741),
        ("Sydsektorn","CQ","Korsningen Vällingevägen/E4-påfart",59.256,17.7),
        ("Sydsektorn","CQ","Vägren E4 avfart söderut",59.254,17.698),
        ("Sydsektorn","CQ","Busshållplats Vällingevägen",59.2585,17.706),
        ("Västsektorn","DQ","Skogsdunge sydväst om säteriet",59.2595,17.708),
        ("Västsektorn","DQ","Vändplan vid skogsbrynet",59.2575,17.717),
        ("Västsektorn","DQ","Skogsväg nordväst om motionsspåret",59.267,17.702),
        ("Vattensektorn","EQ","Stranden vid Vällinge ö",59.2649,17.7191),
        ("Vattensektorn","EQ","Bryggan nedanför säteriet",59.2638,17.716),
    ],
    "civil": [
        "Hundrastare med {dog} på motionsspåret, inget anmärkningsvärt.",
        "Joggare passerade i riktning mot Norsborg.",
        "Familj med barnvagn rastade vid stranden.",
        "{car} parkerade kort, förare hämtade något och körde vidare.",
        "Paketbil levererade vid säteriets infart.",
        "Cyklist i {colour} jacka passerade söderut.",
        "Två pensionärer promenerade längs vägen.",
        "Lantbruksfordon på åkern, sedvanligt arbete.",
        "Bil stannade vid busshållplatsen, släppte av passagerare.",
        "Fiskare vid bryggan, metspö och hink.",
        "Motionär rastade vid grusparkeringen, tänjde.",
        "{car} körde förbi i normal hastighet.",
        "Barn lekte vid stranden under uppsikt av vuxen.",
        "Postutdelare på cykel längs Vällingevägen.",
        "Förare bytte däck på vägrenen, varningstriangel utställd.",
    ],
    "recon_behaviour": [
        "Stod stilla länge och betraktade grindarna, fotograferade mot säteriet.",
        "Långsam passage, andra varvet inom 25 minuter, iakttog in- och utfart.",
        "Person antecknade i block medan fordon passerade infarten.",
        "Satt i parkerad bil med uppsikt mot säteriet, lämnade när patrull närmade sig.",
        "Mätte av sträckan längs staketet med stegräknare, undvek ögonkontakt.",
        "Riktade kikare mot vaktkuren, drog sig undan vid uppmärksamhet.",
        "Rörde sig längs skogsbrynet, verkade kartlägga kameraplaceringar.",
        "Stannade upprepat och tittade bakåt (kontraspaning) innan vidare mot grindarna.",
    ],
    "recon_team": [
        {"id":"R1","marks":"mörk täckjacka, keps neddragen, solglasögon"},
        {"id":"R2","marks":"ljusgrå softshell, axelremsväska, kort rakat hår"},
        {"id":"R3","marks":"grön fältjacka, kikare runt halsen, skäggig"},
        {"id":"R4","marks":"svart hoodie, ryggsäck med stativ, hörlurar"},
        {"id":"R5","marks":"blå arbetsjacka, reflexväst men inget arbete utfört"},
        {"id":"R6","marks":"beige rock, läderportfölj, prydligt klädd"},
        {"id":"R7","marks":"mörk hoodie, kamera med teleobjektiv, ung"},
    ],
}

# --- Tierp profile: Tierp flygfält (ESKT ~60.345 N, 17.422 E) -----------------
# Four platoons AQ/BQ/CQ/DQ in N/E/S/W sectors around the airfield. NEW place
# names and NEW people, but the same behavioural repertoire (same keywords).
TIERP = {
    "name": "Tierp flygfält (ESKT)",
    "protected": (60.345, 17.422),
    "near_sectors": ("Nordsektorn", "Västsektorn"),
    "locations": [
        ("Nordsektorn","AQ","Norra banänden",60.3525,17.4225),
        ("Nordsektorn","AQ","Grusväg norr om fältet",60.355,17.418),
        ("Nordsektorn","AQ","Infart till flygfältet",60.351,17.425),
        ("Nordsektorn","AQ","Skogsdunge norr om banan",60.357,17.421),
        ("Östsektorn","BQ","Parkering vid klubbstugan",60.344,17.44),
        ("Östsektorn","BQ","Motionsspår öster om fältet",60.347,17.452),
        ("Östsektorn","BQ","Åkerkant öster om banan",60.342,17.447),
        ("Östsektorn","BQ","Vägkorsning mot Söderfors",60.349,17.458),
        ("Sydsektorn","CQ","Södra banänden",60.3375,17.4215),
        ("Sydsektorn","CQ","Väg 292 söder om fältet",60.334,17.424),
        ("Sydsektorn","CQ","Busshållplats vid infarten",60.339,17.428),
        ("Sydsektorn","CQ","Åker söder om hangaren",60.336,17.419),
        ("Västsektorn","DQ","Hangarområdet",60.345,17.414),
        ("Västsektorn","DQ","Skogsbryn väster om banan",60.347,17.406),
        ("Västsektorn","DQ","Grusparkering väster om fältet",60.343,17.41),
        ("Västsektorn","DQ","Skogsväg mot Ol-Andersgården",60.349,17.4),
    ],
    "civil": [
        "Segelflygare riggade vid hangaren, sedvanlig verksamhet.",
        "Motionär joggade längs vägen mot Söderfors.",
        "Familj tittade på flygplan från parkeringen.",
        "{car} parkerade vid klubbstugan, förare gick in.",
        "Traktor plöjde åkern intill banan.",
        "Cyklist i {colour} jacka passerade grinden.",
        "Hundrastare med {dog} på grusvägen.",
        "Paketbil levererade till klubbstugan.",
        "Fältarbetare klippte gräs längs banan.",
        "Bil stannade vid vägkorsningen, släppte av passagerare.",
        "Pensionärspar promenerade längs staketet.",
        "{car} körde förbi i normal hastighet.",
        "Bonde kontrollerade stängsel vid åkerkanten.",
        "Barn matade fåglar vid parkeringen.",
        "Förare bytte däck på vägrenen, varningstriangel utställd.",
    ],
    "recon_behaviour": [
        "Stod stilla länge och betraktade hangaren, fotograferade mot banan.",
        "Långsam passage, andra varvet inom 25 minuter, iakttog start och landning.",
        "Person antecknade i block medan flygplan taxade.",
        "Satt i parkerad bil med uppsikt mot fältet, lämnade när patrull närmade sig.",
        "Mätte av sträckan längs staketet med stegräknare, undvek ögonkontakt.",
        "Riktade kikare mot vakten vid grinden, drog sig undan vid uppmärksamhet.",
        "Rörde sig längs skogsbrynet, verkade kartlägga kameraplaceringar.",
        "Stannade upprepat och tittade bakåt (kontraspaning) innan vidare mot hangaren.",
    ],
    "recon_team": [
        {"id":"T1","marks":"blå softshelljacka, solglasögon, kort hår"},
        {"id":"T2","marks":"grön parkas, ryggsäck med kartficka, skäggstubb"},
        {"id":"T3","marks":"grå munkjacka, kamera med teleobjektiv, keps"},
        {"id":"T4","marks":"svart täckjacka, kikare, mörk mössa"},
        {"id":"T5","marks":"beige jacka, axelväska, glasögon"},
        {"id":"T6","marks":"orange arbetsjacka, reflexväst men inget arbete, klocka"},
        {"id":"T7","marks":"mörk hoodie, stativ i ryggsäck, hörlurar"},
    ],
}
SITES = {"vallinge": VALLINGE, "tierp": TIERP}

# Each platoon (sector callsign) has a stable Signal account. Populated in build().
PLATOON_UUID: dict = {}


def fmt_dhm(dt): return dt.strftime("%d%H%M")
def iso(dt): return dt.strftime("%Y-%m-%dT%H:%M:%S")


def render(rec):
    """Render one record dict into the new-format markdown."""
    uuid = rec["uuid"]; tnr = rec["tnr"]; tid = rec["tidpunkt"]
    sigt = rec.get("signal_tidpunkt"); sender = rec.get("sender")
    plats = rec["plats"]; cs = rec["callsign"]
    fm = ["---", f"id: 7S-{uuid}", "typ: 7S-rapport", f'tnr: "{tnr}"', f'tidpunkt: "{tid}"']
    if sigt:
        fm.append(f'signal_tidpunkt: "{sigt}"')
    if sender:
        fm += [f'signal_avsandare_nummer: "{sender}"', f'signal_avsandare_id: "{sender}"']
    fm.append(f'plats: "{plats}"')
    if rec.get("lat") is not None:
        lat = rec["lat"]; lon = rec["lon"]
        fm += [f"lat: {lat}", f"lon: {lon}", f'location: "{lat},{lon}"']
    if rec.get("image"):
        fm.append(f'bilagor: ["{rec["image"]}"]')
    fm += [f"sagesman: {cs}", "---", ""]
    body = [f"**TNR:** {tnr}", "", f"**Stund:** {rec['stund']}", "",
            f"**Ställe:** {rec['stalle']}", "", f"**Händelse:** {rec['handelse']}", ""]
    if rec.get("symbol"):
        body += [f"**Symbol:** {rec['symbol']}", ""]
    body += [f"**Sagesman:** {cs}", "", "**Sedan:** -", ""]
    if rec.get("image"):
        body += [f"![[{rec['image']}]]", ""]
    return "\n".join(fm) + "\n".join(body) + "\n"


def make_record(dt, loc, kind, site, member=None):
    sector, callsign, name, lat, lon = loc
    mgrs = latlon_to_mgrs(lat, lon)
    obs = dt
    via_signal = random.random() < 0.9   # Signal is the default channel
    if via_signal:
        sig = obs + timedelta(minutes=random.randint(1, 3), seconds=random.randint(0, 59))
        tnr = fmt_dhm(sig); signal_tid = iso(sig); sender = PLATOON_UUID[callsign]
    else:
        tnr = fmt_dhm(obs); signal_tid = None; sender = None
    grid_only = random.random() < 0.5   # type B (grid only) vs type A (place + coords)
    rec = {
        "uuid": rid(), "tnr": tnr, "tidpunkt": iso(obs), "signal_tidpunkt": signal_tid,
        "sender": sender, "callsign": callsign, "stund": fmt_dhm(obs),
        "stalle": mgrs if grid_only else f"{mgrs}, {name}",
        "plats": mgrs if grid_only else name,
        "lat": None if grid_only else lat, "lon": None if grid_only else lon,
        "truth": "civil" if kind == "civil" else "recon", "member": member, "plate": None,
        "sector": sector, "name": name,
    }
    if kind == "civil":
        t = random.choice(site["civil"])
        plate = None
        if "{car}" in t and random.random() < 0.5:
            plate = gen_plate()
            car = random.choice(CARS) + f", reg {plate}"
        else:
            car = random.choice(CARS)
        rec["handelse"] = t.format(dog=random.choice(DOGS), car=car, colour=random.choice(COLOURS))
        rec["plate"] = plate
        if random.random() < 0.15:
            rec["symbol"] = f"{random.choice(COLOURS)} jacka"
    else:  # recon — DISTINCT people, NO shared hard ID: detectable ONLY as a
           # spatial/temporal/behavioural pattern. Each recurs by their Symbol marks.
        m = next(x for x in site["recon_team"] if x["id"] == member)
        rec["handelse"] = random.choice(site["recon_behaviour"])
        rec["symbol"] = m["marks"]
    return rec


def build(n, days, seed, site):
    random.seed(seed)
    global PLATOON_UUID
    locs = site["locations"]
    PLATOON_UUID = {cs: str(rid()) for cs in dict.fromkeys(l[1] for l in locs)}
    near = [l for l in locs if l[0] in site["near_sectors"]]
    start = datetime(2026, 6, 15, 0, 0, 0)

    def rand_dt(night_bias=False):
        day = random.randint(0, days - 1)
        if night_bias:
            hour = random.choice([4, 5, 5, 6, 21, 22, 22, 23, 0, 1])
        else:
            hour = min(23, max(5, int(random.gauss(13, 4))))
        return start + timedelta(days=day, hours=hour, minutes=random.randint(0, 59))

    records = []
    # Recon: each member appears 2-4 times, near the object, time-biased.
    for m in site["recon_team"]:
        for _ in range(random.randint(2, 4)):
            loc = random.choice(near)
            records.append(make_record(rand_dt(night_bias=random.random() < 0.6), loc, "recon", site, m["id"]))
    # Civilian: fill the rest.
    while len(records) < n:
        loc = random.choice(locs)
        records.append(make_record(rand_dt(), loc, "civil", site))
    records.sort(key=lambda r: r["tidpunkt"])
    return records


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", choices=list(SITES), default="vallinge")
    ap.add_argument("--n", type=int, default=600)
    ap.add_argument("--days", type=int, default=14)
    ap.add_argument("--seed", type=int, default=2026)
    ap.add_argument("--out", default=None)
    ap.add_argument("--gt", default=None)
    ap.add_argument("--attachments", default="attachments")
    ap.add_argument("--no-images", action="store_true",
                    help="skip rendering corroborating plate photos (needs Pillow)")
    ap.add_argument("--preview", action="store_true")
    args = ap.parse_args()
    site = SITES[args.site]
    tag = "new" if args.site == "vallinge" else args.site
    out_name = args.out or f"reports_{tag}"
    gt_name = args.gt or f"ground_truth_{tag}.json"

    if args.preview:
        recs = build(60, args.days, args.seed, site)
        civ = next(r for r in recs if r["truth"] == "civil")
        rec = next(r for r in recs if r["truth"] == "recon")
        print("="*70, f"\n{site['name']} — CIVILIAN EXAMPLE\n" + "="*70)
        print(render(civ))
        print("="*70, f"\n{site['name']} — SUSPICIOUS (recon-team member) EXAMPLE\n" + "="*70)
        print(render(rec))
        return

    recs = build(args.n, args.days, args.seed, site)
    out = Path(__file__).parent / out_name
    out.mkdir(exist_ok=True)
    for old in out.glob("*.md"): old.unlink()

    images = not args.no_images
    att = Path(__file__).parent / args.attachments
    render_plate = None
    if images:
        att.mkdir(exist_ok=True)
        for old in att.glob("plate_*.jpg"): old.unlink()
        from gen_images import render_plate  # lazy: only needs Pillow when imaging

    gt = []
    seen = {}
    n_images = 0
    for r in recs:
        base = f"TNR{r['tnr']}"
        seen[base] = seen.get(base, 0) + 1
        stem = base if seen[base] == 1 else f"{base}_{seen[base]}"
        if images and r.get("plate"):
            img_name = f"plate_{stem}.jpg"
            render_plate(r["plate"], att / img_name, note="prov – styrker plåt i text")
            r["image"] = img_name
            n_images += 1
        (out / f"{stem}.md").write_text(render(r), encoding="utf-8")
        gt.append({"file": f"{stem}.md", "id": f"7S-{r['uuid']}", "tnr": r["tnr"], "tidpunkt": r["tidpunkt"],
                   "truth": r["truth"], "member": r["member"], "plate": r["plate"],
                   "sector": r["sector"], "image": r.get("image")})
    (Path(__file__).parent / gt_name).write_text(json.dumps(gt, ensure_ascii=False, indent=1), encoding="utf-8")
    n_recon = sum(1 for r in recs if r["truth"] == "recon")
    n_plates = sum(1 for r in recs if r["plate"])
    print(f"[{site['name']}] Wrote {len(recs)} reports to {out} ({n_recon} recon, {len(recs)-n_recon} civilian)")
    print(f"Civilian plates in prose: {n_plates}; recon sightings have NO hard ID (pure pattern).")
    if images:
        print(f"Rendered {n_images} corroborating plate photos to {att} (plate embedded in JPEG).")


if __name__ == "__main__":
    main()
