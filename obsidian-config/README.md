# Bin 2 — Obsidian configuration (no code)

Drop-in Obsidian settings that make the analytical content stand out. This is
**Bin 2** (operator/vault configuration), separate from the plugin (Bin 3).

## `graph.json` — Graph View color groups

Copy to `<vault>/.obsidian/graph.json`. Colors the global graph by node class
and hides the cloud of unconnected message dots:

| Class | query | colour |
|-------|-------|--------|
| Skyddsobjekt (area of interest) | `tag:#skyddsobjekt` | gold |
| Misstänkta (pending suspects) | `tag:#larm` | red |
| Aktörer (confirmed actors) | `tag:#aktör` | blue |
| Platser (relevant locations) | `tag:#plats` | amber |
| Kännetecken (mark entities) | `file:marke-` | violet |
| Fordon (vehicle entities) | `path:entities -tag:#skyddsobjekt -tag:#aktör -tag:#plats -file:marke- -tag:#larm` | green |
| Meddelanden (raw 7S reports) | `file:TNR` | grey |

The **skyddsobjekt** (gold) node is the operation's area of interest, created by
ODEN's "Konfigurera operationsområde" — the suspicion proximity signal measures
against it. On the map it's a gold bullseye (`tag:#skyddsobjekt`).

Location nodes (`#plats`, amber) are one note per relevant place — a location with
a suspicious report or a vehicle plate — linking every report observed there, so
the place appears in the graph as a spatial hub connecting its reports (and through
them the markers/actors at that spot).

Plus `showOrphans: false` so only entities and their linked reports show.

Actor/suspect nodes are colored by **tag** (`#larm` red = pending, `#aktör`
blue = confirmed) rather than filename, so their human-readable names
("Misstänkt fordon RJK241", "Aktör RJK241") don't need a machine prefix. Mark
notes still use the `marke-` filename prefix. Reports are `TNR*.md` at the
vault root, in the **`entities/`** folder (default `Entitetsmapp`).

## `obsidian-map-view` display rules (in the vault only)

Map View is set (`plugins/obsidian-map-view/data.json`) so the default query is
`tag:#larm OR tag:#aktör` and markers are colored to match the graph:
**red triangle = pending suspect (`#larm`)**, **blue spy icon = confirmed actor
(`#aktör`)**. A confirmed agent thus stays on the map, just recolored.

## `oden-lock.css` — lock the workspace

Copy to `<vault>/.obsidian/snippets/oden-lock.css` and enable under
Settings → Appearance → CSS snippets. Hides the tab close/new-tab buttons in the
main area so operator panels can't be accidentally closed. Hot-reloads (no
restart). See the file header for details.

### IMPORTANT — apply with Obsidian CLOSED
Obsidian caches `graph.json` in memory and **rewrites it on close / on any graph
setting change**. Writing the file while Obsidian is open will be overwritten.
Procedure: **quit Obsidian → copy this file in → reopen.** (Or add the color
groups by hand in Graph View settings while it's open.)

The colors only show once entity notes exist — run **Bygg entiteter (Jobb A)**
(or let the watcher auto-build), and confirm actors/marks to see those classes.
