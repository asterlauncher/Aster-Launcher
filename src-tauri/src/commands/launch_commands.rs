use std::{
    collections::{HashMap, HashSet},
    ffi::OsStr,
    fs::File,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
};

use ring::digest::{digest, SHA1_FOR_LEGACY_USE_ONLY};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::task::JoinSet;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::{auth::AuthState, errors::AuthErrorPayload, models::account::StoredAccount};

const VERSION_MANIFEST_URL: &str =
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const DEFAULT_LIBRARY_URL: &str = "https://libraries.minecraft.net/";
const ASSET_OBJECT_URL: &str = "https://resources.download.minecraft.net";
const FORGE_MAVEN_ROOT: &str = "https://maven.minecraftforge.net/net/minecraftforge/forge";
const JAVA_RUNTIME_CATALOG_URL: &str =
    "https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";
const MAX_METADATA_BYTES: usize = 16 * 1024 * 1024;
const MAX_GAME_FILE_BYTES: usize = 768 * 1024 * 1024;
const ASSET_DOWNLOAD_CONCURRENCY: usize = 12;
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LaunchStatusEvent {
    instance_id: String,
    status: String,
    detail: String,
    exit_code: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchStarted {
    pid: u32,
    version_id: String,
    loader: String,
    log_path: String,
}

#[derive(Debug, Deserialize)]
struct VersionManifest {
    versions: Vec<VersionReference>,
}

#[derive(Debug, Deserialize)]
struct VersionReference {
    id: String,
    url: String,
    sha1: String,
    #[serde(default, rename = "type")]
    kind: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionMetadata {
    #[serde(default)]
    id: String,
    #[serde(default)]
    main_class: String,
    #[serde(default)]
    inherits_from: Option<String>,
    #[serde(default)]
    libraries: Vec<Library>,
    arguments: Option<LaunchArguments>,
    minecraft_arguments: Option<String>,
    downloads: Option<VersionDownloads>,
    asset_index: Option<AssetIndexReference>,
    #[allow(dead_code)]
    assets: Option<String>,
    java_version: Option<JavaVersion>,
    logging: Option<LoggingConfiguration>,
}

#[derive(Clone, Debug, Default, Deserialize)]
struct LaunchArguments {
    #[serde(default)]
    game: Vec<ConditionalArgument>,
    #[serde(default)]
    jvm: Vec<ConditionalArgument>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
enum ConditionalArgument {
    Plain(String),
    Ruled {
        rules: Vec<Rule>,
        value: ArgumentValue,
    },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
enum ArgumentValue {
    One(String),
    Many(Vec<String>),
}

#[derive(Clone, Debug, Deserialize)]
struct Rule {
    action: String,
    os: Option<RuleOperatingSystem>,
    #[serde(default)]
    features: HashMap<String, bool>,
}

#[derive(Clone, Debug, Deserialize)]
struct RuleOperatingSystem {
    name: Option<String>,
    arch: Option<String>,
    #[allow(dead_code)]
    version: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
struct VersionDownloads {
    client: DownloadArtifact,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssetIndexReference {
    id: String,
    url: String,
    sha1: String,
    size: u64,
}

#[derive(Debug, Deserialize)]
struct AssetIndex {
    objects: HashMap<String, AssetObject>,
}

#[derive(Debug, Deserialize)]
struct AssetObject {
    hash: String,
    size: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JavaVersion {
    major_version: u32,
}

#[derive(Clone, Debug, Deserialize)]
struct Library {
    name: String,
    url: Option<String>,
    downloads: Option<LibraryDownloads>,
    #[serde(default)]
    rules: Vec<Rule>,
    #[serde(default)]
    natives: HashMap<String, String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
struct LibraryDownloads {
    artifact: Option<DownloadArtifact>,
    #[serde(default)]
    classifiers: HashMap<String, DownloadArtifact>,
}

#[derive(Clone, Debug, Deserialize)]
struct DownloadArtifact {
    path: Option<String>,
    sha1: Option<String>,
    size: Option<u64>,
    url: String,
}

#[derive(Clone, Debug, Deserialize)]
struct LoggingConfiguration {
    client: Option<ClientLoggingConfiguration>,
}

#[derive(Clone, Debug, Deserialize)]
struct ClientLoggingConfiguration {
    argument: String,
    file: LoggingFile,
}

#[derive(Clone, Debug, Deserialize)]
struct LoggingFile {
    id: String,
    sha1: String,
    size: u64,
    url: String,
}

#[derive(Debug, Deserialize)]
struct FabricLoaderEntry {
    loader: FabricLoaderVersion,
}

#[derive(Debug, Deserialize)]
struct FabricLoaderVersion {
    version: String,
    stable: bool,
}

#[derive(Clone, Debug)]
struct ForgeResolution {
    coordinate: String,
    profile_id: String,
}

#[derive(Clone, Debug, Deserialize)]
struct JavaRuntimeEntry {
    manifest: JavaRuntimeManifestReference,
}

#[derive(Clone, Debug, Deserialize)]
struct JavaRuntimeManifestReference {
    url: String,
    sha1: String,
    size: u64,
}

#[derive(Debug, Deserialize)]
struct JavaRuntimeManifest {
    files: HashMap<String, JavaRuntimeFile>,
}

#[derive(Debug, Deserialize)]
struct JavaRuntimeFile {
    #[serde(rename = "type")]
    kind: String,
    downloads: Option<JavaRuntimeDownloads>,
}

#[derive(Debug, Deserialize)]
struct JavaRuntimeDownloads {
    raw: DownloadArtifact,
}

#[derive(Clone)]
struct FileDownload {
    url: String,
    path: PathBuf,
    sha1: Option<String>,
    size: Option<u64>,
}

struct RuntimeDirectories {
    root: PathBuf,
    versions: PathBuf,
    libraries: PathBuf,
    assets: PathBuf,
    natives: PathBuf,
    log_configs: PathBuf,
}

struct PreparedRuntime {
    metadata: VersionMetadata,
    version_id: String,
    classpath: Vec<PathBuf>,
    libraries: PathBuf,
    natives: PathBuf,
    assets: PathBuf,
    asset_index_name: String,
    logging_argument: Option<String>,
    required_java: u32,
}

fn emit_download_progress(app: &AppHandle, id: &str, progress: u8, detail: impl Into<String>) {
    let _ = app.emit(
        "download-progress",
        DownloadProgressEvent {
            id: id.to_owned(),
            progress,
            detail: detail.into(),
            speed: None,
            remaining: None,
        },
    );
}

fn emit_launch_status(
    app: &AppHandle,
    instance_id: &str,
    status: &str,
    detail: impl Into<String>,
    exit_code: Option<i32>,
) {
    let _ = app.emit(
        "launch-status",
        LaunchStatusEvent {
            instance_id: instance_id.to_owned(),
            status: status.to_owned(),
            detail: detail.into(),
            exit_code,
        },
    );
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

fn trusted_download_url(value: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(value).map_err(|_| "A game download URL is invalid.".to_owned())?;
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let trusted = url.scheme() == "https"
        && (host == "piston-meta.mojang.com"
            || host == "piston-data.mojang.com"
            || host == "launcher.mojang.com"
            || host == "launchermeta.mojang.com"
            || host == "libraries.minecraft.net"
            || host == "resources.download.minecraft.net"
            || host == "meta.fabricmc.net"
            || host == "maven.fabricmc.net"
            || host == "maven.minecraftforge.net");
    trusted
        .then_some(url)
        .ok_or_else(|| "A game file uses an untrusted download host.".to_owned())
}

fn safe_relative_path(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value.replace('\\', "/"));
    if path.as_os_str().is_empty()
        || !path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
    {
        return Err("A game file path is unsafe.".to_owned());
    }
    Ok(path)
}

fn sha1_hex(bytes: &[u8]) -> String {
    digest(&SHA1_FOR_LEGACY_USE_ONLY, bytes)
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn verify_bytes(bytes: &[u8], expected_sha1: Option<&str>, expected_size: Option<u64>) -> bool {
    if expected_size.is_some_and(|size| bytes.len() as u64 != size) {
        return false;
    }
    expected_sha1
        .filter(|hash| !hash.is_empty())
        .is_none_or(|hash| sha1_hex(bytes).eq_ignore_ascii_case(hash))
}

async fn fetch_bytes(
    client: &reqwest::Client,
    url: &str,
    maximum: usize,
) -> Result<Vec<u8>, String> {
    let url = trusted_download_url(url)?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|_| "Minecraft download services could not be reached.".to_owned())?;
    if !response.status().is_success() {
        return Err(format!(
            "Minecraft rejected a download (HTTP {}).",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length as usize > maximum)
    {
        return Err("A game download exceeds its safety limit.".to_owned());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "A game download could not be read.".to_owned())?;
    if bytes.len() > maximum {
        return Err("A game download exceeds its safety limit.".to_owned());
    }
    Ok(bytes.to_vec())
}

async fn fetch_json<T: DeserializeOwned>(client: &reqwest::Client, url: &str) -> Result<T, String> {
    let bytes = fetch_bytes(client, url, MAX_METADATA_BYTES).await?;
    serde_json::from_slice(&bytes).map_err(|_| "Minecraft returned invalid metadata.".to_owned())
}

async fn ensure_download(client: &reqwest::Client, download: &FileDownload) -> Result<(), String> {
    if let Ok(existing) = tokio::fs::read(&download.path).await {
        if verify_bytes(&existing, download.sha1.as_deref(), download.size) {
            return Ok(());
        }
    }

    let bytes = fetch_bytes(client, &download.url, MAX_GAME_FILE_BYTES).await?;
    if !verify_bytes(&bytes, download.sha1.as_deref(), download.size) {
        return Err("A downloaded Minecraft file failed its integrity check.".to_owned());
    }
    let parent = download
        .path
        .parent()
        .ok_or_else(|| "A game file has no parent folder.".to_owned())?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|_| "A game download folder could not be created.".to_owned())?;
    let temporary = download.path.with_extension("aster-download");
    let _ = tokio::fs::remove_file(&temporary).await;
    tokio::fs::write(&temporary, bytes)
        .await
        .map_err(|_| "A downloaded game file could not be saved.".to_owned())?;
    let _ = tokio::fs::remove_file(&download.path).await;
    tokio::fs::rename(temporary, &download.path)
        .await
        .map_err(|_| "A downloaded game file could not be finalized.".to_owned())
}

fn runtime_directories(app: &AppHandle, game_version: &str) -> Result<RuntimeDirectories, String> {
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "The launcher data folder is unavailable.".to_owned())?
        .join("minecraft");
    Ok(RuntimeDirectories {
        versions: root.join("versions"),
        libraries: root.join("libraries"),
        assets: root.join("assets"),
        natives: root.join("natives").join(game_version),
        log_configs: root.join("log-configs"),
        root,
    })
}

fn rule_matches(rule: &Rule) -> bool {
    if let Some(os) = &rule.os {
        if os.name.as_deref().is_some_and(|name| name != "windows") {
            return false;
        }
        if let Some(arch) = os.arch.as_deref() {
            let current = if cfg!(target_arch = "x86") {
                "x86"
            } else {
                "x86_64"
            };
            if arch != current && !(arch == "amd64" && current == "x86_64") {
                return false;
            }
        }
    }
    rule.features.values().all(|required_value| !required_value)
}

fn rules_allow(rules: &[Rule]) -> bool {
    if rules.is_empty() {
        return true;
    }
    let mut allowed = false;
    for rule in rules {
        if rule_matches(rule) {
            allowed = rule.action.eq_ignore_ascii_case("allow");
        }
    }
    allowed
}

fn evaluate_arguments(arguments: &[ConditionalArgument]) -> Vec<String> {
    let mut values = Vec::new();
    for argument in arguments {
        match argument {
            ConditionalArgument::Plain(value) => values.push(value.clone()),
            ConditionalArgument::Ruled { rules, value } if rules_allow(rules) => match value {
                ArgumentValue::One(value) => values.push(value.clone()),
                ArgumentValue::Many(items) => values.extend(items.iter().cloned()),
            },
            ConditionalArgument::Ruled { .. } => {}
        }
    }
    values
}

fn maven_artifact(library: &Library) -> Result<DownloadArtifact, String> {
    if let Some(artifact) = library
        .downloads
        .as_ref()
        .and_then(|downloads| downloads.artifact.clone())
    {
        return Ok(artifact);
    }

    let mut coordinate_and_extension = library.name.split('@');
    let coordinate = coordinate_and_extension.next().unwrap_or_default();
    let extension = coordinate_and_extension.next().unwrap_or("jar");
    let parts = coordinate.split(':').collect::<Vec<_>>();
    if !(3..=4).contains(&parts.len())
        || parts
            .iter()
            .any(|part| part.is_empty() || part.contains(['/', '\\']))
    {
        return Err("A library uses an invalid Maven coordinate.".to_owned());
    }
    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    let classifier = parts
        .get(3)
        .map(|value| format!("-{value}"))
        .unwrap_or_default();
    let path = format!("{group}/{artifact}/{version}/{artifact}-{version}{classifier}.{extension}");
    let base = library.url.as_deref().unwrap_or(DEFAULT_LIBRARY_URL);
    Ok(DownloadArtifact {
        url: format!("{}/{}", base.trim_end_matches('/'), path),
        path: Some(path),
        sha1: None,
        size: None,
    })
}

fn file_download(
    artifact: &DownloadArtifact,
    library_directory: &Path,
) -> Result<FileDownload, String> {
    let relative = artifact
        .path
        .as_deref()
        .map(safe_relative_path)
        .transpose()?
        .unwrap_or_else(|| PathBuf::from(artifact.url.rsplit('/').next().unwrap_or("library.jar")));
    Ok(FileDownload {
        url: artifact.url.clone(),
        path: library_directory.join(relative),
        sha1: artifact.sha1.clone(),
        size: artifact.size,
    })
}

fn native_artifact(library: &Library) -> Option<DownloadArtifact> {
    let classifier = library.natives.get("windows")?.replace(
        "${arch}",
        if cfg!(target_arch = "x86") {
            "32"
        } else {
            "64"
        },
    );
    library
        .downloads
        .as_ref()?
        .classifiers
        .get(&classifier)
        .cloned()
}

async fn resolve_fabric_profile(
    client: &reqwest::Client,
    game_version: &str,
) -> Result<VersionMetadata, String> {
    let entries: Vec<FabricLoaderEntry> = fetch_json(
        client,
        &format!("https://meta.fabricmc.net/v2/versions/loader/{game_version}"),
    )
    .await?;
    let loader = entries
        .iter()
        .find(|entry| entry.loader.stable)
        .or_else(|| entries.first())
        .ok_or_else(|| "Fabric does not support this Minecraft version.".to_owned())?;
    fetch_json(
        client,
        &format!(
            "https://meta.fabricmc.net/v2/versions/loader/{game_version}/{}/profile/json",
            loader.loader.version
        ),
    )
    .await
}

fn parse_forge_versions(metadata: &str, game_version: &str) -> Vec<String> {
    let prefix = format!("{game_version}-");
    let mut versions = Vec::new();
    let mut remaining = metadata;
    while let Some(start) = remaining.find("<version>") {
        remaining = &remaining[start + "<version>".len()..];
        let Some(end) = remaining.find("</version>") else {
            break;
        };
        let candidate = remaining[..end].trim();
        let suffix = candidate.strip_prefix(&prefix).unwrap_or_default();
        if !suffix.is_empty()
            && suffix
                .chars()
                .all(|character| character.is_ascii_digit() || character == '.')
        {
            versions.push(candidate.to_owned());
        }
        remaining = &remaining[end + "</version>".len()..];
    }
    versions
}

async fn resolve_forge_version(
    client: &reqwest::Client,
    game_version: &str,
) -> Result<ForgeResolution, String> {
    let metadata = fetch_bytes(
        client,
        &format!("{FORGE_MAVEN_ROOT}/maven-metadata.xml"),
        MAX_METADATA_BYTES,
    )
    .await?;
    let metadata = std::str::from_utf8(&metadata)
        .map_err(|_| "Forge returned invalid version metadata.".to_owned())?;
    let coordinate = parse_forge_versions(metadata, game_version)
        .pop()
        .ok_or_else(|| format!("Forge does not support Minecraft {game_version}."))?;
    let forge_version = coordinate
        .strip_prefix(&format!("{game_version}-"))
        .ok_or_else(|| "Forge returned an invalid version number.".to_owned())?;
    Ok(ForgeResolution {
        profile_id: format!("{game_version}-forge-{forge_version}"),
        coordinate,
    })
}

async fn ensure_forge_profile(
    app: &AppHandle,
    download_id: &str,
    client: &reqwest::Client,
    runtime: &RuntimeDirectories,
    javaw: &Path,
    game_version: &str,
) -> Result<VersionMetadata, String> {
    let forge = resolve_forge_version(client, game_version).await?;
    let profile_path = runtime
        .versions
        .join(&forge.profile_id)
        .join(format!("{}.json", forge.profile_id));
    if let Ok(bytes) = tokio::fs::read(&profile_path).await {
        if let Ok(profile) = serde_json::from_slice::<VersionMetadata>(&bytes) {
            if profile.id == forge.profile_id
                && profile.inherits_from.as_deref() == Some(game_version)
            {
                return Ok(profile);
            }
        }
    }

    emit_download_progress(
        app,
        download_id,
        20,
        format!("Downloading Forge {}", forge.coordinate),
    );
    let installer_name = format!("forge-{}-installer.jar", forge.coordinate);
    let installer_url = format!(
        "{}/{}/{}",
        FORGE_MAVEN_ROOT, forge.coordinate, installer_name
    );
    let checksum_url = format!("{installer_url}.sha1");
    let checksum = fetch_bytes(client, &checksum_url, 1024).await?;
    let checksum = std::str::from_utf8(&checksum)
        .ok()
        .and_then(|value| value.split_whitespace().next())
        .filter(|value| {
            value.len() == 40 && value.chars().all(|character| character.is_ascii_hexdigit())
        })
        .ok_or_else(|| "Forge returned an invalid installer checksum.".to_owned())?;
    let installer = runtime
        .root
        .join("installers")
        .join(&forge.coordinate)
        .join(installer_name);
    ensure_download(
        client,
        &FileDownload {
            url: installer_url,
            path: installer.clone(),
            sha1: Some(checksum.to_owned()),
            size: None,
        },
    )
    .await?;

    let launcher_profiles = runtime.root.join("launcher_profiles.json");
    if !launcher_profiles.is_file() {
        tokio::fs::write(
            &launcher_profiles,
            br#"{"profiles":{},"settings":{},"version":3}"#,
        )
        .await
        .map_err(|_| "The Forge launcher profile file could not be created.".to_owned())?;
    }

    emit_download_progress(
        app,
        download_id,
        23,
        format!("Installing Forge {}", forge.coordinate),
    );
    let java = javaw.with_file_name("java.exe");
    let java = if java.is_file() {
        java
    } else {
        javaw.to_owned()
    };
    let installer_for_task = installer.clone();
    let runtime_for_task = runtime.root.clone();
    let output = tokio::task::spawn_blocking(move || {
        let mut command = Command::new(java);
        #[cfg(windows)]
        command.creation_flags(CREATE_NO_WINDOW);
        command
            .arg("-jar")
            .arg(installer_for_task)
            .arg("--installClient")
            .arg(&runtime_for_task)
            .current_dir(runtime_for_task)
            .output()
    })
    .await
    .map_err(|_| "The Forge installer stopped unexpectedly.".to_owned())?
    .map_err(|_| "The Forge installer could not be started.".to_owned())?;
    if !output.status.success() {
        let output_text = format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let detail = output_text
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("No installer details were returned.");
        return Err(format!("Forge installation failed: {}", detail.trim()));
    }

    let bytes = tokio::fs::read(&profile_path)
        .await
        .map_err(|_| "Forge installed without creating a launch profile.".to_owned())?;
    let profile: VersionMetadata = serde_json::from_slice(&bytes)
        .map_err(|_| "Forge created an invalid launch profile.".to_owned())?;
    if profile.id != forge.profile_id
        || profile.inherits_from.as_deref() != Some(game_version)
        || profile.main_class.is_empty()
    {
        return Err("Forge created an incompatible launch profile.".to_owned());
    }
    Ok(profile)
}

fn merge_loader_profile(mut vanilla: VersionMetadata, profile: VersionMetadata) -> VersionMetadata {
    if !profile.id.is_empty() {
        vanilla.id = profile.id;
    }
    if !profile.main_class.is_empty() {
        vanilla.main_class = profile.main_class;
    }
    let profile_library_keys = profile
        .libraries
        .iter()
        .map(|library| {
            library
                .name
                .split(':')
                .take(2)
                .collect::<Vec<_>>()
                .join(":")
        })
        .collect::<HashSet<_>>();
    vanilla.libraries.retain(|library| {
        let key = library
            .name
            .split(':')
            .take(2)
            .collect::<Vec<_>>()
            .join(":");
        !profile_library_keys.contains(&key)
    });
    vanilla.libraries.extend(profile.libraries);
    if let Some(profile_arguments) = profile.arguments {
        let vanilla_arguments = vanilla
            .arguments
            .get_or_insert_with(LaunchArguments::default);
        vanilla_arguments.game.extend(profile_arguments.game);
        vanilla_arguments.jvm.extend(profile_arguments.jvm);
    }
    if let Some(profile_arguments) = profile.minecraft_arguments {
        let merged = match vanilla.minecraft_arguments.take() {
            Some(vanilla_arguments) => format!("{vanilla_arguments} {profile_arguments}"),
            None => profile_arguments,
        };
        vanilla.minecraft_arguments = Some(merged);
    }
    vanilla
}

fn uses_modular_loader(metadata: &VersionMetadata) -> bool {
    metadata.main_class == "cpw.mods.bootstraplauncher.BootstrapLauncher"
}

async fn prepare_assets(
    app: &AppHandle,
    download_id: &str,
    client: &reqwest::Client,
    runtime: &RuntimeDirectories,
    asset_index: &AssetIndexReference,
) -> Result<String, String> {
    let index_path = runtime
        .assets
        .join("indexes")
        .join(format!("{}.json", asset_index.id));
    ensure_download(
        client,
        &FileDownload {
            url: asset_index.url.clone(),
            path: index_path.clone(),
            sha1: Some(asset_index.sha1.clone()),
            size: Some(asset_index.size),
        },
    )
    .await?;
    let index_bytes = tokio::fs::read(index_path)
        .await
        .map_err(|_| "The Minecraft asset index could not be read.".to_owned())?;
    let index: AssetIndex = serde_json::from_slice(&index_bytes)
        .map_err(|_| "The Minecraft asset index is invalid.".to_owned())?;
    let total = index.objects.len().max(1);
    let mut tasks = JoinSet::new();
    let mut completed = 0usize;

    for object in index.objects.into_values() {
        if object.hash.len() < 2
            || !object
                .hash
                .chars()
                .all(|character| character.is_ascii_hexdigit())
        {
            return Err("The Minecraft asset index contains an invalid hash.".to_owned());
        }
        let prefix = &object.hash[..2];
        let download = FileDownload {
            url: format!("{ASSET_OBJECT_URL}/{prefix}/{}", object.hash),
            path: runtime
                .assets
                .join("objects")
                .join(prefix)
                .join(&object.hash),
            sha1: Some(object.hash),
            size: Some(object.size),
        };
        let task_client = client.clone();
        tasks.spawn(async move { ensure_download(&task_client, &download).await });

        if tasks.len() >= ASSET_DOWNLOAD_CONCURRENCY {
            let result = tasks
                .join_next()
                .await
                .ok_or_else(|| "An asset download task disappeared.".to_owned())?
                .map_err(|_| "An asset download task stopped unexpectedly.".to_owned())?;
            result?;
            completed += 1;
            if completed % 25 == 0 || completed == total {
                emit_download_progress(
                    app,
                    download_id,
                    (45 + completed * 38 / total).min(83) as u8,
                    format!("Checking assets {completed} of {total}"),
                );
            }
        }
    }
    while let Some(result) = tasks.join_next().await {
        result.map_err(|_| "An asset download task stopped unexpectedly.".to_owned())??;
        completed += 1;
        if completed % 25 == 0 || completed == total {
            emit_download_progress(
                app,
                download_id,
                (45 + completed * 38 / total).min(83) as u8,
                format!("Checking assets {completed} of {total}"),
            );
        }
    }
    Ok(asset_index.id.clone())
}

fn extract_native_archive(archive: &Path, destination: &Path) -> Result<(), String> {
    let system_root = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    let tar = system_root.join("System32").join("tar.exe");
    let mut command = Command::new(tar);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command
        .args(["-xf"])
        .arg(archive)
        .arg("-C")
        .arg(destination)
        .output()
        .map_err(|_| "Windows archive support could not extract Minecraft natives.".to_owned())?;
    output
        .status
        .success()
        .then_some(())
        .ok_or_else(|| "A Minecraft native library could not be extracted.".to_owned())
}

async fn prepare_runtime(
    app: &AppHandle,
    download_id: &str,
    game_version: &str,
    loader: &str,
    client: &reqwest::Client,
) -> Result<PreparedRuntime, String> {
    let runtime = runtime_directories(app, game_version)?;
    for folder in [
        &runtime.root,
        &runtime.versions,
        &runtime.libraries,
        &runtime.assets,
        &runtime.log_configs,
    ] {
        tokio::fs::create_dir_all(folder)
            .await
            .map_err(|_| "A Minecraft runtime folder could not be created.".to_owned())?;
    }

    emit_download_progress(app, download_id, 5, "Reading Minecraft version metadata");
    let manifest: VersionManifest = fetch_json(client, VERSION_MANIFEST_URL).await?;
    let version = manifest
        .versions
        .into_iter()
        .find(|version| version.id == game_version)
        .ok_or_else(|| format!("Minecraft version {game_version} was not found."))?;
    let version_json = fetch_bytes(client, &version.url, MAX_METADATA_BYTES).await?;
    if !verify_bytes(&version_json, Some(&version.sha1), None) {
        return Err("Minecraft version metadata failed its integrity check.".to_owned());
    }
    let version_directory = runtime.versions.join(game_version);
    tokio::fs::create_dir_all(&version_directory)
        .await
        .map_err(|_| "The Minecraft version folder could not be created.".to_owned())?;
    tokio::fs::write(
        version_directory.join(format!("{game_version}.json")),
        &version_json,
    )
    .await
    .map_err(|_| "Minecraft version metadata could not be saved.".to_owned())?;
    let vanilla: VersionMetadata = serde_json::from_slice(&version_json)
        .map_err(|_| "Minecraft version metadata is invalid.".to_owned())?;
    let client_download = vanilla
        .downloads
        .as_ref()
        .map(|downloads| &downloads.client)
        .ok_or_else(|| "Minecraft client download metadata is missing.".to_owned())?;
    let client_jar = version_directory.join(format!("{game_version}.jar"));
    emit_download_progress(app, download_id, 12, "Checking Minecraft client");
    ensure_download(
        client,
        &FileDownload {
            url: client_download.url.clone(),
            path: client_jar.clone(),
            sha1: client_download.sha1.clone(),
            size: client_download.size,
        },
    )
    .await?;

    let normalized_loader = loader.to_ascii_lowercase();
    let metadata = if normalized_loader == "fabric" {
        emit_download_progress(app, download_id, 8, "Resolving Fabric Loader");
        merge_loader_profile(vanilla, resolve_fabric_profile(client, game_version).await?)
    } else if normalized_loader == "forge" {
        emit_download_progress(app, download_id, 15, "Resolving Forge");
        let required_java = vanilla
            .java_version
            .as_ref()
            .map(|version| version.major_version)
            .unwrap_or(8);
        let java = match find_java(required_java) {
            Ok(java) => java,
            Err(_) => ensure_java_runtime(app, download_id, client, required_java).await?,
        };
        let forge =
            ensure_forge_profile(app, download_id, client, &runtime, &java, game_version).await?;
        merge_loader_profile(vanilla, forge)
    } else if normalized_loader == "vanilla" {
        vanilla
    } else {
        return Err(format!(
            "{loader} launching is not ready yet. Use Vanilla, Fabric or Forge for this build."
        ));
    };

    let active_libraries = metadata
        .libraries
        .iter()
        .filter(|library| rules_allow(&library.rules))
        .collect::<Vec<_>>();
    let mut classpath = Vec::new();
    let mut native_archives = Vec::new();
    for (index, library) in active_libraries.iter().enumerate() {
        let artifact = maven_artifact(library)?;
        let download = file_download(&artifact, &runtime.libraries)?;
        ensure_download(client, &download).await?;
        classpath.push(download.path);

        if let Some(native) = native_artifact(library) {
            let native_download = file_download(&native, &runtime.libraries)?;
            ensure_download(client, &native_download).await?;
            native_archives.push(native_download.path);
        }
        if index % 8 == 0 || index + 1 == active_libraries.len() {
            emit_download_progress(
                app,
                download_id,
                (15 + (index + 1) * 28 / active_libraries.len().max(1)).min(43) as u8,
                format!(
                    "Checking libraries {} of {}",
                    index + 1,
                    active_libraries.len()
                ),
            );
        }
    }
    // Modern Forge discovers its transformed Minecraft client itself. Adding
    // the vanilla client JAR to BootstrapLauncher's classpath creates a second
    // automatic Java module and makes Forge fail before any mods are loaded.
    if !uses_modular_loader(&metadata) {
        classpath.push(client_jar.clone());
    }

    let asset_index = metadata
        .asset_index
        .as_ref()
        .ok_or_else(|| "Minecraft asset metadata is missing.".to_owned())?;
    let asset_index_name = prepare_assets(app, download_id, client, &runtime, asset_index).await?;

    emit_download_progress(app, download_id, 86, "Preparing native libraries");
    let _ = tokio::fs::remove_dir_all(&runtime.natives).await;
    tokio::fs::create_dir_all(&runtime.natives)
        .await
        .map_err(|_| "The native library folder could not be created.".to_owned())?;
    for archive in native_archives {
        extract_native_archive(&archive, &runtime.natives)?;
    }

    let logging_argument = if let Some(logging) = metadata
        .logging
        .as_ref()
        .and_then(|logging| logging.client.as_ref())
    {
        let path = runtime.log_configs.join(&logging.file.id);
        ensure_download(
            client,
            &FileDownload {
                url: logging.file.url.clone(),
                path: path.clone(),
                sha1: Some(logging.file.sha1.clone()),
                size: Some(logging.file.size),
            },
        )
        .await?;
        Some(logging.argument.replace("${path}", &path.to_string_lossy()))
    } else {
        None
    };

    Ok(PreparedRuntime {
        required_java: metadata
            .java_version
            .as_ref()
            .map(|version| version.major_version)
            .unwrap_or(8),
        version_id: if metadata.id.is_empty() {
            game_version.to_owned()
        } else {
            metadata.id.clone()
        },
        metadata,
        classpath,
        libraries: runtime.libraries,
        natives: runtime.natives,
        assets: runtime.assets,
        asset_index_name,
        logging_argument,
    })
}

fn collect_java_executables(root: &Path, depth: usize, candidates: &mut Vec<PathBuf>) {
    if depth == 0 || !root.is_dir() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if path.is_file() && path.file_name() == Some(OsStr::new("javaw.exe")) {
            candidates.push(path);
        } else if path.is_dir() {
            collect_java_executables(&path, depth - 1, candidates);
        }
    }
}

fn java_major(javaw: &Path) -> Option<u32> {
    let java = javaw.with_file_name("java.exe");
    let mut command = Command::new(if java.is_file() {
        java
    } else {
        javaw.to_owned()
    });
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.arg("-version").output().ok()?;
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stderr),
        String::from_utf8_lossy(&output.stdout)
    );
    let version = text.split('"').nth(1)?;
    let first = version.split('.').next()?.parse::<u32>().ok()?;
    if first == 1 {
        version.split('.').nth(1)?.parse().ok()
    } else {
        Some(first)
    }
}

fn find_java(required_major: u32) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("ASTER_JAVA_PATH").map(PathBuf::from) {
        candidates.push(path);
    }
    if let Some(java_home) = std::env::var_os("JAVA_HOME").map(PathBuf::from) {
        candidates.push(java_home.join("bin").join("javaw.exe"));
    }
    if let Some(app_data) = std::env::var_os("APPDATA").map(PathBuf::from) {
        collect_java_executables(
            &app_data.join(".minecraft").join("runtime"),
            8,
            &mut candidates,
        );
    }
    if let Some(program_files) = std::env::var_os("ProgramFiles").map(PathBuf::from) {
        for folder in ["Eclipse Adoptium", "Java", "Minecraft Launcher"] {
            collect_java_executables(&program_files.join(folder), 7, &mut candidates);
        }
    }
    if let Some(program_files_x86) = std::env::var_os("ProgramFiles(x86)").map(PathBuf::from) {
        collect_java_executables(
            &program_files_x86.join("Minecraft Launcher"),
            8,
            &mut candidates,
        );
    }
    if let Some(local_data) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        collect_java_executables(
            &local_data.join("Programs").join("Eclipse Adoptium"),
            6,
            &mut candidates,
        );
    }

    let mut where_command = Command::new("where.exe");
    #[cfg(windows)]
    where_command.creation_flags(CREATE_NO_WINDOW);
    if let Ok(output) = where_command.arg("javaw.exe").output() {
        candidates.extend(
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(PathBuf::from),
        );
    }
    candidates.sort();
    candidates.dedup();
    candidates
        .into_iter()
        .filter(|path| path.is_file())
        .find(|path| java_major(path) == Some(required_major))
        .ok_or_else(|| {
            format!(
                "Minecraft requires Java {required_major}. Install Eclipse Temurin {required_major} or the official Minecraft Launcher runtime."
            )
        })
}

fn java_runtime_component(required_major: u32) -> Result<&'static str, String> {
    match required_major {
        8 => Ok("jre-legacy"),
        16 => Ok("java-runtime-alpha"),
        17 => Ok("java-runtime-gamma"),
        21 => Ok("java-runtime-delta"),
        25 => Ok("java-runtime-epsilon"),
        _ => Err(format!(
            "Minecraft requires Java {required_major}, but Mojang does not provide that runtime."
        )),
    }
}

async fn ensure_java_runtime(
    app: &AppHandle,
    download_id: &str,
    client: &reqwest::Client,
    required_major: u32,
) -> Result<PathBuf, String> {
    let component = java_runtime_component(required_major)?;
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "The launcher data folder is unavailable.".to_owned())?
        .join("minecraft")
        .join("runtime")
        .join(component);
    let javaw = root.join("bin").join("javaw.exe");
    if javaw.is_file() && java_major(&javaw) == Some(required_major) {
        return Ok(javaw);
    }

    emit_download_progress(
        app,
        download_id,
        88,
        format!("Downloading Mojang Java {required_major} runtime"),
    );
    let catalog: HashMap<String, HashMap<String, Vec<JavaRuntimeEntry>>> =
        fetch_json(client, JAVA_RUNTIME_CATALOG_URL).await?;
    let platform = if cfg!(target_arch = "x86") {
        "windows-x86"
    } else if cfg!(target_arch = "aarch64") {
        "windows-arm64"
    } else {
        "windows-x64"
    };
    let entry = catalog
        .get(platform)
        .and_then(|runtimes| runtimes.get(component))
        .and_then(|entries| entries.first())
        .ok_or_else(|| format!("Mojang does not provide Java {required_major} for this PC."))?;
    let manifest_bytes = fetch_bytes(client, &entry.manifest.url, MAX_METADATA_BYTES).await?;
    if !verify_bytes(
        &manifest_bytes,
        Some(&entry.manifest.sha1),
        Some(entry.manifest.size),
    ) {
        return Err("The Mojang Java runtime manifest failed its integrity check.".to_owned());
    }
    let manifest: JavaRuntimeManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|_| "Mojang returned an invalid Java runtime manifest.".to_owned())?;
    let total = manifest
        .files
        .values()
        .filter(|file| file.kind == "file")
        .count()
        .max(1);
    let mut tasks = JoinSet::new();
    let mut completed = 0usize;

    for (relative, file) in manifest.files {
        let path = root.join(safe_relative_path(&relative)?);
        match file.kind.as_str() {
            "directory" => {
                tokio::fs::create_dir_all(path)
                    .await
                    .map_err(|_| "A Java runtime folder could not be created.".to_owned())?;
            }
            "file" => {
                let raw = file
                    .downloads
                    .ok_or_else(|| "A Java runtime file has no download.".to_owned())?
                    .raw;
                let download = FileDownload {
                    url: raw.url,
                    path,
                    sha1: raw.sha1,
                    size: raw.size,
                };
                let task_client = client.clone();
                tasks.spawn(async move { ensure_download(&task_client, &download).await });

                if tasks.len() >= ASSET_DOWNLOAD_CONCURRENCY {
                    tasks
                        .join_next()
                        .await
                        .ok_or_else(|| "A Java download task disappeared.".to_owned())?
                        .map_err(|_| "A Java download task stopped unexpectedly.".to_owned())??;
                    completed += 1;
                    if completed % 20 == 0 || completed == total {
                        emit_download_progress(
                            app,
                            download_id,
                            (88 + completed * 9 / total).min(97) as u8,
                            format!(
                                "Installing Java {required_major}: {completed} of {total} files"
                            ),
                        );
                    }
                }
            }
            _ => {
                return Err("The Mojang Java runtime contains an unsupported entry.".to_owned());
            }
        }
    }
    while let Some(result) = tasks.join_next().await {
        result.map_err(|_| "A Java download task stopped unexpectedly.".to_owned())??;
        completed += 1;
        if completed % 20 == 0 || completed == total {
            emit_download_progress(
                app,
                download_id,
                (88 + completed * 9 / total).min(97) as u8,
                format!("Installing Java {required_major}: {completed} of {total} files"),
            );
        }
    }

    if !javaw.is_file() || java_major(&javaw) != Some(required_major) {
        return Err(format!(
            "The downloaded Mojang Java {required_major} runtime could not be verified."
        ));
    }
    Ok(javaw)
}

fn expand_argument(value: String, replacements: &HashMap<&str, String>) -> String {
    replacements
        .iter()
        .fold(value, |current, (key, replacement)| {
            current.replace(key, replacement)
        })
}

fn build_launch_arguments(
    prepared: &PreparedRuntime,
    account: &StoredAccount,
    instance_directory: &Path,
    client_id: &str,
    memory_gb: u8,
) -> (Vec<String>, Vec<String>) {
    let classpath = std::env::join_paths(&prepared.classpath)
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let mut replacements = HashMap::new();
    replacements.insert("${auth_player_name}", account.account.username.clone());
    replacements.insert("${version_name}", prepared.version_id.clone());
    replacements.insert(
        "${game_directory}",
        instance_directory.to_string_lossy().into_owned(),
    );
    replacements.insert(
        "${assets_root}",
        prepared.assets.to_string_lossy().into_owned(),
    );
    replacements.insert("${assets_index_name}", prepared.asset_index_name.clone());
    replacements.insert("${auth_uuid}", account.account.id.clone());
    replacements.insert(
        "${auth_access_token}",
        account.minecraft_access_token.clone(),
    );
    replacements.insert("${auth_session}", account.minecraft_access_token.clone());
    replacements.insert("${user_type}", "msa".to_owned());
    replacements.insert("${version_type}", "release".to_owned());
    replacements.insert(
        "${natives_directory}",
        prepared.natives.to_string_lossy().into_owned(),
    );
    replacements.insert("${launcher_name}", "AsterLauncher".to_owned());
    replacements.insert("${launcher_version}", env!("CARGO_PKG_VERSION").to_owned());
    replacements.insert("${classpath}", classpath);
    replacements.insert(
        "${library_directory}",
        prepared.libraries.to_string_lossy().into_owned(),
    );
    replacements.insert("${classpath_separator}", ";".to_owned());
    replacements.insert("${user_properties}", "{}".to_owned());
    replacements.insert("${auth_xuid}", String::new());
    replacements.insert("${clientid}", client_id.to_owned());

    let memory_gb = memory_gb.clamp(2, 24);
    let mut jvm = vec![
        "-Xms512M".to_owned(),
        format!("-Xmx{}M", u32::from(memory_gb) * 1024),
    ];
    let mut game = Vec::new();
    if let Some(arguments) = &prepared.metadata.arguments {
        jvm.extend(
            evaluate_arguments(&arguments.jvm)
                .into_iter()
                .map(|argument| expand_argument(argument, &replacements)),
        );
        game.extend(
            evaluate_arguments(&arguments.game)
                .into_iter()
                .map(|argument| expand_argument(argument, &replacements)),
        );
    } else if let Some(arguments) = &prepared.metadata.minecraft_arguments {
        game.extend(
            arguments
                .split_whitespace()
                .map(|argument| expand_argument(argument.to_owned(), &replacements)),
        );
    }
    if !jvm
        .iter()
        .any(|argument| argument == "-cp" || argument == "-classpath")
    {
        jvm.push("-cp".to_owned());
        jvm.push(
            replacements
                .get("${classpath}")
                .cloned()
                .unwrap_or_default(),
        );
    }
    if !jvm
        .iter()
        .any(|argument| argument.starts_with("-Djava.library.path="))
    {
        jvm.push(format!(
            "-Djava.library.path={}",
            prepared.natives.to_string_lossy()
        ));
    }
    jvm.push("-Dminecraft.launcher.brand=AsterLauncher".to_owned());
    jvm.push(format!(
        "-Dminecraft.launcher.version={}",
        env!("CARGO_PKG_VERSION")
    ));
    if let Some(logging_argument) = &prepared.logging_argument {
        jvm.push(logging_argument.clone());
    }
    (jvm, game)
}

#[tauri::command]
pub async fn list_minecraft_versions() -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .user_agent(format!("AsterLauncher/{}", env!("CARGO_PKG_VERSION")))
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|_| "The Minecraft version client could not be created.".to_owned())?;
    let manifest: VersionManifest = fetch_json(&client, VERSION_MANIFEST_URL).await?;
    let versions = manifest
        .versions
        .into_iter()
        .filter(|version| version.kind.eq_ignore_ascii_case("release"))
        .map(|version| version.id)
        .collect::<Vec<_>>();
    if versions.is_empty() {
        return Err("Minecraft returned no release versions.".to_owned());
    }
    Ok(versions)
}

#[tauri::command]
pub async fn launch_instance(
    app: AppHandle,
    auth: State<'_, AuthState>,
    instance_id: String,
    game_version: String,
    loader: String,
    memory_gb: u8,
) -> Result<LaunchStarted, String> {
    validate_instance_id(&instance_id)?;
    if game_version.trim().is_empty() {
        return Err("Choose a Minecraft version before launching.".to_owned());
    }
    let download_id = format!("launch-{instance_id}");
    emit_launch_status(
        &app,
        &instance_id,
        "preparing",
        "Preparing Minecraft runtime",
        None,
    );
    emit_download_progress(&app, &download_id, 1, "Checking account session");
    let account = auth
        .service
        .active_for_launch()
        .await
        .map_err(|error| AuthErrorPayload::from(error).message.to_owned())?;
    if !account.account.owns_java {
        return Err("This account does not own Minecraft Java Edition.".to_owned());
    }

    let client = reqwest::Client::builder()
        .user_agent(format!("AsterLauncher/{}", env!("CARGO_PKG_VERSION")))
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|_| "The Minecraft download client could not be created.".to_owned())?;
    let prepared = prepare_runtime(&app, &download_id, &game_version, &loader, &client)
        .await
        .inspect_err(|error| {
            emit_launch_status(&app, &instance_id, "failed", error, None);
        })?;

    emit_download_progress(
        &app,
        &download_id,
        88,
        format!("Finding Java {}", prepared.required_java),
    );
    let java = match find_java(prepared.required_java) {
        Ok(java) => java,
        Err(_) => ensure_java_runtime(&app, &download_id, &client, prepared.required_java)
            .await
            .inspect_err(|error| {
                emit_launch_status(&app, &instance_id, "failed", error, None);
            })?,
    };
    let instance_directory = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "The launcher data folder is unavailable.".to_owned())?
        .join("instances")
        .join(&instance_id);
    tokio::fs::create_dir_all(&instance_directory)
        .await
        .map_err(|_| "The instance folder could not be created.".to_owned())?;
    let (jvm_arguments, game_arguments) = build_launch_arguments(
        &prepared,
        &account,
        &instance_directory,
        auth.service.client_id().unwrap_or_default(),
        memory_gb,
    );

    let logs = instance_directory.join("logs");
    tokio::fs::create_dir_all(&logs)
        .await
        .map_err(|_| "The Minecraft log folder could not be created.".to_owned())?;
    let log_path = logs.join("latest-aster-launch.log");
    let stdout = File::create(&log_path)
        .map_err(|_| "The Minecraft log file could not be created.".to_owned())?;
    let stderr = stdout
        .try_clone()
        .map_err(|_| "The Minecraft log file could not be opened.".to_owned())?;

    emit_download_progress(&app, &download_id, 98, "Starting Minecraft");
    let mut command = Command::new(java);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let mut child = command
        .args(jvm_arguments)
        .arg(&prepared.metadata.main_class)
        .args(game_arguments)
        .current_dir(&instance_directory)
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()
        .map_err(|_| "Minecraft could not be started.".to_owned())?;
    let pid = child.id();
    emit_download_progress(&app, &download_id, 100, "Minecraft is running");
    emit_launch_status(&app, &instance_id, "running", "Minecraft is running", None);

    let event_app = app.clone();
    let event_instance_id = instance_id.clone();
    tauri::async_runtime::spawn(async move {
        let status = tauri::async_runtime::spawn_blocking(move || child.wait()).await;
        match status {
            Ok(Ok(status)) => {
                let code = status.code();
                let detail = if status.success() {
                    "Minecraft closed normally"
                } else {
                    "Minecraft closed with an error. Check the instance log."
                };
                emit_launch_status(&event_app, &event_instance_id, "exited", detail, code);
            }
            _ => emit_launch_status(
                &event_app,
                &event_instance_id,
                "failed",
                "Minecraft process monitoring stopped unexpectedly",
                None,
            ),
        }
    });

    Ok(LaunchStarted {
        pid,
        version_id: prepared.version_id,
        loader,
        log_path: log_path.to_string_lossy().into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        build_launch_arguments, parse_forge_versions, safe_relative_path, sha1_hex,
        uses_modular_loader, verify_bytes, PreparedRuntime, VersionMetadata,
    };
    use crate::models::account::{PublicAccount, SessionState, StoredAccount};
    use std::path::PathBuf;

    #[test]
    fn rejects_unsafe_runtime_paths() {
        assert!(safe_relative_path("com/example/library/1.0/library.jar").is_ok());
        assert!(safe_relative_path("../outside.jar").is_err());
        assert!(safe_relative_path("C:\\outside.jar").is_err());
    }

    #[test]
    fn verifies_mojang_sha1_hashes() {
        let hash = sha1_hex(b"aster");
        assert!(verify_bytes(b"aster", Some(&hash), Some(5)));
        assert!(!verify_bytes(b"changed", Some(&hash), None));
    }

    #[test]
    fn selects_only_clean_forge_versions_for_requested_minecraft() {
        let metadata = r#"
            <metadata><versioning><versions>
              <version>1.20.1-47.3.0</version>
              <version>1.20.1-47.4.10</version>
              <version>1.20.2-48.0.1</version>
              <version>1.20.1-47.4.10_mapped_official</version>
            </versions></versioning></metadata>
        "#;
        assert_eq!(
            parse_forge_versions(metadata, "1.20.1"),
            vec!["1.20.1-47.3.0", "1.20.1-47.4.10"]
        );
    }

    #[test]
    fn recognizes_modular_forge_launcher_that_must_not_receive_the_client_jar() {
        assert!(uses_modular_loader(&VersionMetadata {
            main_class: "cpw.mods.bootstraplauncher.BootstrapLauncher".to_owned(),
            ..VersionMetadata::default()
        }));
        assert!(!uses_modular_loader(&VersionMetadata {
            main_class: "net.minecraft.client.main.Main".to_owned(),
            ..VersionMetadata::default()
        }));
    }

    #[test]
    fn launch_arguments_expand_tokens_without_returning_them_to_frontend() {
        let prepared = PreparedRuntime {
            metadata: VersionMetadata {
                id: "1.21.1".to_owned(),
                main_class: "example.Main".to_owned(),
                minecraft_arguments: Some(
                    "--username ${auth_player_name} --accessToken ${auth_access_token}".to_owned(),
                ),
                ..VersionMetadata::default()
            },
            version_id: "1.21.1".to_owned(),
            classpath: vec![PathBuf::from("client.jar")],
            libraries: PathBuf::from("libraries"),
            natives: PathBuf::from("natives"),
            assets: PathBuf::from("assets"),
            asset_index_name: "17".to_owned(),
            logging_argument: None,
            required_java: 21,
        };
        let account = StoredAccount {
            account: PublicAccount {
                id: "uuid".to_owned(),
                username: "AsterPlayer".to_owned(),
                skin_path: None,
                owns_java: true,
                session_state: SessionState::Active,
            },
            microsoft_refresh_token: "refresh-secret".to_owned(),
            minecraft_access_token: "minecraft-secret".to_owned(),
            minecraft_expires_at: 1,
            updated_at: 1,
        };
        let (jvm, game) = build_launch_arguments(
            &prepared,
            &account,
            PathBuf::from("instance").as_path(),
            "id",
            6,
        );
        assert!(game.iter().any(|value| value == "AsterPlayer"));
        assert!(game.iter().any(|value| value == "minecraft-secret"));
        assert!(!game.iter().any(|value| value == "refresh-secret"));
        assert!(jvm.iter().any(|value| value == "-Xmx6144M"));
    }
}
