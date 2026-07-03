import esbuild from "esbuild";

const production = process.argv[2] === "production";

const banner =
  "/* 7S-analys (Bin 3) — bundled by esbuild. Source: src/. */";

const ctx = await esbuild.context({
  banner: { js: banner },
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
