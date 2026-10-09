import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Search, Settings2, History } from "lucide-react";
import { useI18n } from "@/i18n";
import { Button, Chip, ConfirmModal, Modal, Field, inputCls } from "@/components/ui";
import { formatNumber, formatQty, normalizeText } from "@/lib/format";
import { refText } from "@/lib/units";
import * as db from "@/data/stock";
import type { Item, Named } from "@/data/stock";
import { DeliveriesModal, ItemForm, ManageModal } from "./StockModals";

type Dialog =
  | { kind: "item"; item: Item | null }
  | { kind: "deliveries"; item: Item }
  | { kind: "archive"; item: Item }
  | { kind: "manage" }
  | { kind: "category" }
  | null;

export default function Stock() {
  const { t } = useI18n();
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Named[]>([]);
  const [units, setUnits] = useState<Named[]>([]);
  const [catFilter, setCatFilter] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [loadError, setLoadError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [i, c, u] = await Promise.all([db.listItems(), db.listCategories(), db.listUnits()]);
      setItems(i);
      setCategories(c);
      setUnits(u);
      setLoadError(false);
      // a deleted/archived category can't stay selected
      setCatFilter((f) => (f !== null && !c.some((x) => x.id === f) ? null : f));
    } catch {
      setLoadError(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createCategory = useCallback(
    async (name: string) => {
      const id = await db.addCategory(name);
      await reload();
      return id;
    },
    [reload],
  );
  const createUnit = useCallback(
    async (name: string) => {
      const id = await db.addUnit(name);
      await reload();
      return id;
    },
    [reload],
  );

  const shown = useMemo(() => {
    const q = normalizeText(query);
    return items.filter(
      (i) => (catFilter === null || i.category_id === catFilter) && (!q || normalizeText(i.name).includes(q)),
    );
  }, [items, catFilter, query]);

  const close = () => setDialog(null);
  const saved = () => {
    close();
    void reload();
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="mb-1 text-3xl font-extrabold">{t("stock")}</h1>
          <p className="text-muted">{t("stockSub")}</p>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => setDialog({ kind: "manage" })} aria-label={t("manage")} title={t("manage")}>
            <Settings2 className="size-5" />
          </Button>
          <Button onClick={() => setDialog({ kind: "item", item: null })}>
            <Plus className="size-5" /> {t("newItem")}
          </Button>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-3 rounded-2xl border-2 border-line bg-white px-4 py-3 focus-within:border-olive">
        <Search className="size-5 text-muted" />
        <input
          className="flex-1 bg-transparent text-lg outline-none"
          placeholder={t("search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="mb-5 flex flex-wrap gap-2.5">
        <Chip active={catFilter === null} onClick={() => setCatFilter(null)}>
          {t("all")}
        </Chip>
        {categories.map((c) => (
          <Chip key={c.id} active={catFilter === c.id} onClick={() => setCatFilter(c.id)}>
            {c.name}
          </Chip>
        ))}
        <Chip dashed onClick={() => setDialog({ kind: "category" })}>
          ＋ {t("newCategory")}
        </Chip>
      </div>

      {loadError && <p className="mb-4 rounded-2xl bg-bad-l p-4 text-bad">{t("error")}</p>}

      <div className="overflow-x-auto rounded-3xl bg-white p-2 shadow-sm">
        {loaded && shown.length === 0 && !loadError ? (
          <p className="p-10 text-center text-muted">{items.length === 0 ? t("empty") : t("emptyFilter")}</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-muted">
                <th className="p-3 text-start text-base font-medium">{t("item")}</th>
                <th className="hidden p-3 text-start text-base font-medium xl:table-cell">{t("category")}</th>
                <th className="p-3 text-start text-base font-medium">{t("onHand")}</th>
                <th className="p-3 text-start text-base font-medium">{t("buyPrice")}</th>
                <th className="p-3 text-start text-base font-medium">{t("sellPrice")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.id} className="border-t border-line hover:bg-bg/60">
                  <td className="p-3">
                    <b>{i.name}</b>
                    {i.buy_unit_name && i.buy_ratio_milli && i.buy_ratio_dir && (
                      <span className="block text-sm text-muted">
                        {t("boughtIn")} {i.buy_unit_name} · {refText(i.unit_name, i.buy_unit_name, i.buy_ratio_milli, i.buy_ratio_dir)}
                      </span>
                    )}
                  </td>
                  <td className="hidden p-3 text-muted xl:table-cell">{i.category_name ?? "—"}</td>
                  <td className="p-3 font-bold">
                    {formatQty(i.on_hand_milli)} {i.unit_name}{" "}
                    {i.on_hand_milli <= 0 && (
                      <span className="rounded-full bg-warn-l px-3 py-0.5 text-sm font-bold text-warn">{t("outOfStock")}</span>
                    )}
                  </td>
                  <td className="p-3 font-bold">{i.last_buy_price === null ? "—" : formatNumber(i.last_buy_price)}</td>
                  <td className="p-3 font-bold">{formatNumber(i.default_sell_price)}</td>
                  <td className="whitespace-nowrap p-3 text-end">
                    <Button small variant="ghost" onClick={() => setDialog({ kind: "deliveries", item: i })} title={t("deliveries")} aria-label={t("deliveries")}>
                      <History className="size-5" />
                    </Button>{" "}
                    <Button small variant="ghost" onClick={() => setDialog({ kind: "item", item: i })} title={t("edit")} aria-label={t("edit")}>
                      <Pencil className="size-5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {dialog?.kind === "item" && (
        <ItemForm
          item={dialog.item}
          categories={categories}
          units={units}
          defaultCategoryId={catFilter}
          createCategory={createCategory}
          createUnit={createUnit}
          onSaved={saved}
          onClose={close}
          onArchive={dialog.item ? () => setDialog({ kind: "archive", item: dialog.item as Item }) : undefined}
        />
      )}
      {dialog?.kind === "deliveries" && (
        <DeliveriesModal item={dialog.item} onChanged={() => void reload()} onClose={close} />
      )}
      {dialog?.kind === "archive" && (
        <ConfirmModal
          message={t("confirmArchive")}
          confirmLabel={t("archive")}
          onConfirm={async () => {
            await db.archiveItem(dialog.item.id);
            saved();
          }}
          onClose={close}
        />
      )}
      {dialog?.kind === "manage" && (
        <ManageModal categories={categories} units={units} onChanged={() => void reload()} onClose={close} />
      )}
      {dialog?.kind === "category" && <NewCategory onCreate={createCategory} onClose={close} onDone={(id) => { setCatFilter(id); close(); }} />}
    </div>
  );
}

function NewCategory({
  onCreate,
  onClose,
  onDone,
}: {
  onCreate: (name: string) => Promise<number>;
  onClose: () => void;
  onDone: (id: number) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  return (
    <Modal title={t("newCategory")} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return setError(t("required"));
          try {
            onDone(await onCreate(name));
          } catch {
            setError(t("error"));
          }
        }}
      >
        <Field label={t("name")} error={error}>
          <input className={inputCls} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full">
          {t("save")}
        </Button>
      </form>
    </Modal>
  );
}
