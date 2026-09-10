use std::{
    fs::File,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    process::Command,
};

use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use reqwest::{header, Client, Url};
use ring::{
    aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM},
    rand::{SecureRandom, SystemRandom},
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const SNAPSHOT_MAGIC: &[u8; 12] = b"ASTERWORLD1\0";
const SNAPSHOT_CHUNK_BYTES: usize = 4 * 1024 * 1024;
const MAX_SHARED_WORLD_BYTES: u64 = 1024 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedWorldSnapshot {
    source_path: String,
    sha256: String,
    size: u64,
    encryption_key: String,
}

fn validate_instance_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 80
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("The instance identifier is invalid.".to_owned());
    }
    Ok(())
}

fn validate_world_name(value: &str) -> Result<(), String> {
    if value.trim().is_empty()
        || value.len() > 120
        || value.contains(['/', '\\'])
        || matches!(value, "." | "..")
        || value.chars().any(|character| character.is_control())
    {
        return Err("Choose a valid Minecraft world.".to_owned());
    }
    Ok(())
}

fn instances_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|directory| directory.join("instances"))
        .map_err(|_| "The launcher data folder is unavailable.".to_owned())
}

fn shared_world_cache(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|directory| directory.join("shared-worlds"))
        .map_err(|_| "The launcher cache folder is unavailable.".to_owned())
}

fn archive_command() -> PathBuf {
    #[cfg(windows)]
    {
        return std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
            .join("System32")
            .join("tar.exe");
    }
    #[cfg(not(windows))]
    {
        PathBuf::from("tar")
    }
}

fn hidden_command(program: &Path) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn encrypt_archive(source: &Path, destination: &Path) -> Result<[u8; 32], String> {
    let random = SystemRandom::new();
    let mut key_bytes = [0_u8; 32];
    random
        .fill(&mut key_bytes)
        .map_err(|_| "The snapshot encryption key could not be created.".to_owned())?;
    let key = LessSafeKey::new(
        UnboundKey::new(&AES_256_GCM, &key_bytes)
            .map_err(|_| "The snapshot encryption key is invalid.".to_owned())?,
    );
    let mut input =
        File::open(source).map_err(|_| "The world archive could not be opened.".to_owned())?;
    let mut output = File::create(destination)
        .map_err(|_| "The encrypted world snapshot could not be created.".to_owned())?;
    output
        .write_all(SNAPSHOT_MAGIC)
        .and_then(|_| output.write_all(&(SNAPSHOT_CHUNK_BYTES as u32).to_le_bytes()))
        .map_err(|_| "The snapshot header could not be written.".to_owned())?;

    loop {
        let mut chunk = vec![0_u8; SNAPSHOT_CHUNK_BYTES];
        let count = input
            .read(&mut chunk)
            .map_err(|_| "The world archive could not be read.".to_owned())?;
        if count == 0 {
            break;
        }
        chunk.truncate(count);
        let mut nonce_bytes = [0_u8; 12];
        random
            .fill(&mut nonce_bytes)
            .map_err(|_| "Snapshot encryption stopped unexpectedly.".to_owned())?;
        key.seal_in_place_append_tag(
            Nonce::assume_unique_for_key(nonce_bytes),
            Aad::from(SNAPSHOT_MAGIC.as_slice()),
            &mut chunk,
        )
        .map_err(|_| "The world snapshot could not be encrypted.".to_owned())?;
        output
            .write_all(&(count as u32).to_le_bytes())
            .and_then(|_| output.write_all(&nonce_bytes))
            .and_then(|_| output.write_all(&chunk))
            .map_err(|_| "The encrypted world snapshot could not be written.".to_owned())?;
    }
    output
        .flush()
        .map_err(|_| "The encrypted world snapshot could not be finalized.".to_owned())?;
    Ok(key_bytes)
}

fn decrypt_archive(source: &Path, destination: &Path, encoded_key: &str) -> Result<(), String> {
    let decoded = STANDARD_NO_PAD
        .decode(encoded_key.trim())
        .map_err(|_| "The shared-world encryption key is invalid.".to_owned())?;
    let key_bytes: [u8; 32] = decoded
        .try_into()
        .map_err(|_| "The shared-world encryption key is invalid.".to_owned())?;
    let key = LessSafeKey::new(
        UnboundKey::new(&AES_256_GCM, &key_bytes)
            .map_err(|_| "The shared-world encryption key is invalid.".to_owned())?,
    );
    let mut input =
        File::open(source).map_err(|_| "The shared-world snapshot is unavailable.".to_owned())?;
    let mut magic = [0_u8; 12];
    let mut chunk_size = [0_u8; 4];
    input
        .read_exact(&mut magic)
        .and_then(|_| input.read_exact(&mut chunk_size))
        .map_err(|_| "The shared-world snapshot header is incomplete.".to_owned())?;
    if &magic != SNAPSHOT_MAGIC || u32::from_le_bytes(chunk_size) as usize != SNAPSHOT_CHUNK_BYTES {
        return Err("This is not a supported Aster shared-world snapshot.".to_owned());
    }
    let mut output = File::create(destination)
        .map_err(|_| "The restored world archive could not be created.".to_owned())?;
    loop {
        let mut length = [0_u8; 4];
        match input.read_exact(&mut length) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(_) => return Err("The shared-world snapshot is damaged.".to_owned()),
        }
        let plain_length = u32::from_le_bytes(length) as usize;
        if plain_length == 0 || plain_length > SNAPSHOT_CHUNK_BYTES {
            return Err("The shared-world snapshot contains an invalid chunk.".to_owned());
        }
        let mut nonce_bytes = [0_u8; 12];
        let mut encrypted = vec![0_u8; plain_length + AES_256_GCM.tag_len()];
        input
            .read_exact(&mut nonce_bytes)
            .and_then(|_| input.read_exact(&mut encrypted))
            .map_err(|_| "The shared-world snapshot is incomplete.".to_owned())?;
        let plain = key
            .open_in_place(
                Nonce::assume_unique_for_key(nonce_bytes),
                Aad::from(SNAPSHOT_MAGIC.as_slice()),
                &mut encrypted,
            )
            .map_err(|_| "The shared-world snapshot could not be decrypted.".to_owned())?;
        output
            .write_all(plain)
            .map_err(|_| "The restored world archive could not be written.".to_owned())?;
    }
    output
        .flush()
        .map_err(|_| "The restored world archive could not be finalized.".to_owned())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path)
        .map_err(|_| "The shared-world snapshot could not be verified.".to_owned())?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| "The shared-world snapshot could not be verified.".to_owned())?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn validate_archive_entries(archive: &Path) -> Result<(), String> {
    let output = hidden_command(&archive_command())
        .args(["-tf"])
        .arg(archive)
        .output()
        .map_err(|_| "Windows archive support could not inspect the shared world.".to_owned())?;
    if !output.status.success() {
        return Err("The restored world archive is invalid.".to_owned());
    }
    let listing = String::from_utf8(output.stdout)
        .map_err(|_| "The restored world archive contains invalid paths.".to_owned())?;
    for entry in listing.lines().filter(|line| !line.trim().is_empty()) {
        let normalized = entry.trim_start_matches("./").replace('\\', "/");
        let path = Path::new(&normalized);
        if path.is_absolute()
            || path
                .components()
                .any(|component| matches!(component, Component::ParentDir | Component::Prefix(_)))
        {
            return Err("The restored world archive contains an unsafe path.".to_owned());
        }
    }
    Ok(())
}

fn validate_storage_url(value: &str, operation: &str) -> Result<Url, String> {
    let url =
        Url::parse(value).map_err(|_| "The shared-world storage URL is invalid.".to_owned())?;
    if url.scheme() != "https"
        || !url
            .host_str()
            .unwrap_or_default()
            .to_ascii_lowercase()
            .ends_with(".supabase.co")
    {
        return Err("Shared Worlds requires secure Supabase storage.".to_owned());
    }
    let expected = format!("/storage/v1/object/{operation}/shared-worlds/");
    if !url.path().contains(&expected) {
        return Err("The storage URL does not target Aster Shared Worlds.".to_owned());
    }
    Ok(url)
}

#[tauri::command]
pub async fn create_shared_world_snapshot(
    app: AppHandle,
    instance_id: String,
    world_name: String,
) -> Result<SharedWorldSnapshot, String> {
    validate_instance_id(&instance_id)?;
    validate_world_name(&world_name)?;
    let world = instances_directory(&app)?
        .join(&instance_id)
        .join("saves")
        .join(&world_name);
    if !world.is_dir() || !world.join("level.dat").is_file() {
        return Err("The selected Minecraft world is unavailable.".to_owned());
    }
    let cache = shared_world_cache(&app)?;
    tokio::fs::create_dir_all(&cache)
        .await
        .map_err(|_| "The shared-world cache could not be created.".to_owned())?;
    let id = Uuid::new_v4();
    let archive = cache.join(format!("{id}.zip"));
    let encrypted = cache.join(format!("{id}.asterworld"));
    let result = tokio::task::spawn_blocking(move || {
        let output = hidden_command(&archive_command())
            .args(["-a", "-cf"])
            .arg(&archive)
            .arg("-C")
            .arg(&world)
            .arg(".")
            .output()
            .map_err(|_| "Windows archive support could not package the world.".to_owned())?;
        if !output.status.success() {
            return Err("The Minecraft world could not be packaged.".to_owned());
        }
        let key = encrypt_archive(&archive, &encrypted)?;
        let _ = std::fs::remove_file(&archive);
        let metadata = std::fs::metadata(&encrypted)
            .map_err(|_| "The encrypted world snapshot is unavailable.".to_owned())?;
        if metadata.len() > MAX_SHARED_WORLD_BYTES {
            let _ = std::fs::remove_file(&encrypted);
            return Err("This world is larger than Aster's 1 GB sharing limit.".to_owned());
        }
        Ok(SharedWorldSnapshot {
            source_path: encrypted.to_string_lossy().into_owned(),
            sha256: sha256_file(&encrypted)?,
            size: metadata.len(),
            encryption_key: STANDARD_NO_PAD.encode(key),
        })
    })
    .await
    .map_err(|_| "World snapshot creation stopped unexpectedly.".to_owned())?;
    result
}

#[tauri::command]
pub async fn restore_shared_world_snapshot(
    app: AppHandle,
    instance_id: String,
    world_name: String,
    source_path: String,
    encryption_key: String,
) -> Result<String, String> {
    validate_instance_id(&instance_id)?;
    validate_world_name(&world_name)?;
    let source = PathBuf::from(source_path);
    let cache = shared_world_cache(&app)?;
    let canonical_source = std::fs::canonicalize(&source)
        .map_err(|_| "The downloaded shared-world snapshot is unavailable.".to_owned())?;
    let canonical_cache = std::fs::canonicalize(&cache)
        .map_err(|_| "The shared-world cache is unavailable.".to_owned())?;
    if canonical_source.parent() != Some(canonical_cache.as_path()) {
        return Err("Only downloaded Aster Shared World snapshots can be restored.".to_owned());
    }
    let destination = instances_directory(&app)?
        .join(&instance_id)
        .join("saves")
        .join(&world_name);
    let staging = destination.with_file_name(format!(".{world_name}-restoring-{}", Uuid::new_v4()));
    let archive = cache.join(format!("restore-{}.zip", Uuid::new_v4()));
    tokio::task::spawn_blocking(move || {
        let restore = (|| {
            decrypt_archive(&source, &archive, &encryption_key)?;
            validate_archive_entries(&archive)?;
            std::fs::create_dir_all(&staging)
                .map_err(|_| "The world restore folder could not be created.".to_owned())?;
            let output = hidden_command(&archive_command())
                .arg("-xf")
                .arg(&archive)
                .arg("-C")
                .arg(&staging)
                .output()
                .map_err(|_| "Windows archive support could not restore the world.".to_owned())?;
            if !output.status.success() || !staging.join("level.dat").is_file() {
                return Err(
                    "The shared-world snapshot did not contain a valid Minecraft world.".to_owned(),
                );
            }
            if destination.exists() {
                let backups = destination
                    .parent()
                    .ok_or_else(|| "The Minecraft saves folder is unavailable.".to_owned())?
                    .join(".aster-shared-backups");
                std::fs::create_dir_all(&backups).map_err(|_| {
                    "The shared-world backup folder could not be created.".to_owned()
                })?;
                std::fs::rename(
                    &destination,
                    backups.join(format!("{world_name}-{}", Uuid::new_v4())),
                )
                .map_err(|_| "The previous local world could not be backed up.".to_owned())?;
            }
            std::fs::rename(&staging, &destination)
                .map_err(|_| "The restored Minecraft world could not be installed.".to_owned())?;
            Ok(destination.to_string_lossy().into_owned())
        })();
        let _ = std::fs::remove_file(&archive);
        if restore.is_err() {
            let _ = std::fs::remove_dir_all(&staging);
        }
        restore
    })
    .await
    .map_err(|_| "World restoration stopped unexpectedly.".to_owned())?
}

#[tauri::command]
pub async fn upload_shared_world_snapshot(
    source_path: String,
    signed_url: String,
    api_key: String,
    access_token: String,
) -> Result<(), String> {
    let source = PathBuf::from(source_path);
    let metadata = tokio::fs::metadata(&source)
        .await
        .map_err(|_| "The encrypted world snapshot is unavailable.".to_owned())?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_SHARED_WORLD_BYTES {
        return Err("The encrypted world snapshot is empty or too large.".to_owned());
    }
    let upload_url = validate_storage_url(&signed_url, "upload/sign")?;
    let file = tokio::fs::read(&source)
        .await
        .map_err(|_| "The encrypted world snapshot could not be opened.".to_owned())?;
    let response = Client::new()
        .put(upload_url)
        .header("apikey", api_key)
        .bearer_auth(access_token)
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::CONTENT_LENGTH, metadata.len())
        .header("x-upsert", "false")
        .body(file)
        .send()
        .await
        .map_err(|_| "The world snapshot upload could not reach storage.".to_owned())?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().await.unwrap_or_default();
        return Err(format!(
            "Shared-world storage returned HTTP {status}: {}",
            detail.chars().take(180).collect::<String>()
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn download_shared_world_snapshot(
    app: AppHandle,
    signed_url: String,
    expected_sha256: String,
    expected_size: u64,
) -> Result<String, String> {
    if expected_size == 0 || expected_size > MAX_SHARED_WORLD_BYTES {
        return Err("The shared-world revision has an invalid size.".to_owned());
    }
    let download_url = validate_storage_url(&signed_url, "sign")?;
    let response = Client::new()
        .get(download_url)
        .send()
        .await
        .map_err(|_| "The world snapshot download could not reach storage.".to_owned())?;
    if !response.status().is_success() {
        return Err(format!(
            "Shared-world storage returned HTTP {}.",
            response.status()
        ));
    }
    let cache = shared_world_cache(&app)?;
    tokio::fs::create_dir_all(&cache)
        .await
        .map_err(|_| "The shared-world cache could not be created.".to_owned())?;
    let destination = cache.join(format!("received-{}.asterworld", Uuid::new_v4()));
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "The world snapshot download was interrupted.".to_owned())?;
    if bytes.len() as u64 != expected_size || bytes.len() as u64 > MAX_SHARED_WORLD_BYTES {
        return Err("The world snapshot exceeded its declared size.".to_owned());
    }
    let actual_hash = format!("{:x}", Sha256::digest(&bytes));
    if !actual_hash.eq_ignore_ascii_case(expected_sha256.trim()) {
        let _ = tokio::fs::remove_file(&destination).await;
        return Err("The downloaded world snapshot failed integrity verification.".to_owned());
    }
    tokio::fs::write(&destination, bytes)
        .await
        .map_err(|_| "The downloaded world snapshot could not be written.".to_owned())?;
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn remove_cached_shared_world_snapshot(
    app: AppHandle,
    source_path: String,
) -> Result<(), String> {
    let cache = shared_world_cache(&app)?;
    let source = PathBuf::from(source_path);
    if source.parent() != Some(cache.as_path()) {
        return Err("Only cached Aster Shared World snapshots can be removed.".to_owned());
    }
    match tokio::fs::remove_file(source).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("The cached shared-world snapshot could not be removed.".to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::{decrypt_archive, encrypt_archive, validate_archive_entries};
    use std::path::PathBuf;
    use uuid::Uuid;

    #[test]
    fn encrypted_world_snapshot_round_trips_without_plaintext() {
        let root = std::env::temp_dir().join(format!("aster-shared-world-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create test folder");
        let source = root.join("world.zip");
        let encrypted = root.join("world.asterworld");
        let restored = root.join("restored.zip");
        let payload = b"private minecraft world bytes";
        std::fs::write(&source, payload).expect("write source");

        let key = encrypt_archive(&source, &encrypted).expect("encrypt snapshot");
        let encrypted_bytes = std::fs::read(&encrypted).expect("read encrypted snapshot");
        assert!(!encrypted_bytes
            .windows(payload.len())
            .any(|window| window == payload));
        let key = base64::Engine::encode(&base64::engine::general_purpose::STANDARD_NO_PAD, key);
        decrypt_archive(&encrypted, &restored, &key).expect("decrypt snapshot");
        assert_eq!(std::fs::read(&restored).expect("read restored"), payload);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn invalid_archive_is_rejected_before_restore() {
        let path = PathBuf::from("definitely-not-an-aster-world.zip");
        assert!(validate_archive_entries(&path).is_err());
    }
}
