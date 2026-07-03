#!/usr/bin/env python3
"""
Generate synthetic 7S reports in the NEW Bin 1 format (Händelse free-prose,
signal_* frontmatter, MGRS grids, optional Symbol, no [[wikilinks]]).

Scenario: peacetime guarding of HvSS Vällinge. HIGH volume of civilian
(benign) observations + a FEW appearances of a reconnaissance team of distinct
individuals (NOT the same person) over a 14-day window.

Usage:
  python3 generate_reports_newformat.py --preview        # print 2 examples, write nothing
  python3 generate_reports_newformat.py --n 600 --days 14 --seed 2026 \
        --out reports_new --gt ground_truth_new.json
"""
import argparse, json, random, uuid as _uuid
from datetime import datetime, timedelta
from pathlib import Path

# --- Vällinge-area locations (MGRS pre-resolved, zone 33V XF) ---------------
LOCATIONS = [
    ("Nordsektorn","AQ","Vällingevägen vid grindarna",59.2615,17.7135,"33VXF5468572319"),
    ("Nordsektorn","AQ","Vällingevägen norr om säteriet",59.264,17.71,"33VXF5447472590"),
    ("Nordsektorn","AQ","Infart Vällinge säteri",59.263,17.7109,"33VXF5453072480"),
    ("Nordsektorn","AQ","Gång- och cykelväg mot Norsborg",59.27,17.715,"33VXF5473273269"),
    ("Nordsektorn","AQ","Grusparkering vid motionsspåret",59.266,17.705,"33VXF5418072801"),
    ("Östsektorn","BQ","Parkering vid Bornsjöns norra strand",59.247,17.736,"33VXF5603370758"),
    ("Östsektorn","BQ","Skogsbilväg öster om Bornsjön",59.242,17.756,"33VXF5719770249"),
    ("Östsektorn","BQ","Åkerkant norr om Bornsjön",59.251,17.73,"33VXF5567371189"),
    ("Östsektorn","BQ","Strandpromenaden Bornsjön",59.2455,17.741,"33VXF5632570603"),
    ("Sydsektorn","CQ","Korsningen Vällingevägen/E4-påfart",59.256,17.7,"33VXF5394171676"),
    ("Sydsektorn","CQ","Vägren E4 avfart söderut",59.254,17.698,"33VXF5383671449"),
    ("Sydsektorn","CQ","Busshållplats Vällingevägen",59.2585,17.706,"33VXF5427171968"),
    ("Västsektorn","DQ","Skogsdunge sydväst om säteriet",59.2595,17.708,"33VXF5438172084"),
    ("Västsektorn","DQ","Vändplan vid skogsbrynet",59.2575,17.717,"33VXF5490371882"),
    ("Västsektorn","DQ","Skogsväg nordväst om motionsspåret",59.267,17.702,"33VXF5400572905"),
    ("Vattensektorn","EQ","Stranden vid Vällinge ö",59.2649,17.7191,"33VXF5498972711"),
    ("Vattensektorn","EQ","Bryggan nedanför säteriet",59.2638,17.716,"33VXF5481772581"),
]
# Locations adjacent to the protected object (recon interest).
NEAR_OBJECT = [l for l in LOCATIONS if l[0] in ("Nordsektorn","Västsektorn")]

LETTERS = "ABCDEFGHJKLMNPRSTUWXYZ"
def rid(): return _uuid.UUID(int=random.getrandbits(128), version=4)
def gen_plate():
    a = "".join(random.choice(LETTERS) for _ in range(3))
    if random.random() < 0.5:
        return a + "".join(random.choice("0123456789") for _ in range(3))
    return a + "".join(random.choice("0123456789") for _ in range(2)) + random.choice(LETTERS)
# Each platoon (sector callsign AQ/BQ/CQ/DQ/EQ) watches its own sector and has a
# stable Signal account. Populated in build().
PLATOON_UUID: dict = {}

CARS = ["Volvo V70","VW Golf","Toyota Corolla","Audi A4","Skoda Octavia","Ford Focus",
        "Kia Ceed","Tesla Model 3","Volvo XC60","Renault Clio","Hyundai i30","Dacia Duster"]

# --- Civilian (benign) Händelse templates ----------------------------------
CIVIL = [
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
]
DOGS = ["en hund","två hundar","en labrador","en liten terrier"]
COLOURS = ["ljus","gul","röd","blå","grön","orange"]

# --- Reconnaissance team: 7 DISTINCT individuals ----------------------------
# Distinct people (re-id by person via their marks); the TEAM is the pattern.
RECON_TEAM = [
    {"id":"R1","marks":"mörk täckjacka, keps neddragen, solglasögon"},
    {"id":"R2","marks":"ljusgrå softshell, axelremsväska, kort rakat hår"},
    {"id":"R3","marks":"grön fältjacka, kikare runt halsen, skäggig"},
    {"id":"R4","marks":"svart hoodie, ryggsäck med stativ, hörlurar"},
    {"id":"R5","marks":"blå arbetsjacka, reflexväst men inget arbete utfört"},
    {"id":"R6","marks":"beige rock, läderportfölj, prydligt klädd"},
    {"id":"R7","marks":"mörk hoodie, kamera med teleobjektiv, ung"},
]
RECON_BEHAVIOUR = [
    "Stod stilla länge och betraktade grindarna, fotograferade mot säteriet.",
    "Långsam passage, andra varvet inom 25 minuter, iakttog in- och utfart.",
    "Person antecknade i block medan fordon passerade infarten.",
    "Satt i parkerad bil med uppsikt mot säteriet, lämnade när patrull närmade sig.",
    "Mätte av sträckan längs staketet med stegräknare, undvek ögonkontakt.",
    "Riktade kikare mot vaktkuren, drog sig undan vid uppmärksamhet.",
    "Rörde sig längs skogsbrynet, verkade kartlägga kameraplaceringar.",
    "Stannade upprepat och tittade bakåt (kontraspaning) innan vidare mot grindarna.",
]
# A shared team vehicle appears in SOME recon sightings (ties distinct people).
TEAM_VEHICLES = ["mörk skåpbil","mörkblå kombi"]

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
    if sender:  # Signal channel: per-platoon account
        fm += [f'signal_avsandare_nummer: "{sender}"', f'signal_avsandare_id: "{sender}"']
    fm.append(f'plats: "{plats}"')
    if rec.get("lat") is not None:
        lat = rec["lat"]; lon = rec["lon"]
        fm += [f"lat: {lat}", f"lon: {lon}", f'location: "{lat},{lon}"']
    if rec.get("image"):   # a plate photo corroborating the plate typed in text
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

def make_record(dt, loc, kind, member=None):
    sector, callsign, name, lat, lon, mgrs = loc   # callsign = the sector's platoon
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
        "truth": "civil" if kind=="civil" else "recon", "member": member, "plate": None,
        "sector": sector, "name": name,
    }
    if kind == "civil":
        t = random.choice(CIVIL)
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
    else:  # recon — DISTINCT people, NO shared hard ID (operator choice):
        # the cell is detectable ONLY as a spatial/temporal/behavioural pattern.
        # Each member recurs solely by their (soft, free-prose) Symbol marks.
        m = next(x for x in RECON_TEAM if x["id"]==member)
        rec["handelse"] = random.choice(RECON_BEHAVIOUR)
        rec["symbol"] = m["marks"]
    return rec

def build(n, days, seed):
    random.seed(seed)
    global PLATOON_UUID
    # One Signal account per platoon (sector callsign). Preserve sector order.
    PLATOON_UUID = {cs: str(rid()) for cs in dict.fromkeys(l[1] for l in LOCATIONS)}
    start = datetime(2026, 6, 15, 0, 0, 0)
    def rand_dt(night_bias=False):
        day = random.randint(0, days-1)
        if night_bias:
            hour = random.choice([4,5,5,6,21,22,22,23,0,1])
        else:
            hour = min(23, max(5, int(random.gauss(13,4))))
        return start + timedelta(days=day, hours=hour, minutes=random.randint(0,59))

    records = []
    # Recon: each of 7 members appears 2-4 times, near object, time-biased.
    for m in RECON_TEAM:
        for _ in range(random.randint(2,4)):
            loc = random.choice(NEAR_OBJECT)
            records.append(make_record(rand_dt(night_bias=random.random()<0.6), loc, "recon", m["id"]))
    # Civilian: fill the rest.
    while len(records) < n:
        loc = random.choice(LOCATIONS)
        records.append(make_record(rand_dt(), loc, "civil"))
    records.sort(key=lambda r: r["tidpunkt"])
    return records

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=600)
    ap.add_argument("--days", type=int, default=14)
    ap.add_argument("--seed", type=int, default=2026)
    ap.add_argument("--out", default="reports_new")
    ap.add_argument("--gt", default="ground_truth_new.json")
    ap.add_argument("--attachments", default="attachments")
    ap.add_argument("--no-images", action="store_true",
                    help="skip rendering corroborating plate photos (needs Pillow)")
    ap.add_argument("--preview", action="store_true")
    args = ap.parse_args()

    if args.preview:
        recs = build(60, args.days, args.seed)
        civ = next(r for r in recs if r["truth"]=="civil")
        rec = next(r for r in recs if r["truth"]=="recon")
        print("="*70, "\nCIVILIAN EXAMPLE\n" + "="*70)
        print(render(civ))
        print("="*70, "\nSUSPICIOUS (recon-team member) EXAMPLE\n" + "="*70)
        print(render(rec))
        return

    recs = build(args.n, args.days, args.seed)
    out = Path(__file__).parent / args.out
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
        # A corroborating plate photo for reports whose text names a plate.
        if images and r.get("plate"):
            img_name = f"plate_{stem}.jpg"
            render_plate(r["plate"], att / img_name, note="prov – styrker plåt i text")
            r["image"] = img_name
            n_images += 1
        (out / f"{stem}.md").write_text(render(r), encoding="utf-8")
        gt.append({"file": f"{stem}.md", "id": f"7S-{r['uuid']}", "tnr": r["tnr"], "tidpunkt": r["tidpunkt"],
                   "truth": r["truth"], "member": r["member"], "plate": r["plate"],
                   "sector": r["sector"], "image": r.get("image")})
    (Path(__file__).parent / args.gt).write_text(json.dumps(gt, ensure_ascii=False, indent=1), encoding="utf-8")
    n_recon = sum(1 for r in recs if r["truth"]=="recon")
    n_plates = sum(1 for r in recs if r["plate"])
    print(f"Wrote {len(recs)} reports to {out} ({n_recon} recon, {len(recs)-n_recon} civilian)")
    print(f"Civilian plates in prose: {n_plates}; recon sightings have NO hard ID (pure pattern).")
    if images:
        print(f"Rendered {n_images} corroborating plate photos to {att} (plate embedded in JPEG).")

if __name__ == "__main__":
    main()
