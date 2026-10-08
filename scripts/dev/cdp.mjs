// Developer tool: drive the running app window from the command line (no clicking by hand).
// It talks to WebView2 through the Chrome DevTools Protocol, so the app must be started with a debug port:
//
//   PowerShell:  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"; npm run tauri dev
//   Run a script file in the page:   node scripts/dev/cdp.mjs my-steps.js [screenshot.png]
//
// The script file is plain JavaScript run INSIDE the page (async allowed, `return` a value to print it).
// The helpers in helpers.js are available: sleep(ms), setVal(el, value), btn(text), dlg().
//
// Optional environment variables:
//   CDP_PORT=9223      debug port (default 9222)
//   CDP_WIDTH=960 CDP_HEIGHT=900   emulate a window size for this run (and take the screenshot at that size)
//   CDP_PDF=out.pdf    also save the page as it would print (print CSS applied, A4)
//
// CAUTION: this drives the REAL app and its REAL database. Only read, or ask the owner first before saving anything.
// (Lesson learned: never script the Dashboard PIN screen on the owner's PC: wrong tries lock it.)
import { readFileSync, writeFileSync } from "node:fs";

const PORT = process.env.CDP_PORT ?? "9222";
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find((t) => t.type === "page");
if (!page) {
  console.log("NO PAGE", JSON.stringify(targets));
  process.exit(1);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  }
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

if (process.env.CDP_WIDTH) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: Number(process.env.CDP_WIDTH),
    height: Number(process.env.CDP_HEIGHT ?? 800),
    deviceScaleFactor: 1,
    mobile: false,
  });
  await new Promise((r) => setTimeout(r, 400));
}

const helpers = readFileSync(new URL("./helpers.js", import.meta.url), "utf8");
const steps = readFileSync(process.argv[2], "utf8");
const r = await send("Runtime.evaluate", {
  expression: `(async()=>{${helpers}\n${steps}})()`,
  awaitPromise: true,
  returnByValue: true,
});
if (r.result?.exceptionDetails) console.log("EXC", JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails));
else console.log(JSON.stringify(r.result?.result?.value, null, 1));

if (process.argv[3]) {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(process.argv[3], Buffer.from(shot.result.data, "base64"));
}
if (process.env.CDP_PDF) {
  const pdf = await send("Page.printToPDF", { printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false });
  writeFileSync(process.env.CDP_PDF, Buffer.from(pdf.result.data, "base64"));
}
if (process.env.CDP_WIDTH) await send("Emulation.clearDeviceMetricsOverride");
ws.close();
