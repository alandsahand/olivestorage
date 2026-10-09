import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Check, Pencil, Phone, Plus, RotateCcw, Search, Trash2, Truck, X } from "lucide-react";
import { useI18n } from "@/i18n";
import { Button, Chip, ConfirmModal, MoneyInput, PAGE_SIZE, ShowMore, inputCls } from "@/components/ui";
import { formatDateTime, formatNumber, formatQty, normalizeText, parseMoney, parseQty, qtyText } from "@/lib/format";
import { useErrorText } from "@/lib/errors";
import { splitCosts } from "@/lib/purchaseMath";
import { refText, storedFromBought, type RatioDir } from "@/lib/units";
import * as stock from "@/data/stock";
import * as pur from "@/data/purchases";
import type { Item, Named } from "@/data/stock";
import type { Purchase, PurchaseDetail, Supplier } from "@/data/purchases";

type Ref = { ratio_milli: number; dir: RatioDir };
type Line = {
  item_id: number;
  name: string;
  unit: string; // store unit
  qty: string; // what goes into stock (store unit)
  paid: number | null;
  fixed: number | null; // real unit price typed by the owner
  // bought in another unit (docs/flow.md section 7): which unit, how much, and the reference used to fill "stored"
  buyUnitId: number | null;
  buyUnit: string | null;
  ref: Ref | null;
  bought: string;
  storedTouched: boolean;
};
type Extra = { name: string; amount: number | null };

/** The real unit price box: applied when the owner finishes typing (Enter / leaving the box), so the other
 *  prices don't jump on every digit. Clearing it puts the line back to the equal split. */
function PriceInput({ value, onCommit }: { value: number; onCommit: (v: number | null) => void }) {
  const [text, setText] = useState<string | null>(null); // null = not being edited
  function commit() {
    if (text === null) return;
    const v = parseMoney(text);
    setText(null);
    if (v !== value) onCommit(v && v > 0 ? v : null);
  }
  return (
    <input
      className={`${inputCls} text-center font-extrabold text-olive-d`}
      inputMode="numeric"
      value={text ?? formatNumber(value)}
      onFocus={() => setText(formatNumber(value))}
      onChange={(e) => {
        const v = parseMoney(e.target.value);
        setText(v === null ? "" : formatNumber(v));
      }}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

/* ---------- new purchase / edit purchase ---------- */

function PurchaseForm({
  editing,
  onEditDone,
  onStopEditing,
}: {
  editing: PurchaseDetail | null;
  onEditDone: () => void;
  onStopEditing: () => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Named[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [catFilter, setCatFilter] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  const [supplierName, setSupplierName] = useState(editing?.supplier_name ?? "");
  const [phone, setPhone] = useState(editing?.supplier_phone ?? "");
  const [lines, setLines] = useState<Line[]>(
    () =>
      editing?.lines.map((l) => {
        const conv = l.buy_unit_id !== null && !!l.buy_qty_milli;
        return {
          item_id: l.item_id,
          name: l.item_name,
          unit: l.unit_name,
          qty: qtyText(l.qty_milli),
          paid: l.line_paid,
          fixed: l.price_fixed ? l.buy_price : null,
          buyUnitId: conv ? l.buy_unit_id : null,
          buyUnit: conv ? l.buy_unit_name : null,
          // until the items are loaded, the proportion this purchase really had stands in for the reference
          ref: conv ? { ratio_milli: Math.round((l.qty_milli * 1000) / (l.buy_qty_milli as number)), dir: "buy" as const } : null,
          bought: conv ? qtyText(l.buy_qty_milli as number) : "",
          storedTouched: conv,
        };
      }) ?? [],
  );
  const [extras, setExtras] = useState<Extra[]>(() =>
    editing ? editing.extras.map((x) => ({ name: x.name, amount: x.amount })) : [{ name: t("extraDefault"), amount: null }],
  );
  // "paid to the supplier" follows the order total (paid in full) until the owner types a different amount
  const [paid, setPaid] = useState<number | null>(editing?.paid ?? null);
  const [paidTouched, setPaidTouched] = useState(!!editing);
  const [note, setNote] = useState(editing?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{ id: number; total: number } | null>(null);

  const reload = useCallback(async () => {
    const [i, c, s] = await Promise.all([stock.listItems(), stock.listCategories(), pur.listSuppliers()]);
    setItems(i);
    setCategories(c);
    setSuppliers(s);
    setLoaded(true);
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const shown = useMemo(() => {
    const q = normalizeText(query);
    return items.filter((i) => (catFilter === null || i.category_id === catFilter) && (!q || normalizeText(i.name).includes(q)));
  }, [items, catFilter, query]);

  // live numbers: exactly the same calculation the data layer uses when saving
  const parsed = lines.map((l) => ({ ...l, q: parseQty(l.qty), b: l.buyUnitId ? parseQty(l.bought) : null }));
  const valid = parsed.every((l) => l.q && l.paid && l.paid > 0 && (!l.buyUnitId || l.b));
  const single = lines.length === 1; // one item carries all the extra costs: its price can't be typed
  const extrasTotal = extras.reduce((s, x) => s + (x.amount ?? 0), 0);
  const split = splitCosts(
    parsed.map((l) => ({ qty_milli: l.q ?? 0, paid: l.paid ?? 0, fixed_unit: single ? null : l.fixed })),
    extrasTotal,
  );
  const total = split.total;
  const later = editing?.later_paid ?? 0; // payments made to the supplier after the purchase (kept when editing)
  const effPaid = paidTouched ? (paid ?? 0) : Math.max(0, total - later);
  const owed = total - effPaid - later;
  const overpaid = effPaid + later > total;
  const needSupplier = owed > 0 && !supplierName.trim();
  const splitProblem = valid && lines.length > 0 ? split.problem : null;
  const anyFixed = !single && lines.some((l) => l.fixed !== null);
  const canSave = lines.length > 0 && valid && !splitProblem && !overpaid && !needSupplier && !busy;

  function addItem(i: Item) {
    setSaved(null);
    const conv = i.buy_unit_id !== null && !!i.buy_ratio_milli && !!i.buy_ratio_dir;
    const line: Line = {
      item_id: i.id,
      name: i.name,
      unit: i.unit_name,
      qty: "",
      paid: null,
      fixed: null,
      buyUnitId: conv ? i.buy_unit_id : null,
      buyUnit: conv ? i.buy_unit_name : null,
      ref: conv ? { ratio_milli: i.buy_ratio_milli as number, dir: i.buy_ratio_dir as RatioDir } : null,
      bought: "",
      storedTouched: false,
    };
    // clicking a selected item again takes it out of the purchase
    setLines((ls) => (ls.some((l) => l.item_id === i.id) ? ls.filter((l) => l.item_id !== i.id) : [...ls, line]));
  }
  /** The item reference if it still buys in the same unit, else the proportion the line already had. */
  const refFor = (l: Line): Ref | null => {
    const it = items.find((i) => i.id === l.item_id);
    if (it && it.buy_unit_id === l.buyUnitId && it.buy_ratio_milli && it.buy_ratio_dir) return { ratio_milli: it.buy_ratio_milli, dir: it.buy_ratio_dir };
    return l.ref;
  };
  /** A new bought quantity fills "stored" again from the reference (and puts a typed price back to automatic). */
  function setBought(ix: number, text: string) {
    const l = lines[ix];
    const ref = refFor(l);
    const b = parseQty(text);
    const stored = b && ref ? storedFromBought(b, ref.ratio_milli, ref.dir) : 0;
    patch(ix, { bought: text, qty: stored ? qtyText(stored) : "", storedTouched: false, fixed: null });
  }
  const patch = (ix: number, p: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === ix ? { ...l, ...p } : l)));
  const patchExtra = (ix: number, p: Partial<Extra>) => setExtras((xs) => xs.map((x, k) => (k === ix ? { ...x, ...p } : x)));

  // A phone filled in from a known supplier follows the name; a phone the owner typed is never replaced
  // (otherwise switching from supplier A to B would save A's phone on B).
  const [phoneAuto, setPhoneAuto] = useState(false);
  function pickSupplier(name: string) {
    setSupplierName(name);
    if (phone.trim() && !phoneAuto) return;
    const known = suppliers.find((s) => s.name.toLowerCase() === name.trim().toLowerCase());
    setPhone(known?.phone ?? "");
    setPhoneAuto(!!known?.phone);
  }

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setError("");
    const input: pur.PurchaseInput = {
      supplier_name: supplierName,
      supplier_phone: phone,
      paid: effPaid,
      note,
      extras: extras.map((x) => ({ name: x.name, amount: x.amount ?? 0 })),
      lines: parsed.map((l) => ({
        item_id: l.item_id,
        qty_milli: l.q as number,
        paid: l.paid as number,
        fixed_unit: single ? null : l.fixed,
        buy: l.buyUnitId ? { unit_id: l.buyUnitId, qty_milli: l.b as number } : null,
      })),
    };
    try {
      if (editing) {
        await pur.updatePurchase(editing.id, input);
        onEditDone();
      } else {
        const id = await pur.createPurchase(input);
        setSaved({ id, total });
        setLines([]);
        setExtras([{ name: t("extraDefault"), amount: null }]);
        setSupplierName("");
        setPhone("");
        setPhoneAuto(false);
        setPaid(null);
        setPaidTouched(false);
        setNote("");
        await reload();
      }
    } catch (e) {
      setError(errorText(e));
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1fr_1.35fr]">
      {/* item picker */}
      <div>
        <div className="mb-3 flex items-center gap-3 rounded-2xl border-2 border-line bg-white px-4 py-3 focus-within:border-olive">
          <Search className="size-5 text-muted" />
          <input className="flex-1 bg-transparent text-lg outline-none" placeholder={t("search")} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          <Chip active={catFilter === null} onClick={() => setCatFilter(null)}>
            {t("all")}
          </Chip>
          {categories.map((c) => (
            <Chip key={c.id} active={catFilter === c.id} onClick={() => setCatFilter(c.id)}>
              {c.name}
            </Chip>
          ))}
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
          {shown.map((i) => {
            const inList = lines.some((l) => l.item_id === i.id);
            return (
              <button
                key={i.id}
                onClick={() => addItem(i)}
                className={`flex flex-col gap-1 rounded-2xl border-2 p-4 text-start transition ${
                  inList ? "border-olive bg-olive-l" : "border-line bg-white hover:-translate-y-0.5 hover:border-olive"
                }`}
              >
                <b className="text-lg">{i.name}</b>
                <small className="text-base text-muted">
                  {formatQty(i.on_hand_milli)} {i.unit_name}
                </small>
                {i.buy_unit_name && i.buy_ratio_milli && i.buy_ratio_dir && (
                  <span className="text-sm text-olive-d">{refText(i.unit_name, i.buy_unit_name, i.buy_ratio_milli, i.buy_ratio_dir)}</span>
                )}
                <span className="text-sm text-muted">
                  {t("lastCost")}: {i.last_buy_price === null ? "—" : `${formatNumber(i.last_buy_price)} ${t("currency")}`}
                </span>
              </button>
            );
          })}
        </div>
        {loaded && shown.length === 0 && (
          <p className="rounded-3xl bg-white p-8 text-center text-lg text-muted shadow-sm">{items.length === 0 ? t("purchaseNoItems") : t("emptyFilter")}</p>
        )}
      </div>

      {/* the purchase */}
      <div className="rounded-3xl bg-white p-6 shadow-sm">
        {editing && (
          <div className="mb-4 flex items-center justify-between gap-2 rounded-2xl bg-warn-l p-3 font-bold text-warn">
            <span>
              {t("editingPurchase")} #{formatNumber(editing.id)}
            </span>
            <Button small variant="secondary" onClick={onStopEditing}>
              {t("stopEditing")}
            </Button>
          </div>
        )}
        {saved && (
          <div className="mb-4 flex items-center gap-2 rounded-2xl bg-good-l p-3 font-bold text-good">
            <Check className="size-5" /> {t("purchaseSaved")}: {formatNumber(saved.total)} {t("currency")}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_1fr]">
          <label className="block">
            <span className="mb-1.5 flex items-center gap-2 font-bold">
              <Truck className="size-5 text-olive" /> {t("supplier")}
            </span>
            <input className={inputCls} list="suppliers-list" placeholder={t("supplierPlaceholder")} value={supplierName} onChange={(e) => pickSupplier(e.target.value)} />
            <datalist id="suppliers-list">
              {suppliers.map((s) => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className="mb-1.5 flex items-center gap-2 font-bold">
              <Phone className="size-5 text-olive" /> {t("phoneOptional")}
            </span>
            <input className={inputCls} dir="ltr" inputMode="tel" maxLength={40} value={phone} onChange={(e) => { setPhone(e.target.value); setPhoneAuto(false); }} />
          </label>
        </div>

        <div className="mb-1.5 mt-5 font-bold">{t("invoiceItems")}</div>
        {lines.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-line p-6 text-center text-muted">
            {t("emptyInvoice")}
            <br />
            {t("pickItemHint")}
          </div>
        ) : (
          <ul className="space-y-3">
            {parsed.map((l, ix) => {
              const res = split.lines[ix];
              const bad = !l.q || !l.paid || (!!l.buyUnitId && !l.b);
              const conv = !!l.buyUnitId;
              const ref = conv ? refFor(l) : null;
              const auto = conv && l.b && ref ? storedFromBought(l.b, ref.ratio_milli, ref.dir) : 0;
              return (
                <li key={l.item_id} className={`rounded-2xl border-2 p-3 ${bad && (l.qty || l.paid !== null) ? "border-bad bg-bad-l/40" : "border-line"}`}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <b className="text-lg">{l.name}</b>
                    <button
                      onClick={() => setLines((ls) => ls.filter((_, k) => k !== ix))}
                      aria-label={t("remove")}
                      title={t("remove")}
                      className="rounded-lg p-1.5 text-muted hover:bg-bg hover:text-bad"
                    >
                      <X className="size-5" />
                    </button>
                  </div>
                  <div className={`grid gap-2 ${conv ? "grid-cols-2" : "grid-cols-3"}`}>
                    {conv && (
                      <label className="block">
                        <span className="mb-1 block text-sm text-muted">
                          {t("qty")} ({l.buyUnit})
                        </span>
                        <input className={`${inputCls} !px-2 text-center font-extrabold`} inputMode="decimal" value={l.bought} onChange={(e) => setBought(ix, e.target.value)} />
                      </label>
                    )}
                    <label className="block">
                      <span className="mb-1 block text-sm text-muted">
                        {conv ? t("storedQty") : t("qty")} ({l.unit})
                      </span>
                      {/* changing the quantity or the money puts a typed price back to automatic: it was typed for the old numbers */}
                      <input
                        className={`${inputCls} !px-2 text-center font-extrabold`}
                        inputMode="decimal"
                        value={l.qty}
                        onChange={(e) => patch(ix, { qty: e.target.value, fixed: null, storedTouched: true })}
                      />
                      {conv && (
                        <span className="mt-0.5 block text-center text-sm text-muted">
                          {auto && l.q !== auto ? `${t("byReference")}: ${formatQty(auto)}` : " "}
                        </span>
                      )}
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-sm text-muted">
                        {t("paidForItem")} ({t("currency")})
                      </span>
                      <MoneyInput value={l.paid} onChange={(v) => patch(ix, { paid: v, fixed: null })} />
                      <span className="mt-0.5 block text-center text-sm text-muted">
                        {l.q && l.paid ? `${formatNumber((l.paid * 1000) / l.q)} ${t("beforeExtras")}` : " "}
                      </span>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-sm font-bold text-olive-d">{t("realUnitPrice")}</span>
                      {single || bad ? (
                        <div className={`${inputCls} bg-olive-l text-center font-extrabold text-olive-d`}>{bad ? "—" : formatNumber(res.unit_price)}</div>
                      ) : (
                        <PriceInput value={res.unit_price} onCommit={(v) => patch(ix, { fixed: v })} />
                      )}
                      <span className={`mt-0.5 block text-center text-sm ${l.fixed !== null && !single ? "font-bold text-warn" : "text-muted"}`}>
                        {l.fixed !== null && !single ? t("priceEdited") : `${t("perUnit")} ${l.unit}`}
                      </span>
                      {conv && !bad && l.b && (
                        <span className="block text-center text-sm text-muted">
                          {formatNumber((res.cost_total * 1000) / l.b)} {t("perUnit")} {l.buyUnit}
                        </span>
                      )}
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {(anyFixed || splitProblem) && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-base text-bad">
              {splitProblem === "too_low" && t("splitTooLow")}
              {splitProblem === "mismatch" && `${t("splitMismatch")}: ${formatNumber(split.diff)} ${t("currency")}`}
            </span>
            {anyFixed && (
              <Button small variant="secondary" onClick={() => setLines((ls) => ls.map((l) => ({ ...l, fixed: null })))}>
                <RotateCcw className="size-4" /> {t("backToEqual")}
              </Button>
            )}
          </div>
        )}

        <div className="mb-1.5 mt-5 font-bold">{t("extraCosts")}</div>
        <ul className="space-y-2">
          {extras.map((x, ix) => (
            <li key={ix} className="grid grid-cols-[1.3fr_1fr_auto] items-center gap-2">
              <input className={inputCls} aria-label={t("extraName")} maxLength={60} value={x.name} onChange={(e) => patchExtra(ix, { name: e.target.value })} />
              <MoneyInput value={x.amount} onChange={(v) => patchExtra(ix, { amount: v })} />
              <button
                onClick={() => setExtras((xs) => xs.filter((_, k) => k !== ix))}
                aria-label={t("remove")}
                title={t("remove")}
                className="rounded-lg p-2 text-muted hover:bg-bg hover:text-bad"
              >
                <Trash2 className="size-5" />
              </button>
            </li>
          ))}
        </ul>
        <Button small variant="ghost" className="mt-2" onClick={() => setExtras((xs) => [...xs, { name: "", amount: null }])}>
          <Plus className="size-4" /> {t("addExtraCost")}
        </Button>

        <div className="my-5 rounded-2xl bg-olive-l p-4">
          <div className="flex justify-between text-muted">
            <span>{t("goodsTotal")}</span>
            <span>
              {formatNumber(split.goods)} {t("currency")}
            </span>
          </div>
          <div className="flex justify-between text-muted">
            <span>{t("extrasTotal")}</span>
            <span>
              {formatNumber(split.extras)} {t("currency")}
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between border-t border-olive/20 pt-2">
            <span className="text-muted">{t("total")}</span>
            <span className="text-4xl font-extrabold text-olive-d">
              {formatNumber(total)} <span className="text-xl">{t("currency")}</span>
            </span>
          </div>
        </div>

        <div className="mb-1.5 flex items-center justify-between">
          <span className="font-bold">{t("paidToSupplier")}</span>
          <Button
            small
            variant="ghost"
            onClick={() => {
              setPaidTouched(false);
              setPaid(null);
            }}
          >
            {t("payAll")}
          </Button>
        </div>
        <MoneyInput
          value={effPaid}
          onChange={(v) => {
            setPaidTouched(true);
            setPaid(v);
          }}
        />
        {later > 0 && (
          <p className="mt-1 text-base text-muted">
            {t("laterPaidNote")}: {formatNumber(later)} {t("currency")}
          </p>
        )}
        {overpaid && <p className="mt-1 text-base text-bad">{t("paidTooMuch")}</p>}
        <div className={`my-4 flex justify-between text-lg ${owed > 0 ? "font-bold text-bad" : "text-muted"}`}>
          <span>{t("weOweSupplier")}</span>
          <span>
            {formatNumber(Math.max(0, owed))} {t("currency")}
          </span>
        </div>
        {needSupplier && lines.length > 0 && <p className="mb-3 text-base text-bad">{t("supplierRequired")}</p>}

        <label className="mb-1.5 block font-bold">{t("noteOptional")}</label>
        <textarea className={`${inputCls} mb-4 resize-none`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />

        {error && <p className="mb-3 rounded-xl bg-bad-l p-3 text-bad">{error}</p>}
        <Button onClick={save} disabled={!canSave} className="w-full !py-4 text-xl">
          <Check className="size-6" /> {t("savePurchase")}
        </Button>
      </div>
    </div>
  );
}

/* ---------- purchases list ---------- */

function PurchaseList({ onEdit }: { onEdit: (id: number) => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [rows, setRows] = useState<Purchase[] | null>(null);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [more, setMore] = useState(false);

  const load = useCallback(async () => {
    const list = await pur.listPurchases(shown + 1); // one extra row tells us whether more exist
    setMore(list.length > shown);
    setRows(list.slice(0, shown));
  }, [shown]);
  useEffect(() => {
    void load();
  }, [load]);

  async function doCancel() {
    if (cancelId === null) return;
    try {
      await pur.cancelPurchase(cancelId);
      setCancelId(null);
      await load();
    } catch (e) {
      setCancelId(null);
      setError(errorText(e));
    }
  }

  if (rows && rows.length === 0) return <p className="rounded-3xl bg-white p-10 text-center text-muted shadow-sm">{t("noPurchases")}</p>;

  return (
    <div className="overflow-x-auto rounded-3xl bg-white p-2 shadow-sm">
      {error && <p className="m-3 rounded-xl bg-bad-l p-3 text-bad">{error}</p>}
      <table className="w-full">
        <thead>
          <tr className="text-muted">
            {(["date", "supplier", "total", "paidAmount", "debt"] as const).map((k) => (
              <th key={k} className="p-3 text-start text-base font-medium">
                {t(k)}
              </th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {(rows ?? []).map((p) => {
            const dead = p.cancelled_at !== null;
            return (
              <tr key={p.id} className={`border-t border-line ${dead ? "text-muted line-through" : ""}`}>
                <td className="p-3">{formatDateTime(p.created_at)}</td>
                <td className="p-3 font-bold">{p.supplier_name ?? "—"}</td>
                <td className="p-3 font-bold">{formatNumber(p.total)}</td>
                <td className="p-3">{formatNumber(p.paid + p.later_paid)}</td>
                <td className="p-3 no-underline">
                  {dead ? (
                    <span className="flex flex-wrap gap-1.5">
                      <span className="rounded-full bg-bad-l px-3 py-0.5 text-sm font-bold text-bad">{t("cancelled")}</span>
                      {p.refund_due > 0 && (
                        <span className="rounded-full bg-warn-l px-3 py-0.5 text-sm font-bold text-warn">
                          {t("refundDueTag")}: {formatNumber(p.refund_due)}
                        </span>
                      )}
                    </span>
                  ) : p.debt > 0 ? (
                    <span className="rounded-full bg-bad-l px-3 py-0.5 text-sm font-bold text-bad">{formatNumber(p.debt)}</span>
                  ) : (
                    <span className="rounded-full bg-good-l px-3 py-0.5 text-sm font-bold text-good">{t("fullyPaid")}</span>
                  )}
                </td>
                <td className="whitespace-nowrap p-3 text-end">
                  {!dead && (
                    <>
                      <Button small variant="ghost" onClick={() => onEdit(p.id)}>
                        <Pencil className="size-4" /> {t("edit")}
                      </Button>{" "}
                      <Button small variant="danger" onClick={() => setCancelId(p.id)} title={t("cancelPurchase")}>
                        <Ban className="size-4" /> {t("cancel")}
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {more && <ShowMore onClick={() => setShown((n) => n + PAGE_SIZE)} />}
      {cancelId !== null && (
        <ConfirmModal message={t("confirmCancelPurchase")} confirmLabel={t("cancelPurchase")} onConfirm={doCancel} onClose={() => setCancelId(null)} />
      )}
    </div>
  );
}

/* ---------- page ---------- */

export default function Purchases() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"new" | "list">("new");
  const [editing, setEditing] = useState<PurchaseDetail | null>(null);
  const [formKey, setFormKey] = useState(0); // remounts the form when switching purchase

  async function startEdit(id: number) {
    const p = await pur.getPurchase(id);
    if (!p) return;
    setEditing(p);
    setFormKey((k) => k + 1);
    setTab("new");
  }

  return (
    <div>
      <h1 className="mb-1 text-3xl font-extrabold">{t("purchases")}</h1>
      <p className="mb-5 text-muted">{t("purchasesSub")}</p>
      <div className="mb-5 flex gap-2.5">
        <Chip active={tab === "new"} onClick={() => setTab("new")}>
          {t("newPurchase")}
        </Chip>
        <Chip active={tab === "list"} onClick={() => setTab("list")}>
          {t("purchaseList")}
        </Chip>
      </div>
      {tab === "new" ? (
        <PurchaseForm
          key={formKey}
          editing={editing}
          onEditDone={() => {
            setEditing(null);
            setFormKey((k) => k + 1);
            setTab("list");
          }}
          onStopEditing={() => {
            setEditing(null);
            setFormKey((k) => k + 1);
          }}
        />
      ) : (
        <PurchaseList onEdit={startEdit} />
      )}
    </div>
  );
}
