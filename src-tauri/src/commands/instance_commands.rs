use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
    process::Command,
    time::Instant,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const MAX_CONTENT_BYTES: u64 = 512 * 1024 * 1024;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgressEvent {
    id: String,
    progress: u8,
    detail: String,
    speed: Option<String>,
    remaining: Option<String>,
}

fn emit_download_progress(
    app: &AppHandle,
    download_id: &str,
    progress: u8,
    detail: impl Into<String>,
    speed: Option<String>,
    remaining: Option<String>,
) {
    let _ = app.emit(
        "download-progress",
        DownloadProgressEvent {
            id: download_id.to_owned(),
            progress,
            detail: detail.into(),
            speed,
            remaining,
        },
    );
}

fn format_transfer_rate(bytes_per_second: f64) -> String {
    if bytes_per_second >= 1024.0 * 1024.0 {
        format!("{:.1} MB/s", bytes_per_second / (1024.0 * 1024.0))
    } else {
        format!("{:.0} KB/s", bytes_per_second / 1024.0)
    }
}

fn format_remaining(seconds: f64) -> String {
    if seconds < 60.0 {
        format!("{} sec", seconds.ceil() as u64)
    } else {
        format!("{} min", (seconds / 60.0).ceil() as u64)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceContentFile {
    id: String,
    kind: String,
    name: String,
    file_name: String,
    version: String,
    source: String,
    project_id: Option<String>,
    release_id: Option<String>,
    icon_url: Option<String>,
    enabled: bool,
    size: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceSecurityScanResult {
    status: String,
    scanned_files: usize,
    duration_ms: u128,
    message: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstalledContentMetadata {
    pub(crate) section: String,
    pub(crate) file_name: String,
    pub(crate) name: String,
    pub(crate) version: String,
    pub(crate) source: String,
    pub(crate) project_id: String,
    pub(crate) release_id: String,
    pub(crate) icon_url: Option<String>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ContentMetadataDocument {
    #[serde(default = "content_metadata_version")]
    version: u8,
    #[serde(default)]
    items: Vec<InstalledContentMetadata>,
}

fn content_metadata_version() -> u8 {
    1
}

fn content_metadata_path(directory: &Path) -> PathBuf {
    directory.join(".aster-content.json")
}

fn read_content_metadata(directory: &Path) -> ContentMetadataDocument {
    std::fs::read(content_metadata_path(directory))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub(crate) fn write_content_metadata_items(
    directory: &Path,
    new_items: Vec<InstalledContentMetadata>,
) -> Result<(), String> {
    if new_items.is_empty() {
        return Ok(());
    }
    let mut document = read_content_metadata(directory);
    document.version = content_metadata_version();
    for item in new_items {
        document.items.retain(|current| {
            current.section != item.section
                || current
                    .file_name
                    .trim_end_matches(".disabled")
                    .ne(item.file_name.trim_end_matches(".disabled"))
        });
        document.items.push(item);
    }
    save_content_metadata(directory, &document)
}

fn save_content_metadata(
    directory: &Path,
    document: &ContentMetadataDocument,
) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(document)
        .map_err(|_| "The installed content metadata could not be prepared.".to_owned())?;
    let target = content_metadata_path(directory);
    let temporary = directory.join(".aster-content.json.part");
    std::fs::write(&temporary, bytes)
        .map_err(|_| "The installed content metadata could not be saved.".to_owned())?;
    std::fs::rename(&temporary, &target)
        .map_err(|_| "The installed content metadata could not be finalized.".to_owned())
}

fn remove_content_metadata(directory: &Path, section: &str, file_name: &str) -> Result<(), String> {
    let mut document = read_content_metadata(directory);
    let active_name = file_name.trim_end_matches(".disabled");
    let original_length = document.items.len();
    document.items.retain(|item| {
        item.section != section || item.file_name.trim_end_matches(".disabled").ne(active_name)
    });
    if document.items.len() == original_length {
        return Ok(());
    }
    save_content_metadata(directory, &document)
}

fn validate_instance_id(instance_id: &str) -> Result<(), String> {
    if instance_id.is_empty()
        || !instance_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("The instance folder name is invalid.".to_owned());
    }
    Ok(())
}

fn validate_file_name(file_name: &str) -> Result<(), String> {
    if file_name.is_empty() || Path::new(file_name).file_name() != Some(OsStr::new(file_name)) {
        return Err("The content file name is invalid.".to_owned());
    }
    Ok(())
}

fn section_folder(section: &str) -> Result<&'static str, String> {
    match section {
        "mods" => Ok("mods"),
        "resourcepacks" => Ok("resourcepacks"),
        "shaders" => Ok("shaderpacks"),
        "datapacks" => Ok("datapacks"),
        "worlds" => Ok("saves"),
        "screenshots" => Ok("screenshots"),
        _ => Err("This instance content type is not supported.".to_owned()),
    }
}

fn instance_directory(app: &AppHandle, instance_id: &str) -> Result<PathBuf, String> {
    validate_instance_id(instance_id)?;
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|_| "The launcher data folder is unavailable.".to_owned())?
        .join("instances")
        .join(instance_id))
}

#[cfg(windows)]
fn defender_executable() -> Option<PathBuf> {
    let platform_root = std::env::var_os("ProgramData")
        .map(PathBuf::from)
        .map(|path| {
            path.join("Microsoft")
                .join("Windows Defender")
                .join("Platform")
        });

    if let Some(platform_root) = platform_root {
        if let Ok(entries) = std::fs::read_dir(platform_root) {
            let mut candidates = entries
                .filter_map(Result::ok)
                .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
                .map(|entry| entry.path().join("MpCmdRun.exe"))
                .filter(|path| path.is_file())
                .collect::<Vec<_>>();
            candidates.sort_by(|left, right| right.parent().cmp(&left.parent()));
            if let Some(latest) = candidates.into_iter().next() {
                return Some(latest);
            }
        }
    }

    std::env::var_os("ProgramFiles")
        .map(PathBuf::from)
        .map(|path| path.join("Windows Defender").join("MpCmdRun.exe"))
        .filter(|path| path.is_file())
}

fn count_mod_files(mods_directory: &Path) -> Result<usize, String> {
    Ok(std::fs::read_dir(mods_directory)
        .map_err(|_| "The instance mods folder could not be read.".to_owned())?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_type()
                .map(|kind| kind.is_file())
                .unwrap_or(false)
                && allowed_extension("mods", &entry.file_name().to_string_lossy())
        })
        .count())
}

fn ensure_structure_at(directory: &Path) -> Result<(), String> {
    for folder in [
        "mods",
        "resourcepacks",
        "shaderpacks",
        "datapacks",
        "saves",
        "screenshots",
    ] {
        std::fs::create_dir_all(directory.join(folder))
            .map_err(|_| "The instance content folders could not be created.".to_owned())?;
    }
    Ok(())
}

fn allowed_extension(section: &str, file_name: &str) -> bool {
    let active_name = file_name.strip_suffix(".disabled").unwrap_or(file_name);
    let extension = Path::new(active_name)
        .extension()
        .and_then(OsStr::to_str)
        .unwrap_or_default()
        .to_ascii_lowercase();

    match section {
        "mods" => extension == "jar",
        "resourcepacks" | "shaders" | "datapacks" => extension == "zip",
        "screenshots" => matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp"),
        "worlds" => true,
        _ => false,
    }
}

fn display_name(file_name: &str) -> String {
    let active_name = file_name.strip_suffix(".disabled").unwrap_or(file_name);
    Path::new(active_name)
        .file_stem()
        .and_then(OsStr::to_str)
        .unwrap_or(active_name)
        .replace(['_', '-'], " ")
}

fn display_size(bytes: u64) -> String {
    if bytes >= 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    } else if bytes >= 1024 {
        format!("{:.0} KB", bytes as f64 / 1024.0)
    } else {
        format!("{bytes} B")
    }
}

fn scan_section(
    directory: &Path,
    section: &str,
    content_metadata: &[InstalledContentMetadata],
) -> Result<Vec<InstanceContentFile>, String> {
    let folder = directory.join(section_folder(section)?);
    std::fs::create_dir_all(&folder)
        .map_err(|_| "The instance content folder could not be created.".to_owned())?;

    let mut items = Vec::new();
    for entry in std::fs::read_dir(folder)
        .map_err(|_| "The instance content folder could not be read.".to_owned())?
    {
        let entry = entry.map_err(|_| "An instance content entry could not be read.".to_owned())?;
        let metadata = entry
            .metadata()
            .map_err(|_| "An instance content entry is unavailable.".to_owned())?;
        let file_name = entry.file_name().to_string_lossy().into_owned();
        let is_supported = if section == "worlds" {
            metadata.is_dir()
        } else {
            metadata.is_file() && allowed_extension(section, &file_name)
        };
        if !is_supported {
            continue;
        }
        let enabled = !file_name.ends_with(".disabled");
        let active_name = file_name.trim_end_matches(".disabled");
        let saved = content_metadata.iter().find(|item| {
            item.section == section && item.file_name.trim_end_matches(".disabled") == active_name
        });
        items.push(InstanceContentFile {
            id: format!("{section}:{file_name}"),
            kind: section.to_owned(),
            name: saved
                .map(|item| item.name.clone())
                .unwrap_or_else(|| display_name(&file_name)),
            file_name,
            version: saved.map(|item| item.version.clone()).unwrap_or_else(|| {
                if section == "worlds" {
                    "Local world".to_owned()
                } else {
                    "Installed file".to_owned()
                }
            }),
            source: saved
                .map(|item| item.source.clone())
                .unwrap_or_else(|| "Local".to_owned()),
            project_id: saved.map(|item| item.project_id.clone()),
            release_id: saved.map(|item| item.release_id.clone()),
            icon_url: saved.and_then(|item| item.icon_url.clone()),
            enabled,
            size: if metadata.is_file() {
                display_size(metadata.len())
            } else {
                "Folder".to_owned()
            },
        });
    }
    items.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(items)
}

#[tauri::command]
pub fn create_instance_structure(app: AppHandle, instance_id: String) -> Result<(), String> {
    let directory = instance_directory(&app, &instance_id)?;
    ensure_structure_at(&directory)
}

#[tauri::command]
pub fn open_instance_folder(app: AppHandle, instance_id: String) -> Result<(), String> {
    let directory = instance_directory(&app, &instance_id)?;
    ensure_structure_at(&directory)?;
    open::that_detached(directory)
        .map_err(|_| "The instance folder could not be opened.".to_owned())
}

#[tauri::command]
pub fn open_launcher_data_folder(app: AppHandle) -> Result<(), String> {
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "The launcher data folder is unavailable.".to_owned())?;
    std::fs::create_dir_all(&directory)
        .map_err(|_| "The launcher data folder could not be created.".to_owned())?;
    open::that_detached(directory)
        .map_err(|_| "The launcher data folder could not be opened.".to_owned())
}

#[tauri::command]
pub fn open_instance_content_folder(
    app: AppHandle,
    instance_id: String,
    section: String,
) -> Result<(), String> {
    let directory = instance_directory(&app, &instance_id)?;
    ensure_structure_at(&directory)?;
    open::that_detached(directory.join(section_folder(&section)?))
        .map_err(|_| "The instance content folder could not be opened.".to_owned())
}

#[tauri::command]
pub fn list_instance_content(
    app: AppHandle,
    instance_id: String,
) -> Result<Vec<InstanceContentFile>, String> {
    let directory = instance_directory(&app, &instance_id)?;
    ensure_structure_at(&directory)?;
    let metadata = read_content_metadata(&directory);
    let mut items = Vec::new();
    for section in [
        "mods",
        "resourcepacks",
        "shaders",
        "datapacks",
        "worlds",
        "screenshots",
    ] {
        items.extend(scan_section(&directory, section, &metadata.items)?);
    }
    Ok(items)
}

#[tauri::command]
pub async fn scan_instance_mods(
    app: AppHandle,
    instance_id: String,
) -> Result<InstanceSecurityScanResult, String> {
    let directory = instance_directory(&app, &instance_id)?;
    ensure_structure_at(&directory)?;
    let mods_directory = directory.join("mods");
    let scanned_files = count_mod_files(&mods_directory)?;

    if scanned_files == 0 {
        return Ok(InstanceSecurityScanResult {
            status: "no-files".to_owned(),
            scanned_files,
            duration_ms: 0,
            message: "No installed mod files need scanning.".to_owned(),
        });
    }

    #[cfg(not(windows))]
    {
        return Ok(InstanceSecurityScanResult {
            status: "unavailable".to_owned(),
            scanned_files,
            duration_ms: 0,
            message: "Microsoft Defender scanning is only available on Windows.".to_owned(),
        });
    }

    #[cfg(windows)]
    {
        let Some(defender) = defender_executable() else {
            return Ok(InstanceSecurityScanResult {
                status: "unavailable".to_owned(),
                scanned_files,
                duration_ms: 0,
                message: "Microsoft Defender could not be found on this PC.".to_owned(),
            });
        };

        tauri::async_runtime::spawn_blocking(move || {
            let started = Instant::now();
            let output = Command::new(defender)
                .args(["-Scan", "-ScanType", "3", "-File"])
                .arg(&mods_directory)
                .arg("-DisableRemediation")
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            let duration_ms = started.elapsed().as_millis();

            match output {
                Ok(output) if output.status.code() == Some(0) => {
                    Ok(InstanceSecurityScanResult {
                        status: "clean".to_owned(),
                        scanned_files,
                        duration_ms,
                        message: "Microsoft Defender found no threats.".to_owned(),
                    })
                }
                Ok(output) if output.status.code() == Some(2) => {
                    Ok(InstanceSecurityScanResult {
                        status: "attention".to_owned(),
                        scanned_files,
                        duration_ms,
                        message: "Microsoft Defender reported a detection or scan error. Review Windows Security before launching this instance.".to_owned(),
                    })
                }
                Ok(_) => Ok(InstanceSecurityScanResult {
                    status: "failed".to_owned(),
                    scanned_files,
                    duration_ms,
                    message: "Microsoft Defender could not complete the mod scan.".to_owned(),
                }),
                Err(_) => Ok(InstanceSecurityScanResult {
                    status: "unavailable".to_owned(),
                    scanned_files,
                    duration_ms,
                    message: "Microsoft Defender could not be started on this PC.".to_owned(),
                }),
            }
        })
        .await
        .map_err(|_| "The Microsoft Defender scan task stopped unexpectedly.".to_owned())?
    }
}

#[tauri::command]
pub fn import_instance_content(
    app: AppHandle,
    instance_id: String,
    section: String,
    source_path: String,
) -> Result<(), String> {
    let source = PathBuf::from(source_path);
    let metadata = std::fs::metadata(&source)
        .map_err(|_| "The selected content file is unavailable.".to_owned())?;
    if !metadata.is_file() || metadata.len() > MAX_CONTENT_BYTES {
        return Err("Select a content file smaller than 512 MB.".to_owned());
    }

    let file_name = source
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or_else(|| "The selected file name is invalid.".to_owned())?;
    validate_file_name(file_name)?;
    if !allowed_extension(&section, file_name) {
        return Err("The selected file type does not match this content section.".to_owned());
    }

    let directory = instance_directory(&app, &instance_id)?;
    ensure_structure_at(&directory)?;
    let target = directory.join(section_folder(&section)?).join(&file_name);
    if target.exists() {
        return Err("A file with this name is already installed.".to_owned());
    }
    std::fs::copy(source, target)
        .map_err(|_| "The selected content file could not be copied.".to_owned())?;
    Ok(())
}

#[tauri::command]
pub fn set_instance_content_enabled(
    app: AppHandle,
    instance_id: String,
    section: String,
    file_name: String,
    enabled: bool,
) -> Result<(), String> {
    validate_file_name(&file_name)?;
    let directory = instance_directory(&app, &instance_id)?;
    let folder = directory.join(section_folder(&section)?);
    let source = folder.join(&file_name);
    if !source.is_file() {
        return Err("The selected content file no longer exists.".to_owned());
    }

    let target_name = if enabled {
        file_name
            .strip_suffix(".disabled")
            .ok_or_else(|| "This content is already enabled.".to_owned())?
            .to_owned()
    } else {
        if file_name.ends_with(".disabled") {
            return Err("This content is already disabled.".to_owned());
        }
        format!("{file_name}.disabled")
    };
    validate_file_name(&target_name)?;
    std::fs::rename(source, folder.join(target_name))
        .map_err(|_| "The content state could not be changed.".to_owned())
}

#[tauri::command]
pub fn remove_instance_content(
    app: AppHandle,
    instance_id: String,
    section: String,
    file_name: String,
) -> Result<(), String> {
    validate_file_name(&file_name)?;
    let directory = instance_directory(&app, &instance_id)?;
    let target = directory.join(section_folder(&section)?).join(&file_name);
    let removal = if target.is_dir() {
        std::fs::remove_dir_all(target)
            .map_err(|_| "The selected content folder could not be removed.".to_owned())
    } else if target.is_file() {
        std::fs::remove_file(target)
            .map_err(|_| "The selected content file could not be removed.".to_owned())
    } else {
        Err("The selected content no longer exists.".to_owned())
    };
    removal?;
    remove_content_metadata(&directory, &section, &file_name)
}

#[tauri::command]
pub async fn download_instance_content(
    app: AppHandle,
    instance_id: String,
    section: String,
    download_url: String,
    file_name: String,
    name: String,
    version: String,
    source: String,
    project_id: String,
    release_id: String,
    icon_url: Option<String>,
    download_id: String,
) -> Result<(), String> {
    validate_file_name(&file_name)?;
    if !allowed_extension(&section, &file_name) {
        return Err("The download file type does not match this content section.".to_owned());
    }

    let url = url::Url::parse(&download_url)
        .map_err(|_| "The content download URL is invalid.".to_owned())?;
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let trusted_host = url.scheme() == "https"
        && (host == "cdn.modrinth.com"
            || host.ends_with(".modrinth.com")
            || host == "edge.forgecdn.net"
            || host.ends_with(".forgecdn.net")
            || host.ends_with(".curseforge.com"));
    if !trusted_host {
        return Err("The content download host is not trusted.".to_owned());
    }

    let directory = instance_directory(&app, &instance_id)?;
    ensure_structure_at(&directory)?;
    let folder = directory.join(section_folder(&section)?);
    let target = folder.join(&file_name);
    if target.exists() {
        let result = write_content_metadata_items(
            &directory,
            vec![InstalledContentMetadata {
                section,
                file_name,
                name,
                version,
                source,
                project_id,
                release_id,
                icon_url,
            }],
        );
        if result.is_ok() {
            emit_download_progress(&app, &download_id, 100, "Already installed", None, None);
        }
        return result;
    }

    emit_download_progress(&app, &download_id, 2, "Connecting to provider", None, None);
    let mut response = reqwest::Client::builder()
        .user_agent("AsterLauncher/0.5.0")
        .build()
        .map_err(|_| "The download client could not be prepared.".to_owned())?
        .get(url)
        .send()
        .await
        .map_err(|_| "The content provider could not be reached.".to_owned())?;
    if !response.status().is_success() {
        return Err("The content provider rejected the download.".to_owned());
    }
    if response.content_length().unwrap_or(0) > MAX_CONTENT_BYTES {
        return Err("The selected content file is larger than 512 MB.".to_owned());
    }
    let temporary = folder.join(format!("{file_name}.part"));
    let mut output = tokio::fs::File::create(&temporary)
        .await
        .map_err(|_| "The downloaded content could not be saved.".to_owned())?;
    let total = response.content_length();
    let started = Instant::now();
    let mut downloaded = 0_u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The downloaded content could not be read.".to_owned())?
    {
        downloaded = downloaded
            .checked_add(chunk.len() as u64)
            .ok_or_else(|| "The selected content file is too large.".to_owned())?;
        if downloaded > MAX_CONTENT_BYTES {
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err("The selected content file is larger than 512 MB.".to_owned());
        }
        output
            .write_all(&chunk)
            .await
            .map_err(|_| "The downloaded content could not be saved.".to_owned())?;
        let elapsed = started.elapsed().as_secs_f64().max(0.05);
        let rate = downloaded as f64 / elapsed;
        let progress = total
            .filter(|length| *length > 0)
            .map(|length| ((downloaded as f64 / length as f64) * 94.0 + 3.0) as u8)
            .unwrap_or(45)
            .clamp(3, 97);
        let remaining = total.and_then(|length| {
            (rate > 0.0 && length > downloaded)
                .then(|| format_remaining((length - downloaded) as f64 / rate))
        });
        emit_download_progress(
            &app,
            &download_id,
            progress,
            format!("Downloading {}", display_size(downloaded)),
            Some(format_transfer_rate(rate)),
            remaining,
        );
    }
    output
        .flush()
        .await
        .map_err(|_| "The downloaded content could not be finalized.".to_owned())?;
    drop(output);
    tokio::fs::rename(&temporary, target)
        .await
        .map_err(|_| "The downloaded content could not be installed.".to_owned())?;
    let result = write_content_metadata_items(
        &directory,
        vec![InstalledContentMetadata {
            section,
            file_name,
            name,
            version,
            source,
            project_id,
            release_id,
            icon_url,
        }],
    );
    if result.is_ok() {
        emit_download_progress(
            &app,
            &download_id,
            100,
            "Installed successfully",
            None,
            None,
        );
    }
    result
}

#[tauri::command]
pub fn set_instance_icon(
    app: AppHandle,
    instance_id: String,
    source_path: String,
) -> Result<String, String> {
    let source = PathBuf::from(source_path);
    let metadata = std::fs::metadata(&source)
        .map_err(|_| "The selected icon file is unavailable.".to_owned())?;
    let extension = source
        .extension()
        .and_then(OsStr::to_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !metadata.is_file()
        || metadata.len() > 5 * 1024 * 1024
        || !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp")
    {
        return Err("Choose a PNG, JPG or WebP image smaller than 5 MB.".to_owned());
    }
    let directory = instance_directory(&app, &instance_id)?;
    ensure_structure_at(&directory)?;
    for old_extension in ["png", "jpg", "jpeg", "webp"] {
        let old_icon = directory.join(format!(".aster-icon.{old_extension}"));
        if old_icon.is_file() {
            let _ = std::fs::remove_file(old_icon);
        }
    }
    let target = directory.join(format!(".aster-icon.{extension}"));
    std::fs::copy(source, &target)
        .map_err(|_| "The custom modpack icon could not be copied.".to_owned())?;
    Ok(target.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::{
        ensure_structure_at, scan_section, write_content_metadata_items, InstalledContentMetadata,
    };
    use uuid::Uuid;

    #[test]
    fn installed_content_metadata_restores_project_and_icon() {
        let directory = std::env::temp_dir().join(format!("aster-content-test-{}", Uuid::new_v4()));
        ensure_structure_at(&directory).expect("create instance");
        std::fs::write(directory.join("mods/example.jar"), b"test").expect("write mod");
        let metadata = InstalledContentMetadata {
            section: "mods".to_owned(),
            file_name: "example.jar".to_owned(),
            name: "Example Mod".to_owned(),
            version: "1.2.3".to_owned(),
            source: "Modrinth".to_owned(),
            project_id: "example-project".to_owned(),
            release_id: "example-release".to_owned(),
            icon_url: Some("https://cdn.modrinth.com/example.png".to_owned()),
        };
        write_content_metadata_items(&directory, vec![metadata.clone()]).expect("write metadata");
        let files = scan_section(&directory, "mods", &[metadata]).expect("scan mods");
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "Example Mod");
        assert_eq!(files[0].source, "Modrinth");
        assert_eq!(files[0].project_id.as_deref(), Some("example-project"));
        assert_eq!(
            files[0].icon_url.as_deref(),
            Some("https://cdn.modrinth.com/example.png")
        );
        let _ = std::fs::remove_dir_all(directory);
    }
}
