use std::{
    collections::VecDeque,
    fs::{File, OpenOptions},
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream, UdpSocket},
    path::{Component, Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use ring::digest::{digest, SHA1_FOR_LEGACY_USE_ONLY};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use url::Url;

use super::launch_commands::{ensure_java_runtime, find_java};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const VERSION_MANIFEST_URL: &str =
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const MAX_METADATA_BYTES: usize = 16 * 1024 * 1024;
const MAX_SERVER_BYTES: usize = 128 * 1024 * 1024;
const MAX_CONSOLE_LINES: usize = 600;

#[derive(Clone)]
struct ActiveHost {
    instance_id: String,
    pid: u32,
    port: u16,
    world_name: String,
    lan_address: String,
    stdin: Arc<Mutex<ChildStdin>>,
    console: Arc<Mutex<HostConsoleBuffer>>,
}

#[derive(Default)]
pub struct HostState {
    active: Mutex<Option<ActiveHost>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostedWorldStatus {
    instance_id: String,
    world_name: String,
    pid: u32,
    port: u16,
    lan_address: String,
    running: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostServerSettings {
    motd: String,
    game_mode: String,
    difficulty: String,
    max_players: u8,
    port: u16,
    memory_gb: u8,
    pvp: bool,
    allow_flight: bool,
    whitelist: bool,
    view_distance: u8,
    simulation_distance: u8,
    spawn_protection: u8,
}

impl Default for HostServerSettings {
    fn default() -> Self {
        Self {
            motd: "Aster Host".to_owned(),
            game_mode: "survival".to_owned(),
            difficulty: "normal".to_owned(),
            max_players: 8,
            port: 25565,
            memory_gb: 4,
            pvp: true,
            allow_flight: true,
            whitelist: false,
            view_distance: 10,
            simulation_distance: 8,
            spawn_protection: 0,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostSettingsSaveResult {
    settings: HostServerSettings,
    restart_required: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostConsoleLine {
    id: u64,
    stream: String,
    text: String,
}

#[derive(Default)]
struct HostConsoleBuffer {
    next_id: u64,
    lines: VecDeque<HostConsoleLine>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostConsoleSnapshot {
    lines: Vec<HostConsoleLine>,
    next_cursor: u64,
    running: bool,
}

impl From<&ActiveHost> for HostedWorldStatus {
    fn from(value: &ActiveHost) -> Self {
        Self {
            instance_id: value.instance_id.clone(),
            world_name: value.world_name.clone(),
            pid: value.pid,
            port: value.port,
            lan_address: value.lan_address.clone(),
            running: true,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostStatusEvent {
    instance_id: String,
    status: String,
    detail: String,
    exit_code: Option<i32>,
    port: Option<u16>,
    lan_address: Option<String>,
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
}

#[derive(Debug, Deserialize)]
struct ServerVersionMetadata {
    downloads: ServerDownloads,
    #[serde(rename = "javaVersion")]
    java_version: Option<JavaVersion>,
}

#[derive(Debug, Deserialize)]
struct ServerDownloads {
    server: ServerDownload,
}

#[derive(Debug, Deserialize)]
struct ServerDownload {
    url: String,
    sha1: String,
    size: u64,
}

#[derive(Debug, Deserialize)]
struct JavaVersion {
    #[serde(rename = "majorVersion")]
    major_version: u32,
}

#[derive(Debug, Deserialize)]
struct FabricLoaderEntry {
    loader: FabricVersion,
}

#[derive(Debug, Deserialize)]
struct FabricVersion {
    version: String,
    stable: bool,
}

#[derive(Debug, Deserialize)]
struct FabricInstallerVersion {
    version: String,
    stable: bool,
}

fn emit_host_status(
    app: &AppHandle,
    instance_id: &str,
    status: &str,
    detail: impl Into<String>,
    exit_code: Option<i32>,
    port: Option<u16>,
    lan_address: Option<String>,
) {
    let _ = app.emit(
        "host-status",
        HostStatusEvent {
            instance_id: instance_id.to_owned(),
            status: status.to_owned(),
            detail: detail.into(),
            exit_code,
            port,
            lan_address,
        },
    );
}

fn validate_instance_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("The instance folder name is invalid.".to_owned());
    }
    Ok(())
}

fn validate_world_name(value: &str) -> Result<(), String> {
    let path = Path::new(value);
    if value.trim().is_empty()
        || value.len() > 128
        || !path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
        || value.contains(['/', '\\'])
    {
        return Err("Choose a valid local world.".to_owned());
    }
    Ok(())
}

fn trusted_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "A server download URL is invalid.".to_owned())?;
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let trusted = url.scheme() == "https"
        && matches!(
            host.as_str(),
            "piston-meta.mojang.com"
                | "piston-data.mojang.com"
                | "launcher.mojang.com"
                | "meta.fabricmc.net"
        );
    trusted
        .then_some(url)
        .ok_or_else(|| "A server file uses an untrusted download host.".to_owned())
}

async fn fetch_bytes(
    client: &reqwest::Client,
    value: &str,
    maximum: usize,
) -> Result<Vec<u8>, String> {
    let url = trusted_url(value)?;
    let response =
        client.get(url).send().await.map_err(|_| {
            "The Minecraft server download service could not be reached.".to_owned()
        })?;
    if !response.status().is_success() {
        return Err(format!(
            "The Minecraft server download failed (HTTP {}).",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length as usize > maximum)
    {
        return Err("A server download exceeds its safety limit.".to_owned());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "The Minecraft server download could not be read.".to_owned())?;
    if bytes.len() > maximum {
        return Err("A server download exceeds its safety limit.".to_owned());
    }
    Ok(bytes.to_vec())
}

async fn fetch_json<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    value: &str,
) -> Result<T, String> {
    let bytes = fetch_bytes(client, value, MAX_METADATA_BYTES).await?;
    serde_json::from_slice(&bytes)
        .map_err(|_| "The Minecraft server service returned invalid metadata.".to_owned())
}

fn sha1_hex(bytes: &[u8]) -> String {
    digest(&SHA1_FOR_LEGACY_USE_ONLY, bytes)
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

async fn ensure_vanilla_server(
    client: &reqwest::Client,
    game_version: &str,
    destination: &Path,
) -> Result<u32, String> {
    let manifest: VersionManifest = fetch_json(client, VERSION_MANIFEST_URL).await?;
    let reference = manifest
        .versions
        .into_iter()
        .find(|version| version.id == game_version)
        .ok_or_else(|| format!("Minecraft version {game_version} was not found."))?;
    let metadata_bytes = fetch_bytes(client, &reference.url, MAX_METADATA_BYTES).await?;
    if sha1_hex(&metadata_bytes) != reference.sha1.to_ascii_lowercase() {
        return Err("Minecraft server metadata failed its integrity check.".to_owned());
    }
    let metadata: ServerVersionMetadata = serde_json::from_slice(&metadata_bytes)
        .map_err(|_| "Minecraft server metadata is invalid.".to_owned())?;
    let download = metadata.downloads.server;
    if let Ok(existing) = tokio::fs::read(destination).await {
        if existing.len() as u64 == download.size
            && sha1_hex(&existing).eq_ignore_ascii_case(&download.sha1)
        {
            return Ok(metadata
                .java_version
                .map(|version| version.major_version)
                .unwrap_or(17));
        }
    }
    let bytes = fetch_bytes(client, &download.url, MAX_SERVER_BYTES).await?;
    if bytes.len() as u64 != download.size || !sha1_hex(&bytes).eq_ignore_ascii_case(&download.sha1)
    {
        return Err("The Minecraft server failed its integrity check.".to_owned());
    }
    tokio::fs::write(destination, bytes)
        .await
        .map_err(|_| "The Minecraft server could not be saved.".to_owned())?;
    Ok(metadata
        .java_version
        .map(|version| version.major_version)
        .unwrap_or(17))
}

async fn ensure_fabric_server(
    client: &reqwest::Client,
    game_version: &str,
    destination: &Path,
) -> Result<u32, String> {
    let loaders: Vec<FabricLoaderEntry> = fetch_json(
        client,
        &format!("https://meta.fabricmc.net/v2/versions/loader/{game_version}"),
    )
    .await?;
    let loader = loaders
        .iter()
        .find(|entry| entry.loader.stable)
        .or_else(|| loaders.first())
        .ok_or_else(|| format!("Fabric does not provide a loader for {game_version}."))?;
    let installers: Vec<FabricInstallerVersion> =
        fetch_json(client, "https://meta.fabricmc.net/v2/versions/installer").await?;
    let installer = installers
        .iter()
        .find(|entry| entry.stable)
        .or_else(|| installers.first())
        .ok_or_else(|| "Fabric does not provide a server installer.".to_owned())?;
    let url = format!(
        "https://meta.fabricmc.net/v2/versions/loader/{game_version}/{}/{}/server/jar",
        loader.loader.version, installer.version
    );
    if std::fs::metadata(destination)
        .is_ok_and(|metadata| metadata.is_file() && metadata.len() >= 16 * 1024)
    {
        return Ok(if game_version.starts_with("1.20") {
            17
        } else {
            21
        });
    }
    let bytes = fetch_bytes(client, &url, MAX_SERVER_BYTES).await?;
    if bytes.len() < 16 * 1024 {
        return Err("Fabric returned an incomplete server launcher.".to_owned());
    }
    tokio::fs::write(destination, bytes)
        .await
        .map_err(|_| "The Fabric server launcher could not be saved.".to_owned())?;
    Ok(if game_version.starts_with("1.20") {
        17
    } else {
        21
    })
}

fn sync_server_mods(instance: &Path, host: &Path) -> Result<(), String> {
    let source = instance.join("mods");
    let destination = host.join("mods");
    std::fs::create_dir_all(&destination)
        .map_err(|_| "The hosted mods folder could not be created.".to_owned())?;
    if !source.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(source)
        .map_err(|_| "The instance mods folder could not be read.".to_owned())?
    {
        let entry = entry.map_err(|_| "An installed mod could not be read.".to_owned())?;
        let path = entry.path();
        if path.is_file()
            && path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("jar"))
        {
            std::fs::copy(&path, destination.join(entry.file_name()))
                .map_err(|_| "An installed mod could not be prepared for hosting.".to_owned())?;
        }
    }
    Ok(())
}

fn create_host_runtime(host: &Path) -> Result<PathBuf, String> {
    let runtime_root = host.join("runtimes");
    std::fs::create_dir_all(&runtime_root)
        .map_err(|_| "The Aster Host runtime folder could not be created.".to_owned())?;

    // Previous server processes or antivirus scanners can keep JAR files locked on Windows.
    // Runtime folders are therefore disposable and never overwritten. Old folders are only
    // removed on a best-effort basis so a stale lock cannot prevent the next host session.
    if let Ok(entries) = std::fs::read_dir(&runtime_root) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "The system clock could not create a host session.".to_owned())?
        .as_nanos();
    let runtime = runtime_root.join(format!("session-{nonce}"));
    std::fs::create_dir_all(&runtime)
        .map_err(|_| "The Aster Host session folder could not be created.".to_owned())?;
    Ok(runtime)
}

fn validate_game_version(game_version: &str) -> Result<(), String> {
    if game_version.is_empty()
        || game_version.len() > 32
        || !game_version
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || ".-_".contains(character))
    {
        return Err("The Minecraft version is invalid.".to_owned());
    }
    Ok(())
}

fn local_address(port: u16) -> String {
    let ip = UdpSocket::bind(("0.0.0.0", 0))
        .and_then(|socket| {
            socket.connect(("1.1.1.1", 80))?;
            socket.local_addr()
        })
        .map(|address| address.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_owned());
    format!("{ip}:{port}")
}

fn host_directory(app: &AppHandle, instance_id: &str) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|_| "The launcher data folder is unavailable.".to_owned())?
        .join("instances")
        .join(instance_id)
        .join(".aster-host"))
}

fn settings_path(host: &Path, world_name: &str) -> PathBuf {
    host.join("settings").join(format!("{world_name}.json"))
}

fn validate_host_settings(mut settings: HostServerSettings) -> Result<HostServerSettings, String> {
    settings.motd = settings
        .motd
        .replace(['\r', '\n'], " ")
        .trim()
        .chars()
        .take(80)
        .collect();
    if settings.motd.is_empty() {
        settings.motd = "Aster Host".to_owned();
    }
    if !matches!(
        settings.game_mode.as_str(),
        "survival" | "creative" | "adventure" | "spectator"
    ) {
        return Err("Choose a valid default game mode.".to_owned());
    }
    if !matches!(
        settings.difficulty.as_str(),
        "peaceful" | "easy" | "normal" | "hard"
    ) {
        return Err("Choose a valid server difficulty.".to_owned());
    }
    if !(2..=100).contains(&settings.max_players) {
        return Err("Choose between 2 and 100 player slots.".to_owned());
    }
    if !(1024..=65535).contains(&settings.port) {
        return Err("Choose a server port between 1024 and 65535.".to_owned());
    }
    if !(2..=16).contains(&settings.memory_gb) {
        return Err("Choose between 2 and 16 GB of server memory.".to_owned());
    }
    if !(2..=32).contains(&settings.view_distance)
        || !(2..=32).contains(&settings.simulation_distance)
    {
        return Err("View and simulation distance must be between 2 and 32.".to_owned());
    }
    if settings.spawn_protection > 32 {
        return Err("Spawn protection must be between 0 and 32 blocks.".to_owned());
    }
    Ok(settings)
}

fn read_host_settings(host: &Path, world_name: &str) -> Result<HostServerSettings, String> {
    let path = settings_path(host, world_name);
    if !path.is_file() {
        return Ok(HostServerSettings::default());
    }
    let bytes = std::fs::read(path)
        .map_err(|_| "The saved Aster Host settings could not be read.".to_owned())?;
    let settings = serde_json::from_slice(&bytes)
        .map_err(|_| "The saved Aster Host settings are invalid.".to_owned())?;
    validate_host_settings(settings)
}

fn persist_host_settings(
    host: &Path,
    world_name: &str,
    settings: &HostServerSettings,
) -> Result<(), String> {
    let directory = host.join("settings");
    std::fs::create_dir_all(&directory)
        .map_err(|_| "The Aster Host settings folder could not be created.".to_owned())?;
    let bytes = serde_json::to_vec_pretty(settings)
        .map_err(|_| "The Aster Host settings could not be encoded.".to_owned())?;
    std::fs::write(settings_path(host, world_name), bytes)
        .map_err(|_| "The Aster Host settings could not be saved.".to_owned())
}

fn write_server_properties(host: &Path, settings: &HostServerSettings) -> Result<(), String> {
    let HostServerSettings {
        motd,
        game_mode,
        difficulty,
        max_players,
        port,
        pvp,
        allow_flight,
        whitelist,
        view_distance,
        simulation_distance,
        spawn_protection,
        ..
    } = settings;
    let properties = format!(
        "allow-flight={allow_flight}\n\
         broadcast-console-to-ops=false\n\
         difficulty={difficulty}\n\
         enable-command-block=false\n\
         enable-query=false\n\
         enable-rcon=false\n\
         enforce-secure-profile=true\n\
         force-gamemode=false\n\
         gamemode={game_mode}\n\
         max-players={max_players}\n\
         motd={motd}\n\
         online-mode=true\n\
         prevent-proxy-connections=false\n\
         pvp={pvp}\n\
         server-ip=\n\
         server-port={port}\n\
         spawn-protection={spawn_protection}\n\
         view-distance={view_distance}\n\
         simulation-distance={simulation_distance}\n\
         white-list={whitelist}\n"
    );
    std::fs::write(host.join("server.properties"), properties)
        .map_err(|_| "The hosted server settings could not be saved.".to_owned())
}

fn push_console_line(
    console: &Arc<Mutex<HostConsoleBuffer>>,
    stream: &str,
    text: impl Into<String>,
) {
    let Ok(mut buffer) = console.lock() else {
        return;
    };
    buffer.next_id = buffer.next_id.saturating_add(1);
    let id = buffer.next_id;
    buffer.lines.push_back(HostConsoleLine {
        id,
        stream: stream.to_owned(),
        text: text.into(),
    });
    while buffer.lines.len() > MAX_CONSOLE_LINES {
        buffer.lines.pop_front();
    }
}

fn stream_host_output<R: std::io::Read + Send + 'static>(
    reader: R,
    stream: &'static str,
    console: Arc<Mutex<HostConsoleBuffer>>,
    log_path: PathBuf,
) {
    std::thread::spawn(move || {
        let mut log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path)
            .ok();
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            if let Some(file) = log.as_mut() {
                let _ = writeln!(file, "[{stream}] {line}");
                let _ = file.flush();
            }
            push_console_line(&console, stream, line);
        }
    });
}

fn log_tail(path: &Path) -> String {
    let Ok(log) = std::fs::read_to_string(path) else {
        return "Open the Aster Host log for more details.".to_owned();
    };
    let tail = log
        .chars()
        .rev()
        .take(600)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    tail.lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("Open the Aster Host log for more details.")
        .trim()
        .to_owned()
}

async fn wait_for_server_ready(
    child: &mut Child,
    port: u16,
    log_path: &Path,
) -> Result<(), String> {
    let address = format!("127.0.0.1:{port}")
        .parse()
        .map_err(|_| "The local server address is invalid.".to_owned())?;
    for _ in 0..1_200 {
        if let Some(status) = child
            .try_wait()
            .map_err(|_| "The hosted server process could not be checked.".to_owned())?
        {
            return Err(format!(
                "The hosted server exited before it was ready ({}). {}",
                status
                    .code()
                    .map_or_else(|| "no exit code".to_owned(), |code| code.to_string()),
                log_tail(log_path)
            ));
        }
        if TcpStream::connect_timeout(&address, Duration::from_millis(100)).is_ok() {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let _ = child.kill();
    let _ = child.wait();
    Err(format!(
        "The hosted server did not become ready in time. {}",
        log_tail(log_path)
    ))
}

#[tauri::command]
pub fn get_hosted_world_status(
    state: State<'_, HostState>,
) -> Result<Option<HostedWorldStatus>, String> {
    let active = state
        .active
        .lock()
        .map_err(|_| "The Aster Host state is unavailable.".to_owned())?;
    Ok(active.as_ref().map(HostedWorldStatus::from))
}

#[tauri::command]
pub fn get_host_server_settings(
    app: AppHandle,
    instance_id: String,
    world_name: String,
) -> Result<HostServerSettings, String> {
    validate_instance_id(&instance_id)?;
    validate_world_name(&world_name)?;
    read_host_settings(&host_directory(&app, &instance_id)?, &world_name)
}

#[tauri::command]
pub fn save_host_server_settings(
    app: AppHandle,
    state: State<'_, HostState>,
    instance_id: String,
    world_name: String,
    settings: HostServerSettings,
) -> Result<HostSettingsSaveResult, String> {
    validate_instance_id(&instance_id)?;
    validate_world_name(&world_name)?;
    let settings = validate_host_settings(settings)?;
    let host = host_directory(&app, &instance_id)?;
    std::fs::create_dir_all(&host)
        .map_err(|_| "The Aster Host folder could not be created.".to_owned())?;
    persist_host_settings(&host, &world_name, &settings)?;
    write_server_properties(&host, &settings)?;
    let restart_required = state
        .active
        .lock()
        .map_err(|_| "The Aster Host state is unavailable.".to_owned())?
        .as_ref()
        .is_some_and(|active| active.instance_id == instance_id && active.world_name == world_name);
    Ok(HostSettingsSaveResult {
        settings,
        restart_required,
    })
}

#[tauri::command]
pub fn get_host_console(
    state: State<'_, HostState>,
    instance_id: String,
    after_id: Option<u64>,
) -> Result<HostConsoleSnapshot, String> {
    validate_instance_id(&instance_id)?;
    let active = state
        .active
        .lock()
        .map_err(|_| "The Aster Host state is unavailable.".to_owned())?;
    let Some(active) = active
        .as_ref()
        .filter(|host| host.instance_id == instance_id)
    else {
        return Ok(HostConsoleSnapshot {
            lines: Vec::new(),
            next_cursor: after_id.unwrap_or(0),
            running: false,
        });
    };
    let console = active
        .console
        .lock()
        .map_err(|_| "The Aster Host console is unavailable.".to_owned())?;
    let cursor = after_id.unwrap_or(0);
    Ok(HostConsoleSnapshot {
        lines: console
            .lines
            .iter()
            .filter(|line| line.id > cursor)
            .cloned()
            .collect(),
        next_cursor: console.next_id,
        running: true,
    })
}

#[tauri::command]
pub fn send_host_console_command(
    state: State<'_, HostState>,
    instance_id: String,
    command: String,
) -> Result<(), String> {
    validate_instance_id(&instance_id)?;
    let command = command.trim();
    if command.is_empty()
        || command.len() > 256
        || command.chars().any(|character| character.is_control())
    {
        return Err("Enter a valid server command of up to 256 characters.".to_owned());
    }
    let active = state
        .active
        .lock()
        .map_err(|_| "The Aster Host state is unavailable.".to_owned())?;
    let active = active
        .as_ref()
        .filter(|host| host.instance_id == instance_id)
        .ok_or_else(|| "This instance is not currently hosting a world.".to_owned())?;
    let mut stdin = active
        .stdin
        .lock()
        .map_err(|_| "The Aster Host command channel is unavailable.".to_owned())?;
    writeln!(stdin, "{command}")
        .and_then(|_| stdin.flush())
        .map_err(|_| "The command could not be sent to Minecraft.".to_owned())?;
    push_console_line(&active.console, "command", format!("> {command}"));
    Ok(())
}

#[tauri::command]
pub async fn start_hosted_world(
    app: AppHandle,
    state: State<'_, HostState>,
    instance_id: String,
    game_version: String,
    loader: String,
    world_name: String,
    port: u16,
    max_players: u8,
    memory_gb: u8,
    accepted_eula: bool,
) -> Result<HostedWorldStatus, String> {
    validate_instance_id(&instance_id)?;
    validate_world_name(&world_name)?;
    validate_game_version(&game_version)?;
    if !accepted_eula {
        return Err("Accept the Minecraft EULA before hosting.".to_owned());
    }
    if !(1024..=65535).contains(&port) {
        return Err("Choose a server port between 1024 and 65535.".to_owned());
    }
    if !(2..=100).contains(&max_players) {
        return Err("Choose between 2 and 100 player slots.".to_owned());
    }
    if !(2..=16).contains(&memory_gb) {
        return Err("Choose between 2 and 16 GB of server memory.".to_owned());
    }
    {
        let active = state
            .active
            .lock()
            .map_err(|_| "The Aster Host state is unavailable.".to_owned())?;
        if active.is_some() {
            return Err("Another Aster Host session is already running.".to_owned());
        }
    }
    TcpListener::bind(("0.0.0.0", port)).map_err(|_| format!("Port {port} is already in use."))?;

    let instance = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "The launcher data folder is unavailable.".to_owned())?
        .join("instances")
        .join(&instance_id);
    let world = instance.join("saves").join(&world_name);
    if !world.is_dir() || !world.join("level.dat").is_file() {
        return Err("The selected Minecraft world is unavailable.".to_owned());
    }
    let host = instance.join(".aster-host");
    let logs = host.join("logs");
    tokio::fs::create_dir_all(&logs)
        .await
        .map_err(|_| "The Aster Host folder could not be created.".to_owned())?;
    let runtime = tokio::task::spawn_blocking({
        let host = host.clone();
        move || create_host_runtime(&host)
    })
    .await
    .map_err(|_| "The Aster Host session preparation stopped unexpectedly.".to_owned())??;
    tokio::task::spawn_blocking({
        let instance = instance.clone();
        let runtime = runtime.clone();
        move || sync_server_mods(&instance, &runtime)
    })
    .await
    .map_err(|_| "The hosted mod preparation stopped unexpectedly.".to_owned())??;
    let mut settings = read_host_settings(&host, &world_name)?;
    settings.port = port;
    settings.max_players = max_players;
    settings.memory_gb = memory_gb;
    let settings = validate_host_settings(settings)?;
    persist_host_settings(&host, &world_name, &settings)?;
    write_server_properties(&runtime, &settings)?;
    tokio::fs::write(runtime.join("eula.txt"), "eula=true\n")
        .await
        .map_err(|_| "The Minecraft EULA acceptance could not be saved.".to_owned())?;

    emit_host_status(
        &app,
        &instance_id,
        "preparing",
        "Preparing the local dedicated server",
        None,
        Some(port),
        None,
    );
    let client = reqwest::Client::builder()
        .user_agent(format!("AsterLauncher/{}", env!("CARGO_PKG_VERSION")))
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|_| "The server download client could not be created.".to_owned())?;
    let normalized_loader = loader.trim().to_ascii_lowercase();
    if !matches!(normalized_loader.as_str(), "fabric" | "vanilla") {
        return Err(
            "Aster Host currently supports Fabric and Vanilla instances. Forge hosting is next."
                .to_owned(),
        );
    }
    let server_cache = host.join("server-cache");
    tokio::fs::create_dir_all(&server_cache)
        .await
        .map_err(|_| "The Minecraft server cache could not be created.".to_owned())?;
    let server_jar = server_cache.join(format!("{normalized_loader}-{game_version}.jar"));
    let required_java = if normalized_loader == "fabric" {
        ensure_fabric_server(&client, &game_version, &server_jar).await?
    } else {
        ensure_vanilla_server(&client, &game_version, &server_jar).await?
    };
    let java = match find_java(required_java) {
        Ok(java) => java,
        Err(_) => {
            ensure_java_runtime(&app, &format!("host-{instance_id}"), &client, required_java)
                .await?
        }
    };

    let log_path = logs.join("latest-aster-host.log");
    File::create(&log_path).map_err(|_| "The Aster Host log could not be created.".to_owned())?;
    let mut command = Command::new(java);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let max_memory = format!("-Xmx{}G", settings.memory_gb);
    let mut child = command
        .args(["-Xms1G", &max_memory, "-Dfile.encoding=UTF-8", "-jar"])
        .arg(&server_jar)
        .args(["--nogui", "--universe"])
        .arg(instance.join("saves"))
        .args(["--world", &world_name])
        .current_dir(&runtime)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "The local Minecraft server could not be started.".to_owned())?;
    let pid = child.id();
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "The Aster Host command channel could not be opened.".to_owned())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "The Aster Host output channel could not be opened.".to_owned())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "The Aster Host error channel could not be opened.".to_owned())?;
    let console = Arc::new(Mutex::new(HostConsoleBuffer::default()));
    push_console_line(
        &console,
        "aster",
        format!("Preparing {} on port {}", world_name, settings.port),
    );
    stream_host_output(stdout, "server", console.clone(), log_path.clone());
    stream_host_output(stderr, "error", console.clone(), log_path.clone());
    let lan_address = local_address(port);
    emit_host_status(
        &app,
        &instance_id,
        "preparing",
        "Waiting for Minecraft to finish loading the world",
        None,
        Some(port),
        Some(lan_address.clone()),
    );
    wait_for_server_ready(&mut child, port, &log_path).await?;
    let active = ActiveHost {
        instance_id: instance_id.clone(),
        pid,
        port,
        world_name: world_name.clone(),
        lan_address: lan_address.clone(),
        stdin: Arc::new(Mutex::new(stdin)),
        console,
    };
    let hosted_status = HostedWorldStatus::from(&active);
    {
        let mut slot = state
            .active
            .lock()
            .map_err(|_| "The Aster Host state is unavailable.".to_owned())?;
        *slot = Some(active.clone());
    }
    emit_host_status(
        &app,
        &instance_id,
        "running",
        format!("Hosting {world_name} on this PC"),
        None,
        Some(port),
        Some(lan_address.clone()),
    );

    let event_app = app.clone();
    let event_instance = instance_id.clone();
    tauri::async_runtime::spawn(async move {
        let result = tauri::async_runtime::spawn_blocking(move || child.wait()).await;
        let (detail, exit_code) = match result {
            Ok(Ok(status)) if status.success() => (
                "The hosted server stopped normally".to_owned(),
                status.code(),
            ),
            Ok(Ok(status)) => (
                "The hosted server stopped with an error. Check its log.".to_owned(),
                status.code(),
            ),
            _ => (
                "The hosted server process could no longer be monitored.".to_owned(),
                None,
            ),
        };
        if let Ok(mut slot) = event_app.state::<HostState>().active.lock() {
            if slot.as_ref().is_some_and(|record| record.pid == pid) {
                *slot = None;
            }
        }
        emit_host_status(
            &event_app,
            &event_instance,
            "stopped",
            detail,
            exit_code,
            Some(port),
            None,
        );
    });

    Ok(hosted_status)
}

#[tauri::command]
pub fn stop_hosted_world(
    app: AppHandle,
    state: State<'_, HostState>,
    instance_id: String,
) -> Result<(), String> {
    validate_instance_id(&instance_id)?;
    let pid = {
        let active = state
            .active
            .lock()
            .map_err(|_| "The Aster Host state is unavailable.".to_owned())?;
        let record = active
            .as_ref()
            .ok_or_else(|| "No Aster Host session is running.".to_owned())?;
        if record.instance_id != instance_id {
            return Err("A different instance owns the active host session.".to_owned());
        }
        let mut stdin = record
            .stdin
            .lock()
            .map_err(|_| "The Aster Host command channel is unavailable.".to_owned())?;
        writeln!(stdin, "stop")
            .and_then(|_| stdin.flush())
            .map_err(|_| "Minecraft could not be asked to stop safely.".to_owned())?;
        push_console_line(&record.console, "command", "> stop");
        record.pid
    };
    emit_host_status(
        &app,
        &instance_id,
        "stopping",
        "Stopping the hosted world",
        None,
        None,
        None,
    );
    let cleanup_app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(12)).await;
        let still_running = cleanup_app
            .state::<HostState>()
            .active
            .lock()
            .ok()
            .is_some_and(|slot| slot.as_ref().is_some_and(|host| host.pid == pid));
        if !still_running {
            return;
        }
        let _ = tauri::async_runtime::spawn_blocking(move || {
            let mut command = Command::new("taskkill.exe");
            #[cfg(windows)]
            command.creation_flags(CREATE_NO_WINDOW);
            command
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .output()
        })
        .await;
    });
    Ok(())
}

#[tauri::command]
pub fn open_hosting_tunnel_setup() -> Result<(), String> {
    open::that("https://playit.gg/setup/agent")
        .map_err(|_| "The free tunnel setup page could not be opened.".to_owned())
}

#[cfg(test)]
mod tests {
    use super::{
        trusted_url, validate_game_version, validate_host_settings, validate_instance_id,
        validate_world_name, HostServerSettings,
    };

    #[test]
    fn accepts_safe_instance_and_world_names() {
        assert!(validate_instance_id("aster-1_20_1").is_ok());
        assert!(validate_world_name("New World (1)").is_ok());
    }

    #[test]
    fn rejects_paths_disguised_as_names() {
        assert!(validate_instance_id("../instance").is_err());
        assert!(validate_world_name("../world").is_err());
        assert!(validate_world_name("folder/world").is_err());
        assert!(validate_world_name(r"folder\world").is_err());
        assert!(validate_game_version("../1.20.1").is_err());
    }

    #[test]
    fn accepts_safe_minecraft_versions() {
        assert!(validate_game_version("1.20.1").is_ok());
        assert!(validate_game_version("26.1-snapshot-1").is_ok());
    }

    #[test]
    fn validates_and_normalizes_saved_host_settings() {
        let settings = HostServerSettings {
            motd: "  Aster\nFriends  ".to_owned(),
            ..HostServerSettings::default()
        };
        let settings = validate_host_settings(settings).expect("valid settings");
        assert_eq!(settings.motd, "Aster Friends");
    }

    #[test]
    fn rejects_unsafe_host_setting_ranges() {
        let settings = HostServerSettings {
            port: 80,
            ..HostServerSettings::default()
        };
        assert!(validate_host_settings(settings).is_err());

        let settings = HostServerSettings {
            view_distance: 64,
            ..HostServerSettings::default()
        };
        assert!(validate_host_settings(settings).is_err());
    }

    #[test]
    fn only_allows_official_server_download_hosts() {
        assert!(
            trusted_url("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json").is_ok()
        );
        assert!(trusted_url("https://meta.fabricmc.net/v2/versions/installer").is_ok());
        assert!(trusted_url("http://meta.fabricmc.net/v2/versions/installer").is_err());
        assert!(trusted_url("https://example.com/server.jar").is_err());
    }
}
