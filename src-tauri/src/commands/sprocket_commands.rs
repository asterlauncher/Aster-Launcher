use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};

const SPROCKET_APP_ID: &str = "1674170";
const ASTER_RUNTIME_VERSION: &str = "0.7.3";
const ASTER_RUNTIME_MAX_ARCHIVE_BYTES: u64 = 128 * 1024 * 1024;
const ASTER_RUNTIME_MAX_EXTRACTED_BYTES: u64 = 768 * 1024 * 1024;
const ASTER_RUNTIME_MAX_ENTRIES: usize = 4_096;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManagedRuntimeManifest {
    version: String,
    source_url: String,
    archive_sha256: String,
    installed_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SprocketInstallation {
    installed: bool,
    app_id: String,
    install_dir: Option<String>,
    executable_path: Option<String>,
    steam_library: Option<String>,
    build_id: Option<String>,
    data_dir: String,
    melon_loader_installed: bool,
    aster_runtime_installed: bool,
    aster_runtime_version: Option<String>,
    security_scanner_available: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SprocketProfile {
    id: String,
    name: String,
    faction: String,
    path: String,
    modified_at: u64,
    size_bytes: u64,
    preview_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SprocketModFile {
    file_name: String,
    display_name: String,
    path: String,
    enabled: bool,
    size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SprocketBackup {
    id: String,
    created_at: u64,
    size_bytes: u64,
    path: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SprocketTunableField {
    pointer: String,
    label: String,
    category: String,
    value: f64,
    min: f64,
    max: f64,
    step: f64,
    unit: String,
    requires_reload: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SprocketWeapon {
    id: String,
    name: String,
    operator_name: Option<String>,
    linkage_id: Option<String>,
    fields: Vec<SprocketTunableField>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SprocketLaunchStatus {
    instance_id: String,
    status: String,
    detail: String,
    exit_code: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SprocketLaunchStarted {
    pid: u32,
    version_id: String,
    loader: String,
    log_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SprocketValueUpdate {
    pointer: String,
    value: f64,
}

fn epoch_seconds(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub(crate) fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Could not hash {}: {error}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn managed_runtime_root(app: &AppHandle) -> Result<PathBuf, String> {
    managed_runtime_root_for(app, "sprocket", ASTER_RUNTIME_VERSION)
}

pub(crate) fn managed_runtime_root_for(
    app: &AppHandle,
    game_id: &str,
    version: &str,
) -> Result<PathBuf, String> {
    if !game_id
        .bytes()
        .all(|value| value.is_ascii_lowercase() || value.is_ascii_digit() || value == b'-')
        || game_id.is_empty()
    {
        return Err("The managed runtime game ID is invalid.".into());
    }
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("managed-runtimes")
        .join(game_id)
        .join(format!("melonloader-{version}"));
    Ok(root)
}

fn managed_runtime_manifest(app: &AppHandle) -> Result<Option<ManagedRuntimeManifest>, String> {
    let path = managed_runtime_root(app)?.join("aster-runtime.json");
    if !path.is_file() {
        return Ok(None);
    }
    let manifest = serde_json::from_slice(&fs::read(path).map_err(|error| error.to_string())?)
        .map_err(|error| format!("The managed mod runtime manifest is damaged: {error}"))?;
    Ok(Some(manifest))
}

fn managed_runtime_ready(app: &AppHandle) -> bool {
    let Ok(root) = managed_runtime_root(app) else {
        return false;
    };
    let Ok(Some(manifest)) = managed_runtime_manifest(app) else {
        return false;
    };
    manifest.version == ASTER_RUNTIME_VERSION && managed_runtime_layout_ready(&root)
}

fn managed_runtime_layout_ready(root: &Path) -> bool {
    root.join("version.dll").is_file() && root.join("MelonLoader").is_dir()
}

#[cfg(windows)]
pub(crate) fn defender_command() -> Option<PathBuf> {
    let mut platform_versions = std::env::var_os("ProgramData")
        .map(PathBuf::from)
        .map(|path| {
            path.join("Microsoft")
                .join("Windows Defender")
                .join("Platform")
        })
        .and_then(|path| fs::read_dir(path).ok())
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.path().join("MpCmdRun.exe").is_file())
        .collect::<Vec<_>>();
    platform_versions.sort_by_key(|entry| entry.file_name());
    if let Some(entry) = platform_versions.pop() {
        return Some(entry.path().join("MpCmdRun.exe"));
    }
    std::env::var_os("ProgramFiles")
        .map(PathBuf::from)
        .map(|path| path.join("Windows Defender").join("MpCmdRun.exe"))
        .filter(|path| path.is_file())
}

#[cfg(not(windows))]
pub(crate) fn defender_command() -> Option<PathBuf> {
    None
}

pub(crate) fn defender_scan(path: &Path) -> Result<(), String> {
    let scanner = defender_command().ok_or_else(|| {
        "Microsoft Defender is unavailable. Aster blocked this mod operation because the file could not be checked.".to_string()
    })?;
    let mut command = Command::new(scanner);
    command
        .args(["-Scan", "-ScanType", "3", "-File"])
        .arg(path)
        .arg("-DisableRemediation")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let output = command
        .output()
        .map_err(|error| format!("Microsoft Defender could not scan the file: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let detail = String::from_utf8_lossy(&output.stdout)
        .lines()
        .chain(String::from_utf8_lossy(&output.stderr).lines())
        .find(|line| !line.trim().is_empty())
        .unwrap_or("Microsoft Defender reported a threat or scan error.")
        .trim()
        .to_string();
    Err(format!("Security scan blocked this file: {detail}"))
}

pub(crate) fn ensure_pe_dll(path: &Path) -> Result<(), String> {
    let metadata =
        fs::metadata(path).map_err(|_| "The selected mod no longer exists.".to_string())?;
    if metadata.len() == 0 || metadata.len() > 256 * 1024 * 1024 {
        return Err("The selected DLL has an invalid size.".into());
    }
    let mut header = [0u8; 2];
    fs::File::open(path)
        .and_then(|mut file| file.read_exact(&mut header))
        .map_err(|_| "The selected DLL could not be read.".to_string())?;
    if header != *b"MZ" {
        return Err("The selected file is not a valid Windows DLL.".into());
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
struct GithubReleaseAsset {
    name: String,
    browser_download_url: String,
    digest: Option<String>,
    size: u64,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    assets: Vec<GithubReleaseAsset>,
}

fn download_managed_runtime_archive(version: &str) -> Result<(Vec<u8>, String, String), String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("Aster-Launcher/0.6")
        .https_only(true)
        .build()
        .map_err(|error| error.to_string())?;
    let expected_tag = format!("v{version}");
    let release_url =
        format!("https://api.github.com/repos/LavaGang/MelonLoader/releases/tags/{expected_tag}");
    let release = client
        .get(&release_url)
        .send()
        .map_err(|error| format!("The Aster mod runtime could not be checked: {error}"))?
        .error_for_status()
        .map_err(|error| format!("The official runtime release could not be read: {error}"))?
        .json::<GithubRelease>()
        .map_err(|error| format!("The official runtime release response was invalid: {error}"))?;
    if release.tag_name != expected_tag {
        return Err(format!(
            "Aster expected runtime {expected_tag}, but GitHub returned {}.",
            release.tag_name
        ));
    }
    let asset = release
        .assets
        .into_iter()
        .find(|asset| asset.name.eq_ignore_ascii_case("MelonLoader.x64.zip"))
        .ok_or_else(|| {
            "The official x64 runtime archive is missing from the release.".to_string()
        })?;
    let expected_url = format!(
        "https://github.com/LavaGang/MelonLoader/releases/download/{expected_tag}/MelonLoader.x64.zip"
    );
    if asset.browser_download_url != expected_url {
        return Err("The official runtime download URL did not match Aster's allowlist.".into());
    }
    if asset.size == 0 || asset.size > ASTER_RUNTIME_MAX_ARCHIVE_BYTES {
        return Err("The official runtime archive has an unsafe size.".into());
    }
    let expected_digest = asset
        .digest
        .and_then(|value| value.strip_prefix("sha256:").map(str::to_owned))
        .ok_or_else(|| {
            "The official release does not provide a SHA-256 digest. Aster refused the download."
                .to_string()
        })?;
    let bytes = client
        .get(&asset.browser_download_url)
        .send()
        .map_err(|error| format!("The official runtime archive could not be downloaded: {error}"))?
        .error_for_status()
        .map_err(|error| format!("The official runtime archive returned an error: {error}"))?
        .bytes()
        .map_err(|error| format!("The official runtime archive could not be read: {error}"))?;
    if bytes.len() as u64 != asset.size || bytes.len() as u64 > ASTER_RUNTIME_MAX_ARCHIVE_BYTES {
        return Err(
            "The downloaded runtime archive size did not match the signed release metadata.".into(),
        );
    }
    let actual_digest = format!("{:x}", Sha256::digest(&bytes));
    if !actual_digest.eq_ignore_ascii_case(&expected_digest) {
        return Err("The downloaded runtime failed SHA-256 verification.".into());
    }
    Ok((bytes.to_vec(), actual_digest, asset.browser_download_url))
}

fn validate_archive_path(name: &str) -> Result<PathBuf, String> {
    let normalized = name.replace('\\', "/");
    let path = Path::new(&normalized);
    if path.is_absolute()
        || normalized.contains(':')
        || path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("The runtime archive contains an unsafe path.".into());
    }
    Ok(path.to_path_buf())
}

fn hidden_output(program: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
        .output()
        .map_err(|error| format!("Could not run {}: {error}", program.display()))
}

fn verify_extracted_tree(root: &Path) -> Result<(), String> {
    fn walk(root: &Path, current: &Path, count: &mut usize, total: &mut u64) -> Result<(), String> {
        for entry in fs::read_dir(current).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            *count += 1;
            if *count > ASTER_RUNTIME_MAX_ENTRIES {
                return Err("The runtime contains too many files.".into());
            }
            let file_type = entry.file_type().map_err(|error| error.to_string())?;
            if file_type.is_symlink() {
                return Err("The runtime contains an unsafe symbolic link.".into());
            }
            let path = entry.path();
            let canonical = path.canonicalize().map_err(|error| error.to_string())?;
            if !canonical.starts_with(root) {
                return Err("The runtime escaped its private directory.".into());
            }
            if file_type.is_dir() {
                walk(root, &path, count, total)?;
            } else {
                *total = total
                    .saturating_add(entry.metadata().map_err(|error| error.to_string())?.len());
                if *total > ASTER_RUNTIME_MAX_EXTRACTED_BYTES {
                    return Err("The runtime is larger than Aster's safety limit.".into());
                }
            }
        }
        Ok(())
    }
    let canonical_root = root.canonicalize().map_err(|error| error.to_string())?;
    walk(&canonical_root, root, &mut 0, &mut 0)
}

fn extract_managed_runtime(archive_path: &Path, target: &Path) -> Result<(), String> {
    let tar = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .map(|root| root.join("System32").join("tar.exe"))
        .filter(|path| path.is_file())
        .ok_or_else(|| "Windows archive support (tar.exe) is unavailable.".to_string())?;
    let archive = archive_path.to_string_lossy().into_owned();
    let listing = hidden_output(&tar, &["-tf", &archive])?;
    if !listing.status.success() {
        return Err("The official runtime archive could not be inspected.".into());
    }
    let entries = String::from_utf8(listing.stdout)
        .map_err(|_| "The runtime archive contains invalid file names.".to_string())?;
    let paths = entries
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>();
    if paths.is_empty() || paths.len() > ASTER_RUNTIME_MAX_ENTRIES {
        return Err("The runtime archive contains an unsafe number of files.".into());
    }
    for entry in paths {
        validate_archive_path(entry)?;
    }
    let target_text = target.to_string_lossy().into_owned();
    let output = hidden_output(&tar, &["-xf", &archive, "-C", &target_text])?;
    if !output.status.success() {
        return Err(format!(
            "The runtime archive could not be extracted: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    verify_extracted_tree(target)?;
    if !managed_runtime_layout_ready(target) {
        return Err(
            "The official runtime archive did not contain the expected loader files.".into(),
        );
    }
    Ok(())
}

fn ensure_managed_runtime(app: &AppHandle) -> Result<PathBuf, String> {
    ensure_managed_runtime_for(app, "sprocket", ASTER_RUNTIME_VERSION)
}

pub(crate) fn ensure_managed_runtime_for(
    app: &AppHandle,
    game_id: &str,
    version: &str,
) -> Result<PathBuf, String> {
    let root = managed_runtime_root_for(app, game_id, version)?;
    let manifest_path = root.join("aster-runtime.json");
    let ready = manifest_path.is_file()
        && serde_json::from_slice::<ManagedRuntimeManifest>(
            &fs::read(&manifest_path).unwrap_or_default(),
        )
        .map(|manifest| manifest.version == version)
        .unwrap_or(false)
        && managed_runtime_layout_ready(&root);
    if ready {
        return Ok(root);
    }
    if root.exists() {
        fs::remove_dir_all(&root).map_err(|error| error.to_string())?;
    }
    let parent = root
        .parent()
        .ok_or_else(|| "The runtime directory is invalid.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let staging = parent.join(format!(".staging-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
    let result = (|| {
        let (archive, archive_sha256, source_url) = download_managed_runtime_archive(version)?;
        let archive_path = staging.join("runtime.zip");
        fs::write(&archive_path, &archive).map_err(|error| error.to_string())?;
        defender_scan(&archive_path)?;
        let extracted = staging.join("runtime");
        fs::create_dir_all(&extracted).map_err(|error| error.to_string())?;
        extract_managed_runtime(&archive_path, &extracted)?;
        defender_scan(&extracted)?;
        let manifest = ManagedRuntimeManifest {
            version: version.into(),
            source_url,
            archive_sha256,
            installed_at: epoch_seconds(SystemTime::now()),
        };
        fs::write(
            extracted.join("aster-runtime.json"),
            serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        fs::rename(&extracted, &root)
            .map_err(|error| format!("Could not activate the Aster mod runtime: {error}"))?;
        Ok(root.clone())
    })();
    let _ = fs::remove_dir_all(staging);
    result
}

#[derive(Debug)]
struct RuntimeBridgeFile {
    path: PathBuf,
    source: PathBuf,
    created: bool,
}

#[derive(Debug)]
pub(crate) struct RuntimeActivation {
    bridge_files: Vec<RuntimeBridgeFile>,
    legacy_runtime_path: Option<PathBuf>,
    staged_mods_dir: PathBuf,
}

fn stage_enabled_mods(runtime: &Path, game_dir: &Path) -> Result<PathBuf, String> {
    let staged_mods = runtime.join("Mods");
    if staged_mods.exists() {
        fs::remove_dir_all(&staged_mods)
            .map_err(|error| format!("Could not reset the private mod staging folder: {error}"))?;
    }
    fs::create_dir_all(&staged_mods)
        .map_err(|error| format!("Could not create the private mod staging folder: {error}"))?;

    let source_mods = game_dir.join("Mods");
    let entries = match fs::read_dir(&source_mods) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(staged_mods),
        Err(error) => return Err(format!("Could not read the game's mod folder: {error}")),
    };
    for entry in entries.flatten() {
        let source = entry.path();
        if !source.is_file()
            || !source
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case("dll"))
        {
            continue;
        }
        fs::copy(&source, staged_mods.join(entry.file_name()))
            .map_err(|error| format!("Could not stage an enabled mod: {error}"))?;
    }
    Ok(staged_mods)
}

pub(crate) fn activate_managed_runtime(
    runtime: &Path,
    game_dir: &Path,
) -> Result<RuntimeActivation, String> {
    let staged_mods_dir = stage_enabled_mods(runtime, game_dir)?;
    let mut bridge_files: Vec<RuntimeBridgeFile> = Vec::with_capacity(2);
    // Modern MelonLoader archives no longer ship a separate dobby.dll. Keep
    // supporting older verified archives that do, but only version.dll is a
    // required bootstrap bridge.
    for file_name in ["version.dll", "dobby.dll"] {
        let source = runtime.join(file_name);
        if !source.is_file() {
            continue;
        }
        let path = game_dir.join(file_name);
        let created = !path.exists();
        if !created && sha256_file(&path)? != sha256_file(&source)? {
            return Err(format!(
                "The game already contains a different {file_name}. Aster refused to overwrite a file it does not own."
            ));
        }
        if created {
            if let Err(error) = fs::copy(&source, &path) {
                for bridge in &bridge_files {
                    if bridge.created {
                        let _ = fs::remove_file(&bridge.path);
                    }
                }
                let _ = fs::remove_dir_all(&staged_mods_dir);
                return Err(format!("Could not activate the Aster mod bridge: {error}"));
            }
        }
        bridge_files.push(RuntimeBridgeFile {
            path,
            source,
            created,
        });
    }
    let legacy_runtime = game_dir.join("MelonLoader");
    let legacy_runtime_path = if legacy_runtime.exists() {
        let disabled = game_dir.join(format!(
            "MelonLoader.user-disabled-{}",
            epoch_seconds(SystemTime::now())
        ));
        if let Err(error) = fs::rename(&legacy_runtime, &disabled) {
            for bridge in &bridge_files {
                if bridge.created {
                    let _ = fs::remove_file(&bridge.path);
                }
            }
            let _ = fs::remove_dir_all(&staged_mods_dir);
            return Err(format!(
                "A separate MelonLoader installation is active and could not be isolated: {error}"
            ));
        }
        Some(disabled)
    } else {
        None
    };
    Ok(RuntimeActivation {
        bridge_files,
        legacy_runtime_path,
        staged_mods_dir,
    })
}

pub(crate) fn deactivate_managed_runtime(activation: &RuntimeActivation, _runtime: &Path) {
    for bridge in &activation.bridge_files {
        if bridge.created {
            if let (Ok(created), Ok(source)) =
                (sha256_file(&bridge.path), sha256_file(&bridge.source))
            {
                if created == source {
                    let _ = fs::remove_file(&bridge.path);
                }
            }
        }
    }
    if let Some(disabled) = &activation.legacy_runtime_path {
        let original = disabled
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("MelonLoader");
        if !original.exists() {
            let _ = fs::rename(disabled, original);
        }
    }
    let _ = fs::remove_dir_all(&activation.staged_mods_dir);
}

pub(crate) fn scan_enabled_mods(install_dir: &Path) -> Result<(), String> {
    let mods_dir = install_dir.join("Mods");
    let Ok(entries) = fs::read_dir(&mods_dir) else {
        return Ok(());
    };
    let enabled = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| value.eq_ignore_ascii_case("dll"))
        })
        .collect::<Vec<_>>();
    if enabled.is_empty() {
        return Ok(());
    }
    for path in &enabled {
        ensure_pe_dll(path)?;
    }
    defender_scan(&mods_dir)
}

fn sprocket_data_dir() -> PathBuf {
    let profile = std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    let regular = profile.join("Documents").join("My Games").join("Sprocket");
    let one_drive = profile
        .join("OneDrive")
        .join("Documents")
        .join("My Games")
        .join("Sprocket");
    if one_drive.exists() && !regular.exists() {
        one_drive
    } else {
        regular
    }
}

fn steam_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for variable in ["ProgramFiles(x86)", "ProgramFiles"] {
        if let Some(value) = std::env::var_os(variable) {
            let root = PathBuf::from(value).join("Steam");
            if !roots.contains(&root) {
                roots.push(root);
            }
        }
    }
    roots
}

pub(crate) fn steam_libraries() -> Vec<PathBuf> {
    let mut libraries = steam_roots();
    for root in steam_roots() {
        let file = root.join("steamapps").join("libraryfolders.vdf");
        let Ok(content) = fs::read_to_string(file) else {
            continue;
        };
        for line in content.lines() {
            let trimmed = line.trim();
            if !trimmed.starts_with("\"path\"") {
                continue;
            }
            let values: Vec<&str> = trimmed.split('"').collect();
            if values.len() >= 4 {
                let candidate = PathBuf::from(values[3].replace("\\\\", "\\"));
                if !libraries.contains(&candidate) {
                    libraries.push(candidate);
                }
            }
        }
    }
    libraries
}

pub(crate) fn manifest_value(content: &str, key: &str) -> Option<String> {
    content.lines().find_map(|line| {
        let values: Vec<&str> = line.trim().split('"').collect();
        (values.len() >= 4 && values[1] == key).then(|| values[3].to_string())
    })
}

fn detect_installation() -> SprocketInstallation {
    let data_dir = sprocket_data_dir();
    for library in steam_libraries() {
        let manifest = library
            .join("steamapps")
            .join(format!("appmanifest_{SPROCKET_APP_ID}.acf"));
        if !manifest.exists() {
            continue;
        }
        let content = fs::read_to_string(&manifest).unwrap_or_default();
        let folder = manifest_value(&content, "installdir").unwrap_or_else(|| "Sprocket".into());
        let install_dir = library.join("steamapps").join("common").join(folder);
        let executable = install_dir.join("Sprocket.exe");
        return SprocketInstallation {
            installed: executable.exists(),
            app_id: SPROCKET_APP_ID.into(),
            install_dir: Some(install_dir.to_string_lossy().into_owned()),
            executable_path: executable
                .exists()
                .then(|| executable.to_string_lossy().into_owned()),
            steam_library: Some(library.to_string_lossy().into_owned()),
            build_id: manifest_value(&content, "buildid"),
            data_dir: data_dir.to_string_lossy().into_owned(),
            melon_loader_installed: install_dir.join("MelonLoader").exists(),
            aster_runtime_installed: false,
            aster_runtime_version: None,
            security_scanner_available: defender_command().is_some(),
        };
    }
    SprocketInstallation {
        installed: false,
        app_id: SPROCKET_APP_ID.into(),
        install_dir: None,
        executable_path: None,
        steam_library: None,
        build_id: None,
        data_dir: data_dir.to_string_lossy().into_owned(),
        melon_loader_installed: false,
        aster_runtime_installed: false,
        aster_runtime_version: None,
        security_scanner_available: defender_command().is_some(),
    }
}

fn profile_base() -> PathBuf {
    sprocket_data_dir().join("Factions")
}

fn validate_existing_profile(id: &str) -> Result<PathBuf, String> {
    let base = profile_base();
    let canonical_base = base
        .canonicalize()
        .map_err(|_| "No Sprocket profiles exist yet.".to_string())?;
    let candidate = base.join(id);
    let canonical = candidate
        .canonicalize()
        .map_err(|_| "The selected blueprint no longer exists.".to_string())?;
    if !canonical.starts_with(canonical_base)
        || canonical.extension().and_then(|v| v.to_str()) != Some("blueprint")
    {
        return Err("The selected blueprint path is not valid.".into());
    }
    Ok(canonical)
}

fn walk_files(root: &Path, extension: &str, output: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_files(&path, extension, output);
        } else if path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case(extension))
        {
            output.push(path);
        }
    }
}

fn copy_directory(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let target = destination.join(entry.file_name());
        if entry.path().is_dir() {
            copy_directory(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn directory_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| {
            entry
                .metadata()
                .map(|metadata| {
                    if metadata.is_dir() {
                        directory_size(&entry.path())
                    } else {
                        metadata.len()
                    }
                })
                .unwrap_or(0)
        })
        .sum()
}

fn backup_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("sprocket")
        .join("backups");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root)
}

fn safe_file_name(value: &str) -> Result<&str, String> {
    let path = Path::new(value);
    if path.components().count() != 1 || value.trim().is_empty() {
        Err("The file name is not valid.".into())
    } else {
        Ok(value)
    }
}

#[tauri::command]
pub fn detect_sprocket_installation(app: AppHandle) -> SprocketInstallation {
    let mut installation = detect_installation();
    installation.aster_runtime_installed = managed_runtime_ready(&app);
    installation.aster_runtime_version = installation
        .aster_runtime_installed
        .then(|| ASTER_RUNTIME_VERSION.to_string());
    installation
}

#[tauri::command]
pub fn list_sprocket_profiles() -> Vec<SprocketProfile> {
    let base = profile_base();
    let mut files = Vec::new();
    walk_files(&base, "blueprint", &mut files);
    let mut profiles: Vec<SprocketProfile> = files
        .into_iter()
        .filter_map(|path| {
            let metadata = fs::metadata(&path).ok()?;
            let relative = path.strip_prefix(&base).ok()?;
            let faction = relative
                .components()
                .next()
                .map(|value| value.as_os_str().to_string_lossy().into_owned())
                .unwrap_or_else(|| "Unknown".into());
            let preview = path.with_extension("png");
            Some(SprocketProfile {
                id: relative.to_string_lossy().into_owned(),
                name: path.file_stem()?.to_string_lossy().into_owned(),
                faction,
                path: path.to_string_lossy().into_owned(),
                modified_at: metadata.modified().map(epoch_seconds).unwrap_or(0),
                size_bytes: metadata.len(),
                preview_path: preview
                    .exists()
                    .then(|| preview.to_string_lossy().into_owned()),
            })
        })
        .collect();
    profiles.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    profiles
}

#[tauri::command]
pub fn import_sprocket_blueprint(source_path: String) -> Result<SprocketProfile, String> {
    let source = PathBuf::from(source_path);
    if !source.is_file() || source.extension().and_then(|value| value.to_str()) != Some("blueprint")
    {
        return Err("Choose a valid .blueprint file.".into());
    }
    let target_dir = profile_base()
        .join("Aster Imports")
        .join("Blueprints")
        .join("Vehicles");
    fs::create_dir_all(&target_dir).map_err(|error| error.to_string())?;
    let file_name = source
        .file_name()
        .ok_or_else(|| "The source file has no name.".to_string())?;
    let target = target_dir.join(file_name);
    fs::copy(&source, &target).map_err(|error| format!("Could not import blueprint: {error}"))?;
    let metadata = fs::metadata(&target).map_err(|error| error.to_string())?;
    let id = target
        .strip_prefix(profile_base())
        .map_err(|_| "Could not create blueprint ID.".to_string())?
        .to_string_lossy()
        .into_owned();
    Ok(SprocketProfile {
        id,
        name: target
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        faction: "Aster Imports".into(),
        path: target.to_string_lossy().into_owned(),
        modified_at: metadata.modified().map(epoch_seconds).unwrap_or(0),
        size_bytes: metadata.len(),
        preview_path: None,
    })
}

#[tauri::command]
pub fn export_sprocket_blueprint(
    profile_id: String,
    destination_path: String,
) -> Result<(), String> {
    let source = validate_existing_profile(&profile_id)?;
    fs::copy(source, destination_path)
        .map_err(|error| format!("Could not export blueprint: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn list_sprocket_mods() -> Result<Vec<SprocketModFile>, String> {
    let installation = detect_installation();
    let Some(install_dir) = installation.install_dir else {
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
        let enabled = file_name.to_ascii_lowercase().ends_with(".dll");
        if !enabled && !file_name.to_ascii_lowercase().ends_with(".dll.disabled") {
            continue;
        }
        let display_name = file_name
            .trim_end_matches(".disabled")
            .trim_end_matches(".dll")
            .to_string();
        mods.push(SprocketModFile {
            display_name,
            file_name,
            path: path.to_string_lossy().into_owned(),
            enabled,
            size_bytes: entry.metadata().map(|value| value.len()).unwrap_or(0),
        });
    }
    mods.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });
    Ok(mods)
}

#[tauri::command]
pub fn import_sprocket_mod(app: AppHandle, source_path: String) -> Result<(), String> {
    let installation = detect_installation();
    let install_dir = installation
        .install_dir
        .ok_or_else(|| "Install Sprocket through Steam first.".to_string())?;
    let source = PathBuf::from(source_path);
    if !source.is_file()
        || source
            .extension()
            .and_then(|value| value.to_str())
            .map(|v| v.eq_ignore_ascii_case("dll"))
            != Some(true)
    {
        return Err("Choose a valid .dll mod file.".into());
    }
    ensure_pe_dll(&source)?;
    let quarantine = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("security")
        .join("quarantine");
    fs::create_dir_all(&quarantine).map_err(|error| error.to_string())?;
    let staged = quarantine.join(format!(
        "{}-{}.dll",
        epoch_seconds(SystemTime::now()),
        uuid::Uuid::new_v4()
    ));
    fs::copy(&source, &staged)
        .map_err(|error| format!("Could not stage the mod for scanning: {error}"))?;
    let scan_result = defender_scan(&staged);
    if scan_result.is_err() {
        let blocked = quarantine.join(format!(
            "blocked-{}.dll",
            sha256_file(&staged).unwrap_or_else(|_| "unknown".into())
        ));
        let _ = fs::rename(&staged, blocked);
        return scan_result;
    }
    let target_dir = PathBuf::from(install_dir).join("Mods");
    fs::create_dir_all(&target_dir).map_err(|error| error.to_string())?;
    let file_name = source
        .file_name()
        .ok_or_else(|| "The mod has no file name.".to_string())?
        .to_owned();
    let target = target_dir.join(file_name);
    fs::copy(&staged, &target).map_err(|error| format!("Could not add mod: {error}"))?;
    let _ = fs::remove_file(staged);
    Ok(())
}

#[tauri::command]
pub fn set_sprocket_mod_enabled(file_name: String, enabled: bool) -> Result<(), String> {
    let file_name = safe_file_name(&file_name)?;
    let install_dir = detect_installation()
        .install_dir
        .ok_or_else(|| "Sprocket is not installed.".to_string())?;
    let mods_dir = PathBuf::from(install_dir).join("Mods");
    let source = mods_dir.join(file_name);
    if !source.exists() {
        return Err("The selected mod no longer exists.".into());
    }
    let target_name = if enabled {
        file_name.trim_end_matches(".disabled").to_string()
    } else {
        format!("{file_name}.disabled")
    };
    fs::rename(source, mods_dir.join(target_name))
        .map_err(|error| format!("Could not change mod state: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn remove_sprocket_mod(file_name: String) -> Result<(), String> {
    let file_name = safe_file_name(&file_name)?;
    let install_dir = detect_installation()
        .install_dir
        .ok_or_else(|| "Sprocket is not installed.".to_string())?;
    fs::remove_file(PathBuf::from(install_dir).join("Mods").join(file_name))
        .map_err(|error| format!("Could not remove mod: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn repair_sprocket_runtime(app: AppHandle) -> Result<(), String> {
    let root = managed_runtime_root(&app)?;
    if root.exists() {
        fs::remove_dir_all(&root)
            .map_err(|error| format!("Could not reset the Aster mod runtime: {error}"))?;
    }
    ensure_managed_runtime(&app).map(|_| ())
}

#[tauri::command]
pub fn remove_sprocket_runtime(app: AppHandle) -> Result<(), String> {
    let installation = detect_installation();
    if let Some(install_dir) = installation.install_dir {
        let game_dir = PathBuf::from(install_dir);
        let runtime = managed_runtime_root(&app)?;
        for file_name in ["version.dll", "dobby.dll"] {
            let bridge = game_dir.join(file_name);
            let source = runtime.join(file_name);
            if bridge.is_file()
                && source.is_file()
                && sha256_file(&bridge)? == sha256_file(&source)?
            {
                fs::remove_file(bridge)
                    .map_err(|error| format!("Could not remove the Aster mod bridge: {error}"))?;
            }
        }
    }
    let root = managed_runtime_root(&app)?;
    if root.exists() {
        fs::remove_dir_all(root)
            .map_err(|error| format!("Could not remove the Aster mod runtime: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn create_sprocket_backup(app: AppHandle) -> Result<SprocketBackup, String> {
    let source = sprocket_data_dir();
    if !source.exists() {
        return Err("No Sprocket data exists to back up yet.".into());
    }
    let created_at = epoch_seconds(SystemTime::now());
    let id = format!("backup-{created_at}");
    let destination = backup_root(&app)?.join(&id);
    copy_directory(&source, &destination)?;
    Ok(SprocketBackup {
        id,
        created_at,
        size_bytes: directory_size(&destination),
        path: destination.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn list_sprocket_backups(app: AppHandle) -> Result<Vec<SprocketBackup>, String> {
    let root = backup_root(&app)?;
    let mut backups = Vec::new();
    for entry in fs::read_dir(&root)
        .map_err(|error| error.to_string())?
        .flatten()
    {
        if !entry.path().is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().into_owned();
        let created_at = id
            .strip_prefix("backup-")
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        backups.push(SprocketBackup {
            id,
            created_at,
            size_bytes: directory_size(&entry.path()),
            path: entry.path().to_string_lossy().into_owned(),
        });
    }
    backups.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(backups)
}

#[tauri::command]
pub fn restore_sprocket_backup(app: AppHandle, backup_id: String) -> Result<(), String> {
    let backup_id = safe_file_name(&backup_id)?;
    let root = backup_root(&app)?;
    let source = root.join(backup_id);
    if !source.is_dir() {
        return Err("The selected recovery point no longer exists.".into());
    }
    let current = sprocket_data_dir();
    if current.exists() {
        copy_directory(
            &current,
            &root.join(format!(
                "backup-{}-before-restore",
                epoch_seconds(SystemTime::now())
            )),
        )?;
    }
    copy_directory(&source, &current)
}

fn field_spec(key: &str, value: f64, pointer: String) -> Option<SprocketTunableField> {
    let normalized = key.to_ascii_lowercase().replace(['_', '-', ' '], "");
    let field = |label: &str, category: &str, min: f64, max: f64, step: f64, unit: &str| {
        Some(SprocketTunableField {
            pointer: pointer.clone(),
            label: label.into(),
            category: category.into(),
            value,
            min,
            max,
            step,
            unit: unit.into(),
            requires_reload: true,
        })
    };

    if normalized.parse::<usize>().is_ok() {
        let segments = pointer
            .split('/')
            .filter(|segment| !segment.is_empty())
            .collect::<Vec<_>>();
        let parent = segments
            .iter()
            .rev()
            .nth(1)
            .map(|segment| segment.to_ascii_lowercase().replace(['_', '-', ' '], ""))
            .unwrap_or_default();
        let number = normalized.parse::<usize>().unwrap_or_default() + 1;
        return match parent.as_str() {
            "gearratios" | "forwardgearratios" | "forwardgears" => field(
                &format!("Forward gear {number}"),
                "Transmission",
                0.05,
                50.0,
                0.01,
                ":1",
            ),
            "reversegearratios" | "reversegears" => field(
                &format!("Reverse gear {number}"),
                "Transmission",
                0.05,
                50.0,
                0.01,
                ":1",
            ),
            _ => None,
        };
    }

    let normalized_pointer = pointer.to_ascii_lowercase();
    if normalized_pointer.contains("/segments/") {
        match normalized.as_str() {
            "l" | "length" => {
                return field("Barrel segment length", "Weapon", 1.0, 10000.0, 1.0, "mm")
            }
            "t0" => return field("Segment start thickness", "Weapon", 0.1, 1000.0, 0.1, "mm"),
            "t1" => return field("Segment end thickness", "Weapon", 0.1, 1000.0, 0.1, "mm"),
            _ => {}
        }
    }

    match normalized.as_str() {
        "maxrpm" | "rpmmax" | "targetmaxrpm" | "maximumrpm" => {
            field("Engine maximum RPM", "Engine", 100.0, 12000.0, 50.0, "RPM")
        }
        "minrpm" | "rpmmin" | "targetminrpm" | "minimumrpm" => field(
            "Minimum operating RPM",
            "Engine",
            100.0,
            8000.0,
            50.0,
            "RPM",
        ),
        "idlerpm" | "idleenginerpm" | "engineidlerpm" => {
            field("Idle RPM (startup)", "Engine", 100.0, 4000.0, 25.0, "RPM")
        }
        "revlimit" | "rpmlimit" | "enginelimit" => {
            field("Engine rev limit", "Engine", 100.0, 16000.0, 50.0, "RPM")
        }
        "targetrpm" | "operatingrpm" | "enginetargetrpm" => {
            field("Operating RPM", "Engine", 100.0, 12000.0, 50.0, "RPM")
        }
        "upshiftrpm" | "shiftuprpm" => field("Upshift RPM", "Engine", 100.0, 12000.0, 50.0, "RPM"),
        "downshiftrpm" | "shiftdownrpm" => {
            field("Downshift RPM", "Engine", 100.0, 12000.0, 50.0, "RPM")
        }
        "cylinders" | "cylindercount" | "enginecylinders" => {
            field("Cylinder count", "Engine", 1.0, 32.0, 1.0, "")
        }
        "displacement" | "enginedisplacement" | "cylinderdisplacement" => {
            field("Engine displacement", "Engine", 0.05, 100.0, 0.05, "L")
        }
        "compression" | "compressionratio" => {
            field("Compression ratio", "Engine", 1.0, 40.0, 0.1, ":1")
        }
        "baseefficiency" => field("Crew efficiency", "Crew", 0.05, 25.0, 0.05, "x"),
        "engineefficiency" => field("Engine efficiency", "Engine", 0.01, 5.0, 0.01, "x"),
        "torquecoeff" | "torquecoefficient" => {
            field("Torque coefficient", "Engine", 0.01, 10.0, 0.01, "x")
        }
        "finaldrive" | "finaldriveratio" | "sprocketratio" => {
            field("Final-drive ratio", "Transmission", 0.05, 50.0, 0.01, ":1")
        }
        "steeringratio" | "turnratio" => {
            field("Steering ratio", "Transmission", 0.05, 50.0, 0.01, ":1")
        }
        "shiftupdelay" | "shifttime" | "gearshifttime" => {
            field("Gear-shift time", "Transmission", 0.01, 10.0, 0.01, "s")
        }
        "clutchtorque" | "maxclutchtorque" => {
            field("Clutch torque", "Transmission", 1.0, 100000.0, 10.0, "Nm")
        }
        "trackwidth" | "beltwidth" => field("Track width", "Mobility", 0.05, 2.5, 0.01, "m"),
        "trackseparation" | "trackspacing" => {
            field("Track separation", "Mobility", 0.3, 8.0, 0.01, "m")
        }
        "groundclearance" | "clearance" => {
            field("Ground clearance", "Mobility", 0.01, 2.0, 0.01, "m")
        }
        "sprocketdiameter" | "drivesprocketdiameter" => {
            field("Drive sprocket diameter", "Mobility", 0.1, 3.0, 0.01, "m")
        }
        "idlerdiameter" => field("Idler diameter", "Mobility", 0.1, 3.0, 0.01, "m"),
        "roadwheeldiameter" | "wheeldiameter" => {
            field("Roadwheel diameter", "Mobility", 0.1, 3.0, 0.01, "m")
        }
        "suspensiontravel" | "travel" => {
            field("Suspension travel", "Suspension", 0.0, 2.0, 0.01, "m")
        }
        "restangle" | "targetangle" | "suspensionangle" => field(
            "Suspension target angle",
            "Suspension",
            -60.0,
            60.0,
            0.5,
            "deg",
        ),
        "torsionbardiameter" | "bardiameter" => {
            field("Torsion-bar diameter", "Suspension", 0.01, 0.5, 0.001, "m")
        }
        "torsionbarlength" | "barlength" => {
            field("Torsion-bar length", "Suspension", 0.05, 8.0, 0.01, "m")
        }
        "suspensiondamping" | "damping" | "damper" => {
            field("Suspension damping", "Suspension", 0.0, 100000.0, 10.0, "")
        }
        "fuelcapacity" | "internalfuel" | "internalfuelcapacity" => {
            field("Internal fuel capacity", "Fuel", 0.0, 20000.0, 1.0, "L")
        }
        "externalfuel" | "externalfuelcapacity" => {
            field("External fuel capacity", "Fuel", 0.0, 20000.0, 1.0, "L")
        }
        "reloadtime" | "reloadseconds" | "loadtime" | "cycletime" => {
            field("Reload / cycle time", "Weapon", 0.01, 300.0, 0.01, "s")
        }
        "reloadspeed" | "loadspeed" | "autoloaderspeed" | "loadmultiplier" => {
            field("Reload-speed multiplier", "Weapon", 0.01, 25.0, 0.01, "x")
        }
        "firerate" | "rateoffire" | "roundsperminute" | "weaponrpm" => {
            field("Firing rate", "Weapon", 0.1, 6000.0, 0.1, "RPM")
        }
        "fireinterval" | "timebetweenshots" | "shotdelay" | "firingdelay" | "cooldown" => {
            field("Time between shots", "Weapon", 0.001, 300.0, 0.001, "s")
        }
        "firedelayloadfraction" => field(
            "Fire delay after loading",
            "Weapon",
            0.0,
            1.0,
            0.01,
            "cycle",
        ),
        "psi" | "chamberpressure" => {
            field("Chamber pressure", "Weapon", 100.0, 150000.0, 100.0, "PSI")
        }
        "k" | "penetratorconstant" => {
            field("Penetrator constant", "Weapon", 100.0, 10000.0, 10.0, "")
        }
        "muzzlemass" => field("Muzzle-device mass", "Weapon", 0.0, 10000.0, 0.1, "kg"),
        "caliber" | "bore" | "borediameter" => {
            field("Cannon caliber", "Weapon", 5.0, 500.0, 0.1, "mm")
        }
        "barrellength" | "cannonlength" => field("Barrel length", "Weapon", 0.1, 20.0, 0.01, "m"),
        "breechlength" => field("Breech length", "Weapon", 0.01, 10.0, 0.01, "m"),
        "breechdiameter" => field("Breech diameter", "Weapon", 0.01, 5.0, 0.01, "m"),
        "projectilelength" | "shelllength" => {
            field("Projectile length", "Weapon", 1.0, 5000.0, 1.0, "mm")
        }
        "propellantlength" => field("Propellant length", "Weapon", 1.0, 5000.0, 1.0, "mm"),
        "elevationspeed" | "gunelevationspeed" => {
            field("Gun elevation speed", "Weapon", 0.1, 180.0, 0.1, "deg/s")
        }
        "traversespeed" | "turrettraversespeed" => {
            field("Turret traverse speed", "Weapon", 0.1, 180.0, 0.1, "deg/s")
        }
        "maxelevation" | "elevationlimit" => {
            field("Maximum elevation", "Weapon", 0.0, 90.0, 0.5, "deg")
        }
        "maxdepression" | "depressionlimit" => {
            field("Maximum depression", "Weapon", 0.0, 45.0, 0.5, "deg")
        }
        "zoom" | "zoomfactor" | "sightzoom" => field("Sight zoom", "Optics", 1.0, 50.0, 0.1, "x"),
        "fieldofview" | "fov" | "sightfov" => {
            field("Sight field of view", "Optics", 1.0, 120.0, 0.5, "deg")
        }
        _ => None,
    }
}

fn inspect_value(value: &Value, pointer: &str, output: &mut Vec<SprocketTunableField>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let escaped = key.replace('~', "~0").replace('/', "~1");
                let child_pointer = format!("{pointer}/{escaped}");
                if let Some(number) = child.as_f64() {
                    if let Some(field) = field_spec(key, number, child_pointer.clone()) {
                        output.push(field);
                    }
                }
                inspect_value(child, &child_pointer, output);
            }
        }
        Value::Array(values) => {
            for (index, child) in values.iter().enumerate() {
                let child_pointer = format!("{pointer}/{index}");
                if let Some(number) = child.as_f64() {
                    if let Some(field) =
                        field_spec(&index.to_string(), number, child_pointer.clone())
                    {
                        output.push(field);
                    }
                }
                inspect_value(child, &child_pointer, output);
            }
        }
        _ => {}
    }
}

fn object_type(map: &serde_json::Map<String, Value>) -> String {
    map.iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("type"))
        .and_then(|(_, value)| value.as_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .replace(['_', '-', ' '], "")
}

fn direct_text(map: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|wanted| {
        map.iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(wanted))
            .and_then(|(_, value)| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

fn value_id(value: &Value) -> Option<String> {
    match value {
        Value::String(value) if !value.trim().is_empty() => Some(value.trim().to_string()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn collect_ids(value: &Value, output: &mut HashSet<String>) {
    // A node is identified only by its own top-level blueprint ID. Nested
    // objects contain reusable labels such as `AP` and `Propellant`; treating
    // those labels as identities connected otherwise unrelated cannons into a
    // single weapon group.
    if let Value::Object(map) = value {
        for (key, child) in map {
            if matches!(normalized_key(key).as_str(), "id" | "vuid") {
                if let Some(id) = value_id(child) {
                    output.insert(id);
                }
            }
        }
    }
}

fn collect_reference_ids(value: &Value, output: &mut HashSet<String>) {
    match value {
        Value::Array(values) => values
            .iter()
            .for_each(|child| collect_reference_ids(child, output)),
        Value::Object(map) => map
            .values()
            .for_each(|child| collect_reference_ids(child, output)),
        _ => {
            if let Some(id) = value_id(value) {
                let normalized = id.trim().to_ascii_lowercase();
                // Sprocket uses -1 (and occasionally 0/none) for an unused
                // relationship. Shared sentinel values must never connect
                // otherwise independent weapon graphs.
                if !matches!(normalized.as_str(), "-1" | "0" | "none" | "null") {
                    output.insert(id);
                }
            }
        }
    }
}

#[derive(Clone)]
struct BlueprintNode<'a> {
    pointer: String,
    value: &'a Value,
    name: Option<String>,
    ids: HashSet<String>,
    references: HashSet<String>,
}

fn normalized_key(key: &str) -> String {
    key.to_ascii_lowercase().replace(['_', '-', ' '], "")
}

fn is_reference_key(key: &str) -> bool {
    let key = normalized_key(key);
    key == "operatedbehaviours"
        || key == "operatedbehavior"
        || matches!(
            key.as_str(),
            "cannon" | "breech" | "shellid" | "barrelvuids" | "sightvuid" | "cannonbarrelsegment"
        )
        || ((key.ends_with("id") || key.ends_with("ids") || key.ends_with("vuid"))
            && [
                "weapon",
                "gun",
                "cannon",
                "breech",
                "behaviour",
                "behavior",
                "blueprint",
                "operator",
            ]
            .iter()
            .any(|part| key.contains(part)))
}

fn collect_reference_fields(value: &Value, output: &mut HashSet<String>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                if is_reference_key(key) {
                    collect_reference_ids(child, output);
                }
                collect_reference_fields(child, output);
            }
        }
        Value::Array(values) => values
            .iter()
            .for_each(|child| collect_reference_fields(child, output)),
        _ => {}
    }
}

fn nested_text(value: &Value, keys: &[&str], depth: usize) -> Option<String> {
    if depth == 0 {
        return None;
    }
    match value {
        Value::Object(map) => direct_text(map, keys).or_else(|| {
            map.values()
                .find_map(|child| nested_text(child, keys, depth - 1))
        }),
        Value::Array(values) => values
            .iter()
            .find_map(|child| nested_text(child, keys, depth - 1)),
        _ => None,
    }
}

fn related(left: &BlueprintNode<'_>, right: &BlueprintNode<'_>) -> bool {
    !left.ids.is_disjoint(&right.ids)
        || !left.ids.is_disjoint(&right.references)
        || !left.references.is_disjoint(&right.ids)
        || (!left.references.is_empty()
            && !right.references.is_empty()
            && !left.references.is_disjoint(&right.references))
}

fn collect_placement_link_nodes<'a>(
    value: &'a Value,
    pointer: &str,
    output: &mut Vec<BlueprintNode<'a>>,
) {
    match value {
        Value::Object(map) => {
            let is_weapon_placement = map.keys().any(|key| {
                matches!(
                    normalized_key(key).as_str(),
                    "cannonblueprintvuid" | "cannoninstanceblueprintvuid"
                )
            });
            if is_weapon_placement {
                let mut ids = HashSet::new();
                for (key, child) in map {
                    if matches!(normalized_key(key).as_str(), "id" | "vuid") {
                        if let Some(id) = value_id(child) {
                            ids.insert(id);
                        }
                    }
                }
                let mut references = HashSet::new();
                collect_reference_fields(value, &mut references);
                output.push(BlueprintNode {
                    pointer: pointer.to_string(),
                    value,
                    name: None,
                    ids,
                    references,
                });
            }
            for (key, child) in map {
                let escaped = key.replace('~', "~0").replace('/', "~1");
                collect_placement_link_nodes(child, &format!("{pointer}/{escaped}"), output);
            }
        }
        Value::Array(values) => {
            for (index, child) in values.iter().enumerate() {
                collect_placement_link_nodes(child, &format!("{pointer}/{index}"), output);
            }
        }
        _ => {}
    }
}

fn expand_linkage_ids(
    ids: &HashSet<String>,
    references: &HashSet<String>,
    placements: &[BlueprintNode<'_>],
) -> HashSet<String> {
    let mut expanded = ids.union(references).cloned().collect::<HashSet<_>>();
    loop {
        let previous_len = expanded.len();
        for placement in placements {
            let placement_values = placement
                .ids
                .union(&placement.references)
                .cloned()
                .collect::<HashSet<_>>();
            if !expanded.is_disjoint(&placement_values) {
                expanded.extend(placement_values);
            }
        }
        if expanded.len() == previous_len {
            break;
        }
    }
    expanded
}

fn collect_weapon_components(
    weapon_nodes: &[BlueprintNode<'_>],
    placements: &[BlueprintNode<'_>],
) -> Vec<Vec<usize>> {
    let mut visited = vec![false; weapon_nodes.len()];
    let mut components = Vec::new();
    for root_index in 0..weapon_nodes.len() {
        if visited[root_index] {
            continue;
        }
        let mut component = vec![root_index];
        visited[root_index] = true;
        let mut cursor = 0;
        while cursor < component.len() {
            let current = component[cursor];
            let current_links = expand_linkage_ids(
                &weapon_nodes[current].ids,
                &weapon_nodes[current].references,
                placements,
            );
            for candidate in 0..weapon_nodes.len() {
                let candidate_values = weapon_nodes[candidate]
                    .ids
                    .union(&weapon_nodes[candidate].references)
                    .cloned()
                    .collect::<HashSet<_>>();
                if !visited[candidate]
                    && (related(&weapon_nodes[current], &weapon_nodes[candidate])
                        || !current_links.is_disjoint(&candidate_values))
                {
                    visited[candidate] = true;
                    component.push(candidate);
                }
            }
            cursor += 1;
        }
        components.push(component);
    }
    components
}

fn collect_weapon_and_crew_nodes<'a>(
    value: &'a Value,
    pointer: &str,
    inside_weapon: bool,
    inside_crew: bool,
    inherited_name: Option<&str>,
    weapons: &mut Vec<BlueprintNode<'a>>,
    crew: &mut Vec<BlueprintNode<'a>>,
) {
    match value {
        Value::Object(map) => {
            let kind = object_type(map);
            let has_weapon_values = map.keys().any(|key| {
                matches!(
                    normalized_key(key).as_str(),
                    "caliber"
                        | "reloadtime"
                        | "reloadspeed"
                        | "loadtime"
                        | "firerate"
                        | "rateoffire"
                        | "timebetweenshots"
                        | "breechlength"
                        | "barrellength"
                )
            });
            let is_weapon = !inside_weapon
                && (kind.contains("cannon")
                    || kind.contains("breech")
                    || kind == "gun"
                    || kind.contains("shellslot")
                    || has_weapon_values);
            let is_crew = !inside_crew
                && (kind.contains("crewseat")
                    || (map
                        .keys()
                        .any(|key| key.eq_ignore_ascii_case("baseEfficiency"))
                        && map
                            .keys()
                            .any(|key| key.eq_ignore_ascii_case("operatedBehaviours"))));

            if is_weapon || is_crew {
                let mut ids = HashSet::new();
                collect_ids(value, &mut ids);
                let mut references = HashSet::new();
                collect_reference_fields(value, &mut references);
                let node = BlueprintNode {
                    pointer: pointer.to_string(),
                    value,
                    name: nested_text(value, &["name", "label", "displayName", "description"], 3)
                        .or_else(|| inherited_name.map(str::to_string)),
                    ids,
                    references,
                };
                if is_weapon {
                    weapons.push(node.clone());
                }
                if is_crew {
                    crew.push(node);
                }
            }

            let local_name = nested_text(value, &["name", "label", "displayName"], 2)
                .or_else(|| inherited_name.map(str::to_string));
            for (key, child) in map {
                let escaped = key.replace('~', "~0").replace('/', "~1");
                collect_weapon_and_crew_nodes(
                    child,
                    &format!("{pointer}/{escaped}"),
                    inside_weapon || is_weapon,
                    inside_crew || is_crew,
                    local_name.as_deref(),
                    weapons,
                    crew,
                );
            }
        }
        Value::Array(values) => {
            for (index, child) in values.iter().enumerate() {
                collect_weapon_and_crew_nodes(
                    child,
                    &format!("{pointer}/{index}"),
                    inside_weapon,
                    inside_crew,
                    inherited_name,
                    weapons,
                    crew,
                );
            }
        }
        _ => {}
    }
}

fn operated_behaviour_ids(value: &Value) -> HashSet<String> {
    let mut output = HashSet::new();
    collect_reference_fields(value, &mut output);
    output
}

fn base_efficiency_field(node: &BlueprintNode<'_>) -> Option<SprocketTunableField> {
    let mut fields = Vec::new();
    inspect_value(node.value, &node.pointer, &mut fields);
    let mut field = fields.into_iter().find(|field| {
        field
            .pointer
            .rsplit('/')
            .next()
            .is_some_and(|key| normalized_key(key) == "baseefficiency")
    })?;
    field.label = "Reload / firing-speed multiplier".into();
    field.category = "Operator".into();
    Some(field)
}

#[tauri::command]
pub fn inspect_sprocket_weapons(profile_id: String) -> Result<Vec<SprocketWeapon>, String> {
    let path = validate_existing_profile(&profile_id)?;
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let value: Value = serde_json::from_str(&content).map_err(|_| {
        "This blueprint format cannot be edited safely by this Aster version.".to_string()
    })?;
    let mut weapon_nodes = Vec::new();
    let mut crew_nodes = Vec::new();
    let mut placement_nodes = Vec::new();
    collect_weapon_and_crew_nodes(
        &value,
        "",
        false,
        false,
        None,
        &mut weapon_nodes,
        &mut crew_nodes,
    );
    collect_placement_link_nodes(&value, "", &mut placement_nodes);

    let mut weapons = Vec::new();
    for component in collect_weapon_components(&weapon_nodes, &placement_nodes) {
        let root_index = component[0];

        let mut component_ids = HashSet::new();
        let mut component_refs = HashSet::new();
        for index in &component {
            component_ids.extend(weapon_nodes[*index].ids.iter().cloned());
            component_refs.extend(weapon_nodes[*index].references.iter().cloned());
        }
        let expanded_linkage =
            expand_linkage_ids(&component_ids, &component_refs, &placement_nodes);
        let linked_crew = crew_nodes
            .iter()
            .filter(|crew| {
                let operated = operated_behaviour_ids(crew.value);
                !operated.is_disjoint(&expanded_linkage)
                    || component
                        .iter()
                        .any(|index| related(&weapon_nodes[*index], crew))
            })
            .collect::<Vec<_>>();

        let mut fields = Vec::new();
        for index in &component {
            let weapon = &weapon_nodes[*index];
            let mut node_fields = Vec::new();
            inspect_value(weapon.value, &weapon.pointer, &mut node_fields);
            node_fields.retain(|field| matches!(field.category.as_str(), "Weapon" | "Optics"));
            fields.extend(node_fields);
        }
        for crew in &linked_crew {
            if let Some(operator_field) = base_efficiency_field(crew) {
                fields.push(operator_field);
            }
        }
        fields.sort_by(|left, right| {
            left.category
                .cmp(&right.category)
                .then_with(|| left.label.cmp(&right.label))
        });
        fields.dedup_by(|left, right| left.pointer == right.pointer);

        let name = component
            .iter()
            .filter_map(|index| weapon_nodes[*index].name.clone())
            .min_by_key(|name| {
                let normalized = normalized_key(name);
                let generic = normalized.is_empty()
                    || normalized.starts_with("unnamed")
                    || normalized == "cannon"
                    || normalized == "gun"
                    || normalized == "breech";
                (generic, name.len())
            })
            .unwrap_or_else(|| format!("Cannon {}", weapons.len() + 1));
        let id = component_ids
            .iter()
            .next()
            .cloned()
            .unwrap_or_else(|| weapon_nodes[root_index].pointer.clone());
        let linkage_id = linked_crew.iter().find_map(|crew| {
            operated_behaviour_ids(crew.value)
                .into_iter()
                .find(|id| expanded_linkage.contains(id))
        });
        weapons.push(SprocketWeapon {
            id,
            name,
            operator_name: linked_crew
                .iter()
                .find_map(|crew| crew.name.clone())
                .or_else(|| {
                    linked_crew.first().map(|crew| {
                        let id = crew
                            .ids
                            .iter()
                            .next()
                            .cloned()
                            .unwrap_or_else(|| "unknown".into());
                        format!("Crew seat {id}")
                    })
                }),
            linkage_id,
            fields,
        });
    }
    weapons.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(weapons)
}

#[tauri::command]
pub fn inspect_sprocket_blueprint(profile_id: String) -> Result<Vec<SprocketTunableField>, String> {
    let path = validate_existing_profile(&profile_id)?;
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let value: Value = serde_json::from_str(&content).map_err(|_| {
        "This blueprint format cannot be edited safely by this Aster version.".to_string()
    })?;
    let mut fields = Vec::new();
    inspect_value(&value, "", &mut fields);
    fields.sort_by(|left, right| {
        left.category
            .cmp(&right.category)
            .then_with(|| left.label.cmp(&right.label))
            .then_with(|| left.pointer.cmp(&right.pointer))
    });
    fields.dedup_by(|left, right| left.pointer == right.pointer);
    Ok(fields)
}

#[tauri::command]
pub fn update_sprocket_blueprint_values(
    profile_id: String,
    updates: Vec<SprocketValueUpdate>,
) -> Result<(), String> {
    let path = validate_existing_profile(&profile_id)?;
    let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let mut value: Value = serde_json::from_str(&content).map_err(|_| {
        "This blueprint format cannot be edited safely by this Aster version.".to_string()
    })?;
    for update in &updates {
        let Some(target) = value.pointer_mut(&update.pointer) else {
            return Err("A blueprint field changed before it could be saved.".into());
        };
        let key = update
            .pointer
            .rsplit('/')
            .next()
            .unwrap_or_default()
            .replace("~1", "/")
            .replace("~0", "~");
        let Some(spec) = field_spec(&key, update.value, update.pointer.clone()) else {
            return Err("Aster refused to edit an unsupported blueprint field.".into());
        };
        if update.value < spec.min || update.value > spec.max || !update.value.is_finite() {
            return Err(format!("{} is outside the safe range.", spec.label));
        }
        *target = serde_json::Number::from_f64(update.value)
            .map(Value::Number)
            .ok_or_else(|| "The value is not valid.".to_string())?;
    }
    let backup = path.with_extension(format!(
        "blueprint.aster-backup-{}",
        epoch_seconds(SystemTime::now())
    ));
    fs::copy(&path, backup).map_err(|error| format!("Could not create safety backup: {error}"))?;
    let formatted = serde_json::to_string_pretty(&value).map_err(|error| error.to_string())?;
    fs::write(path, formatted).map_err(|error| format!("Could not save blueprint: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn open_sprocket_path(app: AppHandle, section: String) -> Result<(), String> {
    let installation = detect_installation();
    let path = match section.as_str() {
        "game" => PathBuf::from(
            installation
                .install_dir
                .ok_or_else(|| "Sprocket is not installed.".to_string())?,
        ),
        "mods" => PathBuf::from(
            installation
                .install_dir
                .ok_or_else(|| "Sprocket is not installed.".to_string())?,
        )
        .join("Mods"),
        "backups" => backup_root(&app)?,
        _ => profile_base(),
    };
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    open::that(path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_melonloader_download() -> Result<(), String> {
    Err("Aster now manages the Sprocket mod runtime automatically. A separate loader installation is not required.".into())
}

#[tauri::command]
pub fn open_sprocket_store() -> Result<(), String> {
    open::that(format!("steam://store/{SPROCKET_APP_ID}")).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn launch_sprocket(app: AppHandle, safe_mode: bool) -> Result<SprocketLaunchStarted, String> {
    let installation = detect_installation();
    let executable = PathBuf::from(installation.executable_path.ok_or_else(|| {
        "Sprocket was not found. Install it through Steam, then refresh detection.".to_string()
    })?);
    let install_dir = executable
        .parent()
        .ok_or_else(|| "The Sprocket install path is invalid.".to_string())?;
    let has_enabled_mods = fs::read_dir(install_dir.join("Mods"))
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .any(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| value.eq_ignore_ascii_case("dll"))
        });
    let runtime = if !safe_mode && has_enabled_mods {
        let _ = app.emit(
            "launch-status",
            SprocketLaunchStatus {
                instance_id: "sprocket".into(),
                status: "preparing".into(),
                detail: "Verifying the Aster mod runtime and scanning enabled mods.".into(),
                exit_code: None,
            },
        );
        scan_enabled_mods(install_dir)?;
        Some(ensure_managed_runtime(&app)?)
    } else {
        None
    };
    let activation = if let Some(runtime) = runtime.as_deref() {
        Some(activate_managed_runtime(runtime, install_dir)?)
    } else {
        None
    };
    let mut command = Command::new(&executable);
    command
        .current_dir(install_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if safe_mode {
        command.arg("--no-mods");
    }
    if let Some(runtime) = runtime.as_deref() {
        command
            .arg(format!(
                "--melonloader.basedir={}",
                runtime.to_string_lossy()
            ))
            .arg("--melonloader.hideconsole")
            .arg("--melonloader.disablestartscreen");
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
            return Err(format!("Sprocket could not start: {error}"));
        }
    };
    let pid = child.id();
    let event_app = app.clone();
    std::thread::spawn(move || {
        let _ = event_app.emit(
            "launch-status",
            SprocketLaunchStatus {
                instance_id: "sprocket".into(),
                status: "running".into(),
                detail: "Sprocket is running.".into(),
                exit_code: None,
            },
        );
        let status = child.wait();
        if let (Some(activation), Some(runtime)) = (&activation, runtime.as_deref()) {
            deactivate_managed_runtime(activation, runtime);
        }
        match status {
            Ok(status) => {
                let _ = event_app.emit(
                    "launch-status",
                    SprocketLaunchStatus {
                        instance_id: "sprocket".into(),
                        status: "exited".into(),
                        detail: "Sprocket closed.".into(),
                        exit_code: status.code(),
                    },
                );
            }
            Err(error) => {
                let _ = event_app.emit(
                    "launch-status",
                    SprocketLaunchStatus {
                        instance_id: "sprocket".into(),
                        status: "failed".into(),
                        detail: error.to_string(),
                        exit_code: None,
                    },
                );
            }
        }
    });
    Ok(SprocketLaunchStarted {
        pid,
        version_id: installation.build_id.unwrap_or_else(|| "Steam".into()),
        loader: if safe_mode {
            "Safe mode".into()
        } else if has_enabled_mods {
            "Aster Mod Runtime".into()
        } else {
            "Steam".into()
        },
        log_path: String::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modern_runtime_layout_does_not_require_legacy_dobby_bridge() {
        let root = std::env::temp_dir().join(format!(
            "aster-modern-runtime-layout-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(root.join("MelonLoader")).expect("runtime folder");
        fs::write(root.join("version.dll"), b"bootstrap").expect("bootstrap file");

        assert!(managed_runtime_layout_ready(&root));
        assert!(!root.join("dobby.dll").exists());

        fs::remove_dir_all(root).expect("remove test runtime");
    }

    #[test]
    fn private_runtime_stages_only_enabled_dll_mods() {
        let root = std::env::temp_dir().join(format!(
            "aster-runtime-mod-staging-{}",
            uuid::Uuid::new_v4()
        ));
        let runtime = root.join("runtime");
        let game = root.join("game");
        fs::create_dir_all(game.join("Mods")).expect("game mod folder");
        fs::create_dir_all(&runtime).expect("runtime folder");
        fs::write(game.join("Mods").join("Enabled.dll"), b"enabled").expect("enabled mod");
        fs::write(game.join("Mods").join("Disabled.dll.disabled"), b"disabled")
            .expect("disabled mod");

        let staged = stage_enabled_mods(&runtime, &game).expect("stage mods");
        assert!(staged.join("Enabled.dll").is_file());
        assert!(!staged.join("Disabled.dll.disabled").exists());

        fs::remove_dir_all(root).expect("remove test folders");
    }

    #[test]
    fn reads_manifest_values() {
        let value = "\"appid\" \"1674170\"\n\"installdir\" \"Sprocket\"\n\"buildid\" \"12345\"";
        assert_eq!(
            manifest_value(value, "installdir").as_deref(),
            Some("Sprocket")
        );
        assert_eq!(manifest_value(value, "buildid").as_deref(), Some("12345"));
    }
    #[test]
    fn only_known_tuning_keys_are_exposed() {
        assert!(field_spec("targetMaxRpm", 3200.0, "/targetMaxRpm".into()).is_some());
        assert!(field_spec("targetMinRpm", 900.0, "/targetMinRpm".into()).is_some());
        assert!(field_spec("revLimit", 3600.0, "/revLimit".into()).is_some());
        assert!(field_spec("baseEfficiency", 0.8, "/baseEfficiency".into()).is_some());
        assert!(field_spec("breechLength", 0.7, "/breechLength".into()).is_some());
        assert!(field_spec("0", 3.2, "/gearRatios/0".into()).is_some());
        assert!(field_spec("reloadTime", 4.0, "/reloadTime".into()).is_some());
        assert!(field_spec("damage", 999.0, "/damage".into()).is_none());
    }

    #[test]
    fn links_named_cannon_to_its_named_loader() {
        let blueprint: Value = serde_json::json!({
            "blueprints": [
                { "id": 301, "type": "cannon", "name": "Main Cannon", "caliber": 120.0 },
                { "id": 44, "type": "crewSeat", "name": "Alice (Loader)", "baseEfficiency": 1.0, "operatedBehaviours": [301] }
            ]
        });
        let mut weapons = Vec::new();
        let mut crew = Vec::new();
        collect_weapon_and_crew_nodes(&blueprint, "", false, false, None, &mut weapons, &mut crew);
        assert_eq!(weapons.len(), 1);
        assert_eq!(crew.len(), 1);
        assert!(!operated_behaviour_ids(crew[0].value).is_disjoint(&weapons[0].ids));
        let field = base_efficiency_field(&crew[0]).expect("loader field");
        assert_eq!(field.label, "Reload / firing-speed multiplier");
        assert_eq!(field.pointer, "/blueprints/1/baseEfficiency");
    }

    #[test]
    fn finds_nested_named_weapon_and_loader_controls() {
        let blueprint: Value = serde_json::json!({
            "objects": [
                {
                    "type": "cannonBlueprint",
                    "vuid": "mg-blueprint",
                    "header": { "name": "MG" },
                    "blueprint": {
                        "caliber": 20.0,
                        "timeBetweenShots": 0.12,
                        "reloadSpeed": 1.0
                    }
                },
                {
                    "type": "crewSeat",
                    "vuid": "loader-seat",
                    "blueprint": {
                        "name": "MG Loader",
                        "baseEfficiency": 1.25,
                        "operatedBehaviours": ["mg-blueprint"]
                    }
                }
            ]
        });
        let mut weapons = Vec::new();
        let mut crew = Vec::new();
        collect_weapon_and_crew_nodes(&blueprint, "", false, false, None, &mut weapons, &mut crew);
        assert_eq!(weapons.len(), 1);
        assert_eq!(weapons[0].name.as_deref(), Some("MG"));
        assert_eq!(crew.len(), 1);
        assert!(related(&weapons[0], &crew[0]));
        let loader = base_efficiency_field(&crew[0]).expect("nested loader field");
        assert_eq!(loader.label, "Reload / firing-speed multiplier");
        assert_eq!(loader.pointer, "/objects/1/blueprint/baseEfficiency");

        let mut weapon_fields = Vec::new();
        inspect_value(weapons[0].value, &weapons[0].pointer, &mut weapon_fields);
        assert!(weapon_fields
            .iter()
            .any(|field| field.label == "Firing rate" || field.label == "Time between shots"));
        assert!(weapon_fields
            .iter()
            .any(|field| field.label == "Reload-speed multiplier"));
    }

    #[test]
    fn links_real_sprocket_cannon_placement_to_unnamed_loader() {
        let blueprint: Value = serde_json::json!({
            "blueprints": [
                {
                    "id": 159,
                    "type": "cannonInstance",
                    "blueprint": { "barrelVuids": [606], "fireDelayLoadFraction": 0.0 }
                },
                {
                    "id": 160,
                    "type": "cannon",
                    "blueprint": { "name": "MG", "caliber": 20.0, "shellID": 161 }
                },
                {
                    "id": 161,
                    "type": "shellSlot",
                    "blueprint": { "diameter": 20.0, "propellantLength": 438.0 }
                },
                {
                    "id": 163,
                    "type": "crewSeat",
                    "blueprint": {
                        "name": null,
                        "baseEfficiency": 1.0,
                        "operatedBehaviours": [603, 602]
                    }
                }
            ],
            "objects": [
                {
                    "vuid": 601,
                    "cannon": 602,
                    "breech": 603,
                    "cannonBlueprintVuid": 160,
                    "cannonInstanceBlueprintVuid": 159
                }
            ]
        });
        let mut weapons = Vec::new();
        let mut crew = Vec::new();
        let mut placements = Vec::new();
        collect_weapon_and_crew_nodes(&blueprint, "", false, false, None, &mut weapons, &mut crew);
        collect_placement_link_nodes(&blueprint, "", &mut placements);
        let mg = weapons
            .iter()
            .find(|weapon| weapon.name.as_deref() == Some("MG"))
            .expect("MG weapon");
        let expanded = expand_linkage_ids(&mg.ids, &mg.references, &placements);
        assert!(expanded.contains("602"));
        assert!(expanded.contains("603"));
        let loader = crew
            .iter()
            .find(|seat| !operated_behaviour_ids(seat.value).is_disjoint(&expanded))
            .expect("linked MG loader");
        let speed = base_efficiency_field(loader).expect("loader speed");
        assert_eq!(speed.pointer, "/blueprints/3/blueprint/baseEfficiency");
    }

    #[test]
    fn keeps_weapons_separate_when_shells_reuse_function_labels() {
        let blueprint: Value = serde_json::json!({
            "blueprints": [
                { "id": 68, "type": "cannonInstance", "blueprint": { "barrelVuids": [455], "linkedCannonVuid": -1, "sightVuid": -1 } },
                { "id": 69, "type": "cannon", "blueprint": { "name": "105mm main", "caliber": 105.0, "shellID": 75 } },
                {
                    "id": 75,
                    "type": "shellSlot",
                    "blueprint": {
                        "diameter": 105.0,
                        "generatedProjectiles": [{
                            "functions": [{ "id": "AP" }, { "id": "Propellant" }]
                        }]
                    }
                },
                { "id": 159, "type": "cannonInstance", "blueprint": { "barrelVuids": [606], "linkedCannonVuid": -1, "sightVuid": -1 } },
                { "id": 160, "type": "cannon", "blueprint": { "name": "MG", "caliber": 20.0, "shellID": 161 } },
                {
                    "id": 161,
                    "type": "shellSlot",
                    "blueprint": {
                        "diameter": 20.0,
                        "generatedProjectiles": [{
                            "functions": [{ "id": "AP" }, { "id": "Propellant" }]
                        }]
                    }
                }
            ],
            "objects": [
                {
                    "vuid": 408,
                    "cannon": 409,
                    "breech": 410,
                    "cannonBlueprintVuid": 69,
                    "cannonInstanceBlueprintVuid": 68
                },
                {
                    "vuid": 601,
                    "cannon": 602,
                    "breech": 603,
                    "cannonBlueprintVuid": 160,
                    "cannonInstanceBlueprintVuid": 159
                }
            ]
        });
        let mut weapons = Vec::new();
        let mut crew = Vec::new();
        let mut placements = Vec::new();
        collect_weapon_and_crew_nodes(&blueprint, "", false, false, None, &mut weapons, &mut crew);
        collect_placement_link_nodes(&blueprint, "", &mut placements);

        let components = collect_weapon_components(&weapons, &placements);
        assert_eq!(components.len(), 2);
        let component_names = components
            .iter()
            .map(|component| {
                component
                    .iter()
                    .filter_map(|index| weapons[*index].name.as_deref())
                    .collect::<HashSet<_>>()
            })
            .collect::<Vec<_>>();
        assert!(component_names
            .iter()
            .any(|names| names.contains("MG") && !names.contains("105mm main")));
        assert!(component_names
            .iter()
            .any(|names| names.contains("105mm main") && !names.contains("MG")));
    }
}
