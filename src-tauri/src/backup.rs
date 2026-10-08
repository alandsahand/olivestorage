//! Database backups.
//!
//! * At every app start (before the window loads the database) the database file is copied to
//!   `<app data>/backups/olivestorage-YYYYMMDD-HHMMSS.db` (UTC), unless a backup younger than 6 hours exists.
//!   The `-wal` file is copied too, so the copy is complete even after a crash.
//! * "Back up now" in the app writes a consistent single-file copy with SQLite `VACUUM INTO`
//!   (the SQL runs from the frontend; this module only hands out a safe target path).
//! * The newest 30 backups are kept, older ones are deleted.

use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const DB_NAME: &str = "olivestorage.db";
const PREFIX: &str = "olivestorage-";
const KEEP: usize = 30;
const MIN_AGE_SECS: u64 = 6 * 60 * 60;

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn backups_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("backups");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Seconds since 1970 -> "YYYYMMDD-HHMMSS" (UTC). Civil-date algorithm by Howard Hinnant.
pub fn stamp_from_unix(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{:04}{:02}{:02}-{:02}{:02}{:02}", y, m, d, rem / 3600, (rem % 3600) / 60, rem % 60)
}

/// Inverse of `stamp_from_unix`: "olivestorage-YYYYMMDD-HHMMSS.db" -> seconds since 1970 (UTC).
/// The time comes from the NAME because copying a file on Windows keeps the original file's date.
pub fn unix_from_name(name: &str) -> Option<u64> {
    let s = name.strip_prefix(PREFIX)?.strip_suffix(".db")?;
    let (date, time) = s.split_once('-')?;
    if date.len() != 8 || time.len() != 6 || !s.chars().all(|c| c.is_ascii_digit() || c == '-') {
        return None;
    }
    let n = |r: std::ops::Range<usize>, t: &str| t[r].parse::<i64>().ok();
    let (y, m, d) = (n(0..4, date)?, n(4..6, date)?, n(6..8, date)?);
    let (hh, mm, ss) = (n(0..2, time)?, n(2..4, time)?, n(4..6, time)?);
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) || hh > 23 || mm > 59 || ss > 59 {
        return None;
    }
    // days from civil (Howard Hinnant)
    let y2 = if m <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2.rem_euclid(400);
    let mp = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let secs = days * 86_400 + hh * 3600 + mm * 60 + ss;
    u64::try_from(secs).ok()
}

fn is_backup_name(name: &str) -> bool {
    name.starts_with(PREFIX) && name.ends_with(".db")
}

/// Which names to delete so that only the newest `keep` remain (names sort chronologically).
pub fn names_to_prune(mut names: Vec<String>, keep: usize) -> Vec<String> {
    names.retain(|n| is_backup_name(n));
    names.sort();
    let extra = names.len().saturating_sub(keep);
    names.into_iter().take(extra).collect()
}

fn remove_with_siblings(path: &Path) {
    let _ = fs::remove_file(path);
    for ext in ["-wal", "-shm"] {
        let mut s = path.as_os_str().to_owned();
        s.push(ext);
        let _ = fs::remove_file(PathBuf::from(s));
    }
}

fn prune(dir: &Path, keep: usize) {
    let names: Vec<String> = fs::read_dir(dir)
        .map(|rd| rd.filter_map(|e| e.ok()).filter_map(|e| e.file_name().into_string().ok()).collect())
        .unwrap_or_default();
    for name in names_to_prune(names, keep) {
        remove_with_siblings(&dir.join(name));
    }
}

fn newest_backup_age_secs(dir: &Path) -> Option<u64> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs();
    fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .filter_map(|e| unix_from_name(e.file_name().to_str()?))
        .map(|made| now.saturating_sub(made))
        .min()
}

/// Called once from `setup`, before the frontend touches the database. Never fails the app start.
pub fn startup_backup(app: &AppHandle) {
    let _ = try_startup_backup(app);
}

fn try_startup_backup(app: &AppHandle) -> Result<(), String> {
    let db = data_dir(app)?.join(DB_NAME);
    if !db.exists() {
        return Ok(()); // first run: nothing to protect yet
    }
    let dir = backups_dir(app)?;
    if newest_backup_age_secs(&dir).map(|a| a < MIN_AGE_SECS).unwrap_or(false) {
        return Ok(());
    }
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs();
    let target = dir.join(format!("{PREFIX}{}.db", stamp_from_unix(secs)));
    fs::copy(&db, &target).map_err(|e| e.to_string())?;
    let wal = data_dir(app)?.join(format!("{DB_NAME}-wal"));
    if wal.exists() {
        let mut t = target.as_os_str().to_owned();
        t.push("-wal");
        let _ = fs::copy(&wal, PathBuf::from(t));
    }
    prune(&dir, KEEP);
    Ok(())
}

#[derive(serde::Serialize)]
pub struct BackupFile {
    name: String,
    size: u64,
    modified_ms: u64,
}

#[derive(serde::Serialize)]
pub struct BackupList {
    dir: String,
    files: Vec<BackupFile>,
}

/// Newest first.
#[tauri::command]
pub fn list_backups(app: AppHandle) -> Result<BackupList, String> {
    let dir = backups_dir(&app)?;
    let mut files: Vec<BackupFile> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            if !is_backup_name(&name) {
                return None;
            }
            let size = e.metadata().ok()?.len();
            let modified_ms = unix_from_name(&name)? * 1000; // when the backup was MADE (from its name)
            Some(BackupFile { name, size, modified_ms })
        })
        .collect();
    files.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(BackupList { dir: dir.to_string_lossy().into_owned(), files })
}

/// A fresh, safe file path for `VACUUM INTO`. The stamp comes from the frontend and is validated.
#[tauri::command]
pub fn backup_target(app: AppHandle, stamp: String) -> Result<String, String> {
    let ok = !stamp.is_empty() && stamp.len() <= 20 && stamp.chars().all(|c| c.is_ascii_digit() || c == '-');
    if !ok {
        return Err("bad stamp".into());
    }
    let path = backups_dir(&app)?.join(format!("{PREFIX}{stamp}.db"));
    if path.exists() {
        return Err("exists".into());
    }
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn prune_backups(app: AppHandle) -> Result<(), String> {
    prune(&backups_dir(&app)?, KEEP);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stamps_are_correct_utc() {
        assert_eq!(stamp_from_unix(0), "19700101-000000");
        assert_eq!(stamp_from_unix(951_782_400), "20000229-000000"); // leap day
        assert_eq!(stamp_from_unix(1_791_440_735), "20261008-062535");
        assert_eq!(stamp_from_unix(4_102_444_799), "20991231-235959");
    }

    #[test]
    fn prune_keeps_the_newest() {
        let names: Vec<String> = ["olivestorage-20260105-000000.db", "olivestorage-20260101-000000.db", "olivestorage-20260103-000000.db", "notes.txt", "olivestorage-20260102-000000.db-wal"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(names_to_prune(names.clone(), 2), vec!["olivestorage-20260101-000000.db"]);
        assert!(names_to_prune(names, 10).is_empty());
    }

    #[test]
    fn name_and_time_round_trip() {
        for secs in [0u64, 951_782_400, 1_791_440_735, 4_102_444_799, 1_709_251_199] {
            let name = format!("olivestorage-{}.db", stamp_from_unix(secs));
            assert_eq!(unix_from_name(&name), Some(secs), "{name}");
        }
        assert_eq!(unix_from_name("olivestorage-20261308-000000.db"), None); // month 13
        assert_eq!(unix_from_name("olivestorage-2026.db"), None);
        assert_eq!(unix_from_name("notes.txt"), None);
        assert_eq!(unix_from_name("olivestorage-20261008-062535.db-wal"), None);
    }

    #[test]
    fn stamp_sorts_chronologically() {
        assert!(stamp_from_unix(1_000_000_000) < stamp_from_unix(1_700_000_000));
    }
}
