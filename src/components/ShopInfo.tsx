import { useState } from "react";
import { Check, Phone, Plus, X } from "lucide-react";
import logo from "@/assets/logo.png";
import { useI18n } from "@/i18n";
import { useShop } from "@/shop";
import { MAX_SHOP_PHONES } from "@/data/shop";
import { Button, Modal, inputCls } from "@/components/ui";
import { onlyPhone } from "@/lib/format";

/** One to three phone boxes with "+ another number" (used by the first-start screen and the shop info dialog). */
function PhoneFields({ phones, onChange }: { phones: string[]; onChange: (p: string[]) => void }) {
  const { t } = useI18n();
  return (
    <div>
      <span className="mb-1.5 flex items-center gap-2 font-bold">
        <Phone className="size-5 text-olive" /> {t("shopPhones")}
      </span>
      <ul className="space-y-2">
        {phones.map((p, k) => (
          <li key={k} className="flex items-center gap-2">
            <input
              className={`${inputCls} text-center`}
              dir="ltr"
              inputMode="tel"
              maxLength={40}
              placeholder="07xx xxx xxxx"
              aria-label={`${t("shopPhones")} ${k + 1}`}
              value={p}
              onChange={(e) => onChange(phones.map((x, i) => (i === k ? onlyPhone(e.target.value) : x)))}
            />
            {phones.length > 1 && (
              <button
                type="button"
                onClick={() => onChange(phones.filter((_, i) => i !== k))}
                aria-label={t("remove")}
                title={t("remove")}
                className="rounded-lg p-2 text-muted hover:bg-bg hover:text-bad"
              >
                <X className="size-5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {phones.length < MAX_SHOP_PHONES && (
        <Button type="button" small variant="ghost" className="mt-2" onClick={() => onChange([...phones, ""])}>
          <Plus className="size-4" /> {t("addPhone")}
        </Button>
      )}
    </div>
  );
}

const Credit = () => {
  const { t } = useI18n();
  return <p className="mt-6 border-t border-line pt-4 text-center text-base text-muted">{t("devCredit")}</p>;
};

/** Shown once, the first time the app opens: the (fixed) app name, the shop's phone numbers and the credit line. */
export function FirstStart() {
  const { t, lang, setLang } = useI18n();
  const shop = useShop();
  const [phones, setPhones] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await shop.save(phones);
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <form onSubmit={start} className="w-full max-w-md rounded-3xl bg-white p-8 shadow-sm">
        <div className="mb-4 flex justify-center gap-2">
          {(["ckb", "ar"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              className={`rounded-full border-2 px-4 py-1 text-base ${lang === l ? "border-olive bg-olive font-bold text-white" : "border-line"}`}
            >
              {l === "ckb" ? "کوردی" : "العربية"}
            </button>
          ))}
        </div>
        <img src={logo} alt="" className="mx-auto mb-3 size-20" />
        <h1 className="mb-1 text-center text-3xl font-extrabold text-olive-d">{t("appName")}</h1>
        <p className="mb-6 text-center text-muted">
          {t("welcome")} {t("welcomeHint")}
        </p>
        <PhoneFields phones={phones} onChange={setPhones} />
        <p className="my-4 text-base text-muted">{t("changeLater")}</p>
        {error && <p className="mb-3 rounded-xl bg-bad-l p-3 text-bad">{t("error")}</p>}
        <Button type="submit" disabled={busy} className="w-full">
          {t("start")}
        </Button>
        <Credit />
      </form>
    </div>
  );
}

/** Sidebar "shop info": change the phone numbers printed on invoices, receipts and statements. */
export function ShopInfoModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const shop = useShop();
  const [phones, setPhones] = useState<string[]>(shop.phones.length ? shop.phones : [""]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      await shop.save(phones);
      setDone(true);
    } catch {
      setError(true);
    }
    setBusy(false);
  }

  return (
    <Modal title={t("shopInfo")} onClose={onClose}>
      <form onSubmit={save}>
        <p className="mb-4 text-lg font-extrabold text-olive-d">{t("appName")}</p>
        <PhoneFields
          phones={phones}
          onChange={(p) => {
            setDone(false);
            setPhones(p);
          }}
        />
        <p className="my-4 text-base text-muted">{t("phonesOnPrint")}</p>
        {done && (
          <p className="mb-3 flex items-center gap-2 rounded-xl bg-good-l p-3 font-bold text-good">
            <Check className="size-5" /> {t("savedOk")}
          </p>
        )}
        {error && <p className="mb-3 rounded-xl bg-bad-l p-3 text-bad">{t("error")}</p>}
        <Button type="submit" disabled={busy} className="w-full">
          {t("save")}
        </Button>
        <Credit />
      </form>
    </Modal>
  );
}
