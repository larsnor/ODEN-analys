import esbuild from "esbuild";
import { execSync } from "node:child_process";

const production = process.argv[2] === "production";

// Build stamp baked into the bundle (shown in ODEN's settings tab + console) so
// the operator knows EXACTLY which build is running, not just the version.
// `--dirty` marks builds from an uncommitted tree.
const commit = (() => {
  try {
    return execSync("git describe --tags --always --dirty", { encoding: "utf-8" }).trim();
  } catch {
    return "okänd";
  }
})();
const stamp = `${commit} · ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;

const banner =
  "/* 7S-analys (Bin 3) — bundled by esbuild. Source: src/. Build: " + stamp + " */";

const ctx = await esbuild.context({
  banner: { js: banner },
  define: { __ODEN_BUILD__: JSON.stringify(stamp) },
  entryPoints: ["src/main.ts"],
  bundle: true,
  // `obsidian` and Electron/CodeMirror internals are provided by the host.
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  platform: "browser",
});

if (production) {
  await ctx.rebuild();
  await ctx.dispose();
} else {
  await ctx.watch();
}
