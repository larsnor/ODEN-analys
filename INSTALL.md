# Installing ODEN

ODEN is an Obsidian plugin. It is distributed as a zip (not via Obsidian's
community browser). Obsidian and the Map View plugin are **not** bundled — you
install those yourself (below). ODEN makes **zero network calls**; the only thing
that ever touches the network is Map View's map tiles.

## 1. Install Obsidian
Download and install Obsidian from <https://obsidian.md>, then create (or open) a
**vault** — a normal folder Obsidian manages. ODEN is desktop-only.

## 2. Install the Map View plugin (required for the map)
In Obsidian: **Settings → Community plugins → Turn off Restricted mode →
Browse → search "Map View" (by Esm7) → Install → Enable**. ODEN degrades
gracefully without it (the text/graph analysis still works), but the map needs it.

## 3. Install ODEN
From this release, copy the plugin folder into your vault:

```
<vault>/.obsidian/plugins/7s-analys/
    main.js
    manifest.json
```

(The `7s-analys/` folder in the zip contains `main.js` + `manifest.json` — copy the
whole folder.) Then **Settings → Community plugins → Installed plugins → enable
"ODEN"**. Reload if prompted.

## 4. Apply the Obsidian config — WITH OBSIDIAN CLOSED
Obsidian rewrites these files on exit, so **quit Obsidian first**, then copy:

| From (in the zip) | To |
|---|---|
| `obsidian-config/graph.json` | `<vault>/.obsidian/graph.json` |
| `obsidian-config/map-view-data.json` | `<vault>/.obsidian/plugins/obsidian-map-view/data.json` |
| `obsidian-config/oden-lock.css` | `<vault>/.obsidian/snippets/oden-lock.css` |

Reopen Obsidian; under **Settings → Appearance → CSS snippets**, enable
`oden-lock`. See `obsidian-config/README.md` for what each file does. (The graph
colours only appear once entity notes exist — step 6.)

## 5. Set the operation area
Run the command **"ODEN: Konfigurera operationsområde"** (Ctrl/Cmd-P) and enter the
protected object's coordinate (`lat,lon` or an MGRS grid). ODEN measures proximity
against this point and centres the map there. Changing the area later wipes prior
operator decisions (you'll be warned).

## 6. Add 7S reports and analyse
Put 7S report notes in the vault (real intake, or synthetic corpora from the
separate [7S-generator](https://github.com/larsnor/7S-generator)). ODEN's watcher
picks them up and analyses automatically — alarms and pending suggestions appear
as clickable rows in the ODEN panel's feed (confirm/reject from there); naming and
merging live under the panel's ⋯ menu. Spotted something the analysis missed?
**Right-click any report note → "ODEN: Flagga som larm"** — the report elevates
with the reason *flaggad av operatör* (right-click again to remove the flag).
In Graph view
you'll see six colour-coded node types (objektet, larm, aktör, plats, återkomst,
entities) with raw messages hidden by the `-file:TNR` filter.

## 7. (Optional) Image analysis — local LLM via Ollama
ODEN can read attached photos ("Se bild" reports) with a local vision model — most
useful for **registreringsskyltar** and **periods of low staffing**. It is OFF by
default and entirely optional; detection never depends on it.

1. Install **Ollama** (`https://ollama.com`) — a local, offline model server.
2. Pull the model: `ollama pull qwen3-vl:4b` (≈3 GB; the default. `:8b` is more
   accurate but needs ≥32 GB RAM — see `docs/VISION_VALIDATION.md` for the numbers).
3. In Obsidian: **Settings → ODEN** → check the Ollama address + model, press
   **"Testa anslutning"**.
4. In the ODEN panel, click the **📷 Bild** chip to turn it on (you'll get a
   one-time warning about speed). New photo reports are then analysed **as they
   arrive**: the feed shows *"📷 Bild mottagen, analys startad"* while the model
   works, then *"📷 N bildfynd att granska →"* — click it and every finding —
   plate, vehicle, person — is **proposed for your confirmation** (per item, over
   the photo). Nothing is written without you accepting it (`föreslagen-av:
   llm-vision`). Ollama can also run on a stronger machine on the network (set the
   address accordingly).

## Note on detection scope
See `docs/RE-ID_VALIDATION.md`, `docs/BEHAVIOUR_VALIDATION.md`, and (for the vision
model) `docs/VISION_VALIDATION.md`. In short: the deterministic mark
re-identification layer is a **high-precision seed** — it fails safe (never invents
a mark on a civilian) but its recall on *real* reports is limited by a fixed
vocabulary. Plate-based re-id and the proximity/behaviour suspicion scoring are the
robust parts. Image analysis (optional, above) is **nomination-gated**: the model
suggests, the operator confirms — it is never the sole detection path.
