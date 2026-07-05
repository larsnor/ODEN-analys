# Bin 2 — Obsidian configuration (no code)

Drop-in Obsidian settings that make the analytical content stand out. This is
**Bin 2** (operator/vault configuration), separate from the plugin (Bin 3).

## `graph.json` — Graph View color groups

Copy to `<vault>/.obsidian/graph.json`. Colors the global graph by node class
and hides the cloud of unconnected message dots:

| Class | query | colour |
|-------|-------|--------|
| Objektet (area of interest) | `tag:#objektet` | gold |
| Misstänkta (pending suspects) | `tag:#larm` | red |
| Aktörer (confirmed actors) | `tag:#aktör` | blue |
| Platser (relevant locations) | `tag:#plats` | amber |
| Återkomst (same entity 2+× at a place) | `tag:#återkomst` | magenta |
| Kännetecken (mark entities) | `file:marke-` | violet |
| Fordon (vehicle entities) | `path:entities -tag:#objektet -tag:#aktör -tag:#plats -tag:#återkomst -file:marke- -tag:#larm` | green |
| Meddelanden (raw 7S reports) | `file:TNR` | grey (hidden by default — see below) |

The graph **search filter is `-file:TNR`**, so raw message nodes are hidden by
default — the plugin writes direct links (place↔vehicle, actor↔place, larm↔place,
and a 🔁 recurrence node when the same entity recurs at a place) so the entity graph
stays connected without them. Clear the filter box to see the messages again.

The **objektet** (gold) node is the operation's area of interest, created by
ODEN's "Konfigurera operationsområde" — the suspicion proximity signal measures
against it. On the map it's a gold bullseye (`tag:#objektet`).

Location nodes (`#plats`, amber) are one note per relevant place — a location with
a suspicious report or a vehicle plate — linking every report observed there, so
the place appears in the graph as a spatial hub connecting its reports (and through
them the markers/actors at that spot).

Plus `showOrphans: false` so only entities and their linked reports show.

Nodes are colored by **tag** (`#larm` red = pending, `#aktör` blue = confirmed,
`#plats` amber, `#återkomst` magenta) rather than filename. Node names carry an
**emoji type-cue instead of a type word** — `🕸️ …` (actor), `📍 …` (place),
`⚠️ …` (suspect), `🔁 … ×N · place` (recurrence) — so the graph label reads as the
entity's name, with the type in metadata/colour only. Mark notes still use the
`marke-` filename prefix. Reports are `TNR*.md`; entity notes live in the
**`entities/`** folder (default).

## `map-view-data.json` — Map View config

Copy to `<vault>/.obsidian/plugins/obsidian-map-view/data.json` (Map View is a
separate community plugin the operator installs; it is NOT bundled). It sets the
default query to `tag:#larm OR tag:#aktör OR tag:#objektet` and colors markers to
match the graph: **gold bullseye = objektet**, **red triangle = pending suspect
(`#larm`)**, **blue spy icon = confirmed actor (`#aktör`)**. `showNotePreview: false`
makes marker popups show just the note **name** (not the frontmatter). The map
**centre is set per-operation** by ODEN's "Konfigurera operationsområde", so the
committed centre is only a starting point.

## `oden-lock.css` — lock the workspace

Copy to `<vault>/.obsidian/snippets/oden-lock.css` and enable under
Settings → Appearance → CSS snippets. Hides the tab close/new-tab buttons in the
main area so operator panels can't be accidentally closed. Hot-reloads (no
restart). See the file header for details.

### IMPORTANT — apply with Obsidian CLOSED
Obsidian caches `graph.json` **and** the Map View `data.json` in memory and
**rewrites them on close / on any settings change**. Writing either while Obsidian
is open will be overwritten. Procedure: **quit Obsidian → copy the files in →
reopen.** (Or add the colour groups / filter by hand while it's open.)

The colors only show once entity notes exist — run **Bygg entiteter (Jobb A)**
(or let the watcher auto-build), and confirm actors/marks to see those classes.
