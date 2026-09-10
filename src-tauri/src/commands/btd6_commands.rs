use super::sprocket_commands::{
    activate_managed_runtime, deactivate_managed_runtime, defender_command, defender_scan,
    ensure_managed_runtime_for, ensure_pe_dll, managed_runtime_root_for, manifest_value,
    sha256_file, steam_libraries,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
use url::Url;

const BTD6_APP_ID: &str = "960090";
const BTD6_MELONLOADER_VERSION: &str = "0.7.2";
const MAX_MOD_BYTES: u64 = 256 * 1024 * 1024;
const MAX_HELPER_BYTES: u64 = 64 * 1024 * 1024;
const MAX_MOD_ICON_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Btd6Installation {
    installed: bool,
    app_id: String,
    install_dir: Option<String>,
    executable_path: Option<String>,
    build_id: Option<String>,
    melon_loader_ready: bool,
    mod_helper_installed: bool,
    security_scanner_available: bool,
    enabled_mod_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Btd6ModFile {
    file_name: String,
    display_name: String,
    path: String,
    enabled: bool,
    required: bool,
    size_bytes: u64,
    sha256: String,
    scan_status: String,
    risk_signals: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Btd6ScanRecord {
    sha256: String,
    scanned_at: u64,
    engine: String,
    risk_signals: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Btd6LaunchStatus {
    instance_id: String,
    status: String,
    detail: String,
    exit_code: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Btd6LaunchStarted {
    pid: u32,
    modded: bool,
    loader: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Btd6UploadInspection {
    staged_path: String,
    file_name: String,
    display_name: String,
    size_bytes: u64,
    sha256: String,
    risk_signals: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    digest: Option<String>,
    size: u64,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    assets: Vec<GithubAsset>,
}

fn epoch_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn is_mod_helper(file_name: &str) -> bool {
    file_name
        .trim_end_matches(".disabled")
        .eq_ignore_ascii_case("Btd6ModHelper.dll")
}

fn safe_file_name(value: &str) -> Result<&str, String> {
    let path = Path::new(value);
    if value.trim().is_empty() || path.components().count() != 1 {
        Err("The mod file name is invalid.".into())
    } else {
        Ok(value)
    }
}

fn require_modded_launch_acknowledgement(
    has_enabled_mods: bool,
    modded: bool,
    acknowledged: bool,
) -> Result<bool, String> {
    let actually_modded = has_enabled_mods && modded;
    if actually_modded && !acknowledged {
        return Err(
            "A fresh ban/flag risk acknowledgement is required for every modded launch.".into(),
        );
    }
    Ok(actually_modded)
}

fn detect_installation() -> Btd6Installation {
    for library in steam_libraries() {
        let manifest = library
            .join("steamapps")
            .join(format!("appmanifest_{BTD6_APP_ID}.acf"));
        if !manifest.is_file() {
            continue;
        }
        let content = fs::read_to_string(&manifest).unwrap_or_default();
        let folder = manifest_value(&content, "installdir").unwrap_or_else(|| "BloonsTD6".into());
        let install_dir = library.join("steamapps").join("common").join(folder);
        let executable = install_dir.join("BloonsTD6.exe");
        let mods_dir = install_dir.join("Mods");
        let enabled_mod_count = enabled_mod_paths(&mods_dir).len();
        let mod_helper_installed = enabled_mod_paths(&mods_dir).iter().any(|path| {
            path.file_name()
                .and_then(|value| value.to_str())
                .is_some_and(is_mod_helper)
        });
        return Btd6Installation {
            installed: executable.is_file(),
            app_id: BTD6_APP_ID.into(),
            install_dir: Some(install_dir.to_string_lossy().into_owned()),
            executable_path: executable
                .is_file()
                .then(|| executable.to_string_lossy().into_owned()),
            build_id: manifest_value(&content, "buildid"),
            melon_loader_ready: install_dir.join("MelonLoader").is_dir()
                || install_dir.join("version.dll").is_file(),
            mod_helper_installed,
            security_scanner_available: defender_command().is_some(),
            enabled_mod_count,
        };
    }

    Btd6Installation {
        installed: false,
        app_id: BTD6_APP_ID.into(),
        install_dir: None,
        executable_path: None,
        build_id: None,
        melon_loader_ready: false,
        mod_helper_installed: false,
        security_scanner_available: defender_command().is_some(),
        enabled_mod_count: 0,
    }
}

fn enabled_mod_paths(mods_dir: &Path) -> Vec<PathBuf> {
    fs::read_dir(mods_dir)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| value.eq_ignore_ascii_case("dll"))
        })
        .collect()
}

fn static_risk_signals(path: &Path) -> Vec<String> {
    let Ok(bytes) = fs::read(path) else {
        return vec!["File contents could not be inspected".into()];
    };
    let lower = String::from_utf8_lossy(&bytes).to_ascii_lowercase();
    let rules = [
        (
            ["powershell", "system.management.automation"].as_slice(),
            "PowerShell execution reference",
        ),
        (
            ["cmd.exe", "process.start"].as_slice(),
            "External process execution reference",
        ),
        (
            ["webclient", "httpclient", "downloadstring"].as_slice(),
            "Network download reference",
        ),
        (
            ["virtualalloc", "writeprocessmemory", "createremotethread"].as_slice(),
            "Process injection reference",
        ),
    ];
    rules
        .into_iter()
        .filter_map(|(needles, label)| {
            needles
                .iter()
                .any(|needle| lower.contains(needle))
                .then(|| label.to_string())
        })
        .collect()
}

fn scan_record_path(app: &AppHandle, sha256: &str) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("security")
        .join("btd6-scans");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root.join(format!("{sha256}.json")))
}

fn upload_staging_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("btd6-submissions");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root)
}

fn validate_staged_upload(app: &AppHandle, value: &str) -> Result<PathBuf, String> {
    let root = upload_staging_root(app)?;
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "The BTD6 upload staging folder is unavailable.".to_string())?;
    let path = PathBuf::from(value);
    let canonical = path
        .canonicalize()
        .map_err(|_| "The scanned upload file no longer exists.".to_string())?;
    if canonical.parent() != Some(canonical_root.as_path())
        || !canonical
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("dll"))
    {
        return Err("Only BTD6 files prepared by Aster can be uploaded.".into());
    }
    Ok(canonical)
}

fn validate_btd6_upload_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "The upload URL is invalid.".to_string())?;
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if url.scheme() != "https"
        || !host.ends_with(".supabase.co")
        || !url
            .path()
            .contains("/storage/v1/object/upload/sign/btd6-mod-submissions/")
        || url.query_pairs().all(|(key, _)| key != "token")
    {
        return Err("The upload destination is not an approved Aster BTD6 submission URL.".into());
    }
    Ok(url)
}

fn validate_btd6_download_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "The download URL is invalid.".to_string())?;
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if url.scheme() != "https"
        || !host.ends_with(".supabase.co")
        || !url
            .path()
            .contains("/storage/v1/object/sign/btd6-mod-submissions/")
        || url.query_pairs().all(|(key, _)| key != "token")
    {
        return Err("The download does not come from the approved Aster BTD6 storage.".into());
    }
    Ok(url)
}

fn btd6_icon_type(path: &Path) -> Result<&'static str, String> {
    let metadata =
        fs::metadata(path).map_err(|_| "The selected icon is unavailable.".to_string())?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_MOD_ICON_BYTES {
        return Err("Choose an icon smaller than 5 MB.".into());
    }
    let bytes = fs::read(path).map_err(|_| "The selected icon could not be read.".to_string())?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "png" if bytes.starts_with(b"\x89PNG\r\n\x1a\n") => Ok("image/png"),
        "jpg" | "jpeg" if bytes.starts_with(&[0xff, 0xd8, 0xff]) => Ok("image/jpeg"),
        "webp" if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" => {
            Ok("image/webp")
        }
        _ => Err("The icon must be a valid PNG, JPG, or WEBP image.".into()),
    }
}

fn scan_and_record(app: &AppHandle, path: &Path) -> Result<Btd6ScanRecord, String> {
    ensure_pe_dll(path)?;
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_MOD_BYTES {
        return Err("The selected mod exceeds Aster's 256 MB safety limit.".into());
    }
    defender_scan(path)?;
    let sha256 = sha256_file(path)?;
    let record = Btd6ScanRecord {
        sha256: sha256.clone(),
        scanned_at: epoch_seconds(),
        engine: "Microsoft Defender + Aster static inspection".into(),
        risk_signals: static_risk_signals(path),
    };
    fs::write(
        scan_record_path(app, &sha256)?,
        serde_json::to_vec_pretty(&record).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("The scan record could not be saved: {error}"))?;
    Ok(record)
}

fn read_scan_record(app: &AppHandle, path: &Path) -> Option<Btd6ScanRecord> {
    let sha256 = sha256_file(path).ok()?;
    let bytes = fs::read(scan_record_path(app, &sha256).ok()?).ok()?;
    let record: Btd6ScanRecord = serde_json::from_slice(&bytes).ok()?;
    (record.sha256 == sha256).then_some(record)
}

fn download_mod_helper(app: &AppHandle, install_dir: &Path) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .https_only(true)
        .user_agent("Aster-Launcher/0.6")
        .build()
        .map_err(|error| error.to_string())?;
    let release = client
        .get("https://api.github.com/repos/gurrenm3/BTD-Mod-Helper/releases/latest")
        .send()
        .map_err(|error| format!("BTD6 Mod Helper could not be checked: {error}"))?
        .error_for_status()
        .map_err(|error| {
            format!("The official BTD6 Mod Helper release could not be read: {error}")
        })?
        .json::<GithubRelease>()
        .map_err(|error| format!("The BTD6 Mod Helper release response was invalid: {error}"))?;
    let asset = release
        .assets
        .into_iter()
        .find(|asset| asset.name.eq_ignore_ascii_case("Btd6ModHelper.dll"))
        .ok_or_else(|| "The official release does not contain Btd6ModHelper.dll.".to_string())?;
    if !asset
        .browser_download_url
        .starts_with("https://github.com/gurrenm3/BTD-Mod-Helper/releases/download/")
        || asset.size == 0
        || asset.size > MAX_HELPER_BYTES
    {
        return Err("The official BTD6 Mod Helper asset failed Aster's allowlist checks.".into());
    }
    let expected_digest = asset
        .digest
        .and_then(|value| value.strip_prefix("sha256:").map(str::to_owned))
        .ok_or_else(|| "The official BTD6 Mod Helper release has no SHA-256 digest.".to_string())?;
    let bytes = client
        .get(&asset.browser_download_url)
        .send()
        .map_err(|error| format!("BTD6 Mod Helper could not be downloaded: {error}"))?
        .error_for_status()
        .map_err(|error| format!("BTD6 Mod Helper download failed: {error}"))?
        .bytes()
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 != asset.size {
        return Err("The BTD6 Mod Helper download size did not match its release metadata.".into());
    }
    let actual_digest = format!("{:x}", Sha256::digest(&bytes));
    if !actual_digest.eq_ignore_ascii_case(&expected_digest) {
        return Err("BTD6 Mod Helper failed SHA-256 verification.".into());
    }
    let quarantine = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("security")
        .join("quarantine");
    fs::create_dir_all(&quarantine).map_err(|error| error.to_string())?;
    let staged = quarantine.join(format!("btd6-helper-{}.dll", uuid::Uuid::new_v4()));
    fs::write(&staged, &bytes).map_err(|error| error.to_string())?;
    let result = (|| {
        scan_and_record(app, &staged)?;
        let mods = install_dir.join("Mods");
        fs::create_dir_all(&mods).map_err(|error| error.to_string())?;
        fs::copy(&staged, mods.join("Btd6ModHelper.dll"))
            .map_err(|error| format!("BTD6 Mod Helper could not be installed: {error}"))?;
        Ok(())
    })();
    let _ = fs::remove_file(staged);
    result
}

#[tauri::command]
pub fn detect_btd6_installation(app: AppHandle) -> Btd6Installation {
    let mut installation = detect_installation();
    installation.melon_loader_ready =
        managed_runtime_root_for(&app, "btd6", BTD6_MELONLOADER_VERSION)
            .map(|root| root.join("version.dll").is_file() && root.join("MelonLoader").is_dir())
            .unwrap_or(false)
            || installation.melon_loader_ready;
    installation
}

#[tauri::command]
pub fn list_btd6_mods(app: AppHandle) -> Result<Vec<Btd6ModFile>, String> {
    let Some(install_dir) = detect_installation().install_dir else {
        return Ok(Vec::new());
    };
    let mods_dir = PathBuf::from(install_dir).join("Mods");
    let Ok(entries) = fs::read_dir(mods_dir) else {
        return Ok(Vec::new());
    };
    let mut mods = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().into_owned();
        let lower = file_name.to_ascii_lowercase();
        let enabled = lower.ends_with(".dll");
        if !enabled && !lower.ends_with(".dll.disabled") {
            continue;
        }
        let hash = sha256_file(&path).unwrap_or_else(|_| "unreadable".into());
        let record = read_scan_record(&app, &path);
        mods.push(Btd6ModFile {
            display_name: file_name
                .trim_end_matches(".disabled")
                .trim_end_matches(".dll")
                .to_string(),
            required: is_mod_helper(&file_name),
            file_name,
            path: path.to_string_lossy().into_owned(),
            enabled,
            size_bytes: entry.metadata().map(|value| value.len()).unwrap_or(0),
            sha256: hash,
            scan_status: if record.is_some() {
                "passed"
            } else {
                "unscanned"
            }
            .into(),
            risk_signals: record.map(|value| value.risk_signals).unwrap_or_default(),
        });
    }
    mods.sort_by(|a, b| {
        b.required
            .cmp(&a.required)
            .then_with(|| a.display_name.cmp(&b.display_name))
    });
    Ok(mods)
}

#[tauri::command]
pub fn import_btd6_mod(
    app: AppHandle,
    source_path: String,
    enabled: Option<bool>,
) -> Result<String, String> {
    let install_dir = detect_installation()
        .install_dir
        .ok_or_else(|| "Install Bloons TD 6 through Steam first.".to_string())?;
    let source = PathBuf::from(source_path);
    if !source.is_file()
        || !source
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("dll"))
    {
        return Err("Choose a valid BTD6 .dll mod.".into());
    }
    let quarantine = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("security")
        .join("quarantine");
    fs::create_dir_all(&quarantine).map_err(|error| error.to_string())?;
    let staged = quarantine.join(format!("btd6-mod-{}.dll", uuid::Uuid::new_v4()));
    fs::copy(&source, &staged)
        .map_err(|error| format!("The mod could not be quarantined: {error}"))?;
    let result = (|| {
        scan_and_record(&app, &staged)?;
        let target_dir = PathBuf::from(install_dir).join("Mods");
        fs::create_dir_all(&target_dir).map_err(|error| error.to_string())?;
        let name = source
            .file_name()
            .ok_or_else(|| "The mod has no file name.".to_string())?;
        let file_name = name.to_string_lossy().into_owned();
        let target_name = if enabled.unwrap_or(true) {
            file_name.clone()
        } else {
            format!("{file_name}.disabled")
        };
        for previous in [
            target_dir.join(&file_name),
            target_dir.join(format!("{file_name}.disabled")),
        ] {
            if previous.is_file() {
                fs::remove_file(previous).map_err(|error| {
                    format!("The older local mod could not be replaced: {error}")
                })?;
            }
        }
        fs::copy(&staged, target_dir.join(&target_name))
            .map_err(|error| format!("The scanned mod could not be installed: {error}"))?;
        Ok(target_name)
    })();
    let _ = fs::remove_file(staged);
    result
}

#[tauri::command]
pub fn prepare_btd6_mod_upload(
    app: AppHandle,
    source_path: String,
) -> Result<Btd6UploadInspection, String> {
    let source = PathBuf::from(source_path);
    if !source.is_file()
        || !source
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("dll"))
    {
        return Err("Choose a valid BTD6 .dll mod.".into());
    }
    let source_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "The mod has no valid file name.".to_string())?;
    if is_mod_helper(source_name) {
        return Err("The official BTD6 Mod Helper cannot be submitted as a community mod.".into());
    }
    let staged = upload_staging_root(&app)?.join(format!("{}.dll", uuid::Uuid::new_v4()));
    fs::copy(&source, &staged)
        .map_err(|error| format!("The mod could not be copied into upload quarantine: {error}"))?;
    let result = (|| {
        let scan = scan_and_record(&app, &staged)?;
        let size_bytes = fs::metadata(&staged)
            .map_err(|error| error.to_string())?
            .len();
        Ok(Btd6UploadInspection {
            staged_path: staged.to_string_lossy().into_owned(),
            file_name: source_name.to_string(),
            display_name: source
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("BTD6 Mod")
                .to_string(),
            size_bytes,
            sha256: scan.sha256,
            risk_signals: scan.risk_signals,
        })
    })();
    if result.is_err() {
        let _ = fs::remove_file(staged);
    }
    result
}

#[tauri::command]
pub async fn upload_btd6_mod_submission(
    app: AppHandle,
    staged_path: String,
    expected_sha256: String,
    signed_url: String,
    api_key: String,
    access_token: String,
) -> Result<(), String> {
    if api_key.trim().is_empty() || access_token.trim().is_empty() {
        return Err("An active Aster Social session is required to submit a mod.".into());
    }
    let path = validate_staged_upload(&app, &staged_path)?;
    ensure_pe_dll(&path)?;
    let size = fs::metadata(&path)
        .map_err(|error| error.to_string())?
        .len();
    if size == 0 || size > MAX_MOD_BYTES {
        return Err("The prepared mod has an invalid size.".into());
    }
    let actual_sha256 = sha256_file(&path)?;
    if !actual_sha256.eq_ignore_ascii_case(expected_sha256.trim()) {
        return Err("The mod changed after its security scan. Upload blocked.".into());
    }
    defender_scan(&path)?;
    let upload_url = validate_btd6_upload_url(&signed_url)?;
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|_| "The scanned mod could not be read for upload.".to_string())?;
    let response = reqwest::Client::new()
        .put(upload_url)
        .header("apikey", api_key)
        .bearer_auth(access_token)
        .header(reqwest::header::CONTENT_TYPE, "application/x-msdownload")
        .header(reqwest::header::CONTENT_LENGTH, size)
        .header("x-upsert", "false")
        .body(bytes)
        .send()
        .await
        .map_err(|_| "The BTD6 mod submission could not reach Aster storage.".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "The BTD6 mod submission returned HTTP {}.",
            response.status()
        ));
    }
    tokio::fs::remove_file(path).await.map_err(|_| {
        "The upload succeeded, but its temporary scanned copy could not be removed.".to_string()
    })?;
    Ok(())
}

#[tauri::command]
pub async fn upload_btd6_submission_icon(
    source_path: String,
    signed_url: String,
    api_key: String,
    access_token: String,
) -> Result<(), String> {
    if api_key.trim().is_empty() || access_token.trim().is_empty() {
        return Err("An active Aster Social session is required to upload an icon.".into());
    }
    let path = PathBuf::from(source_path);
    let mime_type = btd6_icon_type(&path)?;
    defender_scan(&path)?;
    let size = fs::metadata(&path)
        .map_err(|error| error.to_string())?
        .len();
    let upload_url = validate_btd6_upload_url(&signed_url)?;
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|_| "The selected icon could not be read.".to_string())?;
    let response = reqwest::Client::new()
        .put(upload_url)
        .header("apikey", api_key)
        .bearer_auth(access_token)
        .header(reqwest::header::CONTENT_TYPE, mime_type)
        .header(reqwest::header::CONTENT_LENGTH, size)
        .header("x-upsert", "false")
        .body(bytes)
        .send()
        .await
        .map_err(|_| "The BTD6 mod icon could not reach Aster storage.".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "The BTD6 mod icon upload returned HTTP {}.",
            response.status()
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn install_btd6_community_mod(
    app: AppHandle,
    signed_url: String,
    file_name: String,
    expected_sha256: String,
    enabled: Option<bool>,
) -> Result<(), String> {
    let file_name = safe_file_name(&file_name)?;
    if !file_name.to_ascii_lowercase().ends_with(".dll") || is_mod_helper(file_name) {
        return Err("The community download does not contain a valid BTD6 mod name.".into());
    }
    if expected_sha256.len() != 64
        || !expected_sha256
            .chars()
            .all(|value| value.is_ascii_hexdigit())
    {
        return Err("The community mod has no valid SHA-256 identity.".into());
    }
    let install_dir = detect_installation()
        .install_dir
        .ok_or_else(|| "Install Bloons TD 6 through Steam first.".to_string())?;
    let download_url = validate_btd6_download_url(&signed_url)?;
    let response = reqwest::Client::new()
        .get(download_url)
        .send()
        .await
        .map_err(|_| "The community mod download could not reach Aster storage.".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "The community mod download returned HTTP {}.",
            response.status()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_MOD_BYTES)
    {
        return Err("The community mod exceeds Aster's 256 MB safety limit.".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "The community mod download was interrupted.".to_string())?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_MOD_BYTES {
        return Err("The downloaded community mod has an invalid size.".into());
    }
    let quarantine = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("security")
        .join("quarantine");
    fs::create_dir_all(&quarantine).map_err(|error| error.to_string())?;
    let staged = quarantine.join(format!("btd6-community-{}.dll", uuid::Uuid::new_v4()));
    fs::write(&staged, &bytes)
        .map_err(|error| format!("The mod could not be quarantined: {error}"))?;
    let result = (|| {
        let actual_sha256 = sha256_file(&staged)?;
        if !actual_sha256.eq_ignore_ascii_case(expected_sha256.trim()) {
            return Err("The downloaded mod failed its SHA-256 verification.".into());
        }
        scan_and_record(&app, &staged)?;
        let target_dir = PathBuf::from(install_dir).join("Mods");
        fs::create_dir_all(&target_dir).map_err(|error| error.to_string())?;
        let enabled_target = target_dir.join(file_name);
        let disabled_target = target_dir.join(format!("{file_name}.disabled"));
        for previous in [&enabled_target, &disabled_target] {
            if previous.is_file() {
                fs::remove_file(previous).map_err(|error| {
                    format!("The older mod version could not be replaced: {error}")
                })?;
            }
        }
        let target = if enabled.unwrap_or(false) {
            enabled_target
        } else {
            disabled_target
        };
        fs::copy(&staged, target).map_err(|error| {
            format!("The verified community mod could not be installed: {error}")
        })?;
        Ok(())
    })();
    let _ = fs::remove_file(staged);
    result
}

#[tauri::command]
pub fn discard_btd6_mod_upload(app: AppHandle, staged_path: String) -> Result<(), String> {
    let path = validate_staged_upload(&app, &staged_path)?;
    fs::remove_file(path)
        .map_err(|error| format!("The temporary upload could not be removed: {error}"))
}

#[tauri::command]
pub fn scan_btd6_mod(app: AppHandle, file_name: String) -> Result<(), String> {
    let file_name = safe_file_name(&file_name)?;
    let install_dir = detect_installation()
        .install_dir
        .ok_or_else(|| "Bloons TD 6 is not installed.".to_string())?;
    let path = PathBuf::from(install_dir).join("Mods").join(file_name);
    scan_and_record(&app, &path).map(|_| ())
}

#[tauri::command]
pub fn set_btd6_mod_enabled(file_name: String, enabled: bool) -> Result<(), String> {
    let file_name = safe_file_name(&file_name)?;
    if is_mod_helper(file_name) && !enabled {
        return Err("BTD6 Mod Helper is required while community mods are enabled.".into());
    }
    let install_dir = detect_installation()
        .install_dir
        .ok_or_else(|| "Bloons TD 6 is not installed.".to_string())?;
    let mods_dir = PathBuf::from(install_dir).join("Mods");
    let source = mods_dir.join(file_name);
    if !source.is_file() {
        return Err("The selected mod no longer exists.".into());
    }
    let target = if enabled {
        file_name.trim_end_matches(".disabled").to_string()
    } else {
        format!("{file_name}.disabled")
    };
    fs::rename(source, mods_dir.join(target))
        .map_err(|error| format!("The mod state could not be changed: {error}"))
}

#[tauri::command]
pub fn remove_btd6_mod(file_name: String) -> Result<(), String> {
    let file_name = safe_file_name(&file_name)?;
    if is_mod_helper(file_name) {
        return Err("Use Repair runtime to replace the required BTD6 Mod Helper.".into());
    }
    let install_dir = detect_installation()
        .install_dir
        .ok_or_else(|| "Bloons TD 6 is not installed.".to_string())?;
    fs::remove_file(PathBuf::from(install_dir).join("Mods").join(file_name))
        .map_err(|error| format!("The mod could not be removed: {error}"))
}

#[tauri::command]
pub fn repair_btd6_runtime(app: AppHandle) -> Result<(), String> {
    let install_dir = detect_installation()
        .install_dir
        .ok_or_else(|| "Install Bloons TD 6 through Steam first.".to_string())?;
    let runtime_root = managed_runtime_root_for(&app, "btd6", BTD6_MELONLOADER_VERSION)?;
    if runtime_root.exists() {
        fs::remove_dir_all(&runtime_root)
            .map_err(|error| format!("The private BTD6 runtime could not be reset: {error}"))?;
    }
    ensure_managed_runtime_for(&app, "btd6", BTD6_MELONLOADER_VERSION)?;
    download_mod_helper(&app, &PathBuf::from(install_dir))
}

#[tauri::command]
pub fn open_btd6_path(section: String) -> Result<(), String> {
    let install_dir = detect_installation()
        .install_dir
        .ok_or_else(|| "Bloons TD 6 is not installed.".to_string())?;
    let path = match section.as_str() {
        "mods" => PathBuf::from(install_dir).join("Mods"),
        _ => PathBuf::from(install_dir),
    };
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    open::that(path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_btd6_store() -> Result<(), String> {
    open::that(format!("steam://store/{BTD6_APP_ID}")).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn launch_btd6(
    app: AppHandle,
    modded: bool,
    risk_acknowledged: bool,
) -> Result<Btd6LaunchStarted, String> {
    let installation = detect_installation();
    let executable = PathBuf::from(installation.executable_path.ok_or_else(|| {
        "Bloons TD 6 was not found. Install it through Steam, then refresh detection.".to_string()
    })?);
    let install_dir = executable
        .parent()
        .ok_or_else(|| "The BTD6 installation path is invalid.".to_string())?;
    let enabled_mods = enabled_mod_paths(&install_dir.join("Mods"));
    let actually_modded =
        require_modded_launch_acknowledgement(!enabled_mods.is_empty(), modded, risk_acknowledged)?;
    let runtime = if actually_modded {
        let _ = app.emit(
            "launch-status",
            Btd6LaunchStatus {
                instance_id: "btd6".into(),
                status: "preparing".into(),
                detail: "Scanning every enabled BTD6 mod before launch.".into(),
                exit_code: None,
            },
        );
        for path in &enabled_mods {
            scan_and_record(&app, path)?;
        }
        if !enabled_mods.iter().any(|path| {
            path.file_name()
                .and_then(|value| value.to_str())
                .is_some_and(is_mod_helper)
        }) {
            download_mod_helper(&app, install_dir)?;
        }
        Some(ensure_managed_runtime_for(
            &app,
            "btd6",
            BTD6_MELONLOADER_VERSION,
        )?)
    } else {
        None
    };
    let activation = runtime
        .as_deref()
        .map(|runtime| activate_managed_runtime(runtime, install_dir))
        .transpose()?;
    let mut command = Command::new(&executable);
    command
        .current_dir(install_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(runtime) = runtime.as_deref() {
        command
            .arg(format!(
                "--melonloader.basedir={}",
                runtime.to_string_lossy()
            ))
            .arg("--melonloader.hideconsole")
            .arg("--melonloader.disablestartscreen")
            .arg("--modhelper.offline");
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            if let (Some(activation), Some(runtime)) = (&activation, runtime.as_deref()) {
                deactivate_managed_runtime(activation, runtime);
            }
            return Err(format!("Bloons TD 6 could not start: {error}"));
        }
    };
    let pid = child.id();
    let event_app = app.clone();
    std::thread::spawn(move || {
        let _ = event_app.emit(
            "launch-status",
            Btd6LaunchStatus {
                instance_id: "btd6".into(),
                status: "running".into(),
                detail: if actually_modded {
                    "Bloons TD 6 is running with scanned mods."
                } else {
                    "Bloons TD 6 is running in vanilla mode."
                }
                .into(),
                exit_code: None,
            },
        );
        let status = child.wait();
        if let (Some(activation), Some(runtime)) = (&activation, runtime.as_deref()) {
            deactivate_managed_runtime(activation, runtime);
        }
        let _ = event_app.emit(
            "launch-status",
            Btd6LaunchStatus {
                instance_id: "btd6".into(),
                status: "exited".into(),
                detail: "Bloons TD 6 closed.".into(),
                exit_code: status.ok().and_then(|value| value.code()),
            },
        );
    });
    Ok(Btd6LaunchStarted {
        pid,
        modded: actually_modded,
        loader: if actually_modded {
            format!("Aster managed MelonLoader {BTD6_MELONLOADER_VERSION}")
        } else {
            "Vanilla".into()
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helper_name_is_detected_in_enabled_and_disabled_forms() {
        assert!(is_mod_helper("Btd6ModHelper.dll"));
        assert!(is_mod_helper("btd6modhelper.dll.disabled"));
        assert!(!is_mod_helper("MyTower.dll"));
    }

    #[test]
    fn nested_mod_names_are_rejected() {
        assert!(safe_file_name("example.dll").is_ok());
        assert!(safe_file_name("folder/example.dll").is_err());
        assert!(safe_file_name("..\\example.dll").is_err());
    }

    #[test]
    fn every_modded_launch_requires_a_fresh_acknowledgement() {
        assert!(require_modded_launch_acknowledgement(true, true, false).is_err());
        assert_eq!(
            require_modded_launch_acknowledgement(true, true, true).unwrap(),
            true
        );
        assert_eq!(
            require_modded_launch_acknowledgement(true, false, false).unwrap(),
            false
        );
    }

    #[test]
    fn uploads_only_target_the_private_btd6_submission_bucket() {
        assert!(validate_btd6_upload_url(
            "https://example.supabase.co/storage/v1/object/upload/sign/btd6-mod-submissions/user/file.dll?token=test"
        )
        .is_ok());
        assert!(validate_btd6_upload_url(
            "https://example.supabase.co/storage/v1/object/upload/sign/chat-attachments/user/file.dll?token=test"
        )
        .is_err());
        assert!(validate_btd6_upload_url(
            "http://example.supabase.co/storage/v1/object/upload/sign/btd6-mod-submissions/user/file.dll?token=test"
        )
        .is_err());
    }
}
