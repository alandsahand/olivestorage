import { invoke } from "@tauri-apps/api/core";
import { getDb } from "../db";

export type BackupFile = { name: string; size: number; modified_ms: number };
export type BackupList = { dir: string; files: BackupFile[] };

export const listBackups = () => invoke<BackupList>("list_backups");

/** "YYYYMMDD-HHMMSS" in UTC, same format the app uses for its automatic start-up backups. */
export const backupStamp = (d = new Date()) => d.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");

/** Makes a consistent single-file copy of the live database right now (SQLite VACUUM INTO). */
export async function backupNow(): Promise<string> {
  const target = await invoke<string>("backup_target", { stamp: backupStamp() });
  const db = await getDb();
  await db.execute(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  await invoke("prune_backups");
  return target;
}
