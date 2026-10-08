import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Check, Minus, Pencil, Plus, Printer, Search, X } from "lucide-react";
import { useI18n } from "@/i18n";
import { Button, Chip, ConfirmModal, MoneyInput, inputCls } from "@/components/ui";
import { formatDateTime, formatNumber, formatQty, normalizeText, parseQty, qtyText } from "@/lib/format";
import { useErrorText } from "@/lib/errors";
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
}: {
  editing: SaleDetail | null;
  onEditDone: () => void;
  onStopEditing: () => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Named[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [catFilter, setCatFilter] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  const [clientName, setClientName] = useState(editing?.client_name ?? "");
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
  // "paid" follows the total (paid in full) until the owner types a different amount.
  const [paid, setPaid] = useState<number | null>(editing?.paid ?? null);
  const [paidTouched, setPaidTouched] = useState(!!editing);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{ total: number } | null>(null);

  const reload = useCallback(async () => {
    const [i, c, cl] = await Promise.all([stock.listItems(), stock.listCategories(), sales.listClients()]);
    setItems(i);
    setCategories(c);
    setClients(cl);
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

  const parsed = lines.map((l) => {
    const q = parseQty(l.qty);
    const problem = !q
      ? t("invalidNumber")
      : !l.price
        ? t("invalidNumber")
        : q > available(l.item_id)
          ? `${t("notEnoughStock")} (${t("availableQty")}: ${formatQty(available(l.item_id))})`
          : "";
    return { ...l, q, problem, sum: q && l.price ? sales.lineTotal(q, l.price) : 0 };
  });
  const total = parsed.reduce((s, l) => s + l.sum, 0);
  const later = editing?.later_paid ?? 0; // payments recorded after the sale (kept when editing)
  // While untouched, "paid" means "everything that is still unpaid is paid now".
  const effPaid = paidTouched ? (paid ?? 0) : Math.max(0, total - later);
  const debt = total - effPaid - later;
  const overpaid = effPaid + later > total;
  const canSave = !!clientName.trim() && lines.length > 0 && parsed.every((l) => !l.problem) && !overpaid && !busy;

  function addItem(i: Item) {
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
      paid: effPaid,
      lines: parsed.map((l) => ({ item_id: l.item_id, qty_milli: l.q as number, unit_price: l.price as number })),
    };
    try {
      if (editing) {
        await sales.updateSale(editing.id, input);
        onEditDone();
      } else {
        await sales.createSale(input);
        setSaved({ total });
        setLines([]);
        setClientName("");
        setPaid(null);
        setPaidTouched(false);
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
        <div className="grid grid-cols-2 gap-3">
          {shown.map((i) => {
            const avail = available(i.id);
            const inCart = lines.some((l) => l.item_id === i.id);
            const out = avail <= 0;
            return (
              <button
                key={i.id}
                disabled={out}
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
      </div>

      {/* invoice */}
      <div className="rounded-3xl bg-white p-6 shadow-sm xl:sticky xl:top-6">
        {editing && (
          <div className="mb-4 flex items-center justify-between gap-2 rounded-2xl bg-warn-l p-3 font-bold text-warn">
            <span>
              {t("editingSale")} #{formatNumber(editing.id)}
            </span>
            <Button small variant="secondary" onClick={onStopEditing}>
              {t("stopEditing")}
            </Button>
          </div>
        )}
        {saved && (
          <div className="mb-4 flex items-center gap-2 rounded-2xl bg-good-l p-3 font-bold text-good">
            <Check className="size-5" /> {t("saleSaved")}: {formatNumber(saved.total)} {t("currency")}
          </div>
        )}

        <label className="mb-1.5 block font-bold">👤 {t("client")}</label>
        <input
          className={inputCls}
          list="clients-list"
          placeholder={t("clientPlaceholder")}
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
        />
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
              <li key={l.item_id} className={`rounded-2xl border-2 p-3 ${l.problem ? "border-bad bg-bad-l/40" : "border-line"}`}>
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
                <div className="grid grid-cols-[1fr_1fr] gap-2">
                  <div>
                    <div className="mb-1 text-sm text-muted">
                      {t("qty")} ({l.unit})
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        className="grid size-11 shrink-0 place-items-center rounded-xl border-2 border-line hover:border-olive"
                        onClick={() => patch(ix, { qty: qtyText(Math.max(0, (l.q ?? 0) - 1000)) })}
                        aria-label="−"
                      >
                        <Minus className="size-5" />
                      </button>
                      <input
                        className={`${inputCls} !px-2 text-center font-extrabold`}
                        inputMode="decimal"
                        value={l.qty}
                        onChange={(e) => patch(ix, { qty: e.target.value })}
                      />
                      <button
                        className="grid size-11 shrink-0 place-items-center rounded-xl border-2 border-line hover:border-olive"
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

        <div className="my-5 rounded-2xl bg-olive-l p-4">
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

        {error && <p className="mb-3 rounded-xl bg-bad-l p-3 text-bad">{error}</p>}
        {!clientName.trim() && lines.length > 0 && <p className="mb-3 text-base text-muted">{t("clientRequired")}</p>}
        <Button onClick={save} disabled={!canSave} className="w-full !py-4 text-xl">
          <Check className="size-6" /> {t("saveSale")}
        </Button>
        <Button variant="secondary" disabled className="mt-3 w-full" title={t("printSoon")}>
          <Printer className="size-5" /> {t("printSoon")}
        </Button>
      </div>
    </div>
  );
}

/* ---------- sales history ---------- */

function History({ onEdit }: { onEdit: (id: number) => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [rows, setRows] = useState<Sale[] | null>(null);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => sales.listSales().then(setRows), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function doCancel() {
    if (cancelId === null) return;
    try {
      await sales.cancelSale(cancelId);
      setCancelId(null);
      await load();
    } catch (e) {
      setCancelId(null);
      setError(errorText(e));
    }
  }

  if (rows && rows.length === 0) return <p className="rounded-3xl bg-white p-10 text-center text-muted shadow-sm">{t("noSales")}</p>;

  return (
    <div className="rounded-3xl bg-white p-2 shadow-sm">
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
              <tr key={s.id} className={`border-t border-line ${dead ? "text-muted line-through" : ""}`}>
                <td className="p-3">{formatDateTime(s.created_at)}</td>
                <td className="p-3 font-bold">{s.client_name}</td>
                <td className="p-3 font-bold">{formatNumber(s.total)}</td>
                <td className="p-3">{formatNumber(s.paid + s.later_paid)}</td>
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
                  ) : (
                    <span className="rounded-full bg-good-l px-3 py-0.5 text-sm font-bold text-good">{t("fullyPaid")}</span>
                  )}
                </td>
                <td className="whitespace-nowrap p-3 text-end">
                  {!dead && (
                    <>
                      <Button small variant="ghost" onClick={() => onEdit(s.id)}>
                        <Pencil className="size-4" /> {t("edit")}
                      </Button>{" "}
                      <Button small variant="danger" onClick={() => setCancelId(s.id)} title={t("cancelSale")}>
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
      {cancelId !== null && (
        <ConfirmModal
          message={t("confirmCancelSale")}
          confirmLabel={t("cancelSale")}
          onConfirm={doCancel}
          onClose={() => setCancelId(null)}
        />
      )}
    </div>
  );
}

/* ---------- page ---------- */

export default function Sell() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"new" | "history">("new");
  const [editing, setEditing] = useState<SaleDetail | null>(null);
  const [formKey, setFormKey] = useState(0); // remounts the form when switching sale

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
        <Chip
          active={tab === "new"}
          onClick={() => {
            setTab("new");
          }}
        >
          {t("newSale")}
        </Chip>
        <Chip active={tab === "history"} onClick={() => setTab("history")}>
          {t("salesHistory")}
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
        />
      ) : (
        <History onEdit={startEdit} />
      )}
    </div>
  );
}
