#!/usr/bin/env python3
"""Generate ~300 synthetic 7S reports (true 7S format, internally consistent)."""
import random, json, math
from datetime import datetime, timedelta
from pathlib import Path
from collections import Counter

SEED = 1947
random.seed(SEED)
OUT = Path(__file__).parent / "reports"
OUT.mkdir(exist_ok=True)
for old in OUT.glob("*.md"):
    old.unlink()

N = 300

SECTORS = [
    ("Nordsektorn (säteriet/grindarna)", "AQ", [
        ("Vällingevägen vid grindarna",        59.2615, 17.7135),
        ("Vällingevägen norr om säteriet",     59.2640, 17.7100),
        ("Infart Vällinge säteri",             59.2630, 17.7109),
        ("Gång- och cykelväg mot Norsborg",    59.2700, 17.7150),
        ("Grusparkering vid motionsspåret",    59.2660, 17.7050),
    ]),
    ("Östsektorn (Bornsjön norra)", "BQ", [
        ("Parkering vid Bornsjöns norra strand",59.2470, 17.7360),
        ("Skogsbilväg öster om Bornsjön",      59.2420, 17.7560),
        ("Åkerkant norr om Bornsjön",          59.2510, 17.7300),
        ("Strandpromenaden Bornsjön",          59.2455, 17.7410),
    ]),
    ("Sydsektorn (E4-påfarter)", "CQ", [
        ("Korsningen Vällingevägen/E4-påfart", 59.2560, 17.7000),
        ("Vägren E4 avfart söderut",           59.2540, 17.6980),
        ("Busshållplats Vällingevägen",        59.2585, 17.7060),
    ]),
    ("Västsektorn (skogsbryn/vändplan)", "DQ", [
        ("Skogsdunge sydväst om säteriet",     59.2595, 17.7080),
        ("Vändplan vid skogsbrynet",           59.2575, 17.7170),
        ("Skogsväg nordväst om motionsspåret", 59.2670, 17.7020),
    ]),
    ("Vattensektorn (Vällinge ö)", "EQ", [
        ("Stranden vid Vällinge ö",            59.2649, 17.7191),
        ("Bryggan nedanför säteriet",          59.2638, 17.7160),
    ]),
]
def pick_sector(): return random.choice(SECTORS)
def callsign_for(sector):
    if random.random() < 0.08: return random.choice(SECTORS)[1]
    return sector[1]
def jitter(lat, lon, m=120):
    dlat = random.uniform(-m, m) / 111_320
    dlon = random.uniform(-m, m) / (111_320 * math.cos(math.radians(lat)))
    return round(lat + dlat, 5), round(lon + dlon, 5)
def L(name): return f"[[{name}]]"

LETTERS = "ABCDEFGHJKLMNPRSTUWXYZ"
def gen_plate():
    a = "".join(random.choice(LETTERS) for _ in range(3))
    if random.random() < 0.5:
        return a + "".join(random.choice("0123456789") for _ in range(3))
    return a + "".join(random.choice("0123456789") for _ in range(2)) + random.choice(LETTERS)
def mask_plate(full):
    chars = list(full)
    n_mask = random.choice([1,2,2,3])
    idxs = random.sample(range(len(chars)), min(n_mask, len(chars)-2))
    for i in idxs: chars[i] = "."
    return "".join(chars)

CARS = ["Volvo V70","Volvo XC60","Volkswagen Golf","Toyota Corolla","Kia Ceed",
    "Audi A4","Tesla Model 3","Skoda Octavia","Renault Clio","Ford Focus","BMW 320i",
    "Nissan Qashqai","Hyundai i30","Peugeot 308","Dacia Duster","Volvo V60","Seat Leon","Mazda CX-5"]
VANS = ["Postnord skåpbil","Bring skåpbil","Volkswagen Caddy","vit Ford Transit","Mercedes Sprinter"]

# ----------------------------------------------------------------------------
# COHERENT NOISE TEMPLATES. Each returns a dict with consistent
# slag / styrka / syssel / symbol. Vehicle templates put a plate in symbol;
# person templates never mention a vehicle.
# ----------------------------------------------------------------------------
def t_car_passing(plate_txt):
    car = random.choice(CARS)
    return {"slag":"Fordon","styrka":"1 fordon",
        "syssel":random.choice([
            "Passerade i normal hastighet mot Norsborg.",
            "Körde förbi mot E4-påfarten.",
            "Passerade söderut, inget anmärkningsvärt.",
            "Körde långsamt förbi och fortsatte.",
        ]),
        "symbol":f"{car}, reg {plate_txt}. Förare ensam, vardaglig klädsel."}

def t_car_parked(plate_txt):
    car = random.choice(CARS)
    return {"slag":"Fordon","styrka":"1 fordon, 1 person",
        "syssel":random.choice([
            "Parkerade kort, förare lämnade fordonet och joggade iväg.",
            "Stod parkerad vid vägkanten ca 10 min, ingen synlig aktivitet.",
            "Parkerade, förare rastade hund och återvände.",
        ]),
        "symbol":f"{car}, reg {plate_txt}. Förare medelålders, vardaglig klädsel."}

def t_delivery(plate_txt):
    van = random.choice(VANS)
    return {"slag":"Fordon","styrka":"1 fordon, 1 person",
        "syssel":random.choice([
            "Levererade paket och fortsatte.",
            "Stannade för leverans och fortsatte.",
            "Lossade gods vid infarten.",
        ]),
        "symbol":f"{van}, reg {plate_txt}. Förare i arbetskläder/varselväst."}

def t_pedestrian(_):
    return {"slag":"Person","styrka":random.choice(["1 person","2 personer"]),
        "syssel":random.choice([
            "Joggade förbi längs cykelvägen.",
            "Promenerade med hund.",
            "Rastade hund i området.",
            "Promenerade med barnvagn.",
        ]),
        "symbol":random.choice([
            "Motionär i joggingkläder, inga särskilda kännetecken.",
            "Äldre man med hund och käpp.",
            "Två personer i vardaglig klädsel.",
            "Vuxen med barnvagn.",
        ])}

def t_cyclist(_):
    return {"slag":"Person (cykel)","styrka":"1 person",
        "syssel":random.choice([
            "Cyklade mot busshållplatsen.",
            "Cyklade förbi mot Norsborg.",
        ]),
        "symbol":random.choice([
            "Cyklist i ljus jacka, ryggsäck.",
            "Ungdom på cykel, vardaglig klädsel.",
        ])}

def t_scooter(_):
    return {"slag":"Person (elsparkcykel)","styrka":"1 person",
        "syssel":"Åkte elsparkcykel längs cykelvägen.",
        "symbol":"Ungdom på elsparkcykel, ljus jacka."}

def t_family_beach(_):
    return {"slag":"Personer","styrka":"Familj (3-4)",
        "syssel":random.choice([
            "Rastade med barn i området.",
            "Promenerade i området.",
        ]),
        "symbol":"Barnfamilj, vardaglig klädsel, inga särskilda kännetecken."}

def t_jogger_group(_):
    return {"slag":"Personer","styrka":random.choice(["3 personer","Grupp (4-6)"]),
        "syssel":"Joggade förbi i samlad takt.",
        "symbol":"Motionsgrupp i träningskläder."}

def t_tractor(_):
    return {"slag":"Fordon (jordbruk)","styrka":"1 fordon",
        "syssel":random.choice([
            "Arbetade på intilliggande åker.",
            "Körde traktor längs vägkanten.",
        ]),
        "symbol":"Traktor med vagn, förare i arbetskläder. Ingen registreringsskylt noterad."}

def t_angler(_):
    return {"slag":"Person","styrka":random.choice(["1 person","2 personer"]),
        "syssel":"Fiskade vid vattnet.",
        "symbol":"Sportfiskare med utrustning, vardaglig klädsel."}

# Templates that involve a vehicle plate vs not
VEHICLE_TEMPLATES = [t_car_passing, t_car_parked, t_delivery]
TRACTOR_TEMPLATE = [t_tractor]
PERSON_TEMPLATES = [t_pedestrian, t_cyclist, t_scooter, t_family_beach, t_jogger_group, t_angler]

# Weighting: roughly 55% vehicle-with-plate, 8% tractor (no plate), 37% person
def make_noise_record(t, sector, recurring_pool):
    place, plat, plon = random.choice(sector[2])
    lat, lon = jitter(plat, plon)
    r = random.random()
    if r < 0.55:
        plate = random.choice(recurring_pool) if random.random() < 0.12 else gen_plate()
        plate_txt = L(plate) if random.random() < 0.6 else plate
        tmpl = random.choice(VEHICLE_TEMPLATES)(plate_txt)
    elif r < 0.63:
        tmpl = random.choice(TRACTOR_TEMPLATE)(None)
    else:
        tmpl = random.choice(PERSON_TEMPLATES)(None)
    tmpl.update({"t":t,"place":place,"lat":lat,"lon":lon,
                 "sag":callsign_for(sector),"truth":"noise"})
    return tmpl

COMMUTERS = [
    {"plate":"ABC123","veh":"Volvo V70","slot":(7,8),"ret":(16,17),"symbol":"Förare ensam, medelålders, kavaj."},
    {"plate":"DEF456","veh":"Tesla Model 3","slot":(7,9),"ret":(17,18),"symbol":"Kvinna ensam, solglasögon."},
    {"plate":"GHK78L","veh":"Volkswagen Caddy","slot":(6,7),"ret":(15,16),"symbol":"Hantverkare, två personer, varselkläder."},
    {"plate":"MRT902","veh":"Skoda Octavia","slot":(7,8),"ret":(16,18),"symbol":"Förare ensam, kostym."},
]
POI_CARS = [
    {"full":"RJK241","veh":"mörkgrå Skoda Superb"},
    {"full":"TLP893","veh":"silverfärgad Audi A6"},
    {"full":"WBN84X","veh":"mörkblå VW Passat"},
    {"full":"PMR556","veh":"svart Volvo V60"},
    {"full":"SDG417","veh":"mörkröd Toyota Avensis"},
]
TELL_LOGO="logotyp-fragment DGE"; TELL_BAG="ryggsäck märkning delvis läsbar -TAC"; TELL_CAP="keps mörk med ljust emblem"

# --- Varied PROSE phrasings of the recon-cell tells -------------------------
# Bin 1 links only deterministic IDs (plates). Descriptive marks stay as PROSE.
# Each tell has several paraphrases so the SAME mark reads differently across
# sightings — this is what the plugin's extraction+matching must resolve.
# A hidden stable id (tell_*) is recorded in ground truth so we can score re-id,
# but it never appears in the report text.
TELL_PHRASINGS = {
    "tell_bag": [
        "bar en mörk ryggsäck med ett delvis synligt märke",
        "svart ryggsäck, något tryck på baksidan",
        "mörk väska på ryggen, otydlig logga",
        "ryggsäck i mörkt tyg, märke svårt att läsa",
        "bar en svart ryggsäck, delvis läsbar text -TAC",
    ],
    "tell_cap": [
        "mörk keps med ett ljust emblem",
        "bar en svart keps, ljus symbol fram",
        "mörk mössa/keps med ljust märke",
        "keps i mörk färg, ljust tryck",
        "huvudbonad mörk med ljust emblem",
    ],
    "tell_logo": [
        "delvis synlig logotyp på bakrutan, liknar bokstäverna DGE",
        "dekalrest på bakrutan, otydlig",
        "klistermärke baktill, delvis DGE",
        "logga på bakglaset, svårläst",
        "märke på bakrutan, möjligen DGE",
    ],
}
def phrase(tell_id):
    return random.choice(TELL_PHRASINGS[tell_id])

POI_PERSON_BASE = [
    "Man ca 40–50 år, vältränad, neutral klädsel",
    "Medelålders man, kraftig, fåordig",
    "Man i 40-årsåldern, atletisk, diskret klädd",
    "Två män, medelålders, samordnade rörelser",
]

# POI sub-templates: vehicle-based vs foot-recon. Marks are PROSE (unlinked);
# only the plate is linked. tells[] carries hidden tell-ids for ground truth.
def poi_vehicle_record(t, sector):
    place, plat, plon = random.choice(sector[2]); lat, lon = jitter(plat, plon)
    car = random.choice(POI_CARS)
    plate = car["full"] if random.random() < 0.55 else mask_plate(car["full"])
    syssel = random.choice([
        "Stannade och fotograferade mot militärt område.",
        "Långsam passage, andra varvet inom 25 min.",
        "Kortvarigt möte med annat fordon, därefter separation.",
        "Stod parkerad med fri sikt mot infarten under längre tid.",
    ])
    tells = []
    parts = [f"{car['veh']}, reg {L(plate)}.", random.choice(POI_PERSON_BASE) + "."]
    if random.random() < 0.55:
        parts.append("Fordonet hade " + phrase("tell_logo") + "."); tells.append("tell_logo")
    if random.random() < 0.30:
        parts.append("Föraren " + phrase("tell_cap") + "."); tells.append("tell_cap")
    return {"slag":"Fordon + person","styrka":random.choice(["1 fordon, 1 person","1 fordon, 2 personer"]),
        "syssel":syssel,"symbol":" ".join(parts),"t":t,"place":place,"lat":lat,"lon":lon,
        "sag":callsign_for(sector),"truth":"POI","tells":tells,
        "plate":car["full"],"plate_shown":plate,"veh":car["veh"]}

def poi_foot_record(t, sector):
    place, plat, plon = random.choice(sector[2]); lat, lon = jitter(plat, plon)
    syssel = random.choice([
        "Förde anteckningar och studerade omgivningen.",
        "Använde kikare mot anläggningen.",
        "Rekognoscerade till fots längs stängslet.",
        "Observerade in- och utfart, rörde sig undvikande vid kontakt.",
    ])
    tells = []
    extra = []
    base = random.choice(POI_PERSON_BASE)
    if random.random() < 0.7:
        extra.append(phrase("tell_bag")); tells.append("tell_bag")
    if random.random() < 0.7:
        extra.append(phrase("tell_cap")); tells.append("tell_cap")
    sym = base + ((", " + ", ".join(extra)) if extra else ", inga särskilda kännetecken") + "."
    return {"slag":"Person","styrka":random.choice(["1 person","2 personer"]),
        "syssel":syssel,"symbol":sym,"t":t,"place":place,"lat":lat,"lon":lon,
        "sag":callsign_for(sector),"truth":"POI","tells":tells}

START = datetime(2026,2,14,0,0); DAYS=7
def hour_weight(h):
    if 0<=h<5: return 0.10
    if 5<=h<7: return 0.45
    if 7<=h<10: return 1.00
    if 10<=h<16: return 0.85
    if 16<=h<20: return 1.00
    if 20<=h<23: return 0.45
    return 0.20
def sample_ts():
    while True:
        day=random.randint(0,DAYS-1); h=random.randint(0,23)
        if random.random()<=hour_weight(h):
            return START+timedelta(days=day,hours=h,minutes=random.randint(0,59))

records=[]
N_POI=30
poi_times=[]
for _ in range(N_POI):
    while True:
        t=sample_ts()
        if 6<=t.hour<=21: poi_times.append(t); break
poi_times.sort()
for t in poi_times:
    sector=pick_sector()
    rec = poi_foot_record(t,sector) if random.random()<0.4 else poi_vehicle_record(t,sector)
    records.append(rec)

for day in range(DAYS):
    d=START+timedelta(days=day)
    if d.weekday()>=5: continue
    for c in COMMUTERS:
        for window,note in [(c["slot"],"mot pendelparkering"),(c["ret"],"återväg från arbete")]:
            if random.random()<0.75:
                h=random.randint(*window); t=d+timedelta(hours=h,minutes=random.randint(0,59))
                sector=SECTORS[0] if note.startswith("mot") else random.choice(SECTORS[:3])
                place,plat,plon=random.choice(sector[2]); lat,lon=jitter(plat,plon)
                records.append({"t":t,"place":place,"lat":lat,"lon":lon,
                    "styrka":"1 fordon","slag":"Fordon","syssel":f"Passerade på {note}.",
                    "symbol":f"{c['veh']}, reg {L(c['plate'])}. {c['symbol']}",
                    "sag":callsign_for(sector),"truth":"commuter"})

n_noise=max(0,N-len(records))
recurring_pool=[gen_plate() for _ in range(12)]
for _ in range(n_noise):
    records.append(make_noise_record(sample_ts(), pick_sector(), recurring_pool))

records.sort(key=lambda r:r["t"])

ATT = OUT.parent / "attachments"          # Bin 1 would write attachments here
ATT.mkdir(exist_ok=True)
for old in ATT.glob("*.jpg"): old.unlink()

import gen_images

def render(rec,idx,tnr,bilagor):
    ts=rec["t"].strftime("%Y-%m-%d %H:%M"); iso=rec["t"].strftime("%Y-%m-%dT%H:%M:00"); rid=f"7S-{idx:03d}"
    bil_fm = ("bilagor: [" + ", ".join(f"\"{b}\"" for b in bilagor) + "]\n") if bilagor else ""
    fm=("---\n"f"id: {rid}\ntyp: 7S-rapport\nkälla: bin1-intag\ntnr: \"{tnr}\"\ntidpunkt: \"{iso}\"\n"
        f"plats: \"{rec['place']}\"\nlat: {rec['lat']}\nlon: {rec['lon']}\n"
        f"location: \"{rec['lat']},{rec['lon']}\"\nsagesman: {rec['sag']}\n{bil_fm}---\n\n")
    body=(f"**TNR:** {tnr}\n\n**Stund:** {ts}\n\n**Ställe:** {rec['place']}\n\n**Styrka:** {rec['styrka']}\n\n"
          f"**Slag:** {rec['slag']}\n\n**Sysselsättning:** {rec['syssel']}\n\n"
          f"**Symbol:** {rec['symbol']}\n\n**Sagesman:** {rec['sag']}\n")
    for b in bilagor:
        body += f"\n![[{b}]]\n"
    return fm+body,rid

key=[]
tnr_seen={}
for idx,rec in enumerate(records,1):
    base_tnr=rec["t"].strftime("%d%H%M")
    tnr_seen[base_tnr]=tnr_seen.get(base_tnr,0)+1
    suffix="" if tnr_seen[base_tnr]==1 else f"_{tnr_seen[base_tnr]}"
    tnr=base_tnr+suffix
    # Corroborating image: ~45% of POI vehicle sightings that show a FULL plate
    # get a placeholder plate photo. Plate is also in text → corroboration only.
    bilagor=[]; img_plate=None
    if (rec["truth"]=="POI" and rec.get("plate") and rec.get("plate_shown")==rec["plate"]
            and random.random()<0.8):
        img_name=f"bild_{tnr}.jpg"
        gen_images.render_plate(rec["plate"], ATT/img_name, note="trial – korroborerande")
        bilagor=[img_name]; img_plate=rec["plate"]
    text,rid=render(rec,idx,tnr,bilagor); fname=f"TNR{tnr}.md"
    (OUT/fname).write_text(text,encoding="utf-8")
    entry={"file":fname,"id":rid,"tnr":tnr,
           "tidpunkt":rec["t"].strftime("%Y-%m-%dT%H:%M:00"),"truth":rec["truth"]}
    if rec.get("tells"): entry["tells"]=rec["tells"]          # hidden mark-ids for scoring
    if rec.get("plate"): entry["plate"]=rec["plate"]          # true full plate (signal)
    if rec.get("plate_shown"): entry["plate_shown"]=rec["plate_shown"]
    if img_plate: entry["image_corroborates_plate"]=img_plate
    key.append(entry)
(Path(__file__).parent/"ground_truth.json").write_text(json.dumps(key,ensure_ascii=False,indent=2),encoding="utf-8")
c=Counter(r["truth"] for r in records)
n_img=sum(1 for e in key if "image_corroborates_plate" in e)
print(f"Wrote {len(records)} reports to {OUT}")
print("Breakdown:",dict(c)); print("Span:",records[0]['t'],"->",records[-1]['t'])
print(f"Corroborating images: {n_img} in {ATT}")
