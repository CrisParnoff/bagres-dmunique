import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { Script } from "node:vm";
import { createHash } from "node:crypto";
const css = readFileSync("styles.css", "utf8");
const cssVersion = createHash("sha256").update(css).digest("hex").slice(0,12);
const source = readFileSync("server/worker.template.mjs", "utf8");
const app = ["artwork.js", "app.js", "ui.js"].map(path => readFileSync(path, "utf8")).join("\n");
const logoDataUri = `data:image/webp;base64,${readFileSync("assets/fcbagres-logo.webp").toString("base64")}`;
const mascotDataUri = `data:image/webp;base64,${readFileSync("assets/fcbagres-mascot-cutout.webp").toString("base64")}`;
// Check the exact browser script before embedding it in the Worker output.
new Script(app, { filename: "app.js" });
const replacements = {
  "__HTML_CONTENT__": JSON.stringify(readFileSync("index.html", "utf8").replace('href="styles.css"', `href="styles.css?v=${cssVersion}"`).replace("__FCBAGRES_LOGO_DATA_URI__", logoDataUri).replace("__FCBAGRES_MASCOT_DATA_URI__", mascotDataUri)),
  "__CSS_CONTENT__": JSON.stringify(css),
  "__APP_CONTENT__": JSON.stringify(app)
};
let worker = source;
// Replacement strings interpret $ sequences; use a callback so JavaScript stays byte-for-byte intact.
for (const [placeholder, value] of Object.entries(replacements)) worker = worker.replace(placeholder, () => value);
if (!worker.includes(`const APP = ${JSON.stringify(app)};`)) throw new Error("The browser script changed during packaging");
mkdirSync("dist/server", { recursive: true });
writeFileSync("dist/server/index.js", worker);
