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
| Bildfynd (confirmed photo findings) | `tag:#bildfynd` | cyan |
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
them the markers/actors at that spot). Operator-**predefined** places ("Platser i
förväg…") additionally link the gold `[[Objektet]]` node, so they are visible in
the graph from day 0 even though orphans are hidden — before any report has
reached their vicinity.

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
default query to `tag:#larm OR tag:#aktör OR tag:#objektet OR tag:#fördefinierad`
and colors markers to match the graph: **gold bullseye = objektet**, **red
triangle = pending suspect (`#larm`)**, **blue spy icon = confirmed actor
(`#aktör`)**, **amber dot = reported place (`#plats`, derived from messages —
a place with coordinates belongs on the map, not just in the graph)**, **green
pin = predefined place (`#fördefinierad`, created via "Namngivna platser…")**,
**violet shield = sensitive predefined place (`#skyddsvärd`)**. Rule order
matters: later rules override, so the predefined needle/shield wins over the
plats dot. `showNotePreview: false` makes marker popups show just the note **name**
(not the frontmatter). Declutter: `mapControlsMinimized: true` collapses the
on-map control stack to a single button, and `saveHistory: false` drops the map
search-history dropdown. The map **centre is set per-operation** by ODEN's
"Konfigurera operationsområde", so the committed centre is only a starting point.

### Basemap sources — CartoDB needs a key

`mapSources` ships **two** entries and `chosenMapSource: 0` selects the first:

| # | Source | Key |
|---|--------|-----|
| 0 | **CartoDB** (Voyager) — the default cartography | **required** |
| 1 | **OpenStreetMap (ingen nyckel)** — keyless fallback | none |

CARTO now requires an API key on `basemaps.cartocdn.com`; requests without one are
served with an *"API key required"* watermark (the map still works). The key is
**deliberately not committed** — CARTO's free tier forbids sharing a key across
unrelated projects, so it cannot ride along in the vault zip. Each operator gets
their own free key at [carto.com/basemaps/apikey](https://carto.com/basemaps/apikey)
and appends it to the tile URL:

```
https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=<KEY>
```

The URL is left keyless in the template on purpose: a keyless CartoDB request
degrades to a watermark, whereas a placeholder key would be rejected outright.

CartoDB stays the default rather than OSM because this config sets
`cacheAllTiles: true` (2 GB) and `INSTALL.md` tells air-gapped operators to pan the
area through in advance — a prefetch pattern the OSM tile usage policy explicitly
forbids. OSM is the right *manual fallback*, not the right default.

**Map View's own map tools feed ODEN** (they cannot be hidden, so they work
instead): right-click the map → **"New note here (front matter)"** drops a bare
geolocation note, which ODEN detects and offers to turn into a *plats i förväg*
at that spot or a *name* for the nearest unnamed MGRS place — the kartnot is
absorbed once an action is picked ("Ignorera" keeps it). **"Copy geolocation as
front matter"** copies the position immediately (no dialog) and pastes straight
into any ODEN coordinate field; plain **"Copy geolocation"** works too, but first
asks for a marker name — the clipboard is only written after you press OK.

## `oden-lock.css` — lock the workspace

Copy to `<vault>/.obsidian/snippets/oden-lock.css` and enable under
Settings → Appearance → CSS snippets. Hides the tab close/new-tab buttons in the
main area so operator panels can't be accidentally closed. Hot-reloads (no
restart). See the file header for details.

## `app.json` — editor / vault preferences

Copy to `<vault>/.obsidian/app.json`. Sets `propertiesInDocument: "hidden"` so
notes don't render the **Egenskaper (Properties)** panel at the top of each file —
the 7S frontmatter is still fully parsed and used by ODEN and Map View, it's just
not shown inline. (Equivalent to Settings → Editor → *Properties in document* →
*Hidden*.)

## `workspace.json` — default pane layout

Copy to `<vault>/.obsidian/workspace.json`. The operator workspace: the **map**,
the **graph**, the **ODEN panel** and the **ODEN Chat** (bottom row: Välkommen
30 | ODEN 40 | chat 30) as **pinned** tabs — pinned so clicking a report opens
it in a *new* tab instead of hijacking one of the panels.

**Existing vaults** (workspace.json already materialized by Obsidian) get no
chat pane automatically: open it once via 💬-knappen i ODEN-panelen, `⋯ →
"Öppna chatten"` or the command palette ("ODEN: Öppna chatten") — it splits in
beside the panel and Obsidian persists the layout from then on. Session
state (`lastOpenFiles`, the active leaf, and any open report file/title) is
stripped from the committed template — Obsidian repopulates that as the operator
works. The `left-ribbon.hiddenItems` block also hides the **quick switcher** and
**command palette** ribbon icons (both stay reachable via `Cmd-O` / `Cmd-P`), so
with `core-plugins.json` applied the ribbon is exactly three icons: **ODEN**,
**Map View**, **Graph**.

## `core-plugins.json` — operator-minimal Obsidian

Copy to `<vault>/.obsidian/core-plugins.json`. Disables the Obsidian core features
an ODEN operator never uses — Canvas, Daily notes, Templates, Note composer,
Bookmarks, Outline, Word count, Tag pane, Bases, Sync, Outgoing links — which also
removes their ribbon icons, sidebar tabs and menu entries. Kept on: File explorer,
Search, Quick switcher, Graph, Backlinks, Properties, Page preview, Command
palette, File recovery. Everything is re-enableable per-vault under
Settings → Core plugins.

### IMPORTANT — apply with Obsidian CLOSED
Obsidian caches `graph.json`, the Map View `data.json`, `app.json`,
`core-plugins.json` **and** `workspace.json` in memory and **rewrites them on
close / on any settings change**.
Writing any of them while Obsidian is open will be overwritten. Procedure: **quit
Obsidian → copy the files in → reopen.** (Or add the colour groups / filter by hand
while it's open.)

**Also note:** an already-open map pane keeps its **own** saved query (workspace
state) and ignores `defaultState` — so after updating the map config, either open
a fresh map view, or use ODEN's ⋯ menu → **"Visa ODEN-lagren på kartan"**, which
re-asserts the current ODEN query on the live pane.

The colors only show once entity notes exist — the watcher auto-builds them as
reports arrive (**⋯ → Avancerat → "Uppdatera lägesbild"** is the manual nudge),
and confirming actors/marks reveals those classes.
