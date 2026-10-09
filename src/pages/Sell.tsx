import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Check, Minus, Pencil, Plus, Printer, Search, TriangleAlert, Undo2, X } from "lucide-react";
import { useI18n } from "@/i18n";
import { Button, Chip, ConfirmModal, MoneyInput, PAGE_SIZE, ShowMore, inputCls } from "@/components/ui";
import { formatDateTime, formatNumber, formatQty, normalizeText, parseQty, qtyText } from "@/lib/format";
import { useErrorText } from "@/lib/errors";
import { InvoiceModal } from "@/components/InvoiceModal";
import { ReturnModal, ReturnSlipModal } from "@/components/Returns";
import * as returns from "@/data/returns";
import type { SaleReturn } from "@/data/returns";
import * as stock from "@/data/stock";
import * as sales from "@/data/sales";
import type { Item, Named } from "@/data/stock";
import type { Client, Sale, SaleDetail } from "@/data/sales";

type Line = { item_id: number; name: string; unit: string; qty: string; price: number | null };

/* ---------- new sale / edit sale ---------- */

function SaleForm({
  editing,
  onEditDone,
  onStopEditing,
  onPrint,
}: {
  editing: SaleDetail | null;
  onEditDone: () => void;
  onStopEditing: () => void;
  onPrint: (saleId: number) => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Named[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [catFilter, setCatFilter] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  const [clientName, setClientName] = useState(editing?.client_name ?? "");
  const [clientPhone, setClientPhone] = useState(editing?.client_phone ?? "");
  // a phone filled in from a known client follows the name; a phone the owner typed is never replaced
  const [phoneAuto, setPhoneAuto] = useState(false);
  const [lines, setLines] = useState<Line[]>(
    () =>
      editing?.lines.map((l) => ({
        item_id: l.item_id,
        name: l.item_name,
        unit: l.unit_name,
        qty: qtyText(l.qty_milli),
        price: l.unit_price,
      })) ?? [],
  );
  // Discount on the whole sale: typed as an amount (the default) or as a percent.
  const [discMode, setDiscMode] = useState<"amount" | "percent">(editing?.discount_pct_milli ? "percent" : "amount");
  const [discAmount, setDiscAmount] = useState<number | null>(editing && !editing.discount_pct_milli && editing.discount ? editing.discount : null);
  const [discPct, setDiscPct] = useState(editing?.discount_pct_milli ? qtyText(editing.discount_pct_milli) : "");
  // "paid" follows the total (paid in full) until the owner types a different amount.
  const [paid, setPaid] = useState<number | null>(editing?.paid ?? null);
  const [paidTouched, setPaidTouched] = useState(!!editing);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState(editing?.note ?? "");
  const [saved, setSaved] = useState<{ id: number; total: number } | null>(null);

  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const [i, c, cl] = await Promise.all([stock.listItems(), stock.listCategories(), sales.listClients()]);
    setItems(i);
    setCategories(c);
    setClients(cl);
    setLoaded(true);
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  // Stock available to this invoice: what's on hand, plus what this sale already holds when editing.
  const available = useCallback(
    (item_id: number) =>
      (items.find((i) => i.id === item_id)?.on_hand_milli ?? 0) +
      (editing?.lines.filter((l) => l.item_id === item_id).reduce((s, l) => s + l.qty_milli, 0) ?? 0),
    [items, editing],
  );

  const shown = useMemo(() => {
    const q = normalizeText(query);
    return items.filter(
      (i) => (catFilter === null || i.category_id === catFilter) && (!q || normalizeText(i.name).includes(q)),
    );
  }, [items, catFilter, query]);

  // What one unit cost us: the cost this sale already has when editing it, else the item's last buy price.
  const costOf = (item_id: number) =>
    editing?.lines.find((l) => l.item_id === item_id)?.buy_price ?? items.find((i) => i.id === item_id)?.last_buy_price ?? null;

  const parsed = lines.map((l) => {
    const q = parseQty(l.qty);
    const problem = !q
      ? t("invalidNumber")
      : !l.price
        ? t("invalidNumber")
        : q > available(l.item_id)
          ? `${t("notEnoughStock")} (${t("availableQty")}: ${formatQty(available(l.item_id))})`
          : "";
    const cost = costOf(l.item_id);
    // selling below cost is allowed (owner's choice) but shown in yellow
    const below = !!(l.price && cost && l.price < cost);
    return { ...l, q, problem, cost, below, sum: q && l.price ? sales.lineTotal(q, l.price) : 0 };
  });
  const subtotal = parsed.reduce((s, l) => s + l.sum, 0);
  const pct = parseQty(discPct); // 10% -> 10000
  const discInput: sales.DiscountInput | null =
    discMode === "amount" ? (discAmount ? { mode: "amount", value: discAmount } : null) : pct ? { mode: "percent", value: pct } : null;
  const discount = sales.discountAmount(subtotal, discInput);
  const discProblem = discMode === "percent" && (pct ?? 0) > 100_000 ? t("discountPctTooBig") : discount > subtotal ? t("discountTooBig") : "";
  const total = Math.max(0, subtotal - discount); // what the client owes
  // what these goods cost us: after a big discount the whole sale can end up below cost (warn, never block)
  const costTotal = parsed.reduce((s, l) => s + (l.q && l.cost ? Math.round((l.q * l.cost) / 1000) : 0), 0);
  const discBelowCost = discount > 0 && !discProblem && total < costTotal;
  const later = editing?.later_paid ?? 0; // payments recorded after the sale (kept when editing)
  // While untouched, "paid" means "everything that is still unpaid is paid now".
  const effPaid = paidTouched ? (paid ?? 0) : Math.max(0, total - later);
  const debt = total - effPaid - later;
  const overpaid = effPaid + later > total;
  const canSave = !!clientName.trim() && lines.length > 0 && parsed.every((l) => !l.problem) && !overpaid && !discProblem && !busy;

  function addItem(i: Item) {
    if (editing) return; // money-only edit: items and quantities are locked (goods coming back = a return)
    setSaved(null);
    setLines((ls) => {
      const ix = ls.findIndex((l) => l.item_id === i.id);
      if (ix >= 0) {
        const q = (parseQty(ls[ix].qty) ?? 0) + 1000;
        return ls.map((l, k) => (k === ix ? { ...l, qty: qtyText(q) } : l));
      }
      return [...ls, { item_id: i.id, name: i.name, unit: i.unit_name, qty: qtyText(1000), price: i.default_sell_price }];
    });
  }
  const patch = (ix: number, p: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === ix ? { ...l, ...p } : l)));

  async function save() {
    setBusy(true);
    setError("");
    const input = {
      client_name: clientName,
      client_phone: clientPhone,
      paid: effPaid,
      note,
      discount: discInput,
      lines: parsed.map((l) => ({ item_id: l.item_id, qty_milli: l.q as number, unit_price: l.price as number })),
    };
    try {
      if (editing) {
        await sales.updateSale(editing.id, input);
        onEditDone();
      } else {
        const id = await sales.createSale(input);
        setSaved({ id, total });
        setNote("");
        setLines([]);
        setClientName("");
        setClientPhone("");
        setPhoneAuto(false);
        setPaid(null);
        setPaidTouched(false);
        setDiscMode("amount");
        setDiscAmount(null);
        setDiscPct("");
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
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[1.15fr_1fr]">
      {/* item picker */}
      <div>
        <div className="mb-3 flex items-center gap-3 rounded-2xl border-2 border-line bg-white px-4 py-3 focus-within:border-olive">
          <Search className="size-5 text-muted" />
          <input
            className="flex-1 bg-transparent text-lg outline-none"
            placeholder={t("search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
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
            const avail = available(i.id);
            const inCart = lines.some((l) => l.item_id === i.id);
            const out = avail <= 0;
            return (
              <button
                key={i.id}
                disabled={out || !!editing}
                onClick={() => addItem(i)}
                className={`flex flex-col gap-1 rounded-2xl border-2 p-4 text-start transition ${
                  inCart ? "border-olive bg-olive-l" : "border-line bg-white hover:-translate-y-0.5 hover:border-olive"
                } ${out ? "cursor-not-allowed opacity-50" : ""}`}
              >
                <b className="text-lg">{i.name}</b>
                <small className="text-base text-muted">
                  {out ? (
                    <span className="rounded-full bg-warn-l px-3 py-0.5 text-sm font-bold text-warn">{t("outOfStock")}</span>
                  ) : (
                    <>
                      {formatQty(avail)} {i.unit_name}
                    </>
                  )}
                </small>
                <span className="font-extrabold text-olive-d">
                  {formatNumber(i.default_sell_price)} {t("currency")} / {i.unit_name}
                </span>
              </button>
            );
          })}
        </div>
        {loaded && shown.length === 0 && (
          // first day: no items yet, tell the owner where to add them; otherwise the search/filter found nothing
          <p className="rounded-3xl bg-white p-8 text-center text-lg text-muted shadow-sm">
            {items.length === 0 ? t("sellNoItems") : t("emptyFilter")}
          </p>
        )}
      </div>

      {/* invoice */}
      <div className="rounded-3xl bg-white p-6 shadow-sm xl:sticky xl:top-6">
        {editing && (
          <div className="mb-4 rounded-2xl bg-warn-l p-3 text-warn">
            <div className="flex items-center justify-between gap-2 font-bold">
              <span>
                {t("editingSale")} #{formatNumber(editing.id)}
              </span>
              <Button small variant="secondary" onClick={onStopEditing}>
                {t("stopEditing")}
              </Button>
            </div>
            <p className="mt-1 text-base">{t("moneyOnlyNote")}</p>
          </div>
        )}
        {saved && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-good-l p-3 font-bold text-good">
            <span className="flex items-center gap-2">
              <Check className="size-5" /> {t("saleSaved")}: {formatNumber(saved.total)} {t("currency")}
            </span>
            <Button small onClick={() => onPrint(saved.id)}>
              <Printer className="size-4" /> {t("printPdf")}
            </Button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_1fr]">
          <label className="block">
            <span className="mb-1.5 block font-bold">👤 {t("client")}</span>
            <input
              className={inputCls}
              list="clients-list"
              placeholder={t("clientPlaceholder")}
              value={clientName}
              onChange={(e) => {
                const name = e.target.value;
                setClientName(name);
                if (clientPhone.trim() && !phoneAuto) return;
                const known = clients.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
                setClientPhone(known?.phone ?? "");
                setPhoneAuto(!!known?.phone);
              }}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block font-bold">{t("phoneOptional")}</span>
            <input
              className={inputCls}
              dir="ltr"
              inputMode="tel"
              maxLength={40}
              value={clientPhone}
              onChange={(e) => {
                setClientPhone(e.target.value);
                setPhoneAuto(false);
              }}
            />
          </label>
        </div>
        <datalist id="clients-list">
          {clients.map((c) => (
            <option key={c.id} value={c.name} />
          ))}
        </datalist>

        <div className="mb-1.5 mt-5 font-bold">{t("invoiceItems")}</div>
        {parsed.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-line p-6 text-center text-muted">
            {t("emptyInvoice")}
            <br />
            {t("pickItemHint")}
          </div>
        ) : (
          <ul className="space-y-3">
            {parsed.map((l, ix) => (
              <li
                key={l.item_id}
                className={`rounded-2xl border-2 p-3 ${l.problem ? "border-bad bg-bad-l/40" : l.below ? "border-warn bg-warn-l/60" : "border-line"}`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <b className="text-lg">{l.name}</b>
                  <button
                    hidden={!!editing}
                    onClick={() => setLines((ls) => ls.filter((_, k) => k !== ix))}
                    aria-label={t("remove")}
                    title={t("remove")}
                    className="rounded-lg p-1.5 text-muted hover:bg-bg hover:text-bad"
                  >
                    <X className="size-5" />
                  </button>
                </div>
                <div className="grid grid-cols-[1fr_1fr] gap-2">
                  <div>
                    <div className="mb-1 text-sm text-muted">
                      {t("qty")} ({l.unit})
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        className="grid size-11 shrink-0 place-items-center rounded-xl border-2 border-line hover:border-olive disabled:opacity-30"
                        disabled={!!editing}
                        onClick={() => patch(ix, { qty: qtyText(Math.max(0, (l.q ?? 0) - 1000)) })}
                        aria-label="−"
                      >
                        <Minus className="size-5" />
                      </button>
                      <input
                        className={`${inputCls} !px-2 text-center font-extrabold ${editing ? "bg-bg" : ""}`}
                        inputMode="decimal"
                        readOnly={!!editing}
                        value={l.qty}
                        onChange={(e) => patch(ix, { qty: e.target.value })}
                      />
                      <button
                        className="grid size-11 shrink-0 place-items-center rounded-xl border-2 border-line hover:border-olive disabled:opacity-30"
                        disabled={!!editing}
                        onClick={() => patch(ix, { qty: qtyText((l.q ?? 0) + 1000) })}
                        aria-label="+"
                      >
                        <Plus className="size-5" />
                      </button>
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-sm text-muted">
                      {t("price")} ({t("currency")})
                    </div>
                    <MoneyInput value={l.price} onChange={(v) => patch(ix, { price: v })} />
                  </div>
                </div>
                {l.below && !l.problem && (
                  <p className="mt-2 flex items-center gap-2 rounded-xl bg-warn-l px-3 py-1.5 text-base font-bold text-warn">
                    <TriangleAlert className="size-5 shrink-0" />
                    {t("belowCost")} ({t("buyPrice")}: {formatNumber(l.cost as number)} {t("currency")})
                  </p>
                )}
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-base text-bad">{l.problem}</span>
                  <span className="font-extrabold">
                    {formatNumber(l.sum)} {t("currency")}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-bold">{t("discount")}</span>
            <div className="flex gap-1.5">
              {(["amount", "percent"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setDiscMode(m)}
                  className={`rounded-full border-2 px-3.5 py-0.5 text-base ${discMode === m ? "border-olive bg-olive font-bold text-white" : "border-line bg-white hover:border-olive"}`}
                >
                  {m === "amount" ? t("currency") : "٪"}
                </button>
              ))}
            </div>
          </div>
          {discMode === "amount" ? (
            <MoneyInput value={discAmount} onChange={setDiscAmount} />
          ) : (
            <input className={`${inputCls} text-center`} inputMode="decimal" aria-label={t("discount")} value={discPct} onChange={(e) => setDiscPct(e.target.value)} />
          )}
          {discProblem && <p className="mt-1 text-base text-bad">{discProblem}</p>}
          {discBelowCost && (
            <p className="mt-2 flex items-center gap-2 rounded-xl bg-warn-l px-3 py-1.5 text-base font-bold text-warn">
              <TriangleAlert className="size-5 shrink-0" />
              {t("discountBelowCost")}
            </p>
          )}
        </div>

        <div className="my-5 rounded-2xl bg-olive-l p-4">
          {discount > 0 && !discProblem && (
            <div className="mb-2 border-b border-olive/20 pb-2 text-muted">
              <div className="flex justify-between">
                <span>{t("subtotal")}</span>
                <span>
                  {formatNumber(subtotal)} {t("currency")}
                </span>
              </div>
              <div className="flex justify-between">
                <span>
                  {t("discount")}
                  {discMode === "percent" && pct ? ` (${formatQty(pct)}٪)` : ""}
                </span>
                <span>
                  <bdi dir="ltr">−{formatNumber(discount)}</bdi> {t("currency")}
                </span>
              </div>
            </div>
          )}
          <div className="text-muted">{t("total")}</div>
          <div className="text-4xl font-extrabold text-olive-d">
            {formatNumber(total)} <span className="text-xl">{t("currency")}</span>
          </div>
        </div>

        <div className="mb-1.5 flex items-center justify-between">
          <span className="font-bold">{t("paid")}</span>
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
        <div className={`my-4 flex justify-between text-lg ${debt > 0 ? "font-bold text-bad" : "text-muted"}`}>
          <span>{t("debtLeft")}</span>
          <span>
            {formatNumber(Math.max(0, debt))} {t("currency")}
          </span>
        </div>

        <label className="mb-1.5 block font-bold">{t("noteOptional")}</label>
        <textarea
          className={`${inputCls} mb-4 resize-none`}
          rows={2}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        {error && <p className="mb-3 rounded-xl bg-bad-l p-3 text-bad">{error}</p>}
        {!clientName.trim() && lines.length > 0 && <p className="mb-3 text-base text-muted">{t("clientRequired")}</p>}
        <Button onClick={save} disabled={!canSave} className="w-full !py-4 text-xl">
          <Check className="size-6" /> {t("saveSale")}
        </Button>
        {editing && (
          <Button variant="secondary" className="mt-3 w-full" onClick={() => onPrint(editing.id)}>
            <Printer className="size-5" /> {t("printPdf")}
          </Button>
        )}
      </div>
    </div>
  );
}

/* ---------- sales history ---------- */

function History({ onEdit, onPrint }: { onEdit: (id: number) => void; onPrint: (id: number) => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [rows, setRows] = useState<Sale[] | null>(null);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [error, setError] = useState("");
  // Only the newest rows are drawn; "show more" adds another page. Reloads (after a cancel) keep the current size.
  const [shown, setShown] = useState(PAGE_SIZE);
  const [more, setMore] = useState(false);
  // returns opened under their sale (amber rows), the return window, the slip to print, a return to cancel
  const [open, setOpen] = useState<Record<number, SaleReturn[]>>({});
  const [returnFor, setReturnFor] = useState<number | null>(null);
  const [slip, setSlip] = useState<SaleReturn | null>(null);
  const [cancelReturnId, setCancelReturnId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const list = await sales.listSales(shown + 1); // one extra row tells us whether more exist
    setMore(list.length > shown);
    setRows(list.slice(0, shown));
  }, [shown]);
  useEffect(() => {
    void load();
  }, [load]);

  async function toggleReturns(saleId: number) {
    if (open[saleId]) {
      setOpen(({ [saleId]: _, ...rest }) => rest);
      return;
    }
    const list = await returns.listSaleReturns(saleId);
    setOpen((o) => ({ ...o, [saleId]: list }));
  }
  /** After a change: reload the list and every opened returns row. */
  async function refresh() {
    await load();
    const ids = Object.keys(open).map(Number);
    const fresh: Record<number, SaleReturn[]> = {};
    for (const id of ids) {
      const list = await returns.listSaleReturns(id);
      if (list.length) fresh[id] = list;
    }
    setOpen(fresh);
  }

  async function doCancel() {
    if (cancelId === null) return;
    try {
      await sales.cancelSale(cancelId);
      setCancelId(null);
      await refresh();
    } catch (e) {
      setCancelId(null);
      setError(errorText(e));
    }
  }
  async function doCancelReturn() {
    if (cancelReturnId === null) return;
    try {
      await returns.cancelReturn(cancelReturnId);
      setCancelReturnId(null);
      await refresh();
    } catch (e) {
      setCancelReturnId(null);
      setError(errorText(e));
    }
  }

  if (rows && rows.length === 0) return <p className="rounded-3xl bg-white p-10 text-center text-muted shadow-sm">{t("noSales")}</p>;

  return (
    <div className="overflow-x-auto rounded-3xl bg-white p-2 shadow-sm">
      {error && <p className="m-3 rounded-xl bg-bad-l p-3 text-bad">{error}</p>}
      <table className="w-full">
        <thead>
          <tr className="text-muted">
            {["date", "client", "total", "paid", "debt"].map((k) => (
              <th key={k} className="p-3 text-start text-base font-medium">
                {t(k as "date")}
              </th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {(rows ?? []).map((s) => {
            const dead = s.cancelled_at !== null;
            return (
              <Fragment key={s.id}>
                <tr className={`border-t border-line ${dead ? "text-muted line-through" : ""}`}>
                  <td className="p-3">{formatDateTime(s.created_at)}</td>
                  <td className="p-3 font-bold">{s.client_name}</td>
                  <td className="p-3 font-bold">{formatNumber(s.total)}</td>
                  <td className="p-3">{formatNumber(s.paid + s.later_paid - s.refunded)}</td>
                  <td className="p-3 no-underline">
                    {dead ? (
                      <span className="flex flex-wrap gap-1.5">
                        <span className="rounded-full bg-bad-l px-3 py-0.5 text-sm font-bold text-bad">{t("cancelled")}</span>
                        {s.refund_due > 0 && (
                          <span className="rounded-full bg-warn-l px-3 py-0.5 text-sm font-bold text-warn">
                            {t("refundDueTag")}: {formatNumber(s.refund_due)}
                          </span>
                        )}
                      </span>
                    ) : s.debt > 0 ? (
                      <span className="rounded-full bg-bad-l px-3 py-0.5 text-sm font-bold text-bad">{formatNumber(s.debt)}</span>
                    ) : s.refund_due > 0 ? (
                      <span className="rounded-full bg-warn-l px-3 py-0.5 text-sm font-bold text-warn">
                        {t("refundDueTag")}: {formatNumber(s.refund_due)}
                      </span>
                    ) : (
                      <span className="rounded-full bg-good-l px-3 py-0.5 text-sm font-bold text-good">{t("fullyPaid")}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap p-3 text-end">
                    {!dead && (
                      <>
                        {s.return_count > 0 && (
                          <>
                            <button
                              onClick={() => void toggleReturns(s.id)}
                              className={`rounded-full px-3 py-1 text-sm font-bold ${open[s.id] ? "bg-warn text-white" : "bg-warn-l text-warn hover:bg-warn hover:text-white"}`}
                            >
                              <Undo2 className="inline size-4" /> {t("returnedTag")} ({formatNumber(s.return_count)})
                            </button>{" "}
                          </>
                        )}
                        <Button small variant="ghost" onClick={() => onPrint(s.id)} title={t("printPdf")} aria-label={t("printPdf")}>
                          <Printer className="size-5" />
                        </Button>{" "}
                        {/* labels only on wide screens; on smaller windows the icons (with their name on hover) keep the row in view */}
                        <Button small variant="ghost" onClick={() => setReturnFor(s.id)} title={t("returnBtn")} aria-label={t("returnBtn")}>
                          <Undo2 className="size-4" /> <span className="hidden 2xl:inline">{t("returnBtn")}</span>
                        </Button>{" "}
                        <Button small variant="ghost" onClick={() => onEdit(s.id)} title={t("editMoney")} aria-label={t("editMoney")}>
                          <Pencil className="size-4" /> <span className="hidden 2xl:inline">{t("editMoney")}</span>
                        </Button>{" "}
                        <Button small variant="danger" onClick={() => setCancelId(s.id)} title={t("cancelSale")} aria-label={t("cancelSale")}>
                          <Ban className="size-4" /> <span className="hidden 2xl:inline">{t("cancel")}</span>
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
                {/* this sale's returns, amber so they are easy to follow */}
                {!dead &&
                  open[s.id]?.map((r) => (
                    <tr key={`r${r.id}`} className="bg-warn-l/70 text-warn">
                      <td colSpan={4} className="p-3">
                        <b>
                          {t("returnNo")} {formatNumber(r.id)}
                        </b>
                        <span className="ms-3 text-sm">
                          <bdi>{formatDateTime(r.created_at)}</bdi>
                        </span>
                        <span className="block">{r.lines.map((l) => `${l.item_name} ${formatQty(l.qty_milli)} ${l.unit_name}`).join("، ")}</span>
                      </td>
                      <td className="p-3 font-extrabold">
                        <bdi dir="ltr">−{formatNumber(r.total)}</bdi>
                        {r.refunded_now > 0 && (
                          <span className="block text-sm font-bold">
                            {t("givenBackNow")}: {formatNumber(r.refunded_now)}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap p-3 text-end">
                        <Button small variant="ghost" onClick={() => setSlip(r)} title={t("returnSlip")} aria-label={t("returnSlip")}>
                          <Printer className="size-5" />
                        </Button>{" "}
                        <Button small variant="danger" onClick={() => setCancelReturnId(r.id)} title={t("cancelReturn")} aria-label={t("cancelReturn")}>
                          <Ban className="size-4" /> <span className="hidden 2xl:inline">{t("cancel")}</span>
                        </Button>
                      </td>
                    </tr>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {more && <ShowMore onClick={() => setShown((n) => n + PAGE_SIZE)} />}
      {cancelId !== null && (
        <ConfirmModal message={t("confirmCancelSale")} confirmLabel={t("cancelSale")} onConfirm={doCancel} onClose={() => setCancelId(null)} />
      )}
      {cancelReturnId !== null && (
        <ConfirmModal message={t("confirmCancelReturn")} confirmLabel={t("cancelReturn")} onConfirm={doCancelReturn} onClose={() => setCancelReturnId(null)} />
      )}
      {returnFor !== null && (
        <ReturnModal
          saleId={returnFor}
          onClose={() => setReturnFor(null)}
          onDone={(r) => {
            setReturnFor(null);
            setSlip(r); // the return slip, ready to print
            setOpen((o) => ({ ...o, [r.sale_id]: [] })); // open that sale's returns after the refresh
            void (async () => {
              await load();
              const list = await returns.listSaleReturns(r.sale_id);
              setOpen((o) => ({ ...o, [r.sale_id]: list }));
            })();
          }}
        />
      )}
      {slip && <ReturnSlipModal r={slip} onClose={() => setSlip(null)} />}
    </div>
  );
}

/* ---------- all returns ---------- */

function ReturnsList() {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [rows, setRows] = useState<SaleReturn[] | null>(null);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [more, setMore] = useState(false);
  const [slip, setSlip] = useState<SaleReturn | null>(null);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const list = await returns.listReturns(shown + 1);
    setMore(list.length > shown);
    setRows(list.slice(0, shown));
  }, [shown]);
  useEffect(() => {
    void load();
  }, [load]);

  async function doCancel() {
    if (cancelId === null) return;
    try {
      await returns.cancelReturn(cancelId);
      setCancelId(null);
      await load();
    } catch (e) {
      setCancelId(null);
      setError(errorText(e));
    }
  }

  if (rows && rows.length === 0) return <p className="rounded-3xl bg-white p-10 text-center text-muted shadow-sm">{t("noReturns")}</p>;

  return (
    <div className="overflow-x-auto rounded-3xl bg-white p-2 shadow-sm">
      {error && <p className="m-3 rounded-xl bg-bad-l p-3 text-bad">{error}</p>}
      <table className="w-full">
        <thead>
          <tr className="text-muted">
            <th className="p-3 text-start text-base font-medium">{t("date")}</th>
            <th className="p-3 text-start text-base font-medium">{t("client")}</th>
            <th className="p-3 text-start text-base font-medium">{t("invoiceNo")}</th>
            <th className="p-3 text-start text-base font-medium">{t("invoiceItems")}</th>
            <th className="p-3 text-start text-base font-medium">{t("amountLabel")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(rows ?? []).map((r) => {
            const dead = r.cancelled_at !== null;
            return (
              <tr key={r.id} className={`border-t border-line ${dead ? "text-muted line-through" : ""}`}>
                <td className="p-3">{formatDateTime(r.created_at)}</td>
                <td className="p-3 font-bold">{r.client_name}</td>
                <td className="p-3">{formatNumber(r.sale_id)}</td>
                <td className="p-3">{r.lines.map((l) => `${l.item_name} ${formatQty(l.qty_milli)} ${l.unit_name}`).join("، ")}</td>
                <td className="p-3 font-extrabold text-warn">
                  {formatNumber(r.total)}
                  {r.refunded_now > 0 && (
                    <span className="block text-sm font-bold">
                      {t("givenBackNow")}: {formatNumber(r.refunded_now)}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap p-3 text-end no-underline">
                  {dead ? (
                    <span className="rounded-full bg-bad-l px-3 py-0.5 text-sm font-bold text-bad">{t("cancelled")}</span>
                  ) : (
                    <>
                      <Button small variant="ghost" onClick={() => setSlip(r)} title={t("returnSlip")} aria-label={t("returnSlip")}>
                        <Printer className="size-5" />
                      </Button>{" "}
                      <Button small variant="danger" onClick={() => setCancelId(r.id)} title={t("cancelReturn")}>
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
        <ConfirmModal message={t("confirmCancelReturn")} confirmLabel={t("cancelReturn")} onConfirm={doCancel} onClose={() => setCancelId(null)} />
      )}
      {slip && <ReturnSlipModal r={slip} onClose={() => setSlip(null)} />}
    </div>
  );
}

/* ---------- page ---------- */

export default function Sell() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"new" | "history" | "returns">("new");
  const [editing, setEditing] = useState<SaleDetail | null>(null);
  const [formKey, setFormKey] = useState(0); // remounts the form when switching sale
  const [printId, setPrintId] = useState<number | null>(null); // sale whose invoice is open

  async function startEdit(id: number) {
    const sale = await sales.getSale(id);
    if (!sale) return;
    setEditing(sale);
    setFormKey((k) => k + 1);
    setTab("new");
  }

  return (
    <div>
      <h1 className="mb-1 text-3xl font-extrabold">{t("sell")}</h1>
      <p className="mb-5 text-muted">{t("sellSub")}</p>
      <div className="mb-5 flex gap-2.5">
        <Chip active={tab === "new"} onClick={() => setTab("new")}>
          {t("newSale")}
        </Chip>
        <Chip active={tab === "history"} onClick={() => setTab("history")}>
          {t("salesHistory")}
        </Chip>
        <Chip active={tab === "returns"} onClick={() => setTab("returns")}>
          {t("returnsTab")}
        </Chip>
      </div>
      {tab === "new" ? (
        <SaleForm
          key={formKey}
          editing={editing}
          onEditDone={() => {
            setEditing(null);
            setFormKey((k) => k + 1);
            setTab("history");
          }}
          onStopEditing={() => {
            setEditing(null);
            setFormKey((k) => k + 1);
          }}
          onPrint={setPrintId}
        />
      ) : tab === "history" ? (
        <History onEdit={startEdit} onPrint={setPrintId} />
      ) : (
        <ReturnsList />
      )}
      {printId !== null && <InvoiceModal saleId={printId} onClose={() => setPrintId(null)} />}
    </div>
  );
}
