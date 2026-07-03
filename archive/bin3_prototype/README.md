# Bin 3 prototype — entity resolution (NOT part of the data mimic)

These scripts are a **reference sketch of plugin functionality**, kept out of
the data-generation pipeline on purpose.

`entity_lib.py` + `generate_entities.py` build entity stub notes and resolve
partial→full registration plates (e.g. `.JK..1` → `RJK241`), seed canonical
plates, and aggregate each entity's observations. **This is analysis** — it
*derives* knowledge the raw messages don't contain.

That work belongs in the Obsidian **plugin** (Bin 3), not in:
- the central application (Bin 1) — which only formats messages and adds
  straightforward regex links; it does not decide that two partial plates are
  the same vehicle, and
- the data mimic (`generate_reports.py`, `feed_reports.py`) — which must produce
  exactly what Bin 1 produces, no more.

Keep these as a design reference for the re-identification logic when the plugin
is built. Do not run them as part of generating or feeding the synthetic vault —
doing so would make the test data "too clean", handing the analyst answers the
plugin is supposed to compute.
