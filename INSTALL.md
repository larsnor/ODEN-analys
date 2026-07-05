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
picks them up; use the ODEN panel (the ⋯ menu) to derive actors, review mark
nominations, run the suspicion analysis, name/merge entities, etc. In Graph view
you'll see six colour-coded node types (objektet, larm, aktör, plats, återkomst,
entities) with raw messages hidden by the `-file:TNR` filter.

## Note on detection scope
See `docs/RE-ID_VALIDATION.md`. In short: the deterministic mark re-identification
layer is a **high-precision seed** — it fails safe (never invents a mark on a
civilian) but its recall/precision on *real* reports is unvalidated and limited by
a fixed vocabulary. Plate-based re-id and the proximity/behaviour suspicion scoring
are the robust parts; broad open-vocabulary re-id is future (LLM) work.
