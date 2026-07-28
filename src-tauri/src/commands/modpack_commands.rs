use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
    process::Command,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha512};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

use super::instance_commands::{write_content_metadata_items, InstalledContentMetadata};

const MAX_ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_INSTALLED_BYTES: u64 = 12 * 1024 * 1024 * 1024;
const CURSEFORGE_FILES_API: &str = "https://api.curseforge.com/v1/mods/files";
const CURSEFORGE_MODS_API: &str = "https://api.curseforge.com/v1/mods";
const MODRINTH_PROJECTS_API: &str = "https://api.modrinth.com/v2/projects";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledModpackResult {
    name: String,
    version: String,
    game_version: String,
    loader: String,
    installed_files: usize,
}

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
) {
    let _ = app.emit(
        "download-progress",
        DownloadProgressEvent {
            id: download_id.to_owned(),
            progress,
            detail: detail.into(),
            speed: None,
            remaining: None,
        },
    );
}

#[derive(Debug, Deserialize)]
struct ModrinthIndex {
    name: String,
    #[serde(rename = "versionId")]
    version_id: String,
    dependencies: HashMap<String, String>,
    files: Vec<ModrinthFile>,
}

#[derive(Debug, Deserialize)]
struct ModrinthFile {
    path: String,
    hashes: HashMap<String, String>,
    env: Option<ModrinthEnvironment>,
    downloads: Vec<String>,
    #[serde(rename = "fileSize")]
    file_size: u64,
}

#[derive(Debug, Deserialize)]
struct ModrinthEnvironment {
    client: String,
}

#[derive(Debug, Deserialize)]
struct ModrinthProject {
    id: String,
    title: String,
    icon_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseForgeManifest {
    minecraft: CurseForgeMinecraft,
    name: String,
    version: String,
    files: Vec<CurseForgeManifestFile>,
    overrides: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseForgeMinecraft {
    version: String,
    mod_loaders: Vec<CurseForgeLoader>,
}

#[derive(Debug, Deserialize)]
struct CurseForgeLoader {
    id: String,
    primary: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseForgeManifestFile {
    project_id: u64,
    file_id: u64,
    required: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AsterPackManifest {
    format_version: u8,
    name: String,
    version: String,
    game_version: String,
    loader: String,
}

#[derive(Debug, Deserialize)]
struct CurseForgeFilesResponse {
    data: Vec<CurseForgeDownloadFile>,
}

#[derive(Debug, Deserialize)]
struct CurseForgeModsResponse {
    data: Vec<CurseForgeProject>,
}

#[derive(Debug, Deserialize)]
struct CurseForgeProject {
    id: u64,
    name: String,
    logo: Option<CurseForgeProjectLogo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseForgeProjectLogo {
    thumbnail_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseForgeDownloadFile {
    id: u64,
    file_name: String,
    download_url: Option<String>,
    file_length: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CurseForgeFilesRequest {
    file_ids: Vec<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CurseForgeModsRequest {
    mod_ids: Vec<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstanceMetadata<'a> {
    name: &'a str,
    version: &'a str,
    game_version: &'a str,
    loader: &'a str,
    provider: &'a str,
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

fn instances_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "The launcher data folder is unavailable.".to_owned())?
        .join("instances");
    std::fs::create_dir_all(&directory)
        .map_err(|_| "The instances folder could not be created.".to_owned())?;
    Ok(directory)
}

fn ensure_instance_structure(directory: &Path) -> Result<(), String> {
    for folder in [
        "mods",
        "resourcepacks",
        "shaderpacks",
        "datapacks",
        "saves",
        "screenshots",
    ] {
        std::fs::create_dir_all(directory.join(folder))
            .map_err(|_| "The modpack folders could not be created.".to_owned())?;
    }
    Ok(())
}

fn is_safe_relative_path(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && path
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
}

fn trusted_download_url(value: &str) -> Result<url::Url, String> {
    let url =
        url::Url::parse(value).map_err(|_| "A modpack download URL is invalid.".to_owned())?;
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let trusted = url.scheme() == "https"
        && (host == "cdn.modrinth.com"
            || host.ends_with(".modrinth.com")
            || host == "edge.forgecdn.net"
            || host.ends_with(".forgecdn.net")
            || host.ends_with(".curseforge.com"));
    if trusted {
        Ok(url)
    } else {
        Err("A modpack file uses an untrusted download host.".to_owned())
    }
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("AsterLauncher/0.1.0")
        .build()
        .map_err(|_| "The download client could not be prepared.".to_owned())
}

async fn download_bytes(
    client: &reqwest::Client,
    download_url: &str,
    maximum: u64,
) -> Result<Vec<u8>, String> {
    let url = trusted_download_url(download_url)?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|_| "The content provider could not be reached.".to_owned())?;
    if !response.status().is_success() {
        return Err(format!(
            "The content provider rejected a download (HTTP {}).",
            response.status().as_u16()
        ));
    }
    if response.content_length().unwrap_or_default() > maximum {
        return Err("A downloaded modpack file exceeds the safety limit.".to_owned());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "A downloaded modpack file could not be read.".to_owned())?;
    if bytes.len() as u64 > maximum {
        return Err("A downloaded modpack file exceeds the safety limit.".to_owned());
    }
    Ok(bytes.to_vec())
}

fn powershell_output(script: &str, arguments: &[&str]) -> Result<String, String> {
    let command = format!("& {{ {script} }}");
    let mut process = Command::new("powershell.exe");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        process.creation_flags(CREATE_NO_WINDOW);
    }
    let output = process
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &command,
        ])
        .args(arguments)
        .output()
        .map_err(|_| "Windows archive support could not be started.".to_owned())?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Err(if detail.is_empty() {
            "The modpack archive could not be processed.".to_owned()
        } else {
            format!("The modpack archive could not be processed: {detail}")
        });
    }
    String::from_utf8(output.stdout)
        .map_err(|_| "The modpack archive returned invalid text.".to_owned())
}

fn read_zip_text(archive: &Path, entry_name: &str) -> Result<Vec<u8>, String> {
    const SCRIPT: &str = r#"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($args[0])
try {
  $entry = $zip.GetEntry($args[1])
  if ($null -eq $entry) { throw "Required entry '$($args[1])' is missing." }
  if ($entry.Length -gt 536870912) { throw "The manifest is unexpectedly large." }
  $reader = New-Object IO.StreamReader($entry.Open(), [Text.Encoding]::UTF8, $true)
  try {
    [Console]::OutputEncoding = [Text.Encoding]::UTF8
    [Console]::Write($reader.ReadToEnd())
  } finally { $reader.Dispose() }
} finally { $zip.Dispose() }
"#;
    powershell_output(
        SCRIPT,
        &[
            archive
                .to_str()
                .ok_or_else(|| "The archive path is invalid.".to_owned())?,
            entry_name,
        ],
    )
    .map(String::into_bytes)
}

fn extract_prefix(
    archive: &Path,
    prefix: &str,
    destination: &Path,
    extracted_bytes: &mut u64,
) -> Result<usize, String> {
    let normalized_prefix = prefix.trim_matches('/').replace('\\', "/");
    if normalized_prefix.is_empty() {
        return Ok(0);
    }
    const SCRIPT: &str = r#"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archivePath = $args[0]
$destination = [IO.Path]::GetFullPath($args[1])
$prefix = $args[2].Trim('/').Replace('\', '/') + '/'
$root = $destination.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
$zip = [IO.Compression.ZipFile]::OpenRead($archivePath)
$count = 0
$total = [Int64]0
try {
  foreach ($entry in $zip.Entries) {
    $name = $entry.FullName.Replace('\', '/')
    if (-not $name.StartsWith($prefix, [StringComparison]::Ordinal)) { continue }
    $relative = $name.Substring($prefix.Length)
    if ([String]::IsNullOrWhiteSpace($relative) -or $relative.EndsWith('/')) { continue }
    $target = [IO.Path]::GetFullPath((Join-Path $destination $relative))
    if (-not $target.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
      throw "The archive contains an unsafe path."
    }
    $total += $entry.Length
    if ($total -gt 12884901888) { throw "The extracted files exceed 12 GB." }
    $parent = [IO.Path]::GetDirectoryName($target)
    [IO.Directory]::CreateDirectory($parent) | Out-Null
    $input = $entry.Open()
    $output = [IO.File]::Open($target, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $input.CopyTo($output) } finally { $output.Dispose(); $input.Dispose() }
    $count++
  }
} finally { $zip.Dispose() }
[Console]::Write("$count|$total")
"#;
    let output = powershell_output(
        SCRIPT,
        &[
            archive
                .to_str()
                .ok_or_else(|| "The archive path is invalid.".to_owned())?,
            destination
                .to_str()
                .ok_or_else(|| "The destination path is invalid.".to_owned())?,
            &normalized_prefix,
        ],
    )?;
    let (count, total) = output
        .trim()
        .split_once('|')
        .ok_or_else(|| "The archive extractor returned an invalid result.".to_owned())?;
    let count = count
        .parse::<usize>()
        .map_err(|_| "The archive file count is invalid.".to_owned())?;
    let total = total
        .parse::<u64>()
        .map_err(|_| "The archive size result is invalid.".to_owned())?;
    *extracted_bytes = extracted_bytes
        .checked_add(total)
        .ok_or_else(|| "The installed modpack is too large.".to_owned())?;
    if *extracted_bytes > MAX_INSTALLED_BYTES {
        return Err("The installed modpack exceeds the 12 GB safety limit.".to_owned());
    }
    Ok(count)
}

fn copy_export_tree(
    source: &Path,
    destination: &Path,
    copied_bytes: &mut u64,
    copied_files: &mut usize,
) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }
    std::fs::create_dir_all(destination)
        .map_err(|_| "The export staging folder could not be created.".to_owned())?;
    for entry in std::fs::read_dir(source)
        .map_err(|_| "An instance folder could not be read for export.".to_owned())?
    {
        let entry =
            entry.map_err(|_| "An instance file could not be read for export.".to_owned())?;
        let file_type = entry
            .file_type()
            .map_err(|_| "An instance file type could not be checked.".to_owned())?;
        if file_type.is_symlink() {
            continue;
        }
        let target = destination.join(entry.file_name());
        if file_type.is_dir() {
            copy_export_tree(&entry.path(), &target, copied_bytes, copied_files)?;
        } else if file_type.is_file() {
            let size = entry
                .metadata()
                .map_err(|_| "An instance file size could not be checked.".to_owned())?
                .len();
            *copied_bytes = copied_bytes
                .checked_add(size)
                .ok_or_else(|| "The exported modpack is too large.".to_owned())?;
            if *copied_bytes > MAX_INSTALLED_BYTES || *copied_files >= 50_000 {
                return Err("The exported modpack exceeds the safety limit.".to_owned());
            }
            std::fs::copy(entry.path(), target)
                .map_err(|_| "An instance file could not be copied for export.".to_owned())?;
            *copied_files += 1;
        }
    }
    Ok(())
}

async fn install_aster_pack(
    archive_path: &Path,
    destination: &Path,
) -> Result<InstalledModpackResult, String> {
    let manifest_bytes = read_zip_text(archive_path, "aster-pack.json")?;
    let manifest: AsterPackManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|_| "The Aster pack manifest is invalid.".to_owned())?;
    if manifest.format_version != 1
        || manifest.name.trim().is_empty()
        || manifest.game_version.trim().is_empty()
        || manifest.loader.trim().is_empty()
    {
        return Err("This Aster pack version is not supported.".to_owned());
    }
    let mut installed_bytes = 0_u64;
    let installed_files =
        extract_prefix(archive_path, "overrides", destination, &mut installed_bytes)?;
    Ok(InstalledModpackResult {
        name: manifest.name,
        version: manifest.version,
        game_version: manifest.game_version,
        loader: manifest.loader,
        installed_files,
    })
}

fn loader_from_dependencies(dependencies: &HashMap<String, String>) -> String {
    for (key, label) in [
        ("neoforge", "NeoForge"),
        ("forge", "Forge"),
        ("fabric-loader", "Fabric"),
        ("quilt-loader", "Quilt"),
    ] {
        if dependencies.contains_key(key) {
            return label.to_owned();
        }
    }
    "Vanilla".to_owned()
}

fn curseforge_loader(loaders: &[CurseForgeLoader]) -> String {
    let id = loaders
        .iter()
        .find(|loader| loader.primary)
        .or_else(|| loaders.first())
        .map(|loader| loader.id.to_ascii_lowercase())
        .unwrap_or_default();
    if id.starts_with("neoforge") {
        "NeoForge".to_owned()
    } else if id.starts_with("forge") {
        "Forge".to_owned()
    } else if id.starts_with("fabric") {
        "Fabric".to_owned()
    } else if id.starts_with("quilt") {
        "Quilt".to_owned()
    } else {
        "Vanilla".to_owned()
    }
}

fn lowercase_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

async fn write_download(
    client: &reqwest::Client,
    destination: &Path,
    download_url: &str,
    maximum: u64,
    expected_sha512: Option<&str>,
) -> Result<u64, String> {
    if !is_safe_relative_path(destination) && !destination.is_absolute() {
        return Err("The modpack contains an unsafe file path.".to_owned());
    }
    let bytes = download_bytes(client, download_url, maximum).await?;
    if let Some(expected) = expected_sha512 {
        let actual = lowercase_hex(&Sha512::digest(&bytes));
        if !actual.eq_ignore_ascii_case(expected) {
            return Err("A downloaded modpack file failed its integrity check.".to_owned());
        }
    }
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|_| "A modpack directory could not be created.".to_owned())?;
    }
    let temporary = destination.with_extension(format!(
        "{}.part",
        destination
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
    ));
    tokio::fs::write(&temporary, &bytes)
        .await
        .map_err(|_| "A downloaded modpack file could not be saved.".to_owned())?;
    tokio::fs::rename(&temporary, destination)
        .await
        .map_err(|_| "A downloaded modpack file could not be installed.".to_owned())?;
    Ok(bytes.len() as u64)
}

fn content_location(path: &str) -> Option<(&'static str, String)> {
    let normalized = path.replace('\\', "/");
    let (folder, section) = [
        ("mods/", "mods"),
        ("resourcepacks/", "resourcepacks"),
        ("shaderpacks/", "shaders"),
        ("datapacks/", "datapacks"),
    ]
    .into_iter()
    .find(|(folder, _)| normalized.starts_with(folder))?;
    let file_name = normalized.strip_prefix(folder)?.rsplit('/').next()?;
    (!file_name.is_empty()).then(|| (section, file_name.to_owned()))
}

fn modrinth_download_identity(download_url: &str) -> Option<(String, String)> {
    let url = url::Url::parse(download_url).ok()?;
    let segments: Vec<_> = url.path_segments()?.collect();
    let project_index = segments.iter().position(|segment| *segment == "data")? + 1;
    let version_index = segments.iter().position(|segment| *segment == "versions")? + 1;
    Some((
        segments.get(project_index)?.to_string(),
        segments.get(version_index)?.to_string(),
    ))
}

async fn modrinth_projects(
    client: &reqwest::Client,
    project_ids: &[String],
) -> HashMap<String, ModrinthProject> {
    let mut projects = HashMap::new();
    for chunk in project_ids.chunks(50) {
        let Ok(ids) = serde_json::to_string(chunk) else {
            continue;
        };
        let Ok(response) = client
            .get(MODRINTH_PROJECTS_API)
            .query(&[("ids", ids)])
            .send()
            .await
        else {
            continue;
        };
        if !response.status().is_success() {
            continue;
        }
        let Ok(response) = response.json::<Vec<ModrinthProject>>().await else {
            continue;
        };
        for project in response {
            projects.insert(project.id.clone(), project);
        }
    }
    projects
}

async fn curseforge_projects(
    client: &reqwest::Client,
    api_key: &str,
    project_ids: &[u64],
) -> HashMap<u64, CurseForgeProject> {
    let mut projects = HashMap::new();
    for chunk in project_ids.chunks(50) {
        let Ok(response) = client
            .post(CURSEFORGE_MODS_API)
            .header("x-api-key", api_key)
            .json(&CurseForgeModsRequest {
                mod_ids: chunk.to_vec(),
            })
            .send()
            .await
        else {
            continue;
        };
        if !response.status().is_success() {
            continue;
        }
        let Ok(response) = response.json::<CurseForgeModsResponse>().await else {
            continue;
        };
        for project in response.data {
            projects.insert(project.id, project);
        }
    }
    projects
}

async fn install_modrinth(
    app: &AppHandle,
    download_id: &str,
    archive_path: &Path,
    destination: &Path,
    client: &reqwest::Client,
) -> Result<InstalledModpackResult, String> {
    let index_bytes = read_zip_text(archive_path, "modrinth.index.json")?;
    let index: ModrinthIndex = serde_json::from_slice(&index_bytes)
        .map_err(|_| "The Modrinth pack index is invalid.".to_owned())?;
    let game_version = index
        .dependencies
        .get("minecraft")
        .cloned()
        .ok_or_else(|| "The modpack does not declare a Minecraft version.".to_owned())?;
    let loader = loader_from_dependencies(&index.dependencies);
    let mut installed_bytes = 0_u64;
    let mut installed_files = 0_usize;
    let mut project_ids: Vec<String> = index
        .files
        .iter()
        .filter_map(|file| file.downloads.first())
        .filter_map(|url| modrinth_download_identity(url))
        .map(|(project_id, _)| project_id)
        .collect();
    project_ids.sort();
    project_ids.dedup();
    let projects = modrinth_projects(client, &project_ids).await;
    let mut content_metadata = Vec::new();
    let client_files = index
        .files
        .iter()
        .filter(|file| {
            !file
                .env
                .as_ref()
                .is_some_and(|environment| environment.client == "unsupported")
        })
        .count()
        .max(1);

    for file in &index.files {
        if file
            .env
            .as_ref()
            .is_some_and(|environment| environment.client == "unsupported")
        {
            continue;
        }
        let relative = Path::new(&file.path);
        if !is_safe_relative_path(relative) {
            return Err("The Modrinth pack contains an unsafe file path.".to_owned());
        }
        installed_bytes = installed_bytes
            .checked_add(file.file_size)
            .ok_or_else(|| "The installed modpack is too large.".to_owned())?;
        if installed_bytes > MAX_INSTALLED_BYTES {
            return Err("The installed modpack exceeds the 12 GB safety limit.".to_owned());
        }
        let download_url = file
            .downloads
            .first()
            .ok_or_else(|| "A required Modrinth file has no download URL.".to_owned())?;
        let actual_size = write_download(
            client,
            &destination.join(relative),
            download_url,
            file.file_size.max(1),
            file.hashes.get("sha512").map(String::as_str),
        )
        .await?;
        if actual_size != file.file_size {
            return Err("A downloaded Modrinth file has the wrong size.".to_owned());
        }
        if let (Some((section, file_name)), Some((project_id, release_id))) = (
            content_location(&file.path),
            modrinth_download_identity(download_url),
        ) {
            let project = projects.get(&project_id);
            let fallback_name = Path::new(&file_name)
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or(&file_name)
                .replace(['-', '_'], " ");
            content_metadata.push(InstalledContentMetadata {
                section: section.to_owned(),
                file_name,
                name: project
                    .map(|value| value.title.clone())
                    .unwrap_or(fallback_name),
                version: release_id.clone(),
                source: "Modrinth".to_owned(),
                project_id,
                release_id,
                icon_url: project.and_then(|value| value.icon_url.clone()),
            });
        }
        installed_files += 1;
        emit_download_progress(
            app,
            download_id,
            (15 + (installed_files * 78 / client_files)).min(93) as u8,
            format!("Installing file {installed_files} of {client_files}"),
        );
    }
    write_content_metadata_items(destination, content_metadata)?;
    installed_files +=
        extract_prefix(archive_path, "overrides", destination, &mut installed_bytes)?;
    installed_files += extract_prefix(
        archive_path,
        "client-overrides",
        destination,
        &mut installed_bytes,
    )?;

    Ok(InstalledModpackResult {
        name: index.name,
        version: index.version_id,
        game_version,
        loader,
        installed_files,
    })
}

async fn install_curseforge(
    app: &AppHandle,
    download_id: &str,
    archive_path: &Path,
    destination: &Path,
    client: &reqwest::Client,
) -> Result<InstalledModpackResult, String> {
    let manifest_bytes = read_zip_text(archive_path, "manifest.json")?;
    let manifest: CurseForgeManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|_| "The CurseForge pack manifest is invalid.".to_owned())?;
    let api_key = crate::content::curseforge_api_key().ok_or_else(|| {
        "CurseForge installation needs CURSEFORGE_API_KEY in the native launcher build.".to_owned()
    })?;
    let requested: Vec<&CurseForgeManifestFile> =
        manifest.files.iter().filter(|file| file.required).collect();
    let mut project_ids: Vec<u64> = requested.iter().map(|file| file.project_id).collect();
    project_ids.sort_unstable();
    project_ids.dedup();
    let projects = curseforge_projects(client, &api_key, &project_ids).await;
    let mut resolved = HashMap::new();
    for chunk in requested.chunks(50) {
        let response = client
            .post(CURSEFORGE_FILES_API)
            .header("x-api-key", &api_key)
            .json(&CurseForgeFilesRequest {
                file_ids: chunk.iter().map(|file| file.file_id).collect(),
            })
            .send()
            .await
            .map_err(|_| "CurseForge could not be reached.".to_owned())?;
        if !response.status().is_success() {
            return Err(format!(
                "CurseForge rejected the file list (HTTP {}).",
                response.status().as_u16()
            ));
        }
        let response: CurseForgeFilesResponse = response
            .json()
            .await
            .map_err(|_| "CurseForge returned an invalid file list.".to_owned())?;
        for file in response.data {
            resolved.insert(file.id, file);
        }
    }

    let mut installed_bytes = 0_u64;
    let mut installed_files = 0_usize;
    let mut content_metadata = Vec::new();
    let requested_count = requested.len().max(1);
    for requested_file in requested {
        let file = resolved
            .get(&requested_file.file_id)
            .ok_or_else(|| "CurseForge did not return a required modpack file.".to_owned())?;
        let download_url = file.download_url.as_deref().ok_or_else(|| {
            format!(
                "CurseForge does not permit automatic download of project {} file {}.",
                requested_file.project_id, requested_file.file_id
            )
        })?;
        installed_bytes = installed_bytes
            .checked_add(file.file_length)
            .ok_or_else(|| "The installed modpack is too large.".to_owned())?;
        if installed_bytes > MAX_INSTALLED_BYTES {
            return Err("The installed modpack exceeds the 12 GB safety limit.".to_owned());
        }
        write_download(
            client,
            &destination.join("mods").join(&file.file_name),
            download_url,
            file.file_length.max(1),
            None,
        )
        .await?;
        let project = projects.get(&requested_file.project_id);
        let fallback_name = Path::new(&file.file_name)
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or(&file.file_name)
            .replace(['-', '_'], " ");
        content_metadata.push(InstalledContentMetadata {
            section: "mods".to_owned(),
            file_name: file.file_name.clone(),
            name: project
                .map(|value| value.name.clone())
                .unwrap_or(fallback_name),
            version: requested_file.file_id.to_string(),
            source: "CurseForge".to_owned(),
            project_id: requested_file.project_id.to_string(),
            release_id: requested_file.file_id.to_string(),
            icon_url: project
                .and_then(|value| value.logo.as_ref())
                .map(|logo| logo.thumbnail_url.clone()),
        });
        installed_files += 1;
        emit_download_progress(
            app,
            download_id,
            (15 + (installed_files * 78 / requested_count)).min(93) as u8,
            format!("Installing file {installed_files} of {requested_count}"),
        );
    }
    write_content_metadata_items(destination, content_metadata)?;
    if let Some(overrides) = manifest.overrides.as_deref() {
        installed_files +=
            extract_prefix(archive_path, overrides, destination, &mut installed_bytes)?;
    }
    let loader = curseforge_loader(&manifest.minecraft.mod_loaders);

    Ok(InstalledModpackResult {
        name: manifest.name,
        version: manifest.version,
        game_version: manifest.minecraft.version,
        loader,
        installed_files,
    })
}

fn write_metadata(
    destination: &Path,
    result: &InstalledModpackResult,
    provider: &str,
) -> Result<(), String> {
    let metadata = InstanceMetadata {
        name: &result.name,
        version: &result.version,
        game_version: &result.game_version,
        loader: &result.loader,
        provider,
    };
    let bytes = serde_json::to_vec_pretty(&metadata)
        .map_err(|_| "The instance metadata could not be prepared.".to_owned())?;
    std::fs::write(destination.join("aster-instance.json"), bytes)
        .map_err(|_| "The instance metadata could not be saved.".to_owned())
}

#[tauri::command]
pub async fn install_modpack(
    app: AppHandle,
    instance_id: String,
    provider: String,
    download_url: String,
    download_id: String,
) -> Result<InstalledModpackResult, String> {
    validate_instance_id(&instance_id)?;
    let normalized_provider = provider.to_ascii_lowercase();
    if !matches!(normalized_provider.as_str(), "modrinth" | "curseforge") {
        return Err("This modpack provider is not supported.".to_owned());
    }

    let instances = instances_directory(&app)?;
    let target = instances.join(&instance_id);
    if target.exists() {
        return Err("An instance with this folder name already exists.".to_owned());
    }
    let staging = instances.join(format!(".{instance_id}-installing-{}", Uuid::new_v4()));
    std::fs::create_dir(&staging)
        .map_err(|_| "The temporary modpack folder could not be created.".to_owned())?;

    let installation = async {
        emit_download_progress(&app, &download_id, 2, "Downloading modpack archive");
        ensure_instance_structure(&staging)?;
        let client = http_client()?;
        let archive_bytes = download_bytes(&client, &download_url, MAX_ARCHIVE_BYTES).await?;
        emit_download_progress(&app, &download_id, 12, "Reading modpack manifest");
        let archive_path = staging.join(".aster-modpack-download");
        tokio::fs::write(&archive_path, archive_bytes)
            .await
            .map_err(|_| "The modpack archive could not be saved.".to_owned())?;
        let result = if normalized_provider == "modrinth" {
            install_modrinth(&app, &download_id, &archive_path, &staging, &client).await?
        } else {
            install_curseforge(&app, &download_id, &archive_path, &staging, &client).await?
        };
        emit_download_progress(&app, &download_id, 96, "Finalizing instance");
        tokio::fs::remove_file(&archive_path)
            .await
            .map_err(|_| "The temporary modpack archive could not be removed.".to_owned())?;
        write_metadata(&staging, &result, &provider)?;
        std::fs::rename(&staging, &target)
            .map_err(|_| "The completed modpack could not be added to the library.".to_owned())?;
        emit_download_progress(&app, &download_id, 100, "Installed successfully");
        Ok(result)
    }
    .await;

    if installation.is_err() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    installation
}

#[tauri::command]
pub async fn export_modpack(
    app: AppHandle,
    instance_id: String,
    name: String,
    version: String,
    game_version: String,
    loader: String,
    destination_path: String,
) -> Result<String, String> {
    validate_instance_id(&instance_id)?;
    if name.trim().is_empty()
        || name.len() > 120
        || version.len() > 80
        || game_version.trim().is_empty()
        || game_version.len() > 40
        || loader.trim().is_empty()
        || loader.len() > 40
    {
        return Err("The modpack export metadata is invalid.".to_owned());
    }
    let destination = PathBuf::from(destination_path);
    if destination.extension().and_then(|value| value.to_str()) != Some("zip") {
        return Err("Aster modpacks must be exported as a .zip file.".to_owned());
    }
    let parent = destination
        .parent()
        .filter(|path| path.is_dir())
        .ok_or_else(|| "The export destination folder is unavailable.".to_owned())?;
    let destination = parent.join(
        destination
            .file_name()
            .ok_or_else(|| "The export file name is invalid.".to_owned())?,
    );
    let instances = instances_directory(&app)?;
    let source = instances.join(&instance_id);
    if !source.is_dir() {
        return Err("The instance folder is unavailable.".to_owned());
    }
    let staging = instances.join(format!(".{instance_id}-exporting-{}", Uuid::new_v4()));
    let overrides = staging.join("overrides");
    std::fs::create_dir_all(&overrides)
        .map_err(|_| "The export staging folder could not be created.".to_owned())?;

    let export = (|| {
        let manifest = AsterPackManifest {
            format_version: 1,
            name,
            version,
            game_version,
            loader,
        };
        std::fs::write(
            staging.join("aster-pack.json"),
            serde_json::to_vec_pretty(&manifest)
                .map_err(|_| "The Aster pack manifest could not be prepared.".to_owned())?,
        )
        .map_err(|_| "The Aster pack manifest could not be saved.".to_owned())?;

        let mut copied_bytes = 0_u64;
        let mut copied_files = 0_usize;
        for folder in [
            "mods",
            "config",
            "defaultconfigs",
            "resourcepacks",
            "shaderpacks",
        ] {
            copy_export_tree(
                &source.join(folder),
                &overrides.join(folder),
                &mut copied_bytes,
                &mut copied_files,
            )?;
        }
        let metadata = source.join(".aster-content.json");
        if metadata.is_file() {
            std::fs::copy(metadata, overrides.join(".aster-content.json"))
                .map_err(|_| "The installed content metadata could not be exported.".to_owned())?;
        }

        if destination.exists() {
            std::fs::remove_file(&destination)
                .map_err(|_| "The existing export file could not be replaced.".to_owned())?;
        }
        let system_root = std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
        let mut process = Command::new(system_root.join("System32").join("tar.exe"));
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            process.creation_flags(CREATE_NO_WINDOW);
        }
        let output = process
            .args(["-a", "-cf"])
            .arg(&destination)
            .arg("-C")
            .arg(&staging)
            .args(["aster-pack.json", "overrides"])
            .output()
            .map_err(|_| "Windows archive support could not start the export.".to_owned())?;
        if !output.status.success() {
            return Err("The shareable modpack archive could not be created.".to_owned());
        }
        Ok(destination.to_string_lossy().into_owned())
    })();
    let _ = std::fs::remove_dir_all(&staging);
    export
}

#[tauri::command]
pub async fn import_modpack(
    app: AppHandle,
    instance_id: String,
    source_path: String,
    download_id: String,
) -> Result<InstalledModpackResult, String> {
    validate_instance_id(&instance_id)?;
    let source = PathBuf::from(source_path);
    let metadata = std::fs::metadata(&source)
        .map_err(|_| "The selected modpack archive is unavailable.".to_owned())?;
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !metadata.is_file()
        || metadata.len() > MAX_ARCHIVE_BYTES
        || !matches!(extension.as_str(), "mrpack" | "zip")
    {
        return Err("Choose a .mrpack or .zip archive smaller than 512 MB.".to_owned());
    }

    let instances = instances_directory(&app)?;
    let target = instances.join(&instance_id);
    if target.exists() {
        return Err("An instance with this folder name already exists.".to_owned());
    }
    let staging = instances.join(format!(".{instance_id}-importing-{}", Uuid::new_v4()));
    std::fs::create_dir(&staging)
        .map_err(|_| "The temporary modpack folder could not be created.".to_owned())?;

    let installation = async {
        emit_download_progress(&app, &download_id, 4, "Copying modpack archive");
        ensure_instance_structure(&staging)?;
        let archive_path = staging.join(".aster-modpack-download");
        tokio::fs::copy(&source, &archive_path)
            .await
            .map_err(|_| "The selected modpack archive could not be copied.".to_owned())?;
        let client = http_client()?;
        emit_download_progress(&app, &download_id, 12, "Reading modpack manifest");
        let (provider, result) = if read_zip_text(&archive_path, "aster-pack.json").is_ok() {
            ("Aster", install_aster_pack(&archive_path, &staging).await?)
        } else if read_zip_text(&archive_path, "modrinth.index.json").is_ok() {
            (
                "Modrinth",
                install_modrinth(&app, &download_id, &archive_path, &staging, &client).await?,
            )
        } else if read_zip_text(&archive_path, "manifest.json").is_ok() {
            (
                "CurseForge",
                install_curseforge(&app, &download_id, &archive_path, &staging, &client).await?,
            )
        } else {
            return Err(
                "This archive is not a supported Aster, Modrinth or CurseForge modpack.".to_owned(),
            );
        };
        tokio::fs::remove_file(&archive_path)
            .await
            .map_err(|_| "The temporary modpack archive could not be removed.".to_owned())?;
        write_metadata(&staging, &result, provider)?;
        std::fs::rename(&staging, &target)
            .map_err(|_| "The imported modpack could not be added to the library.".to_owned())?;
        emit_download_progress(&app, &download_id, 100, "Imported successfully");
        Ok(result)
    }
    .await;

    if installation.is_err() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    installation
}

#[cfg(test)]
mod tests {
    use super::{extract_prefix, is_safe_relative_path, read_zip_text};
    use std::{path::Path, process::Command};
    use uuid::Uuid;

    #[test]
    fn rejects_unsafe_instance_paths() {
        assert!(is_safe_relative_path(Path::new("mods/example.jar")));
        assert!(!is_safe_relative_path(Path::new("../outside.jar")));
        assert!(!is_safe_relative_path(Path::new("/absolute.jar")));
    }

    #[test]
    fn reads_and_extracts_windows_zip_archives() {
        let root = std::env::temp_dir().join(format!("aster-zip-test-{}", Uuid::new_v4()));
        let source = root.join("source");
        let destination = root.join("destination");
        let archive = root.join("test.mrpack");
        let zip_archive = root.join("test.zip");
        std::fs::create_dir_all(source.join("overrides/config")).expect("create source folders");
        std::fs::write(
            source.join("modrinth.index.json"),
            br#"{"formatVersion":1,"game":"minecraft"}"#,
        )
        .expect("write test manifest");
        std::fs::write(source.join("overrides/config/test.txt"), b"aster").expect("write override");

        let script = format!(
            "Compress-Archive -Path '{}\\*' -DestinationPath '{}' -Force",
            source.display(),
            zip_archive.display()
        );
        let status = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .status()
            .expect("start PowerShell");
        assert!(status.success());
        std::fs::rename(zip_archive, &archive).expect("rename archive");

        let manifest = read_zip_text(&archive, "modrinth.index.json").expect("read manifest");
        assert!(String::from_utf8(manifest)
            .expect("utf8 manifest")
            .contains("\"minecraft\""));
        let mut installed_bytes = 0;
        let count = extract_prefix(&archive, "overrides", &destination, &mut installed_bytes)
            .expect("extract overrides");
        assert_eq!(count, 1);
        assert_eq!(
            std::fs::read_to_string(destination.join("config/test.txt"))
                .expect("read extracted file"),
            "aster"
        );
        assert_eq!(installed_bytes, 5);
        let _ = std::fs::remove_dir_all(root);
    }
}
