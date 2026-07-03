/*
 * 7S-analys (Bin 3) — Obsidian shell (Steps 1–2).
 *
 * This file is the ONLY part allowed to touch the Obsidian API, and it keeps
 * that surface minimal by design (PLUGIN_DESIGN §11): read the vault, render
 * into one text panel, register commands, and write the plugin's OWN entity
 * notes. It does NOT touch the graph, Map View, or workspace-layout APIs.
 *
 * Write contract (§5): never touches message/operator files; only creates and
 * overwrites files it owns (`generator: 7s-plugin`); idempotent. All analysis
 * (parsing, Job A re-id, note rendering) lives in the Obsidian-free core.
 */
import {
  addIcon,
  App,
  FuzzySuggestModal,
  ItemView,
  MarkdownRenderer,
  Menu,
  Modal,
  normalizePath,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import { ParseIssue, parseReport, Report } from "./parse";
import { buildPlateEntities } from "./reid";
import { plateIdentifiers } from "./ids";
import { EmbeddedPlateVision, corroboratePlate, PlateVision } from "./vision";
import { isOverwritable, isPluginOwned, renderAll, safeFilename } from "./entity_notes";
import { buildMarkNominations, JobBResult, MarkNomination } from "./jobb";
import { markFilename, renderMarkNote } from "./mark_notes";
import { KB, QueryAnswer } from "./query";
import { ActorHypothesis, ActorResult, buildActorHypotheses } from "./actor";
import { actorFilename, renderActorNote } from "./actor_notes";
import { analyzeSuspicion, DEFAULT_SUSPICION, SuspicionAnalysis } from "./suspicion";
import { Alert, AnalysisBundle, computeAlertItems, newAlerts } from "./alerts";
import { buildSuspects, suspectHypotheses, suspectHypId, isActorCandidate } from "./suspects";
import { renderSuspectNotes } from "./suspect_notes";
import { buildLocations, renderLocationNotes, LocationCluster } from "./location_notes";
import { isMgrsGrid, placeLabel } from "./places";
import { mgrsToLatLon } from "./mgrs";
import { buildFeed, FeedItem, FeedRow } from "./feed";
import { suspicionLevel, reasonPhrases } from "./present";
import { Conversation, converse, DeterministicConversation } from "./conversation";

type MarkDecision = "confirmed" | "rejected";
type ActorDecision = "confirmed" | "rejected";

interface SevenSSettings {
  /** Vault-relative folder holding 7S messages. Empty = whole vault. */
  reportsFolder: string;
  /** Vault-relative folder the plugin writes its entity notes into. */
  entitiesFolder: string;
  /** Operator decisions on Job B nominations, keyed by nomination signature. */
  markDecisions: Record<string, MarkDecision>;
  /** Operator decisions on actor hypotheses (§6.4), keyed by hypothesis id. */
  actorDecisions: Record<string, ActorDecision>;
  /** Evidence threshold for actor derivation (§9.3-A parameter request). */
  actorThreshold: number;
  /** Protected object (skyddsobjekt) coords for the suspicion proximity signal. */
  protectedLat: number;
  protectedLon: number;
  /** Live vault watcher → alerts-with-pointer on new activity (§7.2/§9.1). */
  watcherEnabled: boolean;
  /** Alert keys already surfaced (so only NEW activity raises a notice). */
  seenAlerts: Record<string, true>;
  /** Auto-materialize Job A vehicle entities on recompute (CERTAIN ID matches,
   *  §5.5/§6.1 — safe to auto-write). Job B/actors stay confirmation-gated. */
  autoBuildEntities: boolean;
  /** Materialize elevated suspicion observations as `larm-*` marker notes so
   *  they show in the graph + Map View (red). Deterministic finding → safe. */
  materializeAlerts: boolean;
  /** Chat engine: deterministic keyword parser, or local LLM (Ollama, later). */
  engine: "deterministic" | "llm";
  /** Operator nicknames for locations, keyed by the raw `plats` (MGRS) string.
   *  Display-only (never written into message files); the grid stays the identity. */
  locationNicknames: Record<string, string>;
  /** MGRS grids the operator has already been asked to name (named or skipped),
   *  so the "Namnge plats" feed nudge doesn't keep reappearing. */
  locationNameAsked: Record<string, true>;
}

const DEFAULT_SETTINGS: SevenSSettings = {
  reportsFolder: "", // whole vault; reports are identified by frontmatter, not folder
  entitiesFolder: "entities",
  markDecisions: {},
  actorDecisions: {},
  actorThreshold: 1,
  protectedLat: DEFAULT_SUSPICION.protectedLat,
  protectedLon: DEFAULT_SUSPICION.protectedLon,
  watcherEnabled: true,
  seenAlerts: {},
  autoBuildEntities: true,
  materializeAlerts: true,
  engine: "deterministic",
  locationNicknames: {},
  locationNameAsked: {},
};

const VIEW_TYPE_7S = "7s-analys-text";

// Custom ODEN ribbon/view icon — a stylized raven head in a compass ring,
// monochrome (currentColor) so it themes. Registered via addIcon("oden", …).
const ODEN_ICON_ID = "oden";
const ODEN_ICON_SVG =
  '<circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" stroke-width="5"/>' +
  '<path d="M50 4 L57 19 L43 19 Z" fill="currentColor"/>' +
  '<path d="M96 50 L81 57 L81 43 Z" fill="currentColor"/>' +
  '<path fill="currentColor" fill-rule="evenodd" d="M70 41 C69 30 57 23 46 27 ' +
  'C39 30 34 36 27 40 L12 46 L28 50 C32 59 41 64 51 62 C63 60 70 51 70 41 Z ' +
  'M55 39 a3 3 0 1 0 -6 0 a3 3 0 1 0 6 0 Z"/>';

/** Read the `metod:` tag from a plugin-owned note's frontmatter (for per-job
 *  pruning). Returns "" if absent. */
function ownedMetod(text: string): string {
  const m = text.slice(0, 600).match(/(^|\n)metod:\s*([^\n]+)/);
  return m ? m[2].trim() : "";
}

export default class SevenSPlugin extends Plugin {
  settings: SevenSSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    addIcon(ODEN_ICON_ID, ODEN_ICON_SVG);
    this.registerView(VIEW_TYPE_7S, (leaf) => new SevenSTextView(leaf, this));

    this.addCommand({
      id: "index-and-summarise",
      name: "ODEN: Indexera och sammanfatta",
      callback: () => void this.runSummary(),
    });

    this.addCommand({
      id: "build-entities-job-a",
      name: "ODEN: Identifiera återkommande fordon",
      callback: () => void this.runBuildEntities(),
    });

    this.addCommand({
      id: "mark-nominations-job-b",
      name: "ODEN: Föreslå kännetecken-kopplingar",
      callback: () => void this.runMarkNominations(),
    });

    this.addCommand({
      id: "query-interface",
      name: "ODEN: Fråga ODEN",
      callback: () => void this.openQueryInterface(),
    });

    this.addCommand({
      id: "reset-mark-decisions",
      name: "ODEN: Nollställ kännetecken-beslut",
      callback: () => void this.resetMarkDecisions(),
    });

    this.addCommand({
      id: "derive-actors",
      name: "ODEN: Härled aktörer",
      callback: () => void this.runDeriveActors(),
    });

    this.addCommand({
      id: "suspicion-analysis",
      name: "ODEN: Misstankeanalys",
      callback: () => void this.runSuspicion(),
    });

    this.addCommand({
      id: "show-alerts",
      name: "ODEN: Visa larm",
      callback: () => void this.runShowAlerts(),
    });

    this.addRibbonIcon(ODEN_ICON_ID, "ODEN — indexera & sammanfatta", () =>
      void this.runSummary(),
    );

    this.addSettingTab(new SevenSSettingTab(this.app, this));

    // Live watcher (§9.1): recompute on vault changes (debounced); baseline once
    // the layout is ready so the existing corpus does NOT flood the operator.
    this.registerVaultWatcher();
    this.app.workspace.onLayoutReady(async () => {
      // Rewrite confirmed actors in the current format/name and prune stale twins
      // (self-heals notes written by an older version), then baseline the watcher.
      await this.reconcileActorNodes();
      await this.baselineAlerts();
    });
  }

  onunload(): void {
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    // Obsidian does NOT detach custom views on plugin unload — without this, a
    // plugin reload (toggle off/on) leaves an ORPHANED panel bound to the dead
    // plugin instance, so every button silently does nothing. Detach so the
    // panel is recreated fresh against the live plugin on re-enable.
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_7S);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Read-only: collect message files under the configured folder. */
  private messageFiles(): TFile[] {
    const folder = this.settings.reportsFolder.replace(/\/+$/, "");
    const files = this.app.vault.getMarkdownFiles();
    if (folder === "") return files;
    const prefix = folder + "/";
    return files.filter((f) => f.path === folder || f.path.startsWith(prefix));
  }

  /** Open the ODEN panel (feed + chat). */
  async runSummary(): Promise<void> {
    await this.revealPanel();
    await this.refreshPanel();
  }

  /** Read all 7S reports (read-only) into the in-memory model. Reports are
   *  identified by frontmatter `typ: 7S-rapport` — NOT by folder — so the
   *  plugin works wherever Bin 1 / the feeder drops the notes, and never
   *  ingests its own generated entity/actor/dialog notes. The folder setting,
   *  if non-empty, only NARROWS the scan. */
  private async readReports(): Promise<{ reports: Report[]; issues: ParseIssue[] }> {
    const issues: ParseIssue[] = [];
    const reports: Report[] = [];
    for (const file of this.messageFiles()) {
      const text = await this.app.vault.cachedRead(file);
      const fileIssues: ParseIssue[] = [];
      const r = parseReport(text, file.path, fileIssues);
      if (r.typ !== "7S-rapport") continue; // skip non-reports (entities, dialog, operator notes)
      reports.push(r);
      issues.push(...fileIssues);
    }
    return { reports, issues };
  }

  /** Job A: build vehicle entities and write provenance-marked notes (§5). */
  async runBuildEntities(): Promise<void> {
    try {
      const { reports } = await this.readReports();
      const result = buildPlateEntities(reports);
      const confirmed = await this.computePlateCorroboration(reports);
      const notes = renderAll(result.entities, confirmed);
      const write = await this.writeOwnedNotes(
        notes.map((n) => ({ name: n.filename, body: n.markdown })),
        "jobb-a",
      );
      await this.revealPanel();
      await this.refreshPanel();
      const camN = confirmed.size;
      new Notice(
        `ODEN: ${result.entities.length} fordon (${write.written} uppdaterade)` +
          (camN ? ` · 📷 ${camN} bildstyrkta plåtar.` : "."),
      );
    } catch (err) {
      console.error("ODEN: build entities failed", err);
      new Notice("ODEN: kunde inte bygga entiteter (se konsolen).");
    }
  }

  /**
   * Write the plugin's own notes under the entities folder, enforcing §5:
   *  - only ever create/overwrite files we OWN (generator: 7s-plugin);
   *  - never clobber a same-named file we don't own (skip + report);
   *  - idempotent (skip writes when content is byte-identical);
   *  - prune owned files of THIS job (`metod`) no longer derived. Per-job
   *    pruning so a Job A run never deletes confirmed Job B mark notes.
   */
  private async writeOwnedNotes(
    notes: { name: string; body: string }[],
    metod: string,
  ): Promise<{ written: number; unchanged: number; pruned: number; skipped: string[] }> {
    const vault = this.app.vault;
    const folder = this.settings.entitiesFolder.replace(/\/+$/, "");
    if (folder !== "" && !vault.getAbstractFileByPath(folder)) {
      await vault.createFolder(folder).catch(() => {});
    }
    const pathOf = (name: string) => normalizePath(folder === "" ? name : `${folder}/${name}`);

    let written = 0;
    let unchanged = 0;
    const skipped: string[] = [];
    const desired = new Set(notes.map((n) => pathOf(n.name)));

    for (const note of notes) {
      const path = pathOf(note.name);
      const existing = vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) {
        const current = await vault.read(existing);
        // Overwrite only files we own OR empty junk (a stray 0-byte file would
        // otherwise block us forever — see isOverwritable). Real user notes are
        // protected (§5.1/§5.2).
        if (!isOverwritable(current)) {
          skipped.push(path); // not ours — never touch
          desired.delete(path);
          continue;
        }
        if (current === note.body) {
          unchanged++; // idempotent (§5.4)
          continue;
        }
        await vault.modify(existing, note.body);
        written++;
      } else if (existing) {
        skipped.push(path); // a folder or non-file occupies the path
        desired.delete(path);
      } else {
        await vault.create(path, note.body);
        written++;
      }
    }

    // Prune plugin-owned notes OF THIS JOB that are no longer derived. Notes of
    // another job (different `metod`) are left untouched.
    let pruned = 0;
    if (folder !== "") {
      const prefix = folder + "/";
      for (const f of vault.getMarkdownFiles()) {
        if (!(f.path === folder || f.path.startsWith(prefix))) continue;
        if (desired.has(f.path)) continue;
        const text = await vault.read(f);
        if (isPluginOwned(text) && ownedMetod(text) === metod) {
          await vault.delete(f);
          pruned++;
        }
      }
    }

    return { written, unchanged, pruned, skipped };
  }

  // --- Job B: descriptive-mark nominations (nominate-only, §6.1) -------------

  private lastJobB: JobBResult | null = null;

  /** Build Job B nominations and render them with confirm/reject controls. */
  async runMarkNominations(): Promise<void> {
    try {
      const { reports } = await this.readReports();
      this.lastJobB = buildMarkNominations(reports);
      await this.revealMarkNominations();
      const open = this.openNominations().length;
      new Notice(`ODEN: ${this.lastJobB.nominations.length} kännetecken-förslag (${open} att granska).`);
    } catch (err) {
      console.error("ODEN: mark nominations failed", err);
      new Notice("ODEN: kunde inte söka kännetecken (se konsolen).");
    }
  }

  /** Nominations not yet decided by the operator. */
  private openNominations(): MarkNomination[] {
    if (!this.lastJobB) return [];
    return this.lastJobB.nominations.filter((n) => !this.settings.markDecisions[n.signature]);
  }

  /** Operator confirms a nomination → materialize the mark entity note (§5). */
  async confirmNomination(signature: string): Promise<void> {
    const nom = this.lastJobB?.nominations.find((n) => n.signature === signature);
    if (!nom) return;
    const note = renderMarkNote(nom);
    const res = await this.writeOwnedNotes([{ name: note.filename, body: note.markdown }], "jobb-b");
    if (res.skipped.length) {
      new Notice("ODEN: kunde inte skriva märkesnot (ej plugin-ägd fil på samma namn).");
      return;
    }
    this.settings.markDecisions[signature] = "confirmed";
    await this.saveSettings();
    await this.revealMarkNominations();
    new Notice(`ODEN: bekräftade kännetecken "${nom.label}" → nod skapad.`);
  }

  /** Operator rejects a nomination → suppress it; remove any owned note. */
  async rejectNomination(signature: string): Promise<void> {
    const nom = this.lastJobB?.nominations.find((n) => n.signature === signature);
    this.settings.markDecisions[signature] = "rejected";
    await this.saveSettings();
    if (nom) await this.deleteOwnedNote(markFilename(nom));
    await this.revealMarkNominations();
    new Notice("ODEN: förslag avvisat (dolt).");
  }

  /** Clear ALL operator mark decisions (in memory + persisted) and remove every
   *  plugin-owned Job B mark note. The single-click reset for incremental
   *  testing — no plugin toggle / restart needed (the in-memory state is the
   *  source of truth while loaded, so we must clear THAT, not just data.json). */
  async resetMarkDecisions(): Promise<void> {
    const n = Object.keys(this.settings.markDecisions).length;
    this.settings.markDecisions = {};
    await this.saveSettings();

    let removed = 0;
    const folder = this.settings.entitiesFolder.replace(/\/+$/, "");
    const prefix = folder + "/";
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (folder !== "" && !(f.path === folder || f.path.startsWith(prefix))) continue;
      const text = await this.app.vault.read(f);
      if (isPluginOwned(text) && ownedMetod(text) === "jobb-b") {
        await this.app.vault.delete(f);
        removed++;
      }
    }

    if (this.lastJobB) await this.revealMarkNominations();
    new Notice(`ODEN: nollställde ${n} märkesbeslut, tog bort ${removed} kännetecken-noter.`);
  }

  /** Clear ALL actor confirm/reject decisions — so nothing is treated as confirmed
   *  without a fresh human click. Useful after resetting the message corpus, where
   *  a persisted decision would otherwise auto-apply to a re-derived agent (the
   *  decision key is the stable agent identity). Deletes any orphaned empty/owned
   *  actor notes, then reconciles so pending agents show as red markers again. */
  async resetActorDecisions(): Promise<void> {
    const n = Object.keys(this.settings.actorDecisions).length;
    this.settings.actorDecisions = {};
    await this.saveSettings();

    // Remove owned actor notes AND stray empty files in the entities folder (an
    // empty file isn't plugin-owned, so the normal prune would leave it behind).
    let removed = 0;
    const folder = this.settings.entitiesFolder.replace(/\/+$/, "");
    const prefix = folder + "/";
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (folder !== "" && !(f.path === folder || f.path.startsWith(prefix))) continue;
      const text = await this.app.vault.read(f);
      if (text.trim() === "" || (isPluginOwned(text) && ownedMetod(text) === "aktor")) {
        await this.app.vault.delete(f);
        removed++;
      }
    }

    await this.reconcileActorNodes(); // nothing confirmed now → only red markers remain
    if (this.lastActors) await this.revealActors();
    new Notice(`ODEN: nollställde ${n} aktörsbeslut, tog bort ${removed} aktörsnoter.`);
  }

  // --- Location nicknames (operator names for MGRS grids) --------------------

  /** Best-effort assist (bends §7.3 on explicit operator action only): center the
   *  already-open Map View on a coordinate so the operator can see where they are
   *  naming. Feature-detected + try/caught: if Map View is absent or its API
   *  changes, naming still works, just without the zoom. `dedicatedPane` reuses
   *  the open map leaf rather than replacing the active (ODEN) panel. */
  private focusMapOn(lat: number, lon: number): void {
    try {
      const mv = (this.app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins?.[
        "obsidian-map-view"
      ] as { openMapWithState?: (s: unknown, b: string, f: boolean) => unknown; settings?: { zoomOnGoFromNote?: number } } | undefined;
      if (!mv || typeof mv.openMapWithState !== "function") return;
      const mapZoom = mv.settings?.zoomOnGoFromNote ?? 15;
      void mv.openMapWithState({ mapCenter: { lat, lng: lon }, mapZoom }, "dedicatedPane", false);
    } catch (err) {
      console.warn("ODEN: could not focus Map View", err);
    }
  }

  /** Open the naming dialog for one MGRS grid; persist and re-render all notes so
   *  the nickname shows in the graph + notes. "Skip" just records the ask. */
  promptLocationName(grid: string): void {
    const current = this.settings.locationNicknames[grid] ?? "";
    // Show the operator WHERE this grid is on the map, to help them pick a name.
    const ll = mgrsToLatLon(grid);
    if (ll) this.focusMapOn(ll.lat, ll.lon);
    new NameLocationModal(
      this.app,
      grid,
      current,
      ll,
      () => {
        if (ll) this.focusMapOn(ll.lat, ll.lon); // "visa på karta igen"
      },
      async (name) => {
        this.settings.locationNameAsked[grid] = true;
        if (name !== null) {
          const n = name.trim();
          if (n) this.settings.locationNicknames[grid] = n;
          else delete this.settings.locationNicknames[grid];
        }
        await this.saveSettings();
        await this.reconcileActorNodes(); // rewrites location/suspect/actor notes with the name
        await this.refreshPanel();
      },
    ).open();
  }

  /** ⋯ menu / command: pick any relevant MGRS location to name or rename. */
  async openLocationNamer(): Promise<void> {
    const { reports } = await this.readReports();
    const locs = buildLocations(reports, analyzeSuspicion(reports, this.suspicionOpts())).filter((c) =>
      isMgrsGrid(c.key),
    );
    if (!locs.length) {
      new Notice("ODEN: inga MGRS-platser att namnge.");
      return;
    }
    new PickLocationModal(this.app, locs, this.settings.locationNicknames, (grid) =>
      this.promptLocationName(grid),
    ).open();
  }

  /** Reset a prior decision so the nomination is reviewable again. */
  async resetNominationDecision(signature: string): Promise<void> {
    const nom = this.lastJobB?.nominations.find((n) => n.signature === signature);
    const prior = this.settings.markDecisions[signature];
    delete this.settings.markDecisions[signature];
    await this.saveSettings();
    // If it had been confirmed, remove the now-unconfirmed note.
    if (prior === "confirmed" && nom) await this.deleteOwnedNote(markFilename(nom));
    await this.revealMarkNominations();
  }

  /** Delete a single plugin-owned note by filename (ownership-checked). */
  private async deleteOwnedNote(filename: string): Promise<void> {
    const folder = this.settings.entitiesFolder.replace(/\/+$/, "");
    const path = normalizePath(folder === "" ? filename : `${folder}/${filename}`);
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) {
      const text = await this.app.vault.read(f);
      if (isPluginOwned(text)) await this.app.vault.delete(f);
    }
  }

  private async revealMarkNominations(): Promise<void> {
    const leaf = await this.getPanelLeaf();
    const view = leaf.view;
    if (view instanceof SevenSTextView && this.lastJobB) {
      await view.renderNominations(this.lastJobB, this.settings.markDecisions);
    }
  }

  // --- Step 4: deterministic text query interface (§7.1) ---------------------

  /** Build a knowledge-base snapshot of the CURRENT vault state. Reflects
   *  gradual buildup: only reports that exist now + operator-CONFIRMED marks. */
  private async buildKB(): Promise<KB> {
    const { reports } = await this.readReports();
    const vehicles = buildPlateEntities(reports).entities;
    const jobB = buildMarkNominations(reports);
    const marks = jobB.nominations.filter((n) => this.settings.markDecisions[n.signature] === "confirmed");
    return { reports, vehicles, marks };
  }

  async openQueryInterface(): Promise<void> {
    await this.revealPanel();
  }

  /** One chat turn: engine translates → execute → engine narrates → show in
   *  chat + log the dialogue (write-wall: only the dialog log is written). */
  async answerQuery(raw: string): Promise<void> {
    const trimmed = raw.trim();
    if (!trimmed) return;
    try {
      const kb = await this.buildKB();
      const { answer, prose } = await converse(this.engine, trimmed, kb);
      await this.logDialogue(answer);
      await this.revealPanel();
      const view = this.getView();
      if (view) await view.addChat(trimmed, prose);
    } catch (err) {
      console.error("ODEN: query failed", err);
      new Notice("ODEN: frågan kunde inte besvaras (se konsolen).");
    }
  }

  /** Append the turn (query + interpreted query + answer) to a plugin-owned
   *  dialog note — the §7.1 "loggad dialog" audit trail. */
  private async logDialogue(answer: QueryAnswer): Promise<void> {
    const folder = this.settings.entitiesFolder.replace(/\/+$/, "");
    const path = normalizePath(folder === "" ? "7s-dialog.md" : `${folder}/7s-dialog.md`);
    const vault = this.app.vault;
    const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
    const turn = [
      `## ${stamp}`,
      `**Fråga:** ${answer.query.raw}`,
      `**Tolkad query:** \`${answer.query.echo}\``,
      `**Träffar:** ${answer.rowCount}`,
      "",
      answer.markdown,
      "",
      "---",
      "",
    ].join("\n");

    const existing = vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      const cur = await vault.read(existing);
      if (!isPluginOwned(cur)) return; // never clobber a non-owned file
      await vault.modify(existing, cur + "\n" + turn);
    } else if (!existing) {
      if (folder !== "" && !vault.getAbstractFileByPath(folder)) await vault.createFolder(folder).catch(() => {});
      const header = [
        "---",
        "typ: dialog",
        "källa: 7s-plugin",
        "generator: 7s-plugin",
        "metod: dialog",
        "taggar: [dialog]",
        "---",
        "",
        "# ODEN — fråge-dialog (granskningsspår)",
        "",
      ].join("\n");
      await vault.create(path, header + turn);
    }
  }

  // --- §6.4: transitive actor derivation -------------------------------------

  private lastActors: ActorResult | null = null;

  async runDeriveActors(): Promise<void> {
    try {
      const { reports } = await this.readReports();
      const suspicion = analyzeSuspicion(reports, this.suspicionOpts());
      this.lastActors = this.mergedActors(reports, suspicion);
      await this.revealActors();
      new Notice(
        `ODEN: ${this.lastActors.hypotheses.length} aktörsförslag att granska (känslighet ${this.settings.actorThreshold}).`,
      );
    } catch (err) {
      console.error("ODEN: actor derivation failed", err);
      new Notice("ODEN: kunde inte härleda aktörer (se konsolen).");
    }
  }

  /** Change the evidence threshold (§9.3-A) and recompute. */
  async setActorThreshold(t: number): Promise<void> {
    this.settings.actorThreshold = Math.max(1, Math.floor(t) || 1);
    await this.saveSettings();
    await this.runDeriveActors();
  }

  async confirmActor(id: string): Promise<void> {
    const h = this.lastActors?.hypotheses.find((x) => x.id === id);
    if (!h) return;
    this.settings.actorDecisions[id] = "confirmed";
    await this.saveSettings();
    // Write the WHOLE confirmed set (prune-safe) + drop any red marker for the now
    // -confirmed agent so it appears as a single blue actor node (merge, not twin).
    await this.reconcileActorNodes();
    await this.revealActors();
    new Notice(`ODEN: bekräftade aktör (${h.vehicleCount} fordon, ${h.markCount} kännetecken) → nod skapad.`);
  }

  async rejectActor(id: string): Promise<void> {
    this.settings.actorDecisions[id] = "rejected";
    await this.saveSettings();
    await this.reconcileActorNodes();
    await this.revealActors();
    new Notice("ODEN: aktörsförslag avvisat (dolt).");
  }

  async resetActorDecision(id: string): Promise<void> {
    delete this.settings.actorDecisions[id];
    await this.saveSettings();
    await this.reconcileActorNodes();
    await this.revealActors();
  }

  /** Re-read the vault and materialize both agent layers (confirmed actors +
   *  suspect markers). Used by the decision handlers. */
  private async reconcileActorNodes(): Promise<void> {
    const { reports } = await this.readReports();
    await this.materializeAgents(reports, analyzeSuspicion(reports, this.suspicionOpts()));
  }

  /** Materialize BOTH agent layers from an already-computed analysis:
   *   - confirmed actors (blue #aktör) — the full confirmed set (prune removes
   *     rejected/reset ones). Always written (a human decision, not gated by the
   *     alert toggle) so a confirmed agent has a graph node as soon as it appears.
   *   - suspect markers (red #larm) — pending agents only (confirmed excluded).
   *  Called from baseline, the live watcher, suspicion, and the decision handlers
   *  so the two layers stay consistent no matter what triggered the recompute. */
  private async materializeAgents(reports: Report[], suspicion: SuspicionAnalysis): Promise<void> {
    await this.writeOwnedNotes(this.confirmedActorNotesFrom(reports, suspicion), "aktor");
    await this.writeSuspectNotes(reports, suspicion);
    await this.writeLocationNotes(reports, suspicion);
  }

  /** One graph/map node per RELEVANT location (suspicious activity or a vehicle),
   *  linking the reports observed there so the place shows as a spatial hub. */
  private async writeLocationNotes(reports: Report[], s: SuspicionAnalysis): Promise<void> {
    if (!this.settings.materializeAlerts) return;
    const notes = renderLocationNotes(buildLocations(reports, s), this.settings.locationNicknames).map((n) => ({ name: n.filename, body: n.markdown }));
    await this.writeOwnedNotes(notes, "plats");
  }

  private async revealActors(): Promise<void> {
    const leaf = await this.getPanelLeaf();
    const view = leaf.view;
    if (view instanceof SevenSTextView && this.lastActors) {
      await view.renderActors(this.lastActors, this.settings.actorDecisions, this.settings.actorThreshold);
    }
  }

  // --- Step 6: transparent suspicion analysis (§6.5/§6.6) --------------------

  async runSuspicion(): Promise<void> {
    try {
      const { reports } = await this.readReports();
      const a = analyzeSuspicion(reports, this.suspicionOpts());
      await this.materializeAgents(reports, a);
      await this.revealPanel();
      await this.refreshPanel();
      new Notice(`ODEN: ${a.elevated.length} förhöjda observationer; ${a.nearObjectElevated} nära skyddsobjekt.`);
    } catch (err) {
      console.error("ODEN: suspicion analysis failed", err);
      new Notice("ODEN: kunde inte göra misstankeanalys (se konsolen).");
    }
  }

  // --- Step 5: vault watcher + alerts-with-pointer (§7.2/§9.1) ---------------

  private debounceTimer: number | null = null;
  private lastAlerts: Alert[] = [];

  private suspicionOpts() {
    return {
      protectedLat: this.settings.protectedLat,
      protectedLon: this.settings.protectedLon,
      threshold: DEFAULT_SUSPICION.threshold,
    };
  }

  /** Build the full analysis bundle (read-only). */
  private async analyzeBundle(): Promise<AnalysisBundle> {
    const { reports } = await this.readReports();
    const suspicion = analyzeSuspicion(reports, this.suspicionOpts());
    return {
      reports,
      suspicion,
      jobB: buildMarkNominations(reports),
      actors: this.mergedActors(reports, suspicion),
      jobA: buildPlateEntities(reports),
    };
  }

  // --- Panel glue: feed + chat + engine + menu (operator UI) -----------------

  private engine: Conversation = new DeterministicConversation();

  /** The open ODEN view, if any. */
  private getView(): SevenSTextView | null {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_7S)[0];
    return leaf && leaf.view instanceof SevenSTextView ? leaf.view : null;
  }

  /** Open/focus the panel (the view's onOpen calls refreshPanel). */
  private async revealPanel(): Promise<void> {
    await this.getPanelLeaf();
  }

  /** Build the live event/alarm feed items from current analysis + vault notes. */
  private buildFeedItems(bundle: AnalysisBundle): FeedItem[] {
    const folder = this.settings.entitiesFolder.replace(/\/+$/, "");
    const inFolder = (name: string) => (folder ? `${folder}/${name}` : name);
    const ms = (t: string) => Date.parse(t) || 0;
    const items: FeedItem[] = [];

    // Feed shows DERIVED events only (identifications + alarms), not raw
    // "message received" rows.
    // Identified vehicles (Job A entity notes).
    for (const e of bundle.jobA.entities) {
      items.push({
        path: inFolder(safeFilename(e.canonical)),
        kind: "fordon",
        time: ms(e.lastSeen),
        label: e.canonical,
        count: e.count,
        photo: this.lastCorroboration.has(e.canonical),
      });
    }
    // Confirmed marks / actors.
    for (const n of bundle.jobB.nominations) {
      if (this.settings.markDecisions[n.signature] === "confirmed") {
        items.push({ path: inFolder(markFilename(n)), kind: "kännetecken", time: ms(n.lastSeen), label: n.label });
      }
    }
    for (const h of bundle.actors.hypotheses) {
      if (this.settings.actorDecisions[h.id] === "confirmed") {
        items.push({ path: inFolder(actorFilename(h)), kind: "aktör", time: ms(h.lastSeen), label: `${h.vehicleCount} fordon + ${h.markCount} kännetecken` });
      }
    }
    // Alarms (link to the observation itself).
    for (const row of bundle.suspicion.elevated) {
      items.push({
        path: row.file,
        kind: "larm",
        time: ms(row.tidpunkt),
        plats: placeLabel(row.plats, this.settings.locationNicknames),
        level: suspicionLevel(row.score),
        reasons: reasonPhrases(row.reasons),
      });
    }

    // Pending suggestions awaiting operator review — pinned to the top so they
    // are visible (click → the confirm/reject review). Human-gated (§6.1).
    const pendingActors = bundle.actors.hypotheses.filter((h) => !this.settings.actorDecisions[h.id]).length;
    const pendingMarks = bundle.jobB.nominations.filter((n) => !this.settings.markDecisions[n.signature]).length;
    if (pendingActors > 0) {
      items.push({ path: "review:actors", kind: "förslag-aktör", time: Number.MAX_SAFE_INTEGER, pending: pendingActors, review: "actors" });
    }
    if (pendingMarks > 0) {
      items.push({ path: "review:marks", kind: "förslag-märke", time: Number.MAX_SAFE_INTEGER - 1, pending: pendingMarks, review: "marks" });
    }

    // Nudge: relevant locations that are still a bare MGRS grid and haven't been
    // named/skipped yet — click to give them a nickname (§ operator naming).
    let t = Number.MAX_SAFE_INTEGER - 2;
    for (const c of buildLocations(bundle.reports, bundle.suspicion)) {
      if (!isMgrsGrid(c.key)) continue; // already has a human-friendly place name
      if (this.settings.locationNicknames[c.key] || this.settings.locationNameAsked[c.key]) continue;
      items.push({ path: `review:place:${c.key}`, kind: "namnge-plats", time: t--, place: c.key, review: "place" });
    }
    return items;
  }

  /** Recompute and refresh the feed in the open panel (no alert notices). This is
   *  the EXPLICIT path (back button, ⋯ menu, commands), so it leaves any open
   *  review screen and returns to the live feed. */
  async refreshPanel(): Promise<void> {
    try {
      const bundle = await this.analyzeBundle();
      const view = this.getView();
      if (view) {
        view.enterFeedMode();
        view.setFeed(buildFeed(this.buildFeedItems(bundle)));
      }
    } catch (err) {
      console.error("ODEN: refreshPanel failed", err);
    }
  }

  /** Flip the chat engine (LLM not yet available → graceful fallback). */
  async toggleEngine(): Promise<void> {
    this.settings.engine = this.settings.engine === "llm" ? "deterministic" : "llm";
    await this.saveSettings();
    if (this.settings.engine === "llm") {
      new Notice("LLM-läge ännu ej tillgängligt — använder deterministisk tolkning.");
    }
  }

  /** The ⋯ menu — occasional actions, in operator language. */
  openPanelMenu(evt: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Uppdatera lägesbild").setIcon("refresh-cw").onClick(() => void this.refreshPanel()));
    menu.addItem((i) => i.setTitle("Granska kopplingsförslag").setIcon("link").onClick(() => void this.runMarkNominations()));
    menu.addItem((i) => i.setTitle("Granska aktörsförslag").setIcon("git-fork").onClick(() => void this.runDeriveActors()));
    menu.addItem((i) => i.setTitle("Namnge plats…").setIcon("map-pin").onClick(() => void this.openLocationNamer()));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle("Nollställ kopplingsbeslut").setIcon("trash").onClick(() => void this.resetMarkDecisions()));
    menu.addItem((i) => i.setTitle("Nollställ aktörsbeslut").setIcon("trash-2").onClick(() => void this.resetActorDecisions()));
    menu.showAtMouseEvent(evt);
  }

  /** React to vault changes; full recompute each change handles retroactive
   *  transitive completion (§9.1). Debounced so bulk feeding (auto) is one pass.
   *  Ignores plugin-owned files (entities folder) to avoid self-triggering. */
  private registerVaultWatcher(): void {
    const folder = this.settings.entitiesFolder.replace(/\/+$/, "");
    const relevant = (path: string) =>
      path.endsWith(".md") && !(folder !== "" && (path === folder || path.startsWith(folder + "/")));
    const onChange = (file: { path: string }) => {
      if (!this.settings.watcherEnabled || !relevant(file.path)) return;
      if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
      this.debounceTimer = window.setTimeout(() => void this.recomputeAndAlert(false), 1500);
    };
    this.registerEvent(this.app.vault.on("create", onChange));
    this.registerEvent(this.app.vault.on("modify", onChange));
    this.registerEvent(this.app.vault.on("delete", onChange));
  }

  /** Auto-materialize Job A vehicle entities (CERTAIN matches → safe to write,
   *  §5.5/§6.1). Idempotent; per-job pruning keeps it tidy. Job B/actors stay
   *  confirmation-gated. The watcher ignores the entities folder, so no loop. */
  private async autoBuildJobA(bundle: AnalysisBundle): Promise<void> {
    if (!this.settings.autoBuildEntities) return;
    const confirmed = await this.computePlateCorroboration(bundle.reports);
    const notes = renderAll(bundle.jobA.entities, confirmed).map((n) => ({ name: n.filename, body: n.markdown }));
    await this.writeOwnedNotes(notes, "jobb-a");
  }

  // --- §6.7 image corroboration: a photo confirms a plate typed in the text ----
  private vision: PlateVision = new EmbeddedPlateVision();
  /** canonical plate → observation files whose attached photo backs the plate. */
  private lastCorroboration: Map<string, Set<string>> = new Map();

  /**
   * Read each report's attached photos through the vision adapter and record which
   * observations are photo-corroborated (the read plate matches a plate the human
   * typed in that report). Never introduces a plate the text doesn't already have.
   */
  private async computePlateCorroboration(reports: Report[]): Promise<Map<string, Set<string>>> {
    const byPlate = new Map<string, Set<string>>();
    for (const r of reports) {
      if (!r.bilagor || r.bilagor.length === 0) continue;
      const textPlates = plateIdentifiers(r).filter((p) => !p.partial).map((p) => p.value);
      if (textPlates.length === 0) continue;
      for (const att of r.bilagor) {
        if (!/\.(jpe?g|png)$/i.test(att)) continue;
        const bytes = await this.readAttachment(att, r.file);
        if (!bytes) continue;
        const reading = this.vision.readPlate(bytes);
        if (corroboratePlate(reading, textPlates) === "confirmed" && reading) {
          if (!byPlate.has(reading.plate)) byPlate.set(reading.plate, new Set());
          byPlate.get(reading.plate)!.add(r.file);
        }
      }
    }
    this.lastCorroboration = byPlate;
    return byPlate;
  }

  /** Resolve a `bilagor` name to a vault file and read its bytes (best-effort). */
  private async readAttachment(name: string, fromPath: string): Promise<Uint8Array | null> {
    const tf = this.app.metadataCache.getFirstLinkpathDest(name, fromPath);
    if (!(tf instanceof TFile)) return null;
    try {
      return new Uint8Array(await this.app.vault.readBinary(tf));
    } catch (err) {
      console.warn("ODEN: could not read attachment", name, err);
      return null;
    }
  }

  /** Materialize one marker note per suspicious AGENT (vehicle/person) — the map
   *  + graph then show the agent, not an abstract alarm (#4). Idempotent; per-job
   *  pruning removes agents that are no longer suspicious. Agents already CONFIRMED
   *  as actors are skipped — they live as a single blue actor node instead (no
   *  red marker twin), and the larm prune removes any stale marker. */
  private async writeSuspectNotes(reports: Report[], s: SuspicionAnalysis): Promise<void> {
    if (!this.settings.materializeAlerts) return;
    const suspects = buildSuspects(reports, s).filter(
      (sp) => this.settings.actorDecisions[suspectHypId(sp.key)] !== "confirmed",
    );
    const notes = renderSuspectNotes(suspects, this.settings.locationNicknames).map((n) => ({ name: n.filename, body: n.markdown }));
    await this.writeOwnedNotes(notes, "larm");
  }

  /** Actors = transitive hypotheses (§6.4) PLUS single-observation suspect agents
   *  (#1), deduped so an agent already inside a transitive actor isn't repeated. */
  private mergedActors(reports: Report[], suspicion: SuspicionAnalysis): ActorResult {
    const base = buildActorHypotheses(reports, { threshold: this.settings.actorThreshold });
    const inActors = new Set<string>();
    for (const h of base.hypotheses) for (const f of h.facets) inActors.add(f.id);
    // Only nominate suspects with a behavioural signal or a repeat sighting —
    // proximity+time-only agents stay as map markers, not actor candidates.
    const candidates = buildSuspects(reports, suspicion).filter(isActorCandidate);
    const extra = suspectHypotheses(candidates).filter(
      (h) => !h.facets.some((f) => inActors.has(f.id)),
    );
    return { ...base, hypotheses: [...base.hypotheses, ...extra] };
  }

  /** Render the FULL set of currently-confirmed actor notes from an analysis.
   *  Writing the whole set — rather than a single note — keeps the per-job prune
   *  correct: confirming/rejecting one actor never deletes the others. */
  private confirmedActorNotesFrom(reports: Report[], suspicion: SuspicionAnalysis): { name: string; body: string }[] {
    const hyps = this.mergedActors(reports, suspicion).hypotheses.filter(
      (h) => this.settings.actorDecisions[h.id] === "confirmed",
    );
    return hyps.map((h) => {
      // Single-observation suspects get titled by their agent (not "Aktör (…)").
      const label = h.id.startsWith("suspect-") ? h.explanation : undefined;
      const note = renderActorNote(h, label, this.settings.locationNicknames);
      return { name: note.filename, body: note.markdown };
    });
  }

  /** Seed the seen-set from the CURRENT state, silently — so the watcher alerts
   *  only on activity that arrives AFTER the plugin loaded. */
  private async baselineAlerts(): Promise<void> {
    if (!this.settings.watcherEnabled) return;
    try {
      const bundle = await this.analyzeBundle();
      await this.autoBuildJobA(bundle);
      await this.materializeAgents(bundle.reports, bundle.suspicion);
      const items = computeAlertItems(bundle, this.settings.locationNicknames);
      this.lastAlerts = items;
      let changed = false;
      for (const a of items) if (!(a.key in this.settings.seenAlerts)) { this.settings.seenAlerts[a.key] = true; changed = true; }
      if (changed) await this.saveSettings();
      const view = this.getView();
      if (view) view.setFeed(buildFeed(this.buildFeedItems(bundle)));
    } catch (err) {
      console.error("ODEN: baseline failed", err);
    }
  }

  /** Recompute and surface NEW alerts (silent=true only re-baselines). */
  private async recomputeAndAlert(silent: boolean): Promise<void> {
    try {
      const bundle = await this.analyzeBundle();
      await this.autoBuildJobA(bundle);
      await this.materializeAgents(bundle.reports, bundle.suspicion);
      const items = computeAlertItems(bundle, this.settings.locationNicknames);
      this.lastAlerts = items;
      const fresh = newAlerts(items, this.settings.seenAlerts);
      for (const a of fresh) this.settings.seenAlerts[a.key] = true;
      if (fresh.length) await this.saveSettings();
      const view = this.getView();
      if (view) view.setFeed(buildFeed(this.buildFeedItems(bundle)));
      if (silent || fresh.length === 0) return;
      const top = fresh.slice(0, 2).map((a) => a.title).join(" · ");
      new Notice(`ODEN: ${fresh.length} ny händelse — ${top}${fresh.length > 2 ? " …" : ""}`, 8000);
    } catch (err) {
      console.error("ODEN: recompute/alert failed", err);
    }
  }

  /** Command: open the panel (the feed shows current alarms/events). */
  async runShowAlerts(): Promise<void> {
    await this.revealPanel();
    await this.refreshPanel();
  }

  /** Get (or create) the ODEN panel as a MAIN-AREA tab (draggable). */
  private async getPanelLeaf(): Promise<WorkspaceLeaf> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_7S)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_7S, active: true });
    }
    workspace.revealLeaf(leaf);
    return leaf;
  }
}

/** The plugin's only UI: a passive text panel that renders Markdown (§7.3). */
class SevenSTextView extends ItemView {
  private readonly plugin: SevenSPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: SevenSPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_7S;
  }

  getDisplayText(): string {
    return "ODEN";
  }

  getIcon(): string {
    return ODEN_ICON_ID;
  }

  private feedEl!: HTMLElement;
  private chatLogEl!: HTMLElement;
  /** Whether the feed region currently shows the live feed or a review screen.
   *  While "review", background feed refreshes are suppressed so an incoming
   *  message can't wipe the screen the operator is working in. */
  private mode: "feed" | "review" = "feed";

  async onOpen(): Promise<void> {
    const body = this.containerEl.children[1] as HTMLElement;
    body.empty();
    body.addClass("oden-panel");
    body.style.cssText = "display:flex;flex-direction:column;height:100%;";

    // Header: title · engine toggle · ⋯ menu
    const header = body.createDiv();
    header.style.cssText =
      "display:flex;align-items:center;gap:8px;padding:4px 8px;border-bottom:1px solid var(--background-modifier-border);";
    header.createEl("strong", { text: "ODEN" });
    header.createDiv().style.flex = "1";
    const eng = header.createEl("button");
    const setEng = () => eng.setText(this.plugin.settings.engine === "llm" ? "LLM" : "Deterministisk");
    setEng();
    eng.onclick = async () => {
      await this.plugin.toggleEngine();
      setEng();
    };
    header.createEl("button", { text: "⋯" }).onclick = (e) => this.plugin.openPanelMenu(e);

    // Feed (top, scrollable) — live events + alarms, also hosts review screens.
    this.feedEl = body.createDiv();
    this.feedEl.style.cssText = "flex:1;overflow-y:auto;padding:6px 8px;";

    // Chat (bottom) — always available.
    const chat = body.createDiv();
    chat.style.cssText =
      "display:flex;flex-direction:column;border-top:1px solid var(--background-modifier-border);max-height:45%;";
    this.chatLogEl = chat.createDiv();
    this.chatLogEl.style.cssText = "flex:1;overflow-y:auto;padding:6px 8px;";
    const bar = chat.createDiv();
    bar.style.cssText = "display:flex;gap:6px;padding:6px 8px;";
    const input = bar.createEl("input", { type: "text", placeholder: "Fråga ODEN…" });
    input.style.flex = "1";
    const send = () => {
      const v = input.value.trim();
      if (v) {
        input.value = "";
        void this.plugin.answerQuery(v);
      }
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") send();
    });
    bar.createEl("button", { text: "Skicka" }).onclick = send;

    this.addChatSystem('Skriv en fråga, t.ex. "återkommande fordon", "aktivitet vid grindarna i natt", eller en plåt.');
    void this.plugin.refreshPanel();
  }

  /** Leave a review screen and return to showing the live feed. */
  enterFeedMode(): void {
    this.mode = "feed";
  }

  /** Render the live event/alarm feed (newest first; alarms in red). Suppressed
   *  while a review screen is open so a background refresh can't wipe it. */
  setFeed(rows: FeedRow[]): void {
    if (this.mode === "review") return;
    const el = this.feedEl;
    el.empty();
    el.createEl("div", { text: "Händelser & larm" }).style.cssText = "font-weight:600;opacity:.7;margin-bottom:4px;";
    if (!rows.length) {
      el.createEl("div", { text: "Inga händelser ännu." }).style.opacity = ".6";
      return;
    }
    for (const r of rows) {
      const row = el.createDiv();
      const base =
        r.severity === "review"
          ? "padding:5px 7px;border-radius:4px;cursor:pointer;font-size:.9em;font-weight:600;margin-bottom:3px;color:var(--text-accent);background:var(--background-secondary-alt);border:1px solid var(--background-modifier-border);"
          : "padding:3px 4px;border-radius:4px;cursor:pointer;font-size:.9em;" +
            (r.severity === "larm" ? "color:var(--text-error);font-weight:600;" : "");
      row.style.cssText = base;
      row.setText(r.text);
      row.onclick = () => {
        if (r.review === "actors") void this.plugin.runDeriveActors();
        else if (r.review === "marks") void this.plugin.runMarkNominations();
        else if (r.review === "place" && r.place) this.plugin.promptLocationName(r.place);
        else this.plugin.app.workspace.openLinkText(r.stem, "", false);
      };
      if (r.severity !== "review") {
        row.onmouseenter = () => (row.style.background = "var(--background-modifier-hover)");
        row.onmouseleave = () => (row.style.background = "");
      }
    }
  }

  addChatSystem(text: string): void {
    const d = this.chatLogEl.createDiv();
    d.style.cssText = "opacity:.6;font-size:.85em;margin:4px 0;";
    d.setText(text);
  }

  async addChat(question: string, prose: string): Promise<void> {
    const q = this.chatLogEl.createDiv();
    q.style.cssText = "margin:8px 0 2px;font-weight:600;";
    q.setText("▸ " + question);
    const a = this.chatLogEl.createDiv();
    await MarkdownRenderer.render(this.plugin.app, prose, a, "", this.plugin);
    this.chatLogEl.scrollTop = this.chatLogEl.scrollHeight;
  }

  /** Header (with ← back) for a review screen shown in the feed region. */
  private reviewHead(title: string): HTMLElement {
    this.mode = "review"; // pin the screen until the operator leaves it
    this.feedEl.empty();
    const head = this.feedEl.createDiv();
    head.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:6px;";
    head.createEl("button", { text: "← Tillbaka" }).onclick = () => void this.plugin.refreshPanel();
    head.createEl("strong", { text: title });
    return this.feedEl.createDiv();
  }

  /** Render actor hypotheses (§6.4) with threshold control + confirm/reject. */
  async renderActors(result: ActorResult, decisions: Record<string, ActorDecision>, threshold: number): Promise<void> {
    const content = this.reviewHead("Aktörsförslag att granska");
    content.createEl("p", {
      text: `${result.hypotheses.length} förslag. Bekräfta för att koppla ihop fordon/personer/kännetecken; avvisa för att dölja.`,
    });

    // Sensitivity control (more shared observations = fewer, stronger suggestions).
    const tbar = content.createDiv();
    tbar.style.cssText = "margin:0.4em 0 0.8em 0;display:flex;gap:0.5em;align-items:center;";
    tbar.createSpan({ text: `Känslighet: ${threshold}` });
    tbar.createEl("button", { text: "–" }).onclick = () => void this.plugin.setActorThreshold(threshold - 1);
    tbar.createEl("button", { text: "+" }).onclick = () => void this.plugin.setActorThreshold(threshold + 1);
    tbar.createSpan({ text: "  (höj för färre, starkare förslag)" }).style.fontSize = "0.8em";

    if (result.hypotheses.length === 0) {
      content.createEl("p", { text: "Inga förslag vid denna känslighet. Sänk för att koppla svagare samband." });
      return;
    }

    for (const h of result.hypotheses) {
      const decision = decisions[h.id];
      const card = content.createDiv();
      card.style.border = "1px solid var(--background-modifier-border)";
      card.style.borderRadius = "6px";
      card.style.padding = "0.6em 0.8em";
      card.style.margin = "0.6em 0";

      const status = decision === "confirmed" ? "  ·  ✓ bekräftad" : decision === "rejected" ? "  ·  ✗ avvisad" : "";
      const isSuspect = h.id.startsWith("suspect-");
      const title = isSuspect ? h.explanation : `Aktör: ${h.vehicleCount} fordon + ${h.markCount} kännetecken`;
      const h3 = card.createEl("h3", { text: `${title}${status}` });
      h3.style.margin = "0 0 0.3em 0";

      const span = h.firstSeen && h.lastSeen ? ` · ${h.firstSeen.slice(0, 10)}–${h.lastSeen.slice(0, 10)}` : "";
      card.createEl("div", {
        text: isSuspect
          ? `Misstänkt agent · ${h.chain.length} observation(er)${span}. Verifiera som aktör?`
          : `Kopplas via ${h.chain.length} gemensamma observationer${span}.`,
      }).style.fontSize = "0.85em";

      const facetList = card.createEl("ul");
      for (const f of h.facets) {
        const li = facetList.createEl("li");
        li.appendText(`${f.kind === "fordon" ? "🚗" : "🎒"} `);
        const a = li.createEl("a", { text: f.label });
        a.onclick = () => this.plugin.app.workspace.openLinkText(f.noteStem, "", false);
      }

      const det = card.createEl("details");
      det.createEl("summary", { text: `Evidenskedja (${h.chain.length} meddelanden)` });
      const chain = det.createEl("ul");
      for (const step of h.chain) {
        const li = chain.createEl("li");
        const stem = step.file.replace(/^.*\//, "").replace(/\.md$/, "");
        const a = li.createEl("a", { text: `TNR${step.tnr}` });
        a.onclick = () => this.plugin.app.workspace.openLinkText(stem, "", false);
        li.appendText(` — ${step.tidpunkt} — kopplar: ${step.facets.join(" + ")}`);
      }

      const btns = card.createDiv();
      btns.style.display = "flex";
      btns.style.gap = "0.5em";
      if (!decision) {
        btns.createEl("button", { text: "✓ Bekräfta aktör" }).onclick = () => void this.plugin.confirmActor(h.id);
        btns.createEl("button", { text: "✗ Avvisa" }).onclick = () => void this.plugin.rejectActor(h.id);
      } else {
        btns.createEl("button", { text: "↺ Ångra beslut" }).onclick = () => void this.plugin.resetActorDecision(h.id);
      }
    }
  }

  /** Render mark suggestions with per-suggestion confirm/reject controls. */
  async renderNominations(result: JobBResult, decisions: Record<string, MarkDecision>): Promise<void> {
    const content = this.reviewHead("Kopplingsförslag att granska");
    const open = result.nominations.filter((n) => !decisions[n.signature]);
    content.createEl("p", {
      text: `${result.nominations.length} förslag, ${open.length} att granska. Bekräfta för att skapa ett kännetecken; avvisa för att dölja.`,
    });

    for (const nom of result.nominations) {
      const decision = decisions[nom.signature];
      const card = content.createDiv({ cls: "seven-s-nom" });
      card.style.border = "1px solid var(--background-modifier-border)";
      card.style.borderRadius = "6px";
      card.style.padding = "0.6em 0.8em";
      card.style.margin = "0.6em 0";

      const statusTxt = decision === "confirmed" ? "✓ bekräftad" : decision === "rejected" ? "✗ avvisad" : "";
      const title = card.createEl("h3", {
        text: `${nom.label}  ·  ${nom.count} observationer` + (statusTxt ? `  ·  ${statusTxt}` : ""),
      });
      title.style.margin = "0 0 0.3em 0";

      card.createEl("div", {
        text: `${nom.count} observationer beskriver samma kännetecken.`,
      }).style.fontSize = "0.85em";

      const obs = card.createEl("ul");
      for (const m of nom.members) {
        const li = obs.createEl("li");
        const stem = m.file.replace(/^.*\//, "").replace(/\.md$/, "");
        const a = li.createEl("a", { text: `TNR${m.tnr}` });
        a.onclick = () => this.plugin.app.workspace.openLinkText(stem, "", false);
        li.appendText(` — ${m.tidpunkt} — ${m.plats}`);
      }

      const btns = card.createDiv();
      btns.style.display = "flex";
      btns.style.gap = "0.5em";
      if (!decision) {
        btns.createEl("button", { text: "✓ Bekräfta" }).onclick = () =>
          void this.plugin.confirmNomination(nom.signature);
        btns.createEl("button", { text: "✗ Avvisa" }).onclick = () =>
          void this.plugin.rejectNomination(nom.signature);
      } else {
        btns.createEl("button", { text: "↺ Ångra beslut" }).onclick = () =>
          void this.plugin.resetNominationDecision(nom.signature);
      }
    }
  }
}

class SevenSSettingTab extends PluginSettingTab {
  private readonly plugin: SevenSPlugin;

  constructor(app: App, plugin: SevenSPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Meddelandemapp (valfri)")
      .setDesc(
        "Lämna TOM för att skanna hela vaulten (rekommenderas). Rapporter " +
          "identifieras via frontmatter `typ: 7S-rapport`, inte via mapp. Ange en " +
          "mapp endast om du vill begränsa skanningen.",
      )
      .addText((text) =>
        text
          .setPlaceholder("reports")
          .setValue(this.plugin.settings.reportsFolder)
          .onChange(async (value) => {
            this.plugin.settings.reportsFolder = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Mapp för ODENs noter")
      .setDesc(
        "Mapp (relativt vaulten) där ODEN skriver sina noter. ODEN rör bara sina " +
          "egna filer — dina meddelanden och anteckningar lämnas orörda.",
      )
      .addText((text) =>
        text
          .setPlaceholder("entities")
          .setValue(this.plugin.settings.entitiesFolder)
          .onChange(async (value) => {
            this.plugin.settings.entitiesFolder = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Skyddsobjekt — koordinat")
      .setDesc(
        "Lat,lon för skyddsobjektet (HvSS Vällinge). Används av misstankeanalysen " +
          "för närhets-signalen (haversine). Format: \"lat,lon\".",
      )
      .addText((text) =>
        text
          .setPlaceholder("59.2622,17.7120")
          .setValue(`${this.plugin.settings.protectedLat},${this.plugin.settings.protectedLon}`)
          .onChange(async (value) => {
            const m = value.split(",").map((s) => parseFloat(s.trim()));
            if (m.length === 2 && Number.isFinite(m[0]) && Number.isFinite(m[1])) {
              this.plugin.settings.protectedLat = m[0];
              this.plugin.settings.protectedLon = m[1];
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName("Live-larm (vault-watcher)")
      .setDesc(
        "Bevaka vaulten och larma (text + pekare) när NY misstänkt aktivitet " +
          "anländer. Pluginet öppnar aldrig graf/Map View självt.",
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.watcherEnabled).onChange(async (v) => {
          this.plugin.settings.watcherEnabled = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Bygg fordonsnoder automatiskt")
      .setDesc(
        "Skapa noder för återkommande fordon automatiskt när nya meddelanden " +
          "kommer in (säkra matchningar på registreringsnummer). Kännetecken och " +
          "aktörer bekräftas alltid av operatören — de skrivs aldrig automatiskt.",
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.autoBuildEntities).onChange(async (v) => {
          this.plugin.settings.autoBuildEntities = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Visa larm i graf och karta")
      .setDesc(
        "Skapa en röd markör för varje misstänkt observation (med koordinat) så " +
          "att aktivitet syns i grafvyn och kartan. Avförs automatiskt när " +
          "misstankepoängen faller.",
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.materializeAlerts).onChange(async (v) => {
          this.plugin.settings.materializeAlerts = v;
          await this.plugin.saveSettings();
        }),
      );
  }
}


/** Small dialog to give an MGRS grid a human-friendly nickname (or skip). */
class NameLocationModal extends Modal {
  constructor(
    app: App,
    private grid: string,
    private current: string,
    private coords: { lat: number; lon: number } | null,
    private onShowMap: () => void,
    private onDone: (name: string | null) => void | Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Namnge plats" });
    const sub = contentEl.createEl("p");
    sub.style.cssText = "opacity:.7;margin:0 0 8px;";
    sub.setText(
      this.coords
        ? `MGRS: ${this.grid}  ·  ${this.coords.lat.toFixed(5)}, ${this.coords.lon.toFixed(5)}`
        : `MGRS: ${this.grid}`,
    );
    if (this.coords) {
      const hint = contentEl.createEl("p", {
        text: "Kartan (Map View) har zoomat till platsen — se var den ligger och välj ett namn.",
      });
      hint.style.cssText = "opacity:.7;margin:0 0 8px;font-size:.9em;";
      const showMap = contentEl.createEl("button", { text: "📍 Visa på karta igen" });
      showMap.style.cssText = "margin:0 0 12px;";
      showMap.onclick = () => this.onShowMap();
    }
    const input = contentEl.createEl("input", { type: "text" });
    input.value = this.current;
    input.placeholder = "t.ex. Norra grinden";
    input.style.cssText = "width:100%;margin:0 0 12px;";
    const btns = contentEl.createDiv();
    btns.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";
    const save = btns.createEl("button", { text: "Spara", cls: "mod-cta" });
    const skip = btns.createEl("button", { text: "Hoppa över" });
    const done = (name: string | null) => {
      this.close();
      void this.onDone(name);
    };
    save.onclick = () => done(input.value);
    skip.onclick = () => done(null);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") done(input.value);
    });
    window.setTimeout(() => input.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Fuzzy picker over relevant MGRS locations, to name/rename any of them. */
class PickLocationModal extends FuzzySuggestModal<LocationCluster> {
  constructor(
    app: App,
    private locs: LocationCluster[],
    private nicks: Record<string, string>,
    private onPick: (grid: string) => void,
  ) {
    super(app);
    this.setPlaceholder("Välj plats att namnge…");
  }

  getItems(): LocationCluster[] {
    return this.locs;
  }

  getItemText(c: LocationCluster): string {
    const n = this.nicks[c.key];
    const meta = `${c.reports.length} obs${c.elevatedCount ? `, ${c.elevatedCount} misstänkta` : ""}`;
    return n ? `${n} — ${c.key} (${meta})` : `${c.key} (${meta})`;
  }

  onChooseItem(c: LocationCluster): void {
    this.onPick(c.key);
  }
}
