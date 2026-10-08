// Run: npm test — Kurdish and Arabic texts must be complete and not mixed up.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { eq, finish } from "./testkit.ts";
import { dict } from "../src/i18n.tsx";

const ckb = dict.ckb as Record<string, string>;
const ar = dict.ar as Record<string, string>;

eq("same keys in both languages", Object.keys(ckb).sort(), Object.keys(ar).sort());
eq("no empty text (Kurdish)", Object.entries(ckb).filter(([, v]) => !v.trim()).map(([k]) => k), []);
eq("no empty text (Arabic)", Object.entries(ar).filter(([, v]) => !v.trim()).map(([k]) => k), []);

// Letters that exist only in Kurdish (Sorani) must not leak into Arabic text, and Arabic-only forms must not appear in Kurdish.
const kurdishOnly = /[ەڕۆێڵڤگپچژک]/; // ک (Kurdish kaf) is fine in Kurdish but wrong in Arabic
const arabicOnly = /[يكةى]/;
eq("Arabic texts contain no Kurdish-only letters", Object.entries(ar).filter(([, v]) => kurdishOnly.test(v)).map(([k, v]) => `${k}: ${v}`), []);
// Exception: the shop's brand name is written exactly as the owner chose (Arabic spelling) in both languages.
const BRAND_KEYS = new Set(["appName"]);
eq("Kurdish texts contain no Arabic-only letters", Object.entries(ckb).filter(([k, v]) => !BRAND_KEYS.has(k) && arabicOnly.test(v)).map(([k, v]) => `${k}: ${v}`), []);
eq("brand name is identical in both languages", ckb.appName, ar.appName);

// Month lists must have 12 names in both languages.
eq("12 month names (Kurdish, Arabic)", [ckb.months.split(",").length, ar.months.split(",").length], [12, 12]);

// Every key is used somewhere in the code (dead texts get removed).
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css)$/.test(n) && n !== "i18n.tsx" ? [p] : [];
  });
}
const source = files(new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")).map((f) => readFileSync(f, "utf8")).join("\n");
const unused = Object.keys(ckb).filter((k) => !source.includes(`"${k}"`) && !source.includes(`'${k}'`) && !source.includes(`\`${k}\``));
eq("no unused texts", unused, []);
finish();
