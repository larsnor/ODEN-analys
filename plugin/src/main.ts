/*
 * ODEN — the Obsidian plugin shell: commands, panel view, vault I/O; analysis
 * logic lives in the pure src/ modules.
 *
 * This file is the ONLY part allowed to touch the Obsidian API, and it keeps
 * that surface minimal by design: read the vault, render into one text panel,
 * register commands, and write the plugin's OWN entity notes. It does NOT
 * touch the graph, Map View, or workspace-layout APIs.
 *
 * Write contract: never touches message/operator files; only creates and
 * overwrites files it owns (`generator: 7s-plugin`); idempotent. All analysis
 * (parsing, plate re-identification, note rendering) lives in the
 * Obsidian-free core.
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
  TFolder,
  WorkspaceLeaf,
} from "obsidian";
import { demoSchedule } from "./demo";
import { ParseIssue, parseMapSeed, parseReport, Report } from "./parse";
import { buildPlateEntities } from "./reid";
import { plateIdentifiers } from "./ids";
import { EmbeddedPlateVision, corroboratePlate, PlateVision } from "./vision";
import { isOverwritable, isPluginOwned, ownedMetod, renderAll, safeFilename } from "./entity_notes";
import { GENERATOR, METOD, OBJEKTET_STEM, noteStem } from "./notes_common";
import { safeAgentFilename } from "./notenames";
import { mdText } from "./mdsafe";
import { buildMarkNominations, JobBResult, MarkNomination } from "./jobb";
import { markFilename, renderMarkNote } from "./mark_notes";
import { executeQuery, KB } from "./query";
import { extractAllCraft } from "./craft";
import { ActorHypothesis, ActorResult, foldActorMerges } from "./actor";
import { analyzeSuspicion, DEFAULT_SUSPICION, OPERATOR_FLAG_SIGNAL, SuspicionAnalysis } from "./suspicion";
import { AnalysisBundle, computeAlertItems, newAlerts } from "./alerts";
import { buildSuspects, suspectHypId } from "./suspects";
import { renderSuspectNotes } from "./suspect_notes";
import { buildLocations, renderLocationNotes, LocationCluster, PredefinedLocation } from "./location_notes";
import { renderRecurrenceNote, RecurrencePair } from "./recurrence_notes";
import { isMgrsGrid, placeLabel } from "./places";
import { LatLon, mgrsToLatLon, parseCoord } from "./mgrs";
import { renderObservation } from "./observation";
import { buildFeed, FeedRow } from "./feed";
import { Conversation, DeterministicConversation, OllamaConversation } from "./conversation";
import {
  PhotoSighting,
  PhotoNomination,
  PROMPT_VERSION,
  sightingToNominations,
  sightingHasFindings,
} from "./photo_analysis";
import {
  TextExtraction,
  TextMarkNomination,
  TextMarkEntry,
  TEXT_PROMPT_VERSION,
  clusterTextMarks,
} from "./text_reasoning";
import { Signal } from "./suspicion";
import { OllamaVision, OllamaText, VISION_MODELS, DEFAULT_VISION_MODEL, DEFAULT_OLLAMA_URL } from "./llm";
import {
  buildFeedItems,
  buildRecurrences,
  buildWatchStatus,
  confirmedActorNotes,
  foldedConfirmedActors,
  locationLinker,
  mergedActors,
  nearestNamelessGrid,
  predefNearLinker,
  stemForKey,
  WatchEntry,
  WatchRow,
} from "./derive";

/** Build stamp injected by esbuild (`define`): git describe + build time. Falls
 *  back for non-bundled runs (tsc/tests never execute this file's runtime). */
declare const __ODEN_BUILD__: string;
const ODEN_BUILD = typeof __ODEN_BUILD__ !== "undefined" ? __ODEN_BUILD__ : "dev";

type MarkDecision = "confirmed" | "rejected";
type ActorDecision = "confirmed" | "rejected";

interface SevenSSettings {
  /** Vault-relative folder holding 7S messages. Empty = whole vault. */
  reportsFolder: string;
  /** Vault-relative folder the plugin writes its entity notes into. */
  entitiesFolder: string;
  /** Operator decisions on mark nominations (jobb-b), keyed by nomination signature. */
  markDecisions: Record<string, MarkDecision>;
  /** Operator decisions on actor hypotheses, keyed by hypothesis id. */
  actorDecisions: Record<string, ActorDecision>;
  /** Operator free-text names for confirmed actors, keyed by hypothesis id.
   *  Read at render time, so the name survives every owned-note reconcile. */
  actorNames: Record<string, string>;
  /** Operator "same actor" merges: absorbed hypothesis id → surviving id. Folded
   *  into one combined node at render time. */
  actorMerges: Record<string, string>;
  /** Operator "same place" merges: absorbed `plats` grid key → surviving key. */
  locationMerges: Record<string, string>;
  /** Operator-predefined places (created at operation setup, before any reports),
   *  keyed by place name: position + vicinity radius + sensitive flag. Reports
   *  within the radius link to the place; sensitive places also feed the suspicion
   *  proximity signal. */
  predefinedLocations: Record<string, PredefinedLocation>;
  /** Evidence threshold for actor derivation. */
  actorThreshold: number;
  /** Protected object (objektet) coords for the suspicion proximity signal. */
  protectedLat: number;
  protectedLon: number;
  /** Live vault watcher → alerts-with-pointer on new activity. */
  watcherEnabled: boolean;
  /** Trim Obsidian's context menus to ODEN's items + a small whitelist —
   *  a preference (not a judgement; survives operation resets). */
  simplifiedMenus: boolean;
  /** Alert keys already surfaced (so only NEW activity raises a notice). */
  seenAlerts: Record<string, true>;
  /** Map-seed notes (Map View "New note here") the operator chose to ignore —
   *  keyed by vault path, so the seed dialog doesn't re-prompt for them. */
  mapSeedHandled: Record<string, true>;
  /** Auto-materialize re-identified vehicle entities (metod jobb-a) on recompute
   *  (CERTAIN ID matches — safe to auto-write). Marks/actors stay
   *  confirmation-gated: the machine nominates, the operator confirms. */
  autoBuildEntities: boolean;
  /** Materialize elevated suspicion observations as `larm-*` marker notes so
   *  they show in the graph + Map View (red). Deterministic finding → safe. */
  materializeAlerts: boolean;
  /** Operator nicknames for locations, keyed by the raw `plats` (MGRS) string.
   *  Display-only (never written into message files); the grid stays the identity. */
  locationNicknames: Record<string, string>;
  /** MGRS grids the operator has already been asked to name (named or skipped),
   *  so the "Namnge plats" feed nudge doesn't keep reappearing. */
  locationNameAsked: Record<string, true>;
  /** Operation / area-of-interest name (the protected object). */
  operationName: string;
  /** Default sägesman (callsign) for observations the operator authors. */
  operatorCallsign: string;
  /** First-run flag — false until the operator sets the area of interest. */
  setupComplete: boolean;
  // --- Vision (local Ollama VLM) — an ADDITIVE capability over the
  //     deterministic core; detection never depends on it. ---
  /** Operation-mode toggle (the 📷 chip). When on, attached photos are analysed. */
  visionEnabled: boolean;
  /** Local Ollama endpoint (configurable so a deployment box can serve remotely). */
  ollamaUrl: string;
  /** Chosen VLM tag from the curated VISION_MODELS list. */
  visionModel: string;
  /** Run-once cache (no-fishing): image-hash → cached sighting + the model/
   *  prompt it was produced under. A recompute NEVER re-hits Ollama; re-analysis
   *  happens only when the model or prompt version changes. */
  photoAnalyses: Record<string, { model: string; promptV: string; sighting: PhotoSighting }>;
  /** Operator-CONFIRMED photo plates, keyed by report file → plates. Injected into
   *  plate re-identification (jobb-a) as if typed (provenance llm-vision + operatör). */
  photoPlates: Record<string, string[]>;
  /** Operator-CONFIRMED photo annotations (vehicle/person descriptions), keyed by
   *  report file. Report-local (never merged across reports). */
  photoAnnotations: Record<string, string[]>;
  /** Operator-CONFIRMED recon behaviour signals from photos, keyed by report file.
   *  Injected into the suspicion score (recon subset only). */
  confirmedBehaviours: Record<string, { key: string; label: string; weight: number }[]>;
  /** Photo nominations the operator dismissed, keyed by `file|item` so they
   *  don't reappear. */
  photoRejected: Record<string, true>;
  /** Reports the operator explicitly flagged as alarms (file-menu "Flagga som
   *  larm"), keyed by report file. Scored via OPERATOR_FLAG_SIGNAL. */
  operatorFlagged: Record<string, true>;
  // --- Text-reasoning + chat (roles 2 & 3, same local model) ---
  /** 💬 chip: LLM refines the query + narrates the deterministic answer. */
  conversationEnabled: boolean;
  /** 📝 chip: LLM extracts open-vocab marks/behaviours the keyword lists miss. */
  textReasoningEnabled: boolean;
  /** Run-once text-extraction cache: content-hash → extraction + model/prompt. */
  textExtractions: Record<string, { model: string; promptV: string; extraction: TextExtraction }>;
  /** Operator-CONFIRMED text-mark nominations, keyed by normalised mark key. */
  textMarksConfirmed: Record<string, true>;
  /** 🔭 Bevakningslista — operator "keep an eye on this" nominations, keyed
   *  `<kind>:<ref>`. Visibility only (panel + feed); never feeds the score. */
  watchlist: Record<string, WatchEntry>;
  /** Text findings the operator dismissed (`mark|<key>` or `<file>|<behaviourKey>`). */
  textRejected: Record<string, true>;
}

const DEFAULT_SETTINGS: SevenSSettings = {
  reportsFolder: "", // whole vault; reports are identified by frontmatter, not folder
  entitiesFolder: "entities",
  markDecisions: {},
  actorDecisions: {},
  actorNames: {},
  actorMerges: {},
  locationMerges: {},
  predefinedLocations: {},
  actorThreshold: 1,
  protectedLat: DEFAULT_SUSPICION.protectedLat,
  protectedLon: DEFAULT_SUSPICION.protectedLon,
  watcherEnabled: true,
  simplifiedMenus: true,
  seenAlerts: {},
  mapSeedHandled: {},
  autoBuildEntities: true,
  materializeAlerts: true,
  locationNicknames: {},
  locationNameAsked: {},
  operationName: "",
  operatorCallsign: "OP",
  setupComplete: false,
  visionEnabled: false,
  ollamaUrl: DEFAULT_OLLAMA_URL,
  visionModel: DEFAULT_VISION_MODEL,
  photoAnalyses: {},
  photoPlates: {},
  photoAnnotations: {},
  confirmedBehaviours: {},
  photoRejected: {},
  operatorFlagged: {},
  conversationEnabled: false,
  textReasoningEnabled: false,
  textExtractions: {},
  textMarksConfirmed: {},
  watchlist: {},
  textRejected: {},
};

const VIEW_TYPE_7S = "7s-analys-text";

/** The Map View query for ODEN's marker layers (mirrors obsidian-config/
 *  map-view-data.json defaultState.query — keep the two in sync). Includes the
 *  derived `#plats` hubs (amber dots): a place reported with coordinates belongs
 *  on the map, not just in the graph. Predefined places keep their own needle/
 *  shield via the later #fördefinierad/#skyddsvärd display rules. */
const MAP_QUERY = "tag:#objektet OR tag:#larm OR tag:#aktör OR tag:#plats OR tag:#fördefinierad";

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

/** Stable per-report key for a photo nomination (dedup + reject memory). */
function nomKey(n: PhotoNomination): string {
  return n.kind === "plate" ? `plate:${n.value}` : `${n.kind}:${n.label}`;
}

/** "Förenklade menyer": context-menu whitelist (lowercased title prefixes, en+sv).
 *  ODEN's own items ("ODEN: …") are always kept. */
const MENU_KEEP_FILE = ["byt namn", "rename", "radera", "delete", "ta bort"];
const MENU_KEEP_EDITOR = ["kopiera", "copy", "klistra in", "paste"];

export default class SevenSPlugin extends Plugin {
  settings: SevenSSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    console.log(`ODEN v${this.manifest.version} — build ${ODEN_BUILD}`);
    await this.loadSettings();

    addIcon(ODEN_ICON_ID, ODEN_ICON_SVG);
    this.registerView(VIEW_TYPE_7S, (leaf) => new SevenSTextView(leaf, this));

    this.addCommand({
      id: "setup-operation",
      name: "ODEN: Konfigurera operationsområde",
      callback: () => this.openOperationSetup(),
    });

    this.addCommand({
      id: "new-observation",
      name: "ODEN: Ny observation (mall)",
      callback: () => this.openNewObservation(),
    });

    this.addCommand({
      id: "manage-places",
      name: "ODEN: Namngivna platser",
      callback: () => void this.openManagePlaces(),
    });

    this.addCommand({
      id: "focus-map",
      name: "ODEN: Visa ODEN-lagren på kartan",
      callback: () => this.focusMapOnOden(),
    });

    this.addCommand({
      id: "analyze-photos",
      name: "ODEN: Analysera bilder nu",
      callback: () => void this.analyzePhotosFlow(),
    });

    this.addCommand({
      id: "analyze-text",
      name: "ODEN: Tolka text nu",
      callback: () => void this.analyzeTextFlow(),
    });

    // The ONE manual analysis escape hatch. Everything it triggers (plate
    // re-identification build, suspicion + larm notes, mark/actor nominations,
    // feed rows) also runs automatically on every debounced watcher recompute —
    // this command exists for when the watcher is off, autoBuildEntities is
    // disabled, or the operator wants an immediate refresh. Maintenance flows
    // (slå ihop / ångra / nollställ) live under ⋯ → Avancerat.
    this.addCommand({
      id: "update-situation",
      name: "ODEN: Uppdatera lägesbild",
      callback: () => void this.runUpdateSituation(),
    });

    // Demo playback: moves reports from demo/ into inkorg/ in compressed real
    // rhythm — the tool-free way to experience a gradually growing operation.
    // Toggles pause/resume when a run is active.
    this.addCommand({
      id: "feed-demo",
      name: "ODEN: Mata demodata",
      checkCallback: (checking) => {
        if (!(this.app.vault.getAbstractFileByPath("demo") instanceof TFolder)) return false;
        if (!checking) this.toggleDemoFeed();
        return true;
      },
    });

    this.addRibbonIcon(ODEN_ICON_ID, "ODEN — indexera & sammanfatta", () =>
      void this.runSummary(),
    );

    this.addSettingTab(new SevenSSettingTab(this.app, this));

    // Right-click a note (file explorer, tab header, editor menu all emit
    // file-menu): larm-flag on 7S reports; 🔭 Bevaka on reports AND on ODEN's own
    // entity/actor/suspect/mark notes (resolved via watchTargetForNote).
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
        const isReport = fm?.generator !== GENERATOR && (fm?.tnr != null || /^TNR/i.test(file.basename));
        if (isReport) {
          const flagged = !!this.settings.operatorFlagged[file.path];
          menu.addItem((i) =>
            i.setTitle(flagged ? "ODEN: Ta bort larmflagga" : "ODEN: Flagga som larm")
              .setIcon(flagged ? "flag-off" : "alert-triangle")
              .onClick(() => void this.toggleOperatorFlag(file.path, fm?.tnr != null ? String(fm.tnr) : undefined)),
          );
        }
        const target = this.watchTargetForNote(fm, file);
        if (target && target.ref) {
          const watched = !!this.settings.watchlist[`${target.kind}:${target.ref}`];
          menu.addItem((i) =>
            i.setTitle(watched ? "ODEN: Sluta bevaka" : "ODEN: Bevaka")
              .setIcon("telescope")
              .onClick(() => void this.toggleWatch(target)),
          );
        }
        this.simplifyMenu(menu, MENU_KEEP_FILE);
      }),
    );
    // Multi-selection + editor right-click menus get the same diet.
    this.registerEvent(
      this.app.workspace.on("files-menu", (menu) => this.simplifyMenu(menu, MENU_KEEP_FILE)),
    );
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu) => this.simplifyMenu(menu, MENU_KEEP_EDITOR)),
    );

    // Live watcher: recompute on vault changes (debounced); baseline once
    // the layout is ready so the existing corpus does NOT flood the operator.
    this.registerVaultWatcher();
    this.app.workspace.onLayoutReady(async () => {
      // Rewrite confirmed actors in the current format/name and prune stale twins
      // (self-heals notes written by an older version), then baseline the watcher.
      await this.cleanupDialogNote();
      if (this.settings.setupComplete) await this.writeAoiNote(); // self-heal the Objektet marker
      await this.reconcileActorNodes();
      await this.baselineAlerts();
    });
  }

  onunload(): void {
    if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
    if (this.demoTimer !== null) window.clearTimeout(this.demoTimer);
    this.demoRunning = false;
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
   *  plugin works wherever the intake app (källappen) / the feeder drops the notes, and never
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
      // Inject operator-confirmed photo plates so plate re-identification picks them up.
      const pp = this.settings.photoPlates[r.file];
      if (pp && pp.length) r.photoPlates = pp;
      const pb = this.settings.confirmedBehaviours[r.file];
      if (pb && pb.length) r.confirmedBehaviours = pb;
      // Operator-flagged alarm (file-menu): rides the same channel; suspicion
      // dedups by key so re-injection is idempotent.
      if (this.settings.operatorFlagged[r.file]) {
        r.confirmedBehaviours = [...(r.confirmedBehaviours ?? []), OPERATOR_FLAG_SIGNAL];
      }
      reports.push(r);
      issues.push(...fileIssues);
    }
    return { reports, issues };
  }

  /**
   * Write the plugin's own notes under the entities folder, enforcing the write contract:
   *  - only ever create/overwrite files we OWN (generator: 7s-plugin);
   *  - never clobber a same-named file we don't own (skip + report);
   *  - idempotent (skip writes when content is byte-identical);
   *  - prune owned files of THIS job (`metod`) no longer derived. Per-job
   *    pruning so a plate re-identification run never deletes confirmed mark notes.
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
        // protected.
        if (!isOverwritable(current)) {
          skipped.push(path); // not ours — never touch
          desired.delete(path);
          continue;
        }
        if (current === note.body) {
          unchanged++; // idempotent
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

  // --- Mark nominations (jobb-b): nominate-only — the operator confirms ------

  private lastJobB: JobBResult | null = null;

  /** Build mark nominations and render them with confirm/reject controls. */
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

  /** Operator confirms a nomination → materialize the mark entity note (owned-note write). */
  async confirmNomination(signature: string): Promise<void> {
    const nom = this.lastJobB?.nominations.find((n) => n.signature === signature);
    if (!nom) return;
    const note = renderMarkNote(nom);
    const res = await this.writeOwnedNotes([{ name: note.filename, body: note.markdown }], METOD.jobbB);
    if (res.skipped.length) {
      new Notice("ODEN: kunde inte skriva märkesnot (ej plugin-ägd fil på samma namn).");
      return;
    }
    this.settings.markDecisions[signature] = "confirmed";
    await this.saveSettings();
    await this.revealMarksOrFeed();
    new Notice(`ODEN: bekräftade kännetecken "${nom.label}" → nod skapad.`);
  }

  /** Operator rejects a nomination → suppress it; remove any owned note. */
  async rejectNomination(signature: string): Promise<void> {
    const nom = this.lastJobB?.nominations.find((n) => n.signature === signature);
    this.settings.markDecisions[signature] = "rejected";
    await this.saveSettings();
    if (nom) await this.deleteOwnedNote(markFilename(nom));
    await this.revealMarksOrFeed();
    new Notice("ODEN: förslag avvisat (dolt).");
  }

  /** Clear ALL operator mark decisions (in memory + persisted) and remove every
   *  plugin-owned mark note (metod jobb-b). The single-click reset for incremental
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
      if (isPluginOwned(text) && ownedMetod(text) === METOD.jobbB) {
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
      if (text.trim() === "" || (isPluginOwned(text) && ownedMetod(text) === METOD.aktor)) {
        await this.app.vault.delete(f);
        removed++;
      }
    }

    await this.reconcileActorNodes(); // nothing confirmed now → only red markers remain
    if (this.lastActors) await this.revealActors();
    new Notice(`ODEN: nollställde ${n} aktörsbeslut, tog bort ${removed} aktörsnoter.`);
  }

  /** True if the operator has made ANY judgement worth warning about before a wipe. */
  private hasAnyJudgements(): boolean {
    const s = this.settings;
    return [
      s.actorDecisions,
      s.markDecisions,
      s.locationNicknames,
      s.locationNameAsked,
      s.actorNames,
      s.actorMerges,
      s.locationMerges,
      s.predefinedLocations,
      s.seenAlerts,
      s.mapSeedHandled,
      s.photoPlates,
      s.photoAnnotations,
      s.confirmedBehaviours,
      s.operatorFlagged,
      s.textMarksConfirmed,
      s.watchlist,
    ].some((m) => Object.keys(m).length > 0);
  }

  /** Wipe EVERY operator judgement (decisions, names, nicknames, merges, seen-set)
   *  and delete the decision-derived owned notes (metod aktor/jobb-b) + stray empty
   *  files. Called when a new/changed operation area is set so nothing from the
   *  previous operation lingers. Location/larm/objektet nodes re-derive on reconcile. */
  async clearAllJudgements(): Promise<void> {
    this.settings.actorDecisions = {};
    this.settings.markDecisions = {};
    this.settings.locationNicknames = {};
    this.settings.locationNameAsked = {};
    this.settings.actorNames = {};
    this.settings.actorMerges = {};
    this.settings.locationMerges = {};
    this.settings.predefinedLocations = {};
    this.settings.seenAlerts = {};
    this.settings.mapSeedHandled = {};
    // Photo CONFIRMATIONS are per-operation judgements; the sighting cache
    // (photoAnalyses) is not a judgement and survives (keyed by image hash).
    this.settings.photoPlates = {};
    this.settings.photoAnnotations = {};
    this.settings.confirmedBehaviours = {};
    this.settings.photoRejected = {};
    this.settings.operatorFlagged = {};
    this.settings.textMarksConfirmed = {};
    this.settings.textRejected = {};
    this.settings.watchlist = {};
    await this.saveSettings();

    let removed = 0;
    const folder = this.settings.entitiesFolder.replace(/\/+$/, "");
    const prefix = folder + "/";
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (folder !== "" && !(f.path === folder || f.path.startsWith(prefix))) continue;
      const text = await this.app.vault.read(f);
      const metod = ownedMetod(text);
      if (text.trim() === "" || (isPluginOwned(text) && (metod === METOD.aktor || metod === METOD.jobbB))) {
        await this.app.vault.delete(f);
        removed++;
      }
    }
    // A new operation area also empties the conversation — answers grounded in the
    // previous operation's KB must not linger next to the fresh one.
    this.getView()?.clearChat();
    new Notice(`ODEN: raderade tidigare beslut, tog bort ${removed} noter.`);
  }

  // --- Location nicknames (operator names for MGRS grids) --------------------

  /** Best-effort assist (the plugin drives Map View only on explicit operator action): center the
   *  already-open Map View on a coordinate so the operator can see where they are
   *  naming. Feature-detected + try/caught: if Map View is absent or its API
   *  changes, naming still works, just without the zoom. `dedicatedPane` reuses
   *  the open map leaf rather than replacing the active (ODEN) panel. */
  private focusMapOn(lat: number, lon: number, query?: string, zoom?: number): void {
    try {
      const mv = (this.app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins?.[
        "obsidian-map-view"
      ] as { openMapWithState?: (s: unknown, b: string, f: boolean) => unknown; settings?: { zoomOnGoFromNote?: number } } | undefined;
      if (!mv || typeof mv.openMapWithState !== "function") return;
      const mapZoom = zoom ?? mv.settings?.zoomOnGoFromNote ?? 15;
      // Optionally override the query so a just-created marker (e.g. the AOI) is
      // visible even if the map's persisted query doesn't include its tag yet.
      const state: Record<string, unknown> = { mapCenter: { lat, lng: lon }, mapZoom };
      if (query) state.query = query;
      void mv.openMapWithState(state, "dedicatedPane", false);
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
    // Zoom 13 keeps surrounding placenames/roads visible for context (map-view's
    // own zoomOnGoFromNote of 15 is too tight — a bare marker on empty tiles).
    const NAMING_ZOOM = 13;
    if (ll) this.focusMapOn(ll.lat, ll.lon, undefined, NAMING_ZOOM);
    new NameLocationModal(
      this.app,
      grid,
      current,
      ll,
      () => {
        if (ll) this.focusMapOn(ll.lat, ll.lon, undefined, NAMING_ZOOM); // "visa på karta igen"
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

  /** "Namngivna platser" screen: drop an operator-given nickname for a report
   *  grid. locationNameAsked is KEPT so the feed's naming nudge doesn't
   *  immediately reappear for the same grid. Same reconcile path as naming. */
  async removeLocationNickname(grid: string): Promise<void> {
    const nick = this.settings.locationNicknames[grid];
    delete this.settings.locationNicknames[grid];
    await this.saveSettings();
    await this.reconcileActorNodes(); // rewrites location/suspect/actor notes without the name
    await this.refreshPanel();
    new Notice(`ODEN: namnet "${nick ?? grid}" borttaget.`);
  }

  // --- Operation setup (area of interest) + operator observations -------------

  /** First-run / reconfigure: set the protected area of interest (the object the
   *  suspicion proximity signal measures against), centre the map on it, and drop
   *  a permanent AOI marker note in the graph. */
  openOperationSetup(): void {
    const prevLat = this.settings.protectedLat;
    const prevLon = this.settings.protectedLon;
    new SetupOperationModal(
      this.app,
      { name: this.settings.operationName, lat: prevLat, lon: prevLon },
      async (res) => {
        const coordsChanged = res.lat !== prevLat || res.lon !== prevLon;
        // A new/changed area wipes all prior judgements — warn first if there's
        // anything to lose (a pure rename keeps everything).
        if (coordsChanged && this.hasAnyJudgements()) {
          new ConfirmModal(
            this.app,
            {
              title: "Nytt operationsområde",
              body:
                "Ett nytt/ändrat operationsområde raderar alla tidigare beslut " +
                "(bekräftade aktörer, kännetecken, sammanslagningar " +
                "och namngivna platser). Fortsätt?",
              confirmText: "Radera och sätt område",
            },
            async () => {
              await this.clearAllJudgements();
              await this.applyOperationSetup(res);
            },
          ).open();
          return;
        }
        if (coordsChanged) await this.clearAllJudgements(); // nothing to warn about
        await this.applyOperationSetup(res);
      },
    ).open();
  }

  /** Persist the operation area, (re)write the AOI marker, centre the map. */
  private async applyOperationSetup(res: { name: string; lat: number; lon: number }): Promise<void> {
    this.settings.operationName = res.name;
    this.settings.protectedLat = res.lat;
    this.settings.protectedLon = res.lon;
    this.settings.setupComplete = true;
    await this.saveSettings();
    await this.writeAoiNote();
    // Point the map at the area AND include the AOI tag in the query so the marker
    // shows now (the persisted map rule/query only reloads on restart).
    this.focusMapOn(res.lat, res.lon, MAP_QUERY);
    await this.reconcileActorNodes(); // re-derive nodes for the (possibly wiped) state
    await this.refreshPanel();
    new Notice(`ODEN: operationsområde satt — ${res.name || `${res.lat}, ${res.lon}`}.`);
    // Offer to pre-create known places right away (day-0 location nodes that
    // vicinity-link incoming reports; sensitive ones alarm on proximity).
    if (Object.keys(this.settings.predefinedLocations).length === 0) {
      new ConfirmModal(
        this.app,
        {
          title: "Namngivna platser",
          body:
            "Vill du redan nu namnge kända platser (grindar, förråd, infarter)? " +
            "Observationer i närheten kopplas automatiskt till platsen, och " +
            "skyddsvärda platser ger larm vid misstänkt aktivitet i närheten.",
          confirmText: "Namnge platser…",
          cancelText: "Inte nu",
          cta: true,
        },
        () => this.openManagePlaces(),
      ).open();
    }
  }

  /** ODEN's own marker note for the protected object (idempotent, own-note). */
  private async writeAoiNote(): Promise<void> {
    const { protectedLat: lat, protectedLon: lon, operationName } = this.settings;
    // typ/metod/tag = `objektet` (also the graph/map colour key); node titled "Objektet".
    const body: string[] = [
      "---",
      "typ: objektet",
      'namn: "Objektet"',
      "källa: 7s-plugin",
      "generator: 7s-plugin",
      "metod: objektet",
      "tags: [objektet]",
      `lat: ${lat}`,
      `lon: ${lon}`,
      `location: "${lat},${lon}"`,
      "---",
      "",
      "# 🎯 Objektet",
      "",
    ];
    if (operationName) body.push(`**Operation:** ${operationName}`, "");
    body.push(
      `**Koordinat:** ${lat}, ${lon}`,
      "",
      "_Operationens område av intresse. ODEN mäter närhet mot denna punkt._",
      "",
    );
    await this.writeOwnedNotes([{ name: `${OBJEKTET_STEM}.md`, body: body.join("\n") }], METOD.objektet);
  }

  /** Guided dialog → a COMPLETE operator-authored 7S observation (all fields). */
  openNewObservation(): void {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const iso =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
      `T${pad(now.getHours())}:${pad(now.getMinutes())}:00`;
    new NewObservationModal(
      this.app,
      { tidpunkt: iso, sagesman: this.settings.operatorCallsign },
      async (obs) => {
        const id = `7S-${crypto.randomUUID()}`;
        const note = renderObservation({ id, ...obs });
        const path = await this.writeOperatorNote(note.filename, note.markdown);
        if (path) {
          await this.app.workspace.openLinkText(path.replace(/\.md$/, ""), "", false);
          new Notice(`ODEN: observation ${note.filename} skapad.`);
        }
      },
    ).open();
  }

  /** Write an OPERATOR message file (not plugin-owned). Never clobbers an existing
   *  file — appends a suffix on TNR collision. Returns the vault path, or null. */
  private async writeOperatorNote(filename: string, body: string): Promise<string | null> {
    const folder = this.settings.reportsFolder.replace(/\/+$/, "");
    let name = filename;
    for (let i = 2; this.app.vault.getAbstractFileByPath(folder ? `${folder}/${name}` : name); i++) {
      name = filename.replace(/\.md$/, `_${i}.md`);
    }
    const path = normalizePath(folder ? `${folder}/${name}` : name);
    try {
      await this.app.vault.create(path, body);
      return path;
    } catch (err) {
      console.error("ODEN: could not create observation", err);
      new Notice("ODEN: kunde inte skapa observationen (se konsolen).");
      return null;
    }
  }

  // --- Predefined places (operator-created, day-0 location nodes) -------------

  /** ⋯ menu / command: centre the map on the AOI and (re)assert ODEN's marker
   *  layers. An OPEN map pane keeps its own saved query (workspace state) and
   *  ignores data.json's defaultState — so after a query/rule update, or when the
   *  operator's manual filtering drifted, this is the one-click reset. */
  focusMapOnOden(): void {
    this.focusMapOn(this.settings.protectedLat, this.settings.protectedLon, MAP_QUERY);
  }

  /** Panel-header 🌙/☀︎: flip Obsidian dark ⇄ light. vault.getConfig/setConfig are
   *  not in the public typings, so feature-detect (same pattern as the map-view
   *  access). The current EFFECTIVE mode is read off body.theme-dark — which also
   *  resolves theme "system" — and the explicit opposite ("obsidian" = dark,
   *  "moonstone" = light) is set; css-change restyles the workspace immediately. */
  toggleTheme(): void {
    const vault = this.app.vault as unknown as {
      getConfig?: (key: string) => unknown;
      setConfig?: (key: string, value: unknown) => void;
    };
    if (!vault.setConfig) return; // API absent — leave the theme alone
    const dark = document.body.hasClass("theme-dark");
    vault.setConfig("theme", dark ? "moonstone" : "obsidian");
    this.app.workspace.trigger("css-change");
  }

  /** ⋯ menu / command / setup follow-up / map seed: open the places screen IN THE
   *  PANEL (not a modal — a modal blocks the whole workspace, so the operator
   *  couldn't right-click the map to copy a position while entering places). */
  async openManagePlaces(initCoord?: string): Promise<void> {
    await this.revealPanel();
    this.getView()?.showPlaces(initCoord);
  }

  /** Create/overwrite a predefined place, persist, re-derive the nodes. The feed
   *  is NOT refreshed here — the places screen stays open (its ← back refreshes). */
  async addPredefinedPlace(name: string, p: PredefinedLocation): Promise<void> {
    const existed = name in this.settings.predefinedLocations;
    this.settings.predefinedLocations[name] = p;
    await this.saveSettings();
    await this.reconcileActorNodes(); // materializes the 📍 note + vicinity links
    // Show the new needle right away (an already-open map re-queries live).
    this.focusMapOn(p.lat, p.lon, MAP_QUERY);
    new Notice(`ODEN: plats "${name}" ${existed ? "uppdaterad" : "skapad"}.`);
  }

  /** Remove a predefined place; its note is pruned on the reconcile. */
  async removePredefinedPlace(name: string): Promise<void> {
    delete this.settings.predefinedLocations[name];
    await this.saveSettings();
    await this.reconcileActorNodes();
    new Notice(`ODEN: plats "${name}" borttagen.`);
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

  /** After a mark decision: stay on the review only while suggestions remain to
   *  act on; with nothing left pending, return the operator to the live feed. */
  private async revealMarksOrFeed(): Promise<void> {
    const pending = this.lastJobB?.nominations.some((n) => !this.settings.markDecisions[n.signature]);
    if (pending) await this.revealMarkNominations();
    else await this.refreshPanel();
  }

  // --- Deterministic text query interface ------------------------------------

  /** Build a knowledge-base snapshot of the CURRENT vault state. Reflects
   *  gradual buildup: only reports that exist now + operator-CONFIRMED marks. */
  private async buildKB(): Promise<KB> {
    const { reports } = await this.readReports();
    const vehicles = buildPlateEntities(reports).entities;
    const jobB = buildMarkNominations(reports);
    const marks = jobB.nominations.filter((n) => this.settings.markDecisions[n.signature] === "confirmed");
    // The KB is a projection of the domain model: every target is a real analysis
    // product, reusing the same functions the notes/map/feed are built from.
    const suspicion = analyzeSuspicion(reports, this.suspicionOpts());
    const actors = foldedConfirmedActors(reports, suspicion, this.settings);
    const places = buildLocations(reports, suspicion, this.settings.locationMerges, this.settings.predefinedLocations);
    return { reports, vehicles, marks, actors, places, larm: suspicion.elevated, craft: extractAllCraft(reports) };
  }

  /** One chat turn: engine translates → execute → engine narrates → show in
   *  chat. The question + a "…" placeholder appear IMMEDIATELY (so a slow LLM
   *  narrate doesn't read as "no response"); the answer replaces the placeholder
   *  when ready. Write-wall: nothing is written to the vault. */
  async answerQuery(raw: string): Promise<void> {
    const trimmed = raw.trim();
    if (!trimmed) return;
    await this.revealPanel();
    const view = this.getView();
    const pending = view?.beginChat(trimmed) ?? null;
    const llmOn = this.settings.conversationEnabled;
    const stage = (t: string) => { if (pending && llmOn) pending.setText(t); };
    try {
      const kb = await this.buildKB();
      const engine = this.conversationEngine();
      stage("… 💬 tolkar frågan (lokal modell)");
      const query = await engine.toQuery(trimmed); // LLM (if on) TRANSLATES; else deterministic
      const ans = executeQuery(query, kb);
      // Fail-fast: a 0-row deterministic result SKIPS the (slow) LLM narrate — the
      // empty answer shows INSTANTLY with a hint about what CAN be asked, instead
      // of reading as "no response" after a long wait. A guard refusal or a
      // situation summary is a deliberate response, not a miss → no hint.
      let prose: string;
      if (ans.rowCount === 0) {
        prose = ans.markdown;
        if (!query.guard && query.shape !== "summary") {
          prose +=
            "\n\n_Inget att visa. Du kan fråga om **larm**, **aktörer**, **fordon**, " +
            "**farkoster** (drönare/båt/traktor …), **platser** eller **kännetecken** — " +
            'eller be om en översikt ("sammanfatta läget")._';
        }
      } else {
        stage("… 💬 formulerar svar (lokal modell)");
        prose = await engine.narrate(ans); // LLM (if on) NARRATES the deterministic answer
      }
      if (view && pending) await view.fillChat(pending, prose);
    } catch (err) {
      console.error("ODEN: query failed", err);
      if (view && pending) await view.fillChat(pending, "_Frågan kunde inte besvaras (se konsolen)._");
      else new Notice("ODEN: frågan kunde inte besvaras (se konsolen).");
    }
  }

  /** The chat is shown live in the panel and never persisted; this removes a
   *  stale `7s-dialog.md` audit note if one exists (best-effort — a persisted
   *  dialog note would clutter the graph with a node linked to reports). */
  private async cleanupDialogNote(): Promise<void> {
    const folder = this.settings.entitiesFolder.replace(/\/+$/, "");
    const path = normalizePath(folder === "" ? "7s-dialog.md" : `${folder}/7s-dialog.md`);
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) {
      const cur = await this.app.vault.read(f);
      if (isPluginOwned(cur)) await this.app.vault.delete(f);
    }
  }

  // --- Transitive actor derivation -------------------------------------------

  private lastActors: ActorResult | null = null;

  async runDeriveActors(): Promise<void> {
    try {
      const { reports } = await this.readReports();
      const suspicion = analyzeSuspicion(reports, this.suspicionOpts());
      this.lastActors = mergedActors(reports, suspicion, this.settings.actorThreshold);
      await this.revealActors();
      new Notice(
        `ODEN: ${this.lastActors.hypotheses.length} aktörsförslag att granska (känslighet ${this.settings.actorThreshold}).`,
      );
    } catch (err) {
      console.error("ODEN: actor derivation failed", err);
      new Notice("ODEN: kunde inte härleda aktörer (se konsolen).");
    }
  }

  /** Change the evidence threshold and recompute. */
  async setActorThreshold(t: number): Promise<void> {
    this.settings.actorThreshold = Math.max(1, Math.floor(t) || 1);
    await this.saveSettings();
    await this.runDeriveActors();
  }

  async confirmActor(id: string): Promise<void> {
    const h = this.lastActors?.hypotheses.find((x) => x.id === id);
    if (!h) return;
    // Offer a free-text name (the graph node's label) before confirming. The
    // suggestion is any existing name, else the agent's facet label, else a count.
    const suggested =
      this.settings.actorNames[id] ??
      (id.startsWith("suspect-") ? h.facets[0]?.label : undefined) ??
      (h.facets.map((f) => f.label).join(" + ") || `${h.vehicleCount} fordon, ${h.markCount} kännetecken`);
    new NameActorModal(this.app, suggested, async (name) => {
      if (name === null) return; // avbröt → ingen bekräftelse
      const n = name.trim();
      if (n) this.settings.actorNames[id] = n;
      else delete this.settings.actorNames[id];
      this.settings.actorDecisions[id] = "confirmed";
      await this.saveSettings();
      // Write the WHOLE confirmed set (prune-safe) + drop any red marker for the now
      // -confirmed agent so it appears as a single blue actor node (merge, not twin).
      await this.reconcileActorNodes();
      await this.revealActorsOrFeed();
      new Notice(`ODEN: bekräftade aktör${n ? ` "${n}"` : ""} → nod skapad.`);
    }).open();
  }

  // --- Operator merges: two nodes are the SAME actor / place ------------------

  /** Confirmed actor hypotheses as the operator sees them (post merge-fold). */
  private confirmedActorList(): ActorHypothesis[] {
    if (!this.lastActors) return [];
    const confirmed = this.lastActors.hypotheses.filter(
      (h) => this.settings.actorDecisions[h.id] === "confirmed",
    );
    return foldActorMerges(confirmed, this.settings.actorMerges);
  }

  /** Pick two confirmed actors (A absorbed into B) → persist the merge, re-render. */
  async mergeActorsFlow(): Promise<void> {
    const actors = this.confirmedActorList();
    if (actors.length < 2) {
      new Notice("ODEN: behöver minst två bekräftade aktörer att slå ihop.");
      return;
    }
    new PickActorModal(this.app, actors, this.settings.actorNames, "Välj aktör att slå ihop (A)…", (a) => {
      const rest = actors.filter((x) => x.id !== a.id);
      new PickActorModal(this.app, rest, this.settings.actorNames, "…in i vilken aktör? (B — överlevande)", async (b) => {
        this.settings.actorMerges[a.id] = b.id;
        // Keep a good label: carry A's name onto B if B is unnamed.
        if (!this.settings.actorNames[b.id] && this.settings.actorNames[a.id]) {
          this.settings.actorNames[b.id] = this.settings.actorNames[a.id];
        }
        await this.saveSettings();
        await this.reconcileActorNodes();
        await this.revealActors();
        new Notice("ODEN: aktörer sammanslagna till en nod.");
      }).open();
    }).open();
  }

  /** Pick two location clusters (A absorbed into B) → persist the merge, re-render. */
  async mergeLocationsFlow(): Promise<void> {
    const { reports } = await this.readReports();
    const s = analyzeSuspicion(reports, this.suspicionOpts());
    const clusters = buildLocations(reports, s, this.settings.locationMerges, this.settings.predefinedLocations);
    if (clusters.length < 2) {
      new Notice("ODEN: behöver minst två platser att slå ihop.");
      return;
    }
    new PickLocationModal(this.app, clusters, this.settings.locationNicknames, (aKey) => {
      const rest = clusters.filter((c) => c.key !== aKey);
      new PickLocationModal(this.app, rest, this.settings.locationNicknames, async (bKey) => {
        this.settings.locationMerges[aKey] = bKey;
        await this.saveSettings();
        await this.reconcileActorNodes();
        await this.refreshPanel();
        new Notice("ODEN: platser sammanslagna till en nod.");
      }, "…in i vilken plats? (överlevande)").open();
    }, "Välj plats att slå ihop (A)…").open();
  }

  /** Undo a single actor- or location-merge from a combined list. */
  async unmergeFlow(): Promise<void> {
    const items: { value: string; label: string }[] = [];
    for (const [from, to] of Object.entries(this.settings.actorMerges)) {
      const nm = (id: string) => this.settings.actorNames[id] ?? id;
      items.push({ value: `aktor:${from}`, label: `Aktör: ${nm(from)} → ${nm(to)}` });
    }
    for (const [from, to] of Object.entries(this.settings.locationMerges)) {
      const nm = (k: string) => placeLabel(k, this.settings.locationNicknames);
      items.push({ value: `plats:${from}`, label: `Plats: ${nm(from)} → ${nm(to)}` });
    }
    if (!items.length) {
      new Notice("ODEN: inga sammanslagningar att ångra.");
      return;
    }
    new PickStringModal(this.app, items, "Välj sammanslagning att ångra…", async (value) => {
      if (value.startsWith("aktor:")) delete this.settings.actorMerges[value.slice(6)];
      else if (value.startsWith("plats:")) delete this.settings.locationMerges[value.slice(6)];
      await this.saveSettings();
      await this.reconcileActorNodes();
      await this.revealActors();
      await this.refreshPanel();
      new Notice("ODEN: ångrade en sammanslagning.");
    }).open();
  }

  async rejectActor(id: string): Promise<void> {
    this.settings.actorDecisions[id] = "rejected";
    await this.saveSettings();
    await this.reconcileActorNodes();
    await this.revealActorsOrFeed();
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
    // Build the location clusters ONCE so actors can link straight to the same
    // location nodes (a direct actor↔plats edge, no message node in between).
    // Includes the operator-predefined places (day-0 nodes + vicinity linking).
    const clusters = buildLocations(reports, suspicion, this.settings.locationMerges, this.settings.predefinedLocations);
    const locStemOf = locationLinker(clusters, this.settings);
    const nearOf = predefNearLinker(clusters, this.settings);
    const confirmedActors = foldedConfirmedActors(reports, suspicion, this.settings);

    // Recurrence nodes: a vehicle or actor seen 2+ times at the same place gets a
    // labelled node ON that pair (count as edge-weight is impossible in the core
    // graph). The pair is ROUTED through it, so no redundant direct edge. Gated on
    // the same toggle as the location/larm layer; an empty set still prunes stale.
    const recs = this.settings.materializeAlerts
      ? buildRecurrences(clusters, confirmedActors, this.settings)
      : { pairs: [] as RecurrencePair[], byVehicle: new Map<string, string>(), byActor: new Map<string, string>() };
    const recForPlate = (placeKey: string, plate: string) =>
      recs.byVehicle.get(`${noteStem(safeFilename(plate))}@@${stemForKey(clusters, placeKey, this.settings.locationNicknames)}`);

    await this.writeOwnedNotes(
      confirmedActorNotes(confirmedActors, this.settings, locStemOf, recs, nearOf),
      "aktor",
    );
    await this.writeSuspectNotes(reports, suspicion, locStemOf);
    await this.writeLocationNotes(clusters, recForPlate);
    await this.writeOwnedNotes(
      recs.pairs.map((p) => { const n = renderRecurrenceNote(p); return { name: n.filename, body: n.markdown }; }),
      METOD.aterkomst,
    );
  }

  /** One graph/map node per RELEVANT location (suspicious activity or a vehicle),
   *  linking the reports observed there so the place shows as a spatial hub.
   *  Operator-PREDEFINED places are always written (an explicit human creation);
   *  only the derived hubs are gated on the alert-layer toggle. */
  private async writeLocationNotes(
    clusters: LocationCluster[],
    recForPlate?: (placeKey: string, plate: string) => string | undefined,
  ): Promise<void> {
    const set = this.settings.materializeAlerts ? clusters : clusters.filter((c) => c.predefined);
    const notes = renderLocationNotes(set, this.settings.locationNicknames, recForPlate).map((n) => ({ name: n.filename, body: n.markdown }));
    await this.writeOwnedNotes(notes, METOD.plats);
  }

  private async revealActors(): Promise<void> {
    const leaf = await this.getPanelLeaf();
    const view = leaf.view;
    if (view instanceof SevenSTextView && this.lastActors) {
      await view.renderActors(this.lastActors, this.settings.actorDecisions, this.settings.actorThreshold);
    }
  }

  /** After an actor decision: stay on the review only while suggestions remain to
   *  act on; with nothing left pending, return the operator to the live feed. */
  private async revealActorsOrFeed(): Promise<void> {
    const pending = this.lastActors?.hypotheses.some((h) => !this.settings.actorDecisions[h.id]);
    if (pending) await this.revealActors();
    else await this.refreshPanel();
  }

  // --- Vault watcher + alerts-with-pointer -----------------------------------

  private debounceTimer: number | null = null;

  private suspicionOpts() {
    // Sensitive predefined places are extra proximity anchors (scaled bands).
    const sensitivePlaces = Object.entries(this.settings.predefinedLocations)
      .filter(([, p]) => p.sensitive === true)
      .map(([name, p]) => ({ name, lat: p.lat, lon: p.lon, radiusM: p.radiusM }));
    return {
      protectedLat: this.settings.protectedLat,
      protectedLon: this.settings.protectedLon,
      threshold: DEFAULT_SUSPICION.threshold,
      sensitivePlaces,
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
      actors: mergedActors(reports, suspicion, this.settings.actorThreshold),
      jobA: buildPlateEntities(reports),
    };
  }

  // --- Panel glue: feed + chat + engine + menu (operator UI) -----------------

  /** The open ODEN view, if any. */
  private getView(): SevenSTextView | null {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_7S)[0];
    return leaf && leaf.view instanceof SevenSTextView ? leaf.view : null;
  }

  /** Open/focus the panel (the view's onOpen calls refreshPanel). */
  private async revealPanel(): Promise<void> {
    await this.getPanelLeaf();
  }

  /** Recompute and refresh the feed in the open panel (no alert notices). This is
   *  the EXPLICIT path (back button, ⋯ menu, commands), so it leaves any open
   *  review screen and returns to the live feed. */
  async refreshPanel(): Promise<void> {
    try {
      const bundle = await this.analyzeBundle();
      this.lastPhotoPending = await this.photoPendingCount(bundle.reports);
      this.lastTextPending = await this.textPendingCount();
      this.lastWatch = await this.watchStatus(bundle);
      const view = this.getView();
      if (view) {
        view.enterFeedMode();
        view.setFeed(buildFeed(buildFeedItems(bundle, this.settings, this.lastCorroboration, this.analyzingPhotos, this.lastPhotoPending, this.analyzingTexts, this.lastTextPending, this.lastWatch)), this.lastWatch);
      }
    } catch (err) {
      console.error("ODEN: refreshPanel failed", err);
    }
  }

  /** "Förenklade menyer": trim a context menu to ODEN's items + a small
   *  whitelist. The menu's item list is NOT public API, so every access is
   *  feature-detected — on any unexpected shape the menu is left untouched
   *  (full menus, never broken ones). A deferred second pass catches items
   *  other plugins add after this handler runs. Separators (empty titles)
   *  hide too, so the trimmed menu has no stray dividers. */
  simplifyMenu(menu: Menu, keep: string[]): void {
    if (!this.settings.simplifiedMenus) return;
    const pass = () => {
      const items = (menu as unknown as { items?: unknown[] }).items;
      if (!Array.isArray(items)) return;
      for (const raw of items) {
        const it = raw as { dom?: unknown; titleEl?: unknown };
        const dom = it.dom instanceof HTMLElement ? it.dom : null;
        if (!dom) continue;
        const titleEl = it.titleEl instanceof HTMLElement ? it.titleEl : dom;
        const title = (titleEl.textContent ?? "").trim().toLowerCase();
        const keepIt = title.startsWith("oden") || keep.some((k) => title.startsWith(k));
        if (!keepIt) dom.style.display = "none";
      }
    };
    pass();
    window.setTimeout(pass, 0);
  }

  /** The ⋯ menu — the operator's occasional actions. Rare maintenance flows are
   *  tucked one level down under "Avancerat…" (a second Menu at the same spot —
   *  public API only, no undocumented setSubmenu). */
  openPanelMenu(evt: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Ny observation…").setIcon("file-plus").onClick(() => this.openNewObservation()));
    menu.addItem((i) => i.setTitle("Konfigurera operationsområde…").setIcon("target").onClick(() => this.openOperationSetup()));
    menu.addSeparator();
    // The feed surfaces pending review (kopplingar/aktörer) as clickable rows;
    // the vault watcher auto-refreshes.
    menu.addItem((i) => i.setTitle("Visa ODEN-lagren på kartan").setIcon("map").onClick(() => this.focusMapOnOden()));
    menu.addItem((i) => i.setTitle("Namnge plats…").setIcon("map-pin").onClick(() => void this.openLocationNamer()));
    menu.addItem((i) => i.setTitle("Namngivna platser…").setIcon("landmark").onClick(() => void this.openManagePlaces()));
    menu.addItem((i) => i.setTitle("Bevakningslista…").setIcon("telescope").onClick(() => void this.openWatchlist()));
    if (this.app.vault.getAbstractFileByPath("demo") instanceof TFolder) {
      menu.addItem((i) =>
        i.setTitle(this.demoRunning ? "Pausa demomatning" : "Mata demodata…")
          .setIcon(this.demoRunning ? "pause" : "play")
          .onClick(() => this.toggleDemoFeed()),
      );
    }
    menu.addSeparator();
    menu.addItem((i) => i.setTitle("Avancerat…").setIcon("settings-2").onClick(() => this.openAdvancedMenu(evt)));
    menu.showAtMouseEvent(evt);
  }

  /** Second-level menu behind ⋯ → "Avancerat…": manual refresh, entity hygiene
   *  (merge/undo) and the destructive resets — out of the operator's everyday way. */
  private openAdvancedMenu(evt: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Uppdatera lägesbild").setIcon("refresh-cw").onClick(() => void this.runUpdateSituation()));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle("Slå ihop aktörer…").setIcon("git-merge").onClick(() => void this.mergeActorsFlow()));
    menu.addItem((i) => i.setTitle("Slå ihop platser…").setIcon("git-merge").onClick(() => void this.mergeLocationsFlow()));
    menu.addItem((i) => i.setTitle("Ångra sammanslagning…").setIcon("undo-2").onClick(() => void this.unmergeFlow()));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle("Nollställ kopplingsbeslut").setIcon("trash").onClick(() => void this.resetMarkDecisions()));
    menu.addItem((i) => i.setTitle("Nollställ aktörsbeslut").setIcon("trash-2").onClick(() => void this.resetActorDecisions()));
    menu.showAtMouseEvent(evt);
  }

  /** React to vault changes; full recompute each change handles retroactive
   *  transitive completion. Debounced so bulk feeding (auto) is one pass.
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

    // Map-seed intake: a note Map View's "New note here" just dropped (a bare
    // `location:` frontmatter) gets an offer to become a predefined place or a
    // place name. layoutReady gate: Obsidian replays `create` for EVERY existing
    // file during startup indexing — those must never prompt.
    const onCreate = (file: { path: string }) => {
      if (!this.app.workspace.layoutReady) return;
      if (!relevant(file.path) || this.settings.mapSeedHandled[file.path]) return;
      // Give Map View a beat to finish writing the note body.
      window.setTimeout(() => void this.maybeOfferMapSeed(file.path), 500);
    };
    this.registerEvent(this.app.vault.on("create", onCreate));
  }

  /** If the just-created note is a map seed, open the seed dialog (create a
   *  predefined place here / name the nearest unnamed grid / ignore). */
  private async maybeOfferMapSeed(path: string): Promise<void> {
    try {
      const tf = this.app.vault.getAbstractFileByPath(path);
      if (!(tf instanceof TFile)) return;
      const seed = parseMapSeed(await this.app.vault.cachedRead(tf));
      if (!seed) return;
      // The naming option: an unnamed MGRS place near the click.
      const { reports } = await this.readReports();
      const clusters = buildLocations(
        reports,
        analyzeSuspicion(reports, this.suspicionOpts()),
        this.settings.locationMerges,
        this.settings.predefinedLocations,
      );
      const near = nearestNamelessGrid(clusters, seed.lat, seed.lon, this.settings.locationNicknames);
      new MapSeedModal(this.app, this, path, seed, near).open();
    } catch (err) {
      console.warn("ODEN: map-seed check failed", err);
    }
  }

  /** Trash a map-seed note once its coordinate has been carried into a flow.
   *  Operator-commanded from the seed dialog (NOT the owned-note prune path),
   *  so it goes to the trash rather than being deleted outright. */
  async absorbMapSeed(path: string): Promise<void> {
    const tf = this.app.vault.getAbstractFileByPath(path);
    if (!(tf instanceof TFile)) return;
    try {
      await this.app.fileManager.trashFile(tf);
    } catch (err) {
      console.warn("ODEN: could not trash map seed", path, err);
    }
  }

  /** Auto-materialize re-identified vehicle entities (metod jobb-a; CERTAIN
   *  matches → safe to write). Idempotent; per-job pruning keeps it tidy.
   *  Marks/actors stay confirmation-gated. The watcher ignores the entities
   *  folder, so no loop. */
  private async autoBuildJobA(bundle: AnalysisBundle): Promise<void> {
    if (!this.settings.autoBuildEntities) return;
    const confirmed = await this.computePlateCorroboration(bundle.reports);
    const notes = renderAll(bundle.jobA.entities, confirmed).map((n) => ({ name: n.filename, body: n.markdown }));
    await this.writeOwnedNotes(notes, METOD.jobbA);
  }

  // --- Image corroboration: a photo confirms a plate typed in the text --------
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

  // --- Vision (local Ollama VLM) — the ADDITIVE capability ------------------
  /** Live Ollama reachability, refreshed on toggle/analyse; drives the panel dot. */
  visionOnline = false;
  /** Report files whose images are being analysed RIGHT NOW — transient
   *  "Bild mottagen, analys startad" feed rows (in-memory, never persisted). */
  private readonly analyzingPhotos = new Set<string>();
  /** Guard against overlapping auto/manual VLM runs. */
  private photoRunActive = false;
  /** Report files already swept this session — the auto path re-hashes nothing on
   *  every watcher tick; the persistent photoAnalyses cache still dedups runs. */
  private readonly photoSeen = new Set<string>();
  /** Last failed Ollama health probe; the auto path backs off for a minute. */
  private photoHealthFailedAt = 0;
  /** Un-actioned photo findings at last recompute — the feed's review-row count. */
  private lastPhotoPending = 0;
  /** Session memo report|attachment → image hash (skips readBinary+SHA when the
   *  feed refresh recounts pending findings). Attachments are write-once copies. */
  private readonly attachmentHashMemo = new Map<string, string>();

  // --- Text-reasoning (📝) mirrors the photo auto-path -----------------------
  /** Report files whose prose the LLM is analysing RIGHT NOW — transient
   *  "Meddelande mottaget, analyseras" feed rows (in-memory, never persisted). */
  private readonly analyzingTexts = new Set<string>();
  /** Guard against overlapping auto/manual text-LLM runs. */
  private textRunActive = false;
  /** Report files already text-swept this session (cache still dedups runs). */
  private readonly textSeen = new Set<string>();
  /** Last failed Ollama health probe on the text path; auto backs off a minute. */
  private textHealthFailedAt = 0;
  /** Un-actioned text findings at last recompute — the feed's review-row count. */
  private lastTextPending = 0;
  /** Watchlist status at last recompute — panel 🔭 section + feed rows. */
  private lastWatch: WatchRow[] = [];

  /** Hash an attachment via the session memo (reads bytes only on first sight). */
  private async attachmentHash(att: string, fromFile: string): Promise<string | null> {
    const key = `${fromFile}|${att}`;
    const memo = this.attachmentHashMemo.get(key);
    if (memo) return memo;
    const bytes = await this.readAttachment(att, fromFile);
    if (!bytes) return null;
    const hash = await this.imageHash(bytes);
    this.attachmentHashMemo.set(key, hash);
    return hash;
  }

  private photoVision(): OllamaVision {
    return new OllamaVision({ url: this.settings.ollamaUrl, model: this.settings.visionModel });
  }

  /** Image attachments of a report (bilagor + body embeds). */
  imageAttachments(r: Report): string[] {
    return [...(r.bilagor ?? []), ...r.embeds].filter((a) => /\.(jpe?g|png|webp)$/i.test(a));
  }

  /** SHA-256 hex of an image — the run-once cache key (with model + prompt version). */
  private async imageHash(bytes: Uint8Array): Promise<string> {
    // Copy into a fresh (non-shared) ArrayBuffer so the digest arg types cleanly.
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    const buf = await crypto.subtle.digest("SHA-256", copy);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /** Analyse every attached photo through the VLM, ONCE per (image, model, prompt)
   *  — no-fishing. Fills the persistent sighting cache; never re-hits Ollama
   *  for an already-analysed image. NOT in the watcher hot path (VLM is seconds+
   *  per image) — invoked by the command / the toggle. Returns how many ran. */
  async computePhotoSightings(onProgress?: (done: number, total: number) => void, only?: ReadonlySet<string>): Promise<number> {
    if (!this.settings.visionEnabled) return 0;
    const { reports } = await this.readReports();
    const targets = reports.filter((r) => this.imageAttachments(r).length > 0 && (!only || only.has(r.file)));
    const engine = this.photoVision();
    let ran = 0;
    let done = 0;
    for (const r of targets) {
      for (const att of this.imageAttachments(r)) {
        const hash = await this.attachmentHash(att, r.file);
        if (!hash) continue;
        const cached = this.settings.photoAnalyses[hash];
        if (cached && cached.model === this.settings.visionModel && cached.promptV === PROMPT_VERSION) continue;
        const bytes = await this.readAttachment(att, r.file);
        if (!bytes) continue;
        const sighting = await engine.analyzePhoto(bytes);
        if (sighting) {
          this.settings.photoAnalyses[hash] = { model: this.settings.visionModel, promptV: PROMPT_VERSION, sighting };
          await this.saveSettings();
          ran++;
        }
      }
      this.photoSeen.add(r.file); // session-swept (auto path won't revisit)
      onProgress?.(++done, targets.length);
    }
    return ran;
  }

  /** The pending photo nominations for one report: cached sighting(s) for its
   *  images → per-item nominations, minus any already confirmed/rejected. */
  async pendingPhotoNominations(r: Report): Promise<PhotoNomination[]> {
    const textPlates = plateIdentifiers(r).filter((p) => !p.partial).map((p) => p.value);
    const out: PhotoNomination[] = [];
    for (const att of this.imageAttachments(r)) {
      const hash = await this.attachmentHash(att, r.file);
      if (!hash) continue;
      const entry = this.settings.photoAnalyses[hash];
      if (!entry || !sightingHasFindings(entry.sighting)) continue;
      for (const nom of sightingToNominations(entry.sighting, textPlates)) {
        if (this.photoNominationStatus(r.file, nom)) continue; // already decided
        out.push(nom);
      }
    }
    return out;
  }

  /** The operator's decision on a photo nomination, or undefined while pending.
   *  Confirmed = plate present in photoPlates / label in photoAnnotations (the
   *  same stores acceptPhotoNomination writes) — vehicle/person acceptances are
   *  recorded there too, so the pending filter excludes all decided kinds. */
  private photoNominationStatus(file: string, nom: PhotoNomination): "confirmed" | "rejected" | undefined {
    if (this.settings.photoRejected[`${file}|${nomKey(nom)}`]) return "rejected";
    if (nom.kind === "plate" && (this.settings.photoPlates[file] ?? []).includes(nom.value)) return "confirmed";
    if (nom.kind !== "plate" && (this.settings.photoAnnotations[file] ?? []).includes(nom.label)) return "confirmed";
    return undefined;
  }

  /** ALL nominations of a report with their decision state — the review shows
   *  decided items greyed with ↺ Ångra (like the actor cards), not vanished. */
  private async allPhotoNominations(r: Report): Promise<{ nom: PhotoNomination; status?: "confirmed" | "rejected" }[]> {
    const textPlates = plateIdentifiers(r).filter((p) => !p.partial).map((p) => p.value);
    const out: { nom: PhotoNomination; status?: "confirmed" | "rejected" }[] = [];
    for (const att of this.imageAttachments(r)) {
      const hash = await this.attachmentHash(att, r.file);
      if (!hash) continue;
      const entry = this.settings.photoAnalyses[hash];
      if (!entry || !sightingHasFindings(entry.sighting)) continue;
      for (const nom of sightingToNominations(entry.sighting, textPlates)) {
        out.push({ nom, status: this.photoNominationStatus(r.file, nom) });
      }
    }
    return out;
  }

  /** Undo a photo-nomination decision (↺): reopens the item for review. */
  async undoPhotoNomination(file: string, nom: PhotoNomination): Promise<void> {
    delete this.settings.photoRejected[`${file}|${nomKey(nom)}`];
    if (nom.kind === "plate") {
      this.settings.photoPlates[file] = (this.settings.photoPlates[file] ?? []).filter((p) => p !== nom.value);
      if (!this.settings.photoPlates[file].length) delete this.settings.photoPlates[file];
    } else {
      this.settings.photoAnnotations[file] = (this.settings.photoAnnotations[file] ?? []).filter((l) => l !== nom.label);
      if (!this.settings.photoAnnotations[file].length) delete this.settings.photoAnnotations[file];
      if (nom.kind === "person" && nom.recon.length) {
        // Best-effort: withdraw the recon signals this confirmation contributed.
        const keys = new Set(nom.recon.map((s) => s.key));
        const left = (this.settings.confirmedBehaviours[file] ?? []).filter((s) => !keys.has(s.key));
        if (left.length) this.settings.confirmedBehaviours[file] = left;
        else delete this.settings.confirmedBehaviours[file];
      }
    }
    await this.saveSettings();
    await this.reconcileActorNodes();
  }

  /** Reports with ANY photo nomination (pending or decided) — decided ones stay
   *  visible in the review with their status + ↺, so a Bekräfta visibly "takes". */
  async reportsWithPhotoFindings(): Promise<{ report: Report; noms: { nom: PhotoNomination; status?: "confirmed" | "rejected" }[] }[]> {
    const { reports } = await this.readReports();
    const rows: { report: Report; noms: { nom: PhotoNomination; status?: "confirmed" | "rejected" }[] }[] = [];
    for (const r of reports.filter((r) => this.imageAttachments(r).length > 0)) {
      const noms = await this.allPhotoNominations(r);
      if (noms.length) rows.push({ report: r, noms });
    }
    return rows;
  }

  /** Total un-actioned photo findings — the feed's "N bildfynd att granska" count. */
  private async photoPendingCount(reports: Report[]): Promise<number> {
    if (!this.settings.visionEnabled) return 0;
    let n = 0;
    for (const r of reports) {
      if (this.imageAttachments(r).length === 0) continue;
      n += (await this.pendingPhotoNominations(r)).length;
    }
    return n;
  }

  /** Auto-run the VLM over image reports not yet swept this session (watcher
   *  path, 📷 on). Quiet: transient "Bild mottagen, analys startad" feed rows
   *  instead of progress Notices; backs off 60 s when Ollama is unreachable.
   *  Deliberately NOT called from baselineAlerts — startup stays silent; the
   *  first watcher recompute (or the chip/command) sweeps the backlog. */
  private async autoAnalyzePhotos(reports: Report[]): Promise<void> {
    if (this.photoRunActive || !this.settings.visionEnabled) return;
    if (Date.now() - this.photoHealthFailedAt < 60_000) return;
    const cand = reports.filter((r) => !this.photoSeen.has(r.file) && this.imageAttachments(r).length > 0);
    if (cand.length === 0) return;
    this.photoRunActive = true;
    try {
      const health = await this.photoVision().health();
      this.visionOnline = health.ok;
      this.getView()?.renderModeStrip();
      if (!health.ok) {
        this.photoHealthFailedAt = Date.now();
        return;
      }
      for (const r of cand) this.analyzingPhotos.add(r.file);
      await this.refreshPanel(); // "📷 Bild mottagen, analys startad" rows appear
      await this.computePhotoSightings(undefined, new Set(cand.map((r) => r.file)));
    } catch (err) {
      console.error("ODEN: auto photo analysis failed", err);
    } finally {
      for (const r of cand) this.analyzingPhotos.delete(r.file);
      this.photoRunActive = false;
    }
    await this.refreshPanel(); // rows swap to "📷 N bildfynd att granska →"
  }

  /** Operator accepts one photo nomination (per-item). Plate → an identifier for
   *  plate re-identification (jobb-a); vehicle/person → report-local annotation.
   *  Re-derives nodes. */
  async acceptPhotoNomination(file: string, nom: PhotoNomination): Promise<void> {
    if (nom.kind === "plate") {
      const arr = this.settings.photoPlates[file] ?? [];
      if (!arr.includes(nom.value)) this.settings.photoPlates[file] = [...arr, nom.value];
    } else {
      const arr = this.settings.photoAnnotations[file] ?? [];
      this.settings.photoAnnotations[file] = [...arr, nom.label];
      // A confirmed person's recon behaviours feed that report's suspicion score.
      if (nom.kind === "person" && nom.recon.length) {
        const cur = this.settings.confirmedBehaviours[file] ?? [];
        const merged = [...cur];
        for (const s of nom.recon) if (!merged.some((x) => x.key === s.key)) merged.push(s);
        this.settings.confirmedBehaviours[file] = merged;
      }
    }
    await this.saveSettings();
    await this.reconcileActorNodes();
  }

  /** Operator rejects one photo nomination — recorded so it won't reappear. */
  async rejectPhotoNomination(file: string, nom: PhotoNomination): Promise<void> {
    this.settings.photoRejected[`${file}|${nomKey(nom)}`] = true;
    await this.saveSettings();
  }

  /** ⋯/command: run photo analysis now (manual path; the toggle also auto-runs). */
  async analyzePhotosFlow(): Promise<void> {
    if (!this.settings.visionEnabled) {
      new Notice("ODEN: slå på Bildanalys först (📷 i panelen).");
      return;
    }
    if (this.photoRunActive) {
      new Notice("ODEN: bildanalys pågår redan.");
      return;
    }
    const health = await this.photoVision().health();
    this.visionOnline = health.ok;
    this.getView()?.renderModeStrip();
    if (!health.ok) {
      new Notice(`ODEN: Ollama nås ej (${health.error ?? "okänd"}) — deterministiskt läge.`);
      return;
    }
    const notice = new Notice("ODEN: analyserar bilder…", 0);
    try {
      const ran = await this.computePhotoSightings((d, t) => notice.setMessage(`ODEN: analyserar bilder… ${d}/${t}`));
      notice.hide();
      new Notice(`ODEN: bildanalys klar (${ran} nya).`);
      await this.showPhotoReview();
    } catch (err) {
      notice.hide();
      console.error("ODEN: photo analysis failed", err);
      new Notice("ODEN: bildanalysen misslyckades (se konsolen).");
    }
  }

  /** Open the per-item photo-review screen in the panel. */
  async showPhotoReview(): Promise<void> {
    await this.revealPanel();
    const rows = await this.reportsWithPhotoFindings();
    this.getView()?.renderPhotoReview(rows);
  }

  /** After a photo decision: stay on the review only while findings remain to
   *  act on; with nothing left pending, return the operator to the live feed. */
  async showPhotoReviewOrFeed(): Promise<void> {
    const rows = await this.reportsWithPhotoFindings();
    const pending = rows.some((r) => r.noms.some((n) => !n.status));
    if (pending) this.getView()?.renderPhotoReview(rows);
    else await this.refreshPanel();
  }

  /** Toggle the Bildanalys capability from the panel chip. Turning ON shows the
   *  honest consequences warning (slow; low marginal value if you'll look anyway;
   *  best for plates + low staffing) before committing. */
  async toggleVision(): Promise<void> {
    if (this.settings.visionEnabled) {
      this.settings.visionEnabled = false;
      await this.saveSettings();
      this.getView()?.renderModeStrip();
      return;
    }
    new ConfirmModal(
      this.app,
      {
        title: "Slå på bildanalys?",
        body:
          "Bildanalys är långsam (≈15 s–4 min per bild på denna maskin) och belastar " +
          "Ollama. Tittar du ändå på bilderna själv är mervärdet litet. Störst nytta: " +
          "registreringsskyltar och perioder med låg bemanning. Fynd föreslås alltid " +
          "för din bekräftelse — inget skrivs automatiskt.",
        confirmText: "Slå på",
        cta: true,
      },
      async () => {
        this.settings.visionEnabled = true;
        await this.saveSettings();
        const health = await this.photoVision().health();
        this.visionOnline = health.ok;
        this.getView()?.renderModeStrip();
        if (!health.ok) new Notice(`ODEN: Ollama nås ej (${health.error ?? "okänd"}).`);
        else void this.analyzePhotosFlow();
      },
    ).open();
  }

  // --- Text-reasoning (📝, open-vocab) + chat (💬) --------------------------
  private ollamaOpts() {
    // qwen3-vl is a full language model → one pulled model serves image AND text.
    return { url: this.settings.ollamaUrl, model: this.settings.visionModel };
  }

  /** The chat engine for a turn: Ollama refine+narrate when 💬 is on, else the
   *  deterministic parser/passthrough. Findings stay deterministic either way. */
  conversationEngine(): Conversation {
    return this.settings.conversationEnabled
      ? new OllamaConversation(this.ollamaOpts())
      : new DeterministicConversation();
  }

  private textHash(prose: string): Promise<string> {
    return this.imageHash(new TextEncoder().encode(prose));
  }
  private prose(r: Report): string {
    return [r.handelse, r.symbol].filter(Boolean).join(". ").trim();
  }

  /** Extract open-vocab marks/behaviours from each report's prose, ONCE per
   *  (content, model, prompt) — no-fishing. Fills the cache. Not in the
   *  watcher hot path. Returns how many reports were newly analysed. */
  async computeTextExtractions(onProgress?: (done: number, total: number) => void, only?: ReadonlySet<string>): Promise<number> {
    if (!this.settings.textReasoningEnabled) return 0;
    const { reports } = await this.readReports();
    const engine = new OllamaText(this.ollamaOpts());
    const targets = reports.filter((r) => this.prose(r) && (!only || only.has(r.file)));
    let ran = 0;
    let done = 0;
    for (const r of targets) {
      const hash = await this.textHash(this.prose(r));
      const cached = this.settings.textExtractions[hash];
      if (!(cached && cached.model === this.settings.visionModel && cached.promptV === TEXT_PROMPT_VERSION)) {
        const extraction = await engine.extract(this.prose(r));
        if (extraction) {
          this.settings.textExtractions[hash] = { model: this.settings.visionModel, promptV: TEXT_PROMPT_VERSION, extraction };
          await this.saveSettings();
          ran++;
        }
      }
      this.textSeen.add(r.file); // session-swept (auto path won't revisit)
      onProgress?.(++done, targets.length);
    }
    return ran;
  }

  /** Total un-actioned text findings — the feed's "N textfynd att granska" count. */
  private async textPendingCount(): Promise<number> {
    if (!this.settings.textReasoningEnabled) return 0;
    const { behaviours, marks } = await this.pendingTextFindings();
    return behaviours.reduce((n, b) => n + b.sigs.length, 0) + marks.length;
  }

  /** Auto-run the text LLM over reports not yet swept this session (watcher
   *  path, 📝 on). Quiet: transient "Meddelande mottaget, analyseras" feed rows
   *  instead of progress Notices; backs off 60 s when Ollama is unreachable.
   *  Not called from baselineAlerts — startup stays silent (see autoAnalyzePhotos). */
  private async autoAnalyzeTexts(reports: Report[]): Promise<void> {
    if (this.textRunActive || !this.settings.textReasoningEnabled) return;
    if (Date.now() - this.textHealthFailedAt < 60_000) return;
    const cand = reports.filter((r) => !this.textSeen.has(r.file) && this.prose(r));
    if (cand.length === 0) return;
    this.textRunActive = true;
    try {
      const health = await new OllamaText(this.ollamaOpts()).health();
      this.visionOnline = health.ok;
      this.getView()?.renderModeStrip();
      if (!health.ok) {
        this.textHealthFailedAt = Date.now();
        return;
      }
      for (const r of cand) this.analyzingTexts.add(r.file);
      await this.refreshPanel(); // "📝 Meddelande mottaget, analyseras" rows appear
      await this.computeTextExtractions(undefined, new Set(cand.map((r) => r.file)));
    } catch (err) {
      console.error("ODEN: auto text analysis failed", err);
    } finally {
      for (const r of cand) this.analyzingTexts.delete(r.file);
      this.textRunActive = false;
    }
    await this.refreshPanel(); // rows swap to "📝 N textfynd att granska →"
  }

  private async textExtractionFor(r: Report): Promise<TextExtraction | undefined> {
    const p = this.prose(r);
    if (!p) return undefined;
    return this.settings.textExtractions[await this.textHash(p)]?.extraction;
  }

  /** All text-mark clusters (regardless of confirm state) from the cache. */
  private async allTextMarkNoms(): Promise<TextMarkNomination[]> {
    const { reports } = await this.readReports();
    const entries: TextMarkEntry[] = [];
    for (const r of reports) {
      const ex = await this.textExtractionFor(r);
      if (ex?.marks.length) entries.push({ file: r.file, tnr: r.tnr, tidpunkt: r.tidpunkt, plats: r.plats, sagesman: r.sagesman, marks: ex.marks });
    }
    return clusterTextMarks(entries);
  }

  /** Pending text findings: per-report behaviour signals + clustered mark noms,
   *  minus what's already confirmed/rejected. */
  async pendingTextFindings(): Promise<{ behaviours: { report: Report; sigs: Signal[] }[]; marks: TextMarkNomination[] }> {
    const { reports } = await this.readReports();
    const behaviours: { report: Report; sigs: Signal[] }[] = [];
    for (const r of reports) {
      const ex = await this.textExtractionFor(r);
      if (!ex) continue;
      const have = new Set((this.settings.confirmedBehaviours[r.file] ?? []).map((b) => b.key));
      const sigs = ex.behaviours.filter((s) => !have.has(s.key) && !this.settings.textRejected[`${r.file}|${s.key}`]);
      if (sigs.length) behaviours.push({ report: r, sigs });
    }
    const marks = (await this.allTextMarkNoms()).filter(
      (n) => !this.settings.textMarksConfirmed[n.key] && !this.settings.textRejected[`mark|${n.key}`],
    );
    return { behaviours, marks };
  }

  async acceptTextBehaviour(file: string, sig: Signal): Promise<void> {
    const cur = this.settings.confirmedBehaviours[file] ?? [];
    if (!cur.some((x) => x.key === sig.key)) this.settings.confirmedBehaviours[file] = [...cur, sig];
    await this.saveSettings();
    await this.reconcileActorNodes();
  }
  async rejectTextBehaviour(file: string, sig: Signal): Promise<void> {
    this.settings.textRejected[`${file}|${sig.key}`] = true;
    await this.saveSettings();
  }
  async acceptTextMark(nom: TextMarkNomination): Promise<void> {
    this.settings.textMarksConfirmed[nom.key] = true;
    await this.saveSettings();
    await this.writeTextMarkNotes();
  }
  async rejectTextMark(nom: TextMarkNomination): Promise<void> {
    this.settings.textRejected[`mark|${nom.key}`] = true;
    await this.saveSettings();
  }

  /** Materialize confirmed text marks as kännetecken hub notes (owned, provenance
   *  llm) linking their member reports — a graph hub like a confirmed mark (jobb-b). */
  private async writeTextMarkNotes(): Promise<void> {
    const confirmed = (await this.allTextMarkNoms()).filter((n) => this.settings.textMarksConfirmed[n.key]);
    const notes = confirmed.map((n) => {
      const obs = n.members.map(
        (m) =>
          `- [[${noteStem(m.file)}|TNR${mdText(m.tnr)}]] — ${mdText(m.tidpunkt)} — ${mdText(m.plats)}` +
          (m.label !== n.label ? ` — ”${mdText(m.label)}”` : ""),
      );
      const body = [
        "---", "typ: entitet", "slag: kännetecken", `nyckel: "${n.key.replace(/"/g, "'")}"`,
        `namn: "${n.label.replace(/"/g, "'")}"`,
        `källa: ${"7s-plugin"}`, `generator: ${"7s-plugin"}`, "föreslagen-av: llm", "bekräftad-av: operatör",
        `metod: ${METOD.textmarke}`, "tags: [kännetecken]", `antal: ${n.count}`, "---", "",
        `# 🎒 ${mdText(n.label)}`, "",
        // Non-TNR edge → visible in the graph despite -file:TNR + showOrphans:false.
        `**Operationsområde:** [[${OBJEKTET_STEM}]]`, "",
        "## Observationer", ...obs, "",
        "_Öppet-vokabulär kännetecken (föreslaget av ODEN:s textmodell, bekräftat av operatören)._", "",
      ].join("\n");
      return { name: safeAgentFilename(`🎒 ${n.label}`, "textmark:" + n.key), body };
    });
    await this.writeOwnedNotes(notes, METOD.textmarke);
  }

  /** ⋯/command: run text analysis now (manual path; the toggle also auto-runs). */
  async analyzeTextFlow(): Promise<void> {
    if (!this.settings.textReasoningEnabled) {
      new Notice("ODEN: slå på Texttolkning först (📝 i panelen).");
      return;
    }
    if (this.textRunActive) {
      new Notice("ODEN: texttolkning pågår redan.");
      return;
    }
    const health = await new OllamaText(this.ollamaOpts()).health();
    this.visionOnline = health.ok;
    this.getView()?.renderModeStrip();
    if (!health.ok) {
      new Notice(`ODEN: Ollama nås ej (${health.error ?? "okänd"}) — deterministiskt läge.`);
      return;
    }
    const notice = new Notice("ODEN: tolkar text…", 0);
    try {
      const ran = await this.computeTextExtractions((d, t) => notice.setMessage(`ODEN: tolkar text… ${d}/${t}`));
      notice.hide();
      new Notice(`ODEN: texttolkning klar (${ran} nya).`);
      await this.showTextReview();
    } catch (err) {
      notice.hide();
      console.error("ODEN: text analysis failed", err);
      new Notice("ODEN: texttolkningen misslyckades (se konsolen).");
    }
  }

  async showTextReview(): Promise<void> {
    await this.revealPanel();
    const findings = await this.pendingTextFindings();
    this.getView()?.renderTextReview(findings);
  }

  /** After a text decision: stay on the review only while findings remain to
   *  act on; with nothing left pending, return the operator to the live feed. */
  async showTextReviewOrFeed(): Promise<void> {
    const findings = await this.pendingTextFindings();
    if (findings.behaviours.length || findings.marks.length) this.getView()?.renderTextReview(findings);
    else await this.refreshPanel();
  }

  /** Toggle the Texttolkning capability (📝). Warns on enable (unmeasured recall;
   *  more nominations to review; safe because gated). */
  async toggleTextReasoning(): Promise<void> {
    if (this.settings.textReasoningEnabled) {
      this.settings.textReasoningEnabled = false;
      await this.saveSettings();
      this.getView()?.renderModeStrip();
      return;
    }
    new ConfirmModal(
      this.app,
      {
        title: "Slå på texttolkning?",
        body:
          "Texttolkning låter en lokal språkmodell föreslå kännetecken och beteenden " +
          "som de fasta ordlistorna missar (högre täckning). Träffsäkerheten är ännu " +
          "OMÄTT — den ger fler förslag att granska, men inget skrivs utan din " +
          "bekräftelse. Långsam (belastar Ollama).",
        confirmText: "Slå på",
        cta: true,
      },
      async () => {
        this.settings.textReasoningEnabled = true;
        await this.saveSettings();
        const health = await new OllamaText(this.ollamaOpts()).health();
        this.visionOnline = health.ok;
        this.getView()?.renderModeStrip();
        if (!health.ok) new Notice(`ODEN: Ollama nås ej (${health.error ?? "okänd"}).`);
        else void this.analyzeTextFlow();
      },
    ).open();
  }

  /** Toggle the chat LLM (💬) — safe (findings stay deterministic), so no warning. */
  async toggleConversation(): Promise<void> {
    this.settings.conversationEnabled = !this.settings.conversationEnabled;
    await this.saveSettings();
    if (this.settings.conversationEnabled) {
      const health = await new OllamaText(this.ollamaOpts()).health();
      this.visionOnline = health.ok;
      if (!health.ok) new Notice(`ODEN: Ollama nås ej (${health.error ?? "okänd"}).`);
    }
    this.getView()?.renderModeStrip();
  }

  /** Materialize one marker note per suspicious AGENT (vehicle/person) — the map
   *  + graph then show the agent, not an abstract alarm. Idempotent; per-job
   *  pruning removes agents that are no longer suspicious. Agents already CONFIRMED
   *  as actors are skipped — they live as a single blue actor node instead (no
   *  red marker twin), and the larm prune removes any stale marker. */
  private async writeSuspectNotes(
    reports: Report[],
    s: SuspicionAnalysis,
    locStemOf?: (plats: string) => string | undefined,
  ): Promise<void> {
    if (!this.settings.materializeAlerts) return;
    const suspects = buildSuspects(reports, s).filter(
      (sp) => this.settings.actorDecisions[suspectHypId(sp.key)] !== "confirmed",
    );
    const notes = renderSuspectNotes(suspects, this.settings.locationNicknames, locStemOf).map((n) => ({ name: n.filename, body: n.markdown }));
    await this.writeOwnedNotes(notes, METOD.larm);
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
      let changed = false;
      for (const a of items) if (!(a.key in this.settings.seenAlerts)) { this.settings.seenAlerts[a.key] = true; changed = true; }
      if (changed) await this.saveSettings();
      this.lastPhotoPending = await this.photoPendingCount(bundle.reports);
      this.lastTextPending = await this.textPendingCount();
      this.lastWatch = await this.watchStatus(bundle);
      const view = this.getView();
      if (view) view.setFeed(buildFeed(buildFeedItems(bundle, this.settings, this.lastCorroboration, this.analyzingPhotos, this.lastPhotoPending, this.analyzingTexts, this.lastTextPending, this.lastWatch)), this.lastWatch);
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
      const fresh = newAlerts(items, this.settings.seenAlerts);
      for (const a of fresh) this.settings.seenAlerts[a.key] = true;
      if (fresh.length) await this.saveSettings();
      this.lastPhotoPending = await this.photoPendingCount(bundle.reports);
      this.lastTextPending = await this.textPendingCount();
      this.lastWatch = await this.watchStatus(bundle);
      const view = this.getView();
      if (view) view.setFeed(buildFeed(buildFeedItems(bundle, this.settings, this.lastCorroboration, this.analyzingPhotos, this.lastPhotoPending, this.analyzingTexts, this.lastTextPending, this.lastWatch)), this.lastWatch);
      // New reports → quiet LLM sweeps with feed events (📷/📝 on only).
      void this.autoAnalyzePhotos(bundle.reports);
      void this.autoAnalyzeTexts(bundle.reports);
      if (silent || fresh.length === 0) return;
      const top = fresh.slice(0, 2).map((a) => a.title).join(" · ");
      new Notice(`ODEN: ${fresh.length} ny händelse — ${top}${fresh.length > 2 ? " …" : ""}`, 8000);
    } catch (err) {
      console.error("ODEN: recompute/alert failed", err);
    }
  }

  /** Command "Uppdatera lägesbild": the one manual analysis escape hatch — a full
   *  recompute of the situation picture (plate re-identification build, suspicion + larm notes,
   *  nominations, feed). Identical to what the watcher does on every vault change;
   *  exists for when the watcher is off, autoBuildEntities is disabled, or the
   *  operator wants an immediate refresh. Non-silent so fresh events Notice. */
  async runUpdateSituation(): Promise<void> {
    await this.revealPanel();
    await this.recomputeAndAlert(false);
    new Notice("ODEN: lägesbild uppdaterad.");
  }

  // --- Demo playback (operator-commanded moves demo/ → inkorg/) --------------
  private demoTimer: number | null = null;
  private demoRunning = false;

  /** Command/menu toggle: running → pause; otherwise ask for a window and start. */
  toggleDemoFeed(): void {
    if (this.demoRunning) {
      if (this.demoTimer !== null) window.clearTimeout(this.demoTimer);
      this.demoTimer = null;
      this.demoRunning = false;
      new Notice("ODEN: demomatning pausad — kör kommandot igen för att fortsätta.");
      return;
    }
    new DemoFeedModal(this.app, (minutes) => this.startDemoFeed(minutes)).open();
  }

  /** The queue is whatever remains under demo/ — moved files are gone, so pause/
   *  resume (and app restarts) need no persisted state. Only files under demo/
   *  are ever touched; the move is an explicit operator command. */
  private startDemoFeed(minutes: number): void {
    const reports = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith("demo/") && /^TNR\d+\.md$/.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name)); // TNR = DDHHMM → chronological
    if (reports.length === 0) {
      new Notice("ODEN: demo/ innehåller inga rapporter (klart, eller redan matat).");
      return;
    }
    const offsets = demoSchedule(reports.map((f) => f.name.slice(3, 9)), minutes);
    this.demoRunning = true;
    new Notice(`ODEN: matar ${reports.length} rapporter över ~${minutes} min — i korpusens egen rytm.`);
    const step = (i: number) => {
      if (!this.demoRunning) return;
      void this.moveDemoReport(reports[i]).then(() => {
        if (i + 1 >= reports.length) {
          this.demoRunning = false;
          this.demoTimer = null;
          new Notice("ODEN: demodata slut — facit finns i demo/facit.json.", 10000);
          return;
        }
        this.demoTimer = window.setTimeout(() => step(i + 1), offsets[i + 1] - offsets[i]);
      });
    };
    this.demoTimer = window.setTimeout(() => step(0), offsets[0]);
  }

  /** Move one report into inkorg/, its photo folder(s) first so embeds resolve
   *  the moment the report lands (folder names contain `_<tnr>-`, the same
   *  contract the packager uses). */
  private async moveDemoReport(report: TFile): Promise<void> {
    try {
      if (!(this.app.vault.getAbstractFileByPath("inkorg") instanceof TFolder)) {
        await this.app.vault.createFolder("inkorg");
      }
      const tnr = report.name.slice(3, -3);
      const parent = report.parent;
      if (parent instanceof TFolder) {
        for (const child of [...parent.children]) {
          if (child instanceof TFolder && child.name.includes(`_${tnr}-`)) {
            await this.app.fileManager.renameFile(child, normalizePath(`inkorg/${child.name}`));
          }
        }
      }
      await this.app.fileManager.renameFile(report, normalizePath(`inkorg/${report.name}`));
    } catch (err) {
      console.error("ODEN: demo move failed", report.path, err);
    }
  }

  /** File-menu: operator flags/unflags a browsed report as an alarm. The flag is
   *  a per-operation judgement — OPERATOR_FLAG_SIGNAL (≥ Hög) rides the
   *  confirmedBehaviours channel so the report elevates with the reason
   *  "flaggad av operatör"; a new operation area wipes it like all judgements. */
  async toggleOperatorFlag(path: string, tnr?: string): Promise<void> {
    const label = tnr ? `TNR${tnr}` : (path.split("/").pop() ?? path);
    if (this.settings.operatorFlagged[path]) {
      delete this.settings.operatorFlagged[path];
      await this.saveSettings();
      new Notice(`ODEN: larmflagga borttagen — ${label}.`);
    } else {
      this.settings.operatorFlagged[path] = true;
      await this.saveSettings();
      new Notice(`ODEN: ${label} flaggad som larm.`);
    }
    await this.recomputeAndAlert(true); // rescore + rewrite larm notes + refresh feed
  }

  // --- 🔭 Bevakningslista (watchlist) ----------------------------------------

  /** Resolve the watchlist against a bundle; repairs new entries' baselines
   *  (added as -1) to the current count so "nya" counts from the watch moment. */
  private async watchStatus(bundle: AnalysisBundle): Promise<WatchRow[]> {
    const entries = Object.values(this.settings.watchlist);
    if (entries.length === 0) return [];
    const textMarks = entries.some((w) => w.kind === "textmärke") ? await this.allTextMarkNoms() : [];
    const suspects = entries.some((w) => w.kind === "person")
      ? buildSuspects(bundle.reports, bundle.suspicion)
      : [];
    const rows = buildWatchStatus(bundle, this.settings, textMarks, suspects);
    let repaired = false;
    for (const row of rows) {
      const w = this.settings.watchlist[row.key];
      if (w && w.baseline < 0) { w.baseline = row.count; repaired = true; }
    }
    if (repaired) await this.saveSettings();
    return rows;
  }

  /** Add or remove a watch (file-menu "Bevaka"/"Sluta bevaka"). */
  async toggleWatch(entry: Omit<WatchEntry, "addedAt" | "baseline">): Promise<void> {
    const key = `${entry.kind}:${entry.ref}`;
    if (this.settings.watchlist[key]) {
      delete this.settings.watchlist[key];
      await this.saveSettings();
      new Notice(`ODEN: "${entry.label}" borttagen ur bevakningslistan.`);
    } else {
      this.settings.watchlist[key] = { ...entry, addedAt: new Date().toISOString(), baseline: -1 };
      await this.saveSettings();
      new Notice(`ODEN: 🔭 bevakar "${entry.label}".`);
    }
    await this.refreshPanel();
  }

  /** Clicking a 🔭 row = seen: baseline moves to the current count. */
  async markWatchSeen(key: string, count: number): Promise<void> {
    const w = this.settings.watchlist[key];
    if (!w) return;
    w.baseline = count;
    await this.saveSettings();
    await this.refreshPanel();
  }

  /** The last-computed status row for a watch key (feed-row click helper). */
  lastWatchRow(key: string): WatchRow | undefined {
    return this.lastWatch.find((w) => w.key === key);
  }

  /** ⋯ menu: the watchlist manager screen (fresh status first). */
  async openWatchlist(): Promise<void> {
    await this.revealPanel();
    const bundle = await this.analyzeBundle();
    this.lastWatch = await this.watchStatus(bundle);
    this.getView()?.showWatchlist(this.lastWatch);
  }

  /** Manager screen: drop one watch. */
  async removeWatch(key: string): Promise<void> {
    const w = this.settings.watchlist[key];
    if (!w) return;
    delete this.settings.watchlist[key];
    await this.saveSettings();
    new Notice(`ODEN: "${w.label}" borttagen ur bevakningslistan.`);
  }

  /** Map a right-clicked vault note to its watchable identity, using the keys the
   *  note renderers emit (fordon: namn; aktör: id; suspect: agent_nyckel;
   *  nominated mark (jobb-b): signatur; text-mark: nyckel; report: file path). */
  private watchTargetForNote(fm: Record<string, unknown> | undefined, file: TFile): Omit<WatchEntry, "addedAt" | "baseline"> | null {
    const owned = fm?.generator === GENERATOR;
    const s = (v: unknown) => (v != null ? String(v) : "");
    if (!owned) {
      const isReport = fm?.tnr != null || /^TNR/i.test(file.basename);
      if (!isReport) return null;
      return { kind: "händelse", ref: file.path, label: fm?.tnr != null ? `TNR${s(fm.tnr)}` : file.basename };
    }
    const slag = s(fm?.slag);
    if (slag.startsWith("fordon-reg")) return { kind: "fordon", ref: s(fm?.namn), label: s(fm?.namn) };
    if (slag === "aktör" && fm?.id != null) return { kind: "aktör", ref: s(fm.id), label: s(fm?.namn) };
    if (s(fm?.typ) === "misstänkt" && fm?.agent_nyckel != null) {
      const key = s(fm.agent_nyckel);
      // A vehicle suspect IS its plate — watch the vehicle so the watch survives
      // the suspect note being pruned/confirmed away.
      if (key.startsWith("fordon:")) return { kind: "fordon", ref: key.slice("fordon:".length), label: s(fm?.namn) };
      return { kind: "person", ref: key, label: s(fm?.namn) };
    }
    if (slag === "kannetecken" && fm?.signatur != null) return { kind: "märke", ref: s(fm.signatur), label: s(fm?.namn) };
    if (slag === "kännetecken" && fm?.nyckel != null) return { kind: "textmärke", ref: s(fm.nyckel), label: s(fm?.namn) };
    return null;
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

/** The chat's opening system hint — shown on open and again after clearChat(). */
const CHAT_HINT =
  'Skriv en fråga om larm, aktörer, fordon, farkoster, platser eller kännetecken — ' +
  't.ex. "vilka larm har vi?", "visa drönarobservationer", "återkommande fordon", ' +
  '"sammanfatta läget vid Köpmanholm", eller en regplåt.';

/** The plugin's only UI: a passive text panel that renders Markdown. */
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
  private modeEl!: HTMLElement;
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

    // Header: title · 🌙/☀︎ tema · ＋Obs · ⋯ menu
    const header = body.createDiv();
    header.style.cssText =
      "display:flex;align-items:center;gap:8px;padding:4px 8px;border-bottom:1px solid var(--background-modifier-border);";
    header.createEl("strong", { text: "ODEN" });
    header.createDiv().style.flex = "1";
    const theme = header.createEl("button");
    theme.setAttribute("aria-label", "Växla mörkt/ljust läge");
    const themeGlyph = () => (document.body.hasClass("theme-dark") ? "🌙" : "☀︎");
    theme.setText(themeGlyph());
    theme.onclick = () => {
      this.plugin.toggleTheme();
      theme.setText(themeGlyph());
    };
    const obs = header.createEl("button", { text: "＋ Obs" });
    obs.setAttribute("aria-label", "Ny observation");
    obs.onclick = () => this.plugin.openNewObservation();
    header.createEl("button", { text: "⋯" }).onclick = (e) => this.plugin.openPanelMenu(e);

    // Mode strip — operation mode the operator sees + changes directly (the status
    // IS the control). Capability chips over the always-on deterministic core.
    this.modeEl = body.createDiv();
    this.renderModeStrip();

    // Feed (top, scrollable) — live events + alarms, also hosts review screens.
    this.feedEl = body.createDiv();
    this.feedEl.style.cssText = "flex:1;overflow-y:auto;padding:6px 8px;";

    // Chat (bottom) — always available.
    const chat = body.createDiv();
    chat.style.cssText =
      "display:flex;flex-direction:column;border-top:1px solid var(--background-modifier-border);max-height:45%;";
    this.chatLogEl = chat.createDiv();
    this.chatLogEl.style.cssText = "flex:1;overflow-y:auto;padding:6px 8px;";
    // Rendered [[TNR…]] citations: MarkdownRenderer only BUILDS the anchors — a
    // custom view must route internal-link clicks itself, or they do nothing.
    this.chatLogEl.addEventListener("click", (e) => {
      const link = (e.target as HTMLElement).closest?.("a.internal-link");
      if (!link) return;
      e.preventDefault();
      const target = link.getAttribute("data-href") ?? link.getAttribute("href") ?? link.textContent ?? "";
      if (target) void this.plugin.app.workspace.openLinkText(target, "", false);
    });
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

    this.addChatSystem(CHAT_HINT);
    void this.plugin.refreshPanel();
  }

  /** Empty the conversation back to the opening hint. The chat is DOM-only (never
   *  persisted), but a NEW operation area must not show answers grounded in the
   *  previous operation's data — called from clearAllJudgements(). */
  clearChat(): void {
    this.chatLogEl.empty();
    this.addChatSystem(CHAT_HINT);
  }

  /** Leave a review screen and return to showing the live feed. */
  enterFeedMode(): void {
    this.mode = "feed";
  }

  /** Render the live event/alarm feed (newest first; alarms in red). Suppressed
   *  while a review screen is open so a background refresh can't wipe it. */
  setFeed(rows: FeedRow[], watch: WatchRow[] = []): void {
    if (this.mode === "review") return;
    const el = this.feedEl;
    el.empty();

    // First-run: guide the operator to set the area of interest before anything else.
    if (!this.plugin.settings.setupComplete) {
      const card = el.createDiv();
      card.style.cssText =
        "padding:10px 12px;margin-bottom:10px;border-radius:6px;border:1px solid var(--interactive-accent);background:var(--background-secondary-alt);";
      card.createEl("div", { text: "🎯 Kom igång" }).style.cssText = "font-weight:700;margin-bottom:4px;";
      card.createEl("div", {
        text: "Ange operationens område av intresse (objektet). ODEN mäter närhet mot denna punkt och centrerar kartan där.",
      }).style.cssText = "font-size:.9em;opacity:.85;margin-bottom:8px;";
      const btn = card.createEl("button", { text: "Konfigurera operationsområde", cls: "mod-cta" });
      btn.onclick = () => this.plugin.openOperationSetup();
    }

    // 🔭 Bevakningslista — the operator's short "keep an eye on these" list,
    // pinned above the log. Visibility only; clicking opens the note AND marks
    // its new activity as seen (baseline reset).
    if (watch.length) {
      el.createEl("div", { text: "🔭 Bevakningslista" }).style.cssText = "font-weight:600;opacity:.7;margin-bottom:4px;";
      const box = el.createDiv();
      box.style.cssText = "margin:0 0 10px;";
      for (const w of watch) {
        const row = box.createDiv();
        row.style.cssText =
          "padding:3px 4px;border-radius:4px;cursor:pointer;font-size:.9em;" +
          (w.fresh > 0 ? "color:var(--color-orange, #d80);font-weight:600;" : "");
        const seen = w.lastSeen ? ` · senast ${w.lastSeen.slice(0, 16).replace("T", " ")}` : "";
        const obs = w.kind === "händelse" ? "" : ` — ${w.count} obs`;
        row.setText(`🔭 ${w.label}${obs}${seen}${w.fresh > 0 ? ` · +${w.fresh} nya` : ""}`);
        row.onclick = () => {
          if (w.fresh > 0) void this.plugin.markWatchSeen(w.key, w.count);
          if (w.stem) this.plugin.app.workspace.openLinkText(w.stem, "", false);
        };
        row.onmouseenter = () => (row.style.background = "var(--background-modifier-hover)");
        row.onmouseleave = () => (row.style.background = "");
      }
    }

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
            (r.severity === "larm"
              ? "color:var(--text-error);font-weight:600;"
              : r.severity === "bevakad"
                ? "color:var(--color-orange, #d80);font-weight:600;"
                : "");
      row.style.cssText = base;
      row.setText(r.text);
      row.onclick = () => {
        if (r.review === "actors") void this.plugin.runDeriveActors();
        else if (r.review === "marks") void this.plugin.runMarkNominations();
        else if (r.review === "photos") void this.plugin.showPhotoReview();
        else if (r.review === "texts") void this.plugin.showTextReview();
        else if (r.review === "place" && r.place) this.plugin.promptLocationName(r.place);
        else {
          // A 🔭 row: seeing it = seen (baseline reset), then open the note.
          if (r.watchKey) {
            const w = this.plugin.lastWatchRow(r.watchKey);
            if (w) void this.plugin.markWatchSeen(w.key, w.count);
          }
          this.plugin.app.workspace.openLinkText(r.stem, "", false);
        }
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

  /** Append the operator's question + a pending "…" answer; return the answer
   *  element to fill once the (possibly slow) engine responds. */
  beginChat(question: string): HTMLElement {
    const q = this.chatLogEl.createDiv();
    q.style.cssText = "margin:8px 0 2px;font-weight:600;";
    q.setText("▸ " + question);
    const a = this.chatLogEl.createDiv();
    a.setText("…");
    a.style.opacity = ".6";
    this.chatLogEl.scrollTop = this.chatLogEl.scrollHeight;
    return a;
  }

  /** Replace a pending placeholder with the rendered answer (never blank). */
  async fillChat(a: HTMLElement, prose: string): Promise<void> {
    a.empty();
    a.style.opacity = "";
    await MarkdownRenderer.render(this.plugin.app, prose || "_(inget svar)_", a, "", this.plugin);
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

  /** The operation-mode strip: capability chips (click to toggle) + connection dot.
   *  The deterministic core is always on (implied "deterministiskt läge" when no
   *  chip is lit); the chips are additive LLM layers. */
  renderModeStrip(): void {
    const el = this.modeEl;
    el.empty();
    el.style.cssText =
      "display:flex;align-items:center;gap:6px;padding:3px 8px;border-bottom:1px solid var(--background-modifier-border);font-size:.8em;";
    const s = this.plugin.settings;
    const chip = (text: string, on: boolean, enabled: boolean, onClick?: () => void) => {
      const c = el.createEl("span", { text });
      c.style.cssText =
        `padding:1px 8px;border-radius:9px;cursor:${enabled ? "pointer" : "default"};` +
        (on
          ? "background:var(--interactive-accent);color:var(--text-on-accent);"
          : `background:var(--background-modifier-border);opacity:${enabled ? "1" : ".4"};`);
      if (enabled && onClick) c.onclick = onClick;
      else if (!enabled) c.setAttribute("aria-label", "Kommer i senare fas");
      return c;
    };
    chip("📷 Bild", s.visionEnabled, true, () => void this.plugin.toggleVision());
    chip("📝 Text", s.textReasoningEnabled, true, () => void this.plugin.toggleTextReasoning());
    chip("💬 Chat", s.conversationEnabled, true, () => void this.plugin.toggleConversation());
    el.createDiv().style.flex = "1";
    const anyOn = s.visionEnabled || s.textReasoningEnabled || s.conversationEnabled;
    const dot = el.createEl("span");
    if (anyOn) {
      const ok = this.plugin.visionOnline;
      dot.setText(ok ? `● ${s.visionModel}` : "○ offline");
      dot.style.cssText = `color:${ok ? "var(--text-success)" : "var(--text-error)"};`;
    } else {
      dot.setText("deterministiskt läge");
      dot.style.opacity = ".5";
    }
  }

  /** Per-item photo-review screen: each report's cached
   *  sighting → per plate/vehicle/person accept-or-reject, shown OVER the photo so
   *  the operator judges against the evidence. Plates lead (the killer app). */
  async renderPhotoReview(rows: { report: Report; noms: { nom: PhotoNomination; status?: "confirmed" | "rejected" }[] }[]): Promise<void> {
    const content = this.reviewHead("Bildfynd att granska");
    if (!rows.length) {
      content.createEl("p", { text: "Inga bildfynd att granska. Kör bildanalys (📷) först." }).style.opacity = ".7";
      return;
    }
    const order = { plate: 0, vehicle: 1, person: 2 } as const;
    // Reports with pending findings first; fully-decided cards after.
    const ordered = [
      ...rows.filter((r) => r.noms.some((n) => !n.status)),
      ...rows.filter((r) => r.noms.every((n) => n.status)).reverse(),
    ];
    for (const { report, noms } of ordered) {
      const card = content.createDiv();
      card.style.cssText = "border:1px solid var(--background-modifier-border);border-radius:6px;padding:8px;margin:0 0 10px;";
      const head = card.createEl("div", { text: `TNR${report.tnr}${report.plats ? " — " + report.plats : ""}` });
      head.style.cssText = "font-weight:600;font-size:.9em;margin-bottom:6px;";
      // Thumbnail — confirm against the evidence.
      const img = this.plugin.imageAttachments(report)[0];
      const tf = img ? this.plugin.app.metadataCache.getFirstLinkpathDest(img, report.file) : null;
      if (tf instanceof TFile) {
        const el = card.createEl("img");
        el.src = this.plugin.app.vault.getResourcePath(tf);
        el.style.cssText = "max-width:100%;max-height:200px;border-radius:4px;margin-bottom:6px;display:block;";
      }
      const sorted = [...noms].sort((a, b) => (a.status ? 1 : 0) - (b.status ? 1 : 0) || order[a.nom.kind] - order[b.nom.kind]);
      for (const { nom, status } of sorted) {
        const row = card.createDiv();
        row.style.cssText = "display:flex;align-items:center;gap:6px;padding:2px 0;font-size:.9em;";
        const tag = nom.kind === "plate" ? "📷 Skylt" : nom.kind === "vehicle" ? "📷 Fordon" : "📷 Person";
        const val =
          nom.kind === "plate"
            ? `${nom.value}${nom.conflict ? " ⚠ avviker från regplåten i texten" : ""}`
            : nom.label;
        const statusTxt = status === "confirmed" ? "  ·  ✓ bekräftad" : status === "rejected" ? "  ·  ✗ avvisad" : "";
        const span = row.createEl("span", { text: `${tag}: ${val}${statusTxt}` });
        span.style.cssText =
          "flex:1;" +
          (nom.kind === "plate" && nom.conflict && !status ? "color:var(--text-error);" : "") +
          (status ? "opacity:.65;" : "");
        if (!status) {
          const acc = row.createEl("button", { text: "Bekräfta", cls: "mod-cta" });
          acc.onclick = async () => {
            await this.plugin.acceptPhotoNomination(report.file, nom);
            await this.plugin.showPhotoReviewOrFeed();
          };
          row.createEl("button", { text: "Avvisa" }).onclick = async () => {
            await this.plugin.rejectPhotoNomination(report.file, nom);
            await this.plugin.showPhotoReviewOrFeed();
          };
        } else {
          row.createEl("button", { text: "↺ Ångra beslut" }).onclick = async () => {
            await this.plugin.undoPhotoNomination(report.file, nom);
            await this.plugin.showPhotoReview();
          };
        }
      }
    }
  }

  /** Text-findings review (📝): recurring open-vocab kännetecken (→ hub note) and
   *  per-report behaviours (→ suspicion score). Each accepted/rejected on its own. */
  async renderTextReview(findings: { behaviours: { report: Report; sigs: Signal[] }[]; marks: TextMarkNomination[] }): Promise<void> {
    const content = this.reviewHead("Textfynd att granska");
    const { behaviours, marks } = findings;
    if (!behaviours.length && !marks.length) {
      content.createEl("p", { text: "Inga textfynd att granska. Kör texttolkning (📝) först." }).style.opacity = ".7";
      return;
    }
    const heading = (t: string) => {
      content.createEl("div", { text: t }).style.cssText = "font-weight:600;opacity:.75;margin:6px 0 4px;";
    };
    if (marks.length) {
      heading("Kännetecken (återkommande — blir en nod)");
      for (const nom of marks) {
        // Evidence card: the operator must see WHICH reports carried the mark
        // (and each report's own phrasing) to be able to judge it.
        const card = content.createDiv();
        card.style.cssText =
          "border:1px solid var(--background-modifier-border);border-radius:6px;padding:6px 8px;margin:0 0 8px;font-size:.9em;";
        const top = card.createDiv();
        top.style.cssText = "display:flex;align-items:center;gap:6px;";
        top.createEl("span", { text: `🔤 ${nom.label} — ${nom.count} rapporter` }).style.cssText = "flex:1;font-weight:600;";
        top.createEl("button", { text: "Bekräfta", cls: "mod-cta" }).onclick = async () => {
          await this.plugin.acceptTextMark(nom);
          await this.plugin.showTextReviewOrFeed();
        };
        top.createEl("button", { text: "Avvisa" }).onclick = async () => {
          await this.plugin.rejectTextMark(nom);
          await this.plugin.showTextReviewOrFeed();
        };
        const obs = card.createEl("ul");
        obs.style.cssText = "margin:4px 0 0;";
        for (const m of nom.members) {
          const li = obs.createEl("li");
          const a = li.createEl("a", { text: `TNR${m.tnr}` });
          a.onclick = () => this.plugin.app.workspace.openLinkText(noteStem(m.file), "", false);
          li.appendText(` — ${m.tidpunkt} — ${m.plats}${m.label !== nom.label ? ` — ”${m.label}”` : ""}`);
        }
      }
    }
    if (behaviours.length) {
      heading("Beteenden (matas till misstankepoängen)");
      for (const { report, sigs } of behaviours) {
        for (const sig of sigs) {
          const row = content.createDiv();
          row.style.cssText = "display:flex;align-items:center;gap:6px;padding:2px 0;font-size:.9em;";
          const span = row.createEl("span");
          span.style.flex = "1";
          span.appendText("🔤 ");
          const a = span.createEl("a", { text: `TNR${report.tnr}` });
          a.onclick = () => this.plugin.app.workspace.openLinkText(noteStem(report.file), "", false);
          span.appendText(`${report.plats ? " — " + report.plats : ""}: ${sig.label}`);
          row.createEl("button", { text: "Bekräfta", cls: "mod-cta" }).onclick = async () => {
            await this.plugin.acceptTextBehaviour(report.file, sig);
            await this.plugin.showTextReviewOrFeed();
          };
          row.createEl("button", { text: "Avvisa" }).onclick = async () => {
            await this.plugin.rejectTextBehaviour(report.file, sig);
            await this.plugin.showTextReviewOrFeed();
          };
        }
      }
    }
  }

  /** Places screen IN THE PANEL (not a modal, which would block the map): list +
   *  remove + add. The map stays interactive alongside, so the operator can
   *  right-click it → "Copy geolocation" and paste into the position field. */
  showPlaces(initCoord?: string): void {
    const content = this.reviewHead("Namngivna platser");
    content.createEl("p", {
      text:
        "Namnge kända platser (grindar, förråd, infarter). Observationer inom radien " +
        "kopplas till platsen i grafen. Skyddsvärda platser ger dessutom larmsignal vid närhet.",
    }).style.cssText = "opacity:.75;margin:0 0 10px;font-size:.9em;";

    // Existing places, with remove buttons.
    const entries = Object.entries(this.plugin.settings.predefinedLocations).sort(([a], [b]) =>
      a.localeCompare(b, "sv"),
    );
    if (entries.length > 0) {
      const list = content.createDiv();
      list.style.cssText = "margin:0 0 12px;";
      for (const [name, p] of entries) {
        const row = list.createDiv();
        row.style.cssText = "display:flex;align-items:center;gap:8px;padding:2px 0;";
        const txt = row.createEl("span", {
          text: `📍 ${name} — radie ${p.radiusM} m${p.sensitive ? " — 🛡️ skyddsvärd" : ""}`,
        });
        txt.style.cssText = "flex:1;font-size:.92em;";
        row.createEl("button", { text: "Ta bort" }).onclick = async () => {
          await this.plugin.removePredefinedPlace(name);
          this.showPlaces();
        };
      }
    }

    // Report places the operator has NAMED (nickname on an observed MGRS grid) —
    // the same operator concept, lighter capability: no radius, no skyddsvärd
    // (those require the operator-created kind above). "Ta bort namn" keeps
    // locationNameAsked so the feed's naming nudge doesn't immediately reappear.
    const nicks = Object.entries(this.plugin.settings.locationNicknames).sort(([, a], [, b]) =>
      a.localeCompare(b, "sv"),
    );
    if (nicks.length > 0) {
      content.createEl("div", { text: "Namngivna rapportplatser" }).style.cssText =
        "font-weight:600;font-size:.9em;margin:0 0 4px;";
      const list = content.createDiv();
      list.style.cssText = "margin:0 0 12px;";
      for (const [grid, nick] of nicks) {
        const row = list.createDiv();
        row.style.cssText = "display:flex;align-items:center;gap:8px;padding:2px 0;";
        const txt = row.createEl("span", { text: `📍 ${nick} — ${grid}` });
        txt.style.cssText = "flex:1;font-size:.92em;";
        row.createEl("button", { text: "Ta bort namn" }).onclick = async () => {
          await this.plugin.removeLocationNickname(grid);
          this.showPlaces();
        };
      }
    }

    // Add form.
    const nameIn = content.createEl("input", { type: "text" });
    nameIn.placeholder = "Namn (t.ex. Norra grinden)";
    nameIn.style.cssText = "width:100%;margin:0 0 6px;";

    const coordIn = content.createEl("input", { type: "text" });
    coordIn.placeholder = "Position: 59.2622,17.712  eller  33VXF5453072480";
    coordIn.style.cssText = "width:100%;margin:0 0 2px;";
    if (initCoord) coordIn.value = initCoord; // from a map seed
    content.createEl("div", {
      text:
        "Tips: högerklicka i kartan → “Copy geolocation as front matter” (kopierar direkt, " +
        "ingen dialog) och klistra in här. Eller “New note here (front matter)” — då fylls " +
        "positionen i automatiskt.",
    }).style.cssText = "opacity:.55;font-size:.8em;margin:0 0 6px;";

    const optRow = content.createDiv();
    optRow.style.cssText = "display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:0 0 6px;";
    optRow.createEl("span", { text: "Radie (m):" }).style.cssText = "font-size:.9em;";
    const radIn = optRow.createEl("input", { type: "number" });
    radIn.value = "100";
    radIn.style.cssText = "width:90px;";
    const sensLbl = optRow.createEl("label");
    sensLbl.style.cssText = "display:flex;gap:4px;align-items:center;font-size:.9em;cursor:pointer;";
    const sensIn = sensLbl.createEl("input", { type: "checkbox" });
    sensLbl.appendText("Skyddsvärd (larma vid närhet)");

    const err = content.createEl("div");
    err.style.cssText = "color:var(--text-error);font-size:.85em;min-height:1.2em;margin-bottom:8px;";

    const add = content.createEl("button", { text: "Lägg till", cls: "mod-cta" });
    add.onclick = async () => {
      const name = nameIn.value.trim();
      if (!name) {
        err.setText("Ange ett namn på platsen.");
        return;
      }
      const c = parseCoord(coordIn.value);
      if (!c) {
        err.setText("Kunde inte tolka positionen — ange lat,lon, en MGRS-ruta eller klistra in från kartan.");
        return;
      }
      const radiusM = Math.round(Number(radIn.value));
      if (!Number.isFinite(radiusM) || radiusM < 10) {
        err.setText("Radien måste vara minst 10 m.");
        return;
      }
      err.setText("");
      await this.plugin.addPredefinedPlace(name, { lat: c.lat, lon: c.lon, radiusM, sensitive: sensIn.checked });
      this.showPlaces(); // stay on the screen — the operator often adds several
    };
    window.setTimeout(() => nameIn.focus(), 0);
  }

  /** 🔭 Watchlist manager — the operator's short list, with status + remove. */
  showWatchlist(rows: WatchRow[]): void {
    const content = this.reviewHead("Bevakningslista");
    content.createEl("p", {
      text:
        "Entiteter du valt att hålla extra koll på. Bevakning påverkar ALDRIG misstankepoängen — " +
        "den styr bara synlighet (🔭-raderna i loggen). Lägg till genom att högerklicka en rapport, " +
        "ett fordon, en aktör eller ett kännetecken → \"ODEN: Bevaka\".",
    }).style.cssText = "opacity:.75;margin:0 0 10px;font-size:.9em;";
    if (!rows.length) {
      content.createEl("p", { text: "Bevakningslistan är tom." }).style.opacity = ".6";
      return;
    }
    const kindWord: Record<WatchRow["kind"], string> = {
      fordon: "fordon", aktör: "aktör", person: "person", märke: "kännetecken",
      textmärke: "kännetecken", händelse: "rapport",
    };
    for (const w of rows) {
      const row = content.createDiv();
      row.style.cssText = "display:flex;align-items:center;gap:8px;padding:3px 0;font-size:.92em;";
      const seen = w.lastSeen ? ` · senast ${w.lastSeen.slice(0, 16).replace("T", " ")}` : "";
      const obs = w.kind === "händelse" ? "" : ` — ${w.count} obs`;
      const txt = row.createEl("span", {
        text: `🔭 ${w.label} (${kindWord[w.kind]})${obs}${seen}${w.fresh > 0 ? ` · +${w.fresh} nya` : ""}`,
      });
      txt.style.cssText = "flex:1;" + (w.fresh > 0 ? "color:var(--color-orange, #d80);font-weight:600;" : "");
      if (w.stem) {
        row.createEl("button", { text: "Öppna" }).onclick = () => {
          if (w.fresh > 0) void this.plugin.markWatchSeen(w.key, w.count);
          this.plugin.app.workspace.openLinkText(w.stem!, "", false);
        };
      }
      row.createEl("button", { text: "Ta bort" }).onclick = async () => {
        await this.plugin.removeWatch(w.key);
        await this.plugin.openWatchlist();
      };
    }
  }

  /** Render actor hypotheses with threshold control + confirm/reject. */
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

    // Pending suggestions first (in derivation order); already-decided ones after,
    // newest decision-ish last-in-first-out (reverse of appearance) so the
    // operator's working set is always at the top.
    const ordered = [
      ...result.hypotheses.filter((h) => !decisions[h.id]),
      ...result.hypotheses.filter((h) => decisions[h.id]).reverse(),
    ];
    for (const h of ordered) {
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
        const stem = noteStem(step.file);
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

    // Pending first; decided after in reverse order of appearance (see renderActors).
    const ordered = [
      ...result.nominations.filter((n) => !decisions[n.signature]),
      ...result.nominations.filter((n) => decisions[n.signature]).reverse(),
    ];
    for (const nom of ordered) {
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
        const stem = noteStem(m.file);
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

    // Which build is running — version (matches the community-plugin listing)
    // + the baked-in build stamp, so testing is never against a stale bundle.
    const ver = containerEl.createEl("div", {
      text: `ODEN v${this.plugin.manifest.version} — build ${ODEN_BUILD}`,
    });
    ver.style.cssText = "opacity:.6;font-size:.85em;margin:0 0 12px;";

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
      .setName("Sagesman (din signal)")
      .setDesc("Förvald sagesman/callsign för observationer du själv skapar.")
      .addText((text) =>
        text
          .setPlaceholder("OP")
          .setValue(this.plugin.settings.operatorCallsign)
          .onChange(async (value) => {
            this.plugin.settings.operatorCallsign = value.trim() || "OP";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Objektet — koordinat")
      .setDesc(
        "Lat,lon för objektet som ska bevakas. Används av misstankeanalysen för närhets-" +
          "signalen (haversine). Sätts enklast via \"Konfigurera operationsområde\". Format: \"lat,lon\".",
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
      .setName("Förenklade menyer")
      .setDesc(
        "Visa bara ODEN-val och de vanligaste alternativen (byt namn, radera, " +
          "kopiera/klistra in) i högerklicksmenyerna. Stäng av om en Obsidian-" +
          "uppdatering skulle ändra menyerna.",
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.simplifiedMenus).onChange(async (v) => {
          this.plugin.settings.simplifiedMenus = v;
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

    // --- Lokal LLM — CONFIGURATION only. On/off per capability is a live mode in
    //     the panel (📷/📝/💬 chips), not here. One model serves all three. ---
    new Setting(containerEl).setName("Lokal LLM (bild · text · chat)").setHeading();
    containerEl.createEl("div", {
      text: "På/av sätts direkt i panelen (📷 bild · 📝 text · 💬 chat) — det är driftläge, inte konfiguration. Kräver en lokal Ollama-server; samma modell betjänar alla tre.",
    }).style.cssText = "opacity:.7;font-size:.85em;margin:-6px 0 8px;";

    new Setting(containerEl)
      .setName("Ollama-adress")
      .setDesc("URL till den lokala Ollama-servern (kan peka på en kraftfullare maskin i nätverket).")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_OLLAMA_URL)
          .setValue(this.plugin.settings.ollamaUrl)
          .onChange(async (value) => {
            this.plugin.settings.ollamaUrl = value.trim() || DEFAULT_OLLAMA_URL;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Modell")
      .setDesc("Bildmodell (Ollama). qwen3-vl:4b är standard; större modeller är noggrannare men kräver mer RAM.")
      .addDropdown((d) => {
        for (const m of VISION_MODELS) d.addOption(m.tag, m.label);
        d.setValue(this.plugin.settings.visionModel).onChange(async (v) => {
          this.plugin.settings.visionModel = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Anslutning")
      .setDesc(`ODEN v${this.plugin.manifest.version} — build ${ODEN_BUILD}`)
      .addButton((b) =>
        b.setButtonText("Testa anslutning").onClick(async () => {
          const h = await new OllamaVision({ url: this.plugin.settings.ollamaUrl, model: this.plugin.settings.visionModel }).health();
          if (!h.ok) new Notice(`ODEN: Ollama nås ej (${h.error ?? "okänd"}).`);
          else if (!(h.models ?? []).includes(this.plugin.settings.visionModel))
            new Notice(`ODEN: Ollama svarar, men ${this.plugin.settings.visionModel} är inte hämtad. Kör: ollama pull ${this.plugin.settings.visionModel}`);
          else new Notice(`ODEN: Ollama ✓ — ${this.plugin.settings.visionModel} redo.`);
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
    placeholder = "Välj plats att namnge…",
  ) {
    super(app);
    this.setPlaceholder(placeholder);
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

/** Free-text naming dialog for a confirmed actor (the graph node's label). */
class NameActorModal extends Modal {
  constructor(
    app: App,
    private suggested: string,
    private onDone: (name: string | null) => void | Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Namnge aktör" });
    contentEl.createEl("p", {
      text: "Ge aktören ett namn (visas som nodens etikett i grafen). Lämna tomt för att behålla det härledda namnet.",
    }).style.cssText = "opacity:.75;margin:0 0 10px;font-size:.9em;";
    const input = contentEl.createEl("input", { type: "text" });
    input.value = this.suggested;
    input.placeholder = "t.ex. Spanare vid norra grinden";
    input.style.cssText = "width:100%;margin:0 0 12px;";
    const btns = contentEl.createDiv();
    btns.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";
    const ok = btns.createEl("button", { text: "Bekräfta aktör", cls: "mod-cta" });
    btns.createEl("button", { text: "Avbryt" }).onclick = () => {
      this.close();
      void this.onDone(null);
    };
    const done = () => {
      this.close();
      void this.onDone(input.value);
    };
    ok.onclick = done;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") done();
    });
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Fuzzy picker over actor hypotheses (used for the merge flow). */
class PickActorModal extends FuzzySuggestModal<ActorHypothesis> {
  constructor(
    app: App,
    private actors: ActorHypothesis[],
    private names: Record<string, string>,
    placeholder: string,
    private onPick: (h: ActorHypothesis) => void,
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  getItems(): ActorHypothesis[] {
    return this.actors;
  }

  getItemText(h: ActorHypothesis): string {
    const desc = h.facets.map((f) => f.label).join(" + ") || `${h.vehicleCount}f ${h.markCount}k`;
    const nm = this.names[h.id];
    return nm ? `${nm} — ${desc}` : desc;
  }

  onChooseItem(h: ActorHypothesis): void {
    this.onPick(h);
  }
}

/** Fuzzy picker over labelled string values (used for the undo-merge flow). */
class PickStringModal extends FuzzySuggestModal<{ value: string; label: string }> {
  constructor(
    app: App,
    private items: { value: string; label: string }[],
    placeholder: string,
    private onPick: (value: string) => void,
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  getItems(): { value: string; label: string }[] {
    return this.items;
  }

  getItemText(i: { value: string; label: string }): string {
    return i.label;
  }

  onChooseItem(i: { value: string; label: string }): void {
    this.onPick(i.value);
  }
}

/** Generic confirm/cancel dialog for a destructive action. */
/** Ask for the demo playback window (minutes) before starting the feed. */
class DemoFeedModal extends Modal {
  constructor(
    app: App,
    private readonly onSubmit: (minutes: number) => void,
  ) {
    super(app);
  }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Mata demodata" });
    contentEl.createEl("p", {
      text:
        "Rapporterna flyttas från demo/ till inkorg/ i korpusens egen rytm, " +
        "komprimerad till det tidsfönster du väljer. Kör kommandot igen för att pausa.",
    }).style.cssText = "opacity:.8;font-size:.9em;";
    const row = contentEl.createDiv();
    row.style.cssText = "display:flex;gap:8px;align-items:center;margin:8px 0;";
    row.createEl("span", { text: "Speltid (minuter):" });
    const input = row.createEl("input", { type: "number" });
    input.value = "15";
    input.min = "1";
    input.style.width = "80px";
    const btns = contentEl.createDiv();
    btns.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:10px;";
    const start = btns.createEl("button", { text: "Starta", cls: "mod-cta" });
    const submit = () => {
      const m = Math.max(1, Math.round(Number(input.value) || 15));
      this.close();
      this.onSubmit(m);
    };
    start.onclick = submit;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    btns.createEl("button", { text: "Avbryt" }).onclick = () => this.close();
    window.setTimeout(() => input.focus(), 0);
  }
  onClose(): void {
    this.contentEl.empty();
  }
}

class ConfirmModal extends Modal {
  constructor(
    app: App,
    private opts: { title: string; body: string; confirmText?: string; cancelText?: string; cta?: boolean },
    private onConfirm: () => void | Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.opts.title });
    contentEl.createEl("p", { text: this.opts.body }).style.cssText = "opacity:.85;margin:0 0 12px;";
    const btns = contentEl.createDiv();
    btns.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";
    // Destructive confirmations warn (default); a plain offer uses the CTA style.
    const ok = btns.createEl("button", { text: this.opts.confirmText ?? "Fortsätt", cls: this.opts.cta ? "mod-cta" : "mod-warning" });
    btns.createEl("button", { text: this.opts.cancelText ?? "Avbryt" }).onclick = () => this.close();
    ok.onclick = () => {
      this.close();
      void this.onConfirm();
    };
    window.setTimeout(() => ok.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Parse "lat,lon" or an MGRS grid into coordinates. */

/** Setup dialog: name the operation + set the protected object's coordinate. */
class SetupOperationModal extends Modal {
  constructor(
    app: App,
    private init: { name: string; lat: number; lon: number },
    private onDone: (res: { name: string; lat: number; lon: number }) => void | Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Operationsområde" });
    contentEl.createEl("p", {
      text: "Ange objektet/området som ska bevakas. ODEN mäter närhet mot denna punkt och centrerar kartan där.",
    }).style.cssText = "opacity:.75;margin:0 0 10px;font-size:.9em;";

    const nameIn = contentEl.createEl("input", { type: "text" });
    nameIn.placeholder = "Operation ODEN";
    nameIn.value = this.init.name;
    nameIn.style.cssText = "width:100%;margin:0 0 8px;";

    const coordIn = contentEl.createEl("input", { type: "text" });
    coordIn.placeholder = "Koordinat: 59.2622,17.712  eller  33VXF5453072480";
    coordIn.value = this.init.lat && this.init.lon ? `${this.init.lat},${this.init.lon}` : "";
    coordIn.style.cssText = "width:100%;margin:0 0 6px;";

    const err = contentEl.createEl("div");
    err.style.cssText = "color:var(--text-error);font-size:.85em;min-height:1.2em;margin-bottom:8px;";

    const btns = contentEl.createDiv();
    btns.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";
    const save = btns.createEl("button", { text: "Spara", cls: "mod-cta" });
    btns.createEl("button", { text: "Avbryt" }).onclick = () => this.close();
    save.onclick = () => {
      const c = parseCoord(coordIn.value);
      if (!c) {
        err.setText("Kunde inte tolka koordinaten — ange lat,lon eller en MGRS-ruta.");
        return;
      }
      this.close();
      void this.onDone({ name: nameIn.value.trim(), lat: c.lat, lon: c.lon });
    };
    window.setTimeout(() => nameIn.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** A Map View "New note here" seed → converge into ODEN's validated flows:
 *  create a predefined place at the click, or name the nearest unnamed grid.
 *  Choosing an action absorbs the seed note (it only carried the coordinate);
 *  "Ignorera" keeps it and never asks about that path again. */
class MapSeedModal extends Modal {
  constructor(
    app: App,
    private plugin: SevenSPlugin,
    private path: string,
    private coord: LatLon,
    private near?: { key: string; distanceM: number },
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Ny plats från kartan" });
    contentEl.createEl("p", {
      text:
        `En kartnot skapades på ${this.coord.lat.toFixed(5)}, ${this.coord.lon.toFixed(5)}. ` +
        "Väljer du en åtgärd tas kartnoten bort — koordinaten följer med.",
    }).style.cssText = "opacity:.8;margin:0 0 12px;font-size:.9em;";

    const btns = contentEl.createDiv();
    btns.style.cssText = "display:flex;flex-direction:column;gap:8px;";
    const mk = (text: string, cta: boolean, onClick: () => void | Promise<void>) => {
      const b = btns.createEl("button", { text, cls: cta ? "mod-cta" : "" });
      b.onclick = () => {
        this.close();
        void onClick();
      };
    };

    mk("Skapa namngiven plats här…", true, async () => {
      await this.plugin.absorbMapSeed(this.path);
      await this.plugin.openManagePlaces(`${this.coord.lat},${this.coord.lon}`);
    });
    if (this.near) {
      mk(`Namnge platsen ${this.near.key} (~${this.near.distanceM} m)…`, false, async () => {
        await this.plugin.absorbMapSeed(this.path);
        await this.plugin.promptLocationName(this.near!.key);
      });
    }
    mk("Ignorera (behåll noten)", false, async () => {
      this.plugin.settings.mapSeedHandled[this.path] = true;
      await this.plugin.saveSettings();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Guided template dialog → a complete operator-authored 7S observation. */
class NewObservationModal extends Modal {
  constructor(
    app: App,
    private init: { tidpunkt: string; sagesman: string },
    private onDone: (obs: {
      tidpunkt: string; plats: string; sagesman: string; handelse: string; symbol?: string;
    }) => void | Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Ny observation" });

    const field = (label: string, hint = "") => {
      const l = contentEl.createEl("div", { text: label });
      l.style.cssText = "font-weight:600;font-size:.85em;margin:8px 0 2px;";
      if (hint) {
        const h = contentEl.createEl("div", { text: hint });
        h.style.cssText = "opacity:.6;font-size:.8em;margin-bottom:2px;";
      }
    };

    // Fields follow the 7S order: Stund · Ställe · Händelse · Symbol · Sagesman.
    field("Stund");
    const time = contentEl.createEl("input", { type: "datetime-local" });
    time.value = this.init.tidpunkt.slice(0, 16);
    time.style.cssText = "width:100%;";

    field("Ställe", "Platsnamn och/eller MGRS-ruta (koordinat härleds från rutan)");
    const plats = contentEl.createEl("input", { type: "text" });
    plats.placeholder = "t.ex. Vid grindarna  ·  33VXF5453072480";
    plats.style.cssText = "width:100%;";

    field("Händelse", "(Slag, Styrka, Sysselsättning)");
    const hand = contentEl.createEl("textarea");
    hand.rows = 3;
    hand.style.cssText = "width:100%;resize:vertical;";

    field("Symbol", "Kännetecken — valfritt");
    const sym = contentEl.createEl("textarea");
    sym.rows = 2;
    sym.style.cssText = "width:100%;resize:vertical;";

    field("Sagesman");
    const cs = contentEl.createEl("input", { type: "text" });
    cs.value = this.init.sagesman;
    cs.style.cssText = "width:100%;";

    const err = contentEl.createEl("div");
    err.style.cssText = "color:var(--text-error);font-size:.85em;min-height:1.2em;margin:6px 0;";

    const btns = contentEl.createDiv();
    btns.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:6px;";
    const save = btns.createEl("button", { text: "Skapa", cls: "mod-cta" });
    btns.createEl("button", { text: "Avbryt" }).onclick = () => this.close();
    save.onclick = () => {
      const platsVal = plats.value.trim();
      const handelse = hand.value.trim();
      if (!platsVal || !handelse) {
        err.setText("Fyll i minst Ställe och Händelse.");
        return;
      }
      const t = time.value ? `${time.value}:00` : this.init.tidpunkt;
      this.close();
      void this.onDone({
        tidpunkt: t, plats: platsVal, sagesman: cs.value.trim() || this.init.sagesman,
        handelse, symbol: sym.value.trim() || undefined,
      });
    };
    window.setTimeout(() => plats.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
