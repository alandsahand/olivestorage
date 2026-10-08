import { useCallback, useEffect, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Check, FolderOpen, HardDriveDownload } from "lucide-react";
import { useI18n } from "@/i18n";
import { Button, Modal } from "@/components/ui";
import { formatDateTime, formatNumber } from "@/lib/format";
import { backupNow, listBackups } from "@/data/backup";
import type { BackupList } from "@/data/backup";

const sizeText = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${formatNumber(Math.round((bytes / 1024 / 1024) * 10) / 10)} MB` : `${formatNumber(Math.max(1, Math.round(bytes / 1024)))} KB`;

export function BackupModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [info, setInfo] = useState<BackupList | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setInfo(await listBackups());
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function run() {
    setBusy(true);
    setError(false);
    setDone(false);
    try {
      await backupNow();
      setDone(true);
      await load();
    } catch {
      setError(true);
    }
    setBusy(false);
  }

  async function openFolder() {
    if (!info) return;
    try {
      // reveal selects the newest file; with no files, fall back to the folder's own path
      await revealItemInDir(info.files.length ? `${info.dir}\\${info.files[0].name}` : info.dir);
    } catch {
      setError(true);
    }
  }

  const latest = info?.files[0];

  return (
    <Modal title={t("backup")} onClose={onClose}>
      <p className="mb-4 text-muted">{t("backupHint")}</p>
      <div className="mb-4 rounded-2xl bg-olive-l p-4 text-olive-d">
        {t("lastBackup")}: <b>{latest ? formatDateTime(new Date(latest.modified_ms).toISOString()) : t("noBackups")}</b>
        {info && info.files.length > 0 && (
          <span className="block text-base">
            {formatNumber(info.files.length)} {t("backupFiles")}
          </span>
        )}
      </div>
      {done && (
        <p className="mb-3 flex items-center gap-2 rounded-xl bg-good-l p-3 font-bold text-good">
          <Check className="size-5" /> {t("backupDone")}
        </p>
      )}
      {error && <p className="mb-3 rounded-xl bg-bad-l p-3 text-bad">{t("error")}</p>}
      <div className="mb-5 flex gap-3">
        <Button onClick={run} disabled={busy} className="flex-1">
          <HardDriveDownload className="size-5" /> {t("backupNow")}
        </Button>
        <Button variant="secondary" onClick={openFolder} disabled={!info}>
          <FolderOpen className="size-5" /> {t("openFolder")}
        </Button>
      </div>
      {info && info.files.length > 0 && (
        <ul className="max-h-56 divide-y divide-line overflow-auto rounded-2xl border-2 border-line text-base">
          {info.files.slice(0, 10).map((f) => (
            <li key={f.name} className="flex justify-between gap-3 p-2.5">
              <span>{formatDateTime(new Date(f.modified_ms).toISOString())}</span>
              <span className="text-muted">{sizeText(f.size)}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
