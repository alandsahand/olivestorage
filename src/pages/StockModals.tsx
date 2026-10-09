import { useCallback, useEffect, useState } from "react";
import { Check, Pencil, Plus, X } from "lucide-react";
import { useI18n } from "@/i18n";
import { Button, ConfirmModal, Field, MoneyInput, Modal, inputCls } from "@/components/ui";
import { formatDateTime, formatNumber, formatQty, onlyDecimal, parseQty, qtyText } from "@/lib/format";
import { useErrorText } from "@/lib/errors";
import * as db from "@/data/stock";
import type { Delivery, Item, Named } from "@/data/stock";
import { reverseRatio, type RatioDir } from "@/lib/units";

/* ---------- helpers ---------- */

/** A select that can also create a new entry inline (used for category and unit). */
function PickOrAdd({
  label,
  options,
  value,
  onChange,
  onCreate,
  noneLabel,
  error,
}: {
  label: string;
  options: Named[];
  value: number | null;
  onChange: (id: number | null) => void;
  onCreate: (name: string) => Promise<number>;
  noneLabel?: string;
  error?: string;
}) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      onChange(await onCreate(name));
      setAdding(false);
      setName("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Field label={label} error={error}>
      {adding ? (
        <div className="flex gap-2">
          <input
            className={inputCls}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void create();
              }
            }}
          />
          <Button type="button" onClick={create} disabled={busy} aria-label={t("add")}>
            <Check className="size-5" />
          </Button>
          <Button type="button" variant="secondary" onClick={() => setAdding(false)} aria-label={t("cancel")}>
            <X className="size-5" />
          </Button>
        </div>
      ) : (
        <select
          className={inputCls}
          value={value ?? ""}
          onChange={(e) => (e.target.value === "new" ? setAdding(true) : onChange(e.target.value ? Number(e.target.value) : null))}
        >
          <option value="">{noneLabel ?? t("pick")}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
          <option value="new">{t("addNew")}</option>
        </select>
      )}
    </Field>
  );
}

/* ---------- item form (new / edit) ---------- */

export function ItemForm({
  item,
  categories,
  units,
  defaultCategoryId,
  createCategory,
  createUnit,
  onSaved,
  onClose,
  onArchive,
}: {
  item: Item | null;
  categories: Named[];
  units: Named[];
  defaultCategoryId: number | null;
  createCategory: (name: string) => Promise<number>;
  createUnit: (name: string) => Promise<number>;
  onSaved: () => void;
  onClose: () => void;
  onArchive?: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(item?.name ?? "");
  const [categoryId, setCategoryId] = useState<number | null>(item ? item.category_id : defaultCategoryId);
  const [unitId, setUnitId] = useState<number | null>(item?.unit_id ?? null);
  const [price, setPrice] = useState<number | null>(item?.default_sell_price ?? null);
  // bought in another unit (docs/flow.md section 7): off for most items
  const [buyOn, setBuyOn] = useState(!!item?.buy_unit_id);
  const [buyUnitId, setBuyUnitId] = useState<number | null>(item?.buy_unit_id ?? null);
  // default (owner): "1 jar = ? kg" — how much of the buying unit makes ONE store unit
  const [dir, setDir] = useState<RatioDir>(item?.buy_ratio_dir ?? "store");
  const [ratio, setRatio] = useState(item?.buy_ratio_milli ? qtyText(item.buy_ratio_milli) : "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const unitName = (id: number | null) => (id === null ? "؟" : (units.find((u) => u.id === id)?.name ?? (id === item?.buy_unit_id ? item?.buy_unit_name : item?.unit_name) ?? "؟"));
  const storeName = unitName(unitId);
  const buyName = unitName(buyUnitId);
  const ratioMilli = parseQty(ratio);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const err: Record<string, string> = {};
    if (!name.trim()) err.name = t("required");
    if (!unitId) err.unit = t("required");
    if (!price || price <= 0) err.price = t("invalidNumber");
    if (buyOn && (!buyUnitId || buyUnitId === unitId)) err.buyUnit = t("required");
    if (buyOn && !ratioMilli) err.ratio = t("invalidNumber");
    setErrors(err);
    if (Object.keys(err).length) return;
    setBusy(true);
    try {
      await db.saveItem({
        id: item?.id,
        name,
        category_id: categoryId,
        unit_id: unitId as number,
        default_sell_price: price as number,
        buy: buyOn ? { unit_id: buyUnitId as number, ratio_milli: ratioMilli as number, dir } : null,
      });
      onSaved();
    } catch {
      setErrors({ form: t("error") });
      setBusy(false);
    }
  }

  return (
    <Modal title={item ? t("editItem") : t("newItem")} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label={t("name")} error={errors.name}>
          <input className={inputCls} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <PickOrAdd
          label={t("category")}
          options={categories}
          value={categoryId}
          onChange={setCategoryId}
          onCreate={createCategory}
          noneLabel={t("noCategory")}
        />
        <PickOrAdd label={t("storeUnit")} options={units} value={unitId} onChange={setUnitId} onCreate={createUnit} error={errors.unit} />
        <label className="mb-4 flex cursor-pointer items-center gap-3 text-lg font-bold">
          <input type="checkbox" className="size-6 accent-olive" checked={buyOn} onChange={(e) => setBuyOn(e.target.checked)} />
          {t("buyDifferent")}
        </label>
        {buyOn && (
          <div className="mb-4 rounded-2xl bg-olive-l/60 p-4">
            <PickOrAdd
              label={t("buyUnit")}
              options={units.filter((u) => u.id !== unitId)}
              value={buyUnitId}
              onChange={setBuyUnitId}
              onCreate={createUnit}
              error={errors.buyUnit}
            />
            <span className="mb-1.5 block font-bold">{t("refHow")}</span>
            {/* the owner writes the reference whichever way is easier for this item */}
            <div className="mb-3 flex flex-wrap gap-2">
              {(["store", "buy"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDir(d)}
                  className={`rounded-full border-2 px-4 py-1.5 font-medium ${dir === d ? "border-olive bg-olive text-white" : "border-line bg-white hover:border-olive"}`}
                >
                  ١ {d === "buy" ? buyName : storeName} = ؟ {d === "buy" ? storeName : buyName}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-lg font-bold">
              <span className="whitespace-nowrap">١ {dir === "buy" ? buyName : storeName} =</span>
              <input
                className={`${inputCls} !w-28 text-center`}
                inputMode="decimal"
                aria-label={t("refHow")}
                value={ratio}
                onChange={(e) => setRatio(onlyDecimal(e.target.value))}
              />
              <span className="whitespace-nowrap">{dir === "buy" ? storeName : buyName}</span>
            </div>
            {errors.ratio && <span className="mt-1 block text-base text-bad">{errors.ratio}</span>}
            {ratioMilli && (
              <p className="mt-2 text-base text-muted">
                {t("meaning")} ١ {dir === "buy" ? storeName : buyName} = {formatQty(reverseRatio(ratioMilli))} {dir === "buy" ? buyName : storeName}
              </p>
            )}
          </div>
        )}
        <Field label={`${t("defaultSellPrice")} (${t("currency")})`} error={errors.price}>
          <MoneyInput value={price} onChange={setPrice} />
        </Field>
        {errors.form && <p className="mb-3 text-bad">{errors.form}</p>}
        <div className="flex gap-3">
          <Button type="submit" disabled={busy} className="flex-1">
            {t("save")}
          </Button>
          {onArchive && (
            <Button type="button" variant="danger" onClick={onArchive}>
              {t("archive")}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}

/* ---------- deliveries of one item: edit / cancel ---------- */

export function DeliveriesModal({ item, onChanged, onClose }: { item: Item; onChanged: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [rows, setRows] = useState<Delivery[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [eQty, setEQty] = useState("");
  const [ePrice, setEPrice] = useState<number | null>(null);
  const [voiding, setVoiding] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => db.listDeliveries(item.id).then(setRows), [item.id]);
  useEffect(() => {
    void load();
  }, [load]);

  function startEdit(d: Delivery) {
    setEditing(d.id);
    setEQty(qtyText(d.qty_milli));
    setEPrice(d.buy_price);
    setError("");
  }

  async function saveEdit(id: number) {
    const q = parseQty(eQty);
    if (!q || !ePrice || ePrice <= 0) return setError(t("invalidNumber"));
    try {
      await db.editDelivery(id, q, ePrice);
      setEditing(null);
      await load();
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function confirmVoid() {
    if (voiding === null) return;
    try {
      await db.voidDelivery(voiding);
      setVoiding(null);
      await load();
      onChanged();
    } catch (e) {
      setVoiding(null);
      setError(errorText(e));
    }
  }

  return (
    <Modal title={`${t("deliveries")}: ${item.name}`} onClose={onClose} wide>
      {error && <p className="mb-3 text-bad">{error}</p>}
      <table className="w-full">
        <thead>
          <tr className="text-start text-base text-muted">
            <th className="p-2 text-start font-medium">{t("date")}</th>
            <th className="p-2 text-start font-medium">{t("qty")}</th>
            <th className="p-2 text-start font-medium">{t("buyPrice")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const dead = d.cancelled_at !== null;
            return (
              <tr key={d.id} className={`border-t border-line ${dead ? "text-muted line-through" : ""}`}>
                <td className="p-2">{formatDateTime(d.created_at)}</td>
                {editing === d.id ? (
                  <>
                    <td className="p-2">
                      <input className={inputCls} inputMode="decimal" value={eQty} onChange={(e) => setEQty(onlyDecimal(e.target.value))} />
                    </td>
                    <td className="p-2">
                      <MoneyInput value={ePrice} onChange={setEPrice} />
                    </td>
                    <td className="whitespace-nowrap p-2">
                      <Button small onClick={() => saveEdit(d.id)}>
                        {t("save")}
                      </Button>{" "}
                      <Button small variant="secondary" onClick={() => setEditing(null)}>
                        {t("cancel")}
                      </Button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="p-2 font-bold">
                      {formatQty(d.qty_milli)} {item.unit_name}
                    </td>
                    <td className="p-2 font-bold">{formatNumber(d.buy_price)}</td>
                    <td className="whitespace-nowrap p-2 text-end no-underline">
                      {d.purchase_id !== null ? (
                        // a purchase line: changed by editing the purchase (Purchases page)
                        <span className="rounded-full bg-olive-l px-3 py-1 text-sm font-bold text-olive-d">
                          {t("purchaseNo")} {formatNumber(d.purchase_id)}
                        </span>
                      ) : dead ? (
                        <span className="rounded-full bg-bad-l px-3 py-1 text-sm font-bold text-bad no-underline">{t("cancelled")}</span>
                      ) : (
                        <>
                          <Button small variant="ghost" onClick={() => startEdit(d)}>
                            <Pencil className="size-4" /> {t("edit")}
                          </Button>{" "}
                          <Button small variant="danger" onClick={() => setVoiding(d.id)}>
                            {t("voidDelivery")}
                          </Button>
                        </>
                      )}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {voiding !== null && (
        <ConfirmModal
          message={t("confirmVoid")}
          confirmLabel={t("voidDelivery")}
          onConfirm={confirmVoid}
          onClose={() => setVoiding(null)}
        />
      )}
    </Modal>
  );
}

/* ---------- manage categories & units ---------- */

function ListEditor({
  title,
  rows,
  onAdd,
  onRename,
  onArchive,
}: {
  title: string;
  rows: Named[];
  onAdd: (name: string) => Promise<unknown>;
  onRename: (id: number, name: string) => Promise<unknown>;
  onArchive: (id: number) => Promise<unknown>;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [archiving, setArchiving] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function run(fn: () => Promise<unknown>, after?: () => void) {
    try {
      setError("");
      await fn();
      after?.();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <section className="mb-6">
      <h3 className="mb-2 text-xl font-extrabold">{title}</h3>
      <ul className="mb-3 divide-y divide-line rounded-2xl border-2 border-line">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2 p-2">
            {editing === r.id ? (
              <>
                <input className={inputCls} autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} />
                <Button small onClick={() => run(() => onRename(r.id, editName), () => setEditing(null))}>
                  <Check className="size-4" />
                </Button>
              </>
            ) : (
              <>
                <span className="flex-1 px-2 font-medium">{r.name}</span>
                <Button
                  small
                  variant="ghost"
                  onClick={() => {
                    setEditing(r.id);
                    setEditName(r.name);
                  }}
                >
                  <Pencil className="size-4" /> {t("rename")}
                </Button>
                <Button small variant="danger" onClick={() => setArchiving(r.id)}>
                  {t("archive")}
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input
          className={inputCls}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && newName.trim() && run(() => onAdd(newName), () => setNewName(""))}
        />
        <Button onClick={() => newName.trim() && run(() => onAdd(newName), () => setNewName(""))}>
          <Plus className="size-5" /> {t("add")}
        </Button>
      </div>
      {error && <p className="mt-2 text-bad">{error}</p>}
      {archiving !== null && (
        <ConfirmModal
          message={t("confirmArchiveNamed")}
          confirmLabel={t("archive")}
          onConfirm={() => run(() => onArchive(archiving), () => setArchiving(null))}
          onClose={() => setArchiving(null)}
        />
      )}
    </section>
  );
}

export function ManageModal({
  categories,
  units,
  onChanged,
  onClose,
}: {
  categories: Named[];
  units: Named[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const wrap = <A extends unknown[]>(fn: (...a: A) => Promise<unknown>) => async (...a: A) => {
    await fn(...a);
    onChanged();
  };
  return (
    <Modal title={t("manage")} onClose={onClose}>
      <ListEditor
        title={t("categories")}
        rows={categories}
        onAdd={wrap(db.addCategory)}
        onRename={wrap(db.renameCategory)}
        onArchive={wrap(db.archiveCategory)}
      />
      <ListEditor
        title={t("units")}
        rows={units}
        onAdd={wrap(db.addUnit)}
        onRename={wrap(db.renameUnit)}
        onArchive={wrap(db.archiveUnit)}
      />
    </Modal>
  );
}
