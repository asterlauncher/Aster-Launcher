use std::path::{Path, PathBuf};

use reqwest::{header, Client, Url};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const MAX_SCREENSHOT_BYTES: u64 = 12 * 1024 * 1024;
const MAX_MODPACK_BYTES: u64 = 250 * 1024 * 1024;
const MAX_SOCIAL_SESSION_BYTES: usize = 64 * 1024;
const SOCIAL_SESSION_FILE: &str = ".social-session.bin";

#[derive(Debug, Deserialize)]
struct StoredSocialSession {
    access_token: String,
    refresh_token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadedChatAttachment {
    file_name: String,
    mime_type: String,
    size: u64,
}

fn social_session_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(SOCIAL_SESSION_FILE))
        .map_err(|_| "Windows secure Social storage is unavailable.".to_owned())
}

fn validate_social_session(payload: &str) -> Result<(), String> {
    if payload.is_empty() || payload.len() > MAX_SOCIAL_SESSION_BYTES {
        return Err("The Social session payload is invalid.".to_owned());
    }
    let session: StoredSocialSession = serde_json::from_str(payload)
        .map_err(|_| "The Social session payload is invalid.".to_owned())?;
    if session.access_token.trim().is_empty() || session.refresh_token.trim().is_empty() {
        return Err("The Social session payload is incomplete.".to_owned());
    }
    Ok(())
}

#[cfg(windows)]
fn load_social_session_file(path: &Path) -> Result<Option<String>, String> {
    let encrypted = match std::fs::read(path) {
        Ok(payload) => payload,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("The saved Social session could not be read.".to_owned()),
    };
    let decrypted = crate::auth::token_store::windows_dpapi::decrypt(&encrypted)
        .map_err(|_| "The saved Social session could not be decrypted.".to_owned())?;
    let payload = String::from_utf8(decrypted)
        .map_err(|_| "The saved Social session is invalid.".to_owned())?;
    validate_social_session(&payload)?;
    Ok(Some(payload))
}

#[cfg(not(windows))]
fn load_social_session_file(_path: &Path) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(windows)]
fn save_social_session_file(path: &Path, payload: &str) -> Result<(), String> {
    validate_social_session(payload)?;
    let encrypted = crate::auth::token_store::windows_dpapi::encrypt(payload.as_bytes())
        .map_err(|_| "The Social session could not be encrypted.".to_owned())?;
    let parent = path
        .parent()
        .ok_or_else(|| "The Social session path is invalid.".to_owned())?;
    std::fs::create_dir_all(parent)
        .map_err(|_| "The Social session folder could not be created.".to_owned())?;
    let temporary = path.with_extension("bin.new");
    std::fs::write(&temporary, encrypted)
        .map_err(|_| "The Social session could not be saved.".to_owned())?;
    if path.exists() {
        std::fs::remove_file(path)
            .map_err(|_| "The previous Social session could not be replaced.".to_owned())?;
    }
    std::fs::rename(temporary, path)
        .map_err(|_| "The Social session could not be finalized.".to_owned())
}

#[cfg(not(windows))]
fn save_social_session_file(_path: &Path, _payload: &str) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn load_social_auth_session(app: AppHandle) -> Result<Option<String>, String> {
    let path = social_session_path(&app)?;
    tokio::task::spawn_blocking(move || load_social_session_file(&path))
        .await
        .map_err(|_| "The Social session could not be loaded.".to_owned())?
}

#[tauri::command]
pub async fn save_social_auth_session(app: AppHandle, payload: String) -> Result<(), String> {
    let path = social_session_path(&app)?;
    tokio::task::spawn_blocking(move || save_social_session_file(&path, &payload))
        .await
        .map_err(|_| "The Social session could not be saved.".to_owned())?
}

#[tauri::command]
pub async fn clear_social_auth_session(app: AppHandle) -> Result<(), String> {
    let path = social_session_path(&app)?;
    tokio::task::spawn_blocking(move || match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("The saved Social session could not be removed.".to_owned()),
    })
    .await
    .map_err(|_| "The Social session could not be removed.".to_owned())?
}

fn allowed_attachment(path: &Path, kind: &str) -> Result<(String, u64), String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let (mime_type, limit) = match (kind, extension.as_str()) {
        ("screenshot", "png") => ("image/png", MAX_SCREENSHOT_BYTES),
        ("screenshot", "jpg" | "jpeg") => ("image/jpeg", MAX_SCREENSHOT_BYTES),
        ("screenshot", "webp") => ("image/webp", MAX_SCREENSHOT_BYTES),
        ("modpack", "zip") => ("application/zip", MAX_MODPACK_BYTES),
        ("modpack", "mrpack") => ("application/octet-stream", MAX_MODPACK_BYTES),
        ("screenshot", _) => return Err("Choose a PNG, JPG, JPEG, or WebP screenshot.".to_owned()),
        ("modpack", _) => return Err("Choose a ZIP or MRPACK modpack archive.".to_owned()),
        _ => return Err("This chat attachment type is not supported.".to_owned()),
    };

    let metadata =
        std::fs::metadata(path).map_err(|_| "The selected file is unavailable.".to_owned())?;
    if !metadata.is_file() {
        return Err("The selected path is not a file.".to_owned());
    }
    if metadata.len() == 0 {
        return Err("Empty files cannot be shared.".to_owned());
    }
    if metadata.len() > limit {
        let max_megabytes = limit / 1024 / 1024;
        return Err(format!("This file is larger than {max_megabytes} MB."));
    }
    Ok((mime_type.to_owned(), metadata.len()))
}

fn validate_supabase_url(value: &str, operation: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "The storage URL is invalid.".to_owned())?;
    if url.scheme() != "https" {
        return Err("Chat attachments require secure HTTPS storage.".to_owned());
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if !host.ends_with(".supabase.co") {
        return Err("The storage destination is not an approved Supabase host.".to_owned());
    }
    let expected = format!("/storage/v1/object/{operation}/chat-attachments/");
    if !url.path().contains(&expected) {
        return Err("The storage URL does not target Aster chat attachments.".to_owned());
    }
    Ok(url)
}

fn safe_server_error(status: reqwest::StatusCode, body: &str) -> String {
    let compact = body
        .chars()
        .filter(|character| !character.is_control())
        .take(220)
        .collect::<String>();
    if compact.is_empty() {
        format!("Storage returned HTTP {status}.")
    } else {
        format!("Storage returned HTTP {status}: {compact}")
    }
}

#[tauri::command]
pub async fn upload_chat_attachment(
    source_path: String,
    kind: String,
    signed_url: String,
    api_key: String,
    access_token: String,
) -> Result<UploadedChatAttachment, String> {
    let source = PathBuf::from(source_path);
    let (mime_type, size) = allowed_attachment(&source, &kind)?;
    let upload_url = validate_supabase_url(&signed_url, "upload/sign")?;
    if upload_url.query_pairs().all(|(key, _)| key != "token") {
        return Err("The signed upload token is missing.".to_owned());
    }
    if api_key.trim().is_empty() {
        return Err("The Supabase publishable key is missing.".to_owned());
    }
    if access_token.trim().is_empty() {
        return Err(
            "The Aster Social session has expired. Reopen Friends and try again.".to_owned(),
        );
    }

    let file = tokio::fs::read(&source)
        .await
        .map_err(|_| "The selected file could not be opened.".to_owned())?;
    let response = Client::new()
        .put(upload_url)
        .header("apikey", api_key)
        .bearer_auth(access_token)
        .header(header::CONTENT_TYPE, &mime_type)
        .header(header::CONTENT_LENGTH, size)
        .header(header::CACHE_CONTROL, "max-age=3600")
        .header("x-upsert", "false")
        .body(file)
        .send()
        .await
        .map_err(|_| "The attachment upload could not reach storage.".to_owned())?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(safe_server_error(status, &body));
    }

    let file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("attachment")
        .to_owned();
    Ok(UploadedChatAttachment {
        file_name,
        mime_type,
        size,
    })
}

#[tauri::command]
pub async fn download_chat_attachment(
    signed_url: String,
    destination_path: String,
    max_bytes: u64,
) -> Result<(), String> {
    download_attachment_to_path(signed_url, PathBuf::from(destination_path), max_bytes).await
}

async fn download_attachment_to_path(
    signed_url: String,
    destination: PathBuf,
    max_bytes: u64,
) -> Result<(), String> {
    let download_url = validate_supabase_url(&signed_url, "sign")?;
    if download_url.query_pairs().all(|(key, _)| key != "token") {
        return Err("The signed download token is missing.".to_owned());
    }
    let hard_limit = MAX_MODPACK_BYTES.max(MAX_SCREENSHOT_BYTES);
    let limit = max_bytes.clamp(1, hard_limit);
    if destination.file_name().is_none() {
        return Err("Choose a valid destination file.".to_owned());
    }
    let staging = destination.with_extension(format!(
        "{}.aster-part",
        destination
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
    ));

    let response = Client::new()
        .get(download_url)
        .send()
        .await
        .map_err(|_| "The attachment download could not reach storage.".to_owned())?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(safe_server_error(status, &body));
    }
    if response
        .content_length()
        .is_some_and(|length| length > limit)
    {
        return Err("The attachment exceeds the allowed download size.".to_owned());
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|_| "The attachment download was interrupted.".to_owned())?;
    if bytes.len() as u64 > limit {
        return Err("The attachment exceeds the allowed download size.".to_owned());
    }
    tokio::fs::write(&staging, &bytes)
        .await
        .map_err(|_| "The attachment could not be written.".to_owned())?;
    if tokio::fs::try_exists(&destination).await.unwrap_or(false) {
        tokio::fs::remove_file(&destination)
            .await
            .map_err(|_| "The existing destination file could not be replaced.".to_owned())?;
    }
    tokio::fs::rename(&staging, &destination)
        .await
        .map_err(|_| "The downloaded attachment could not be finalized.".to_owned())?;
    Ok(())
}

#[tauri::command]
pub async fn download_chat_modpack_for_import(
    app: AppHandle,
    signed_url: String,
    file_name: String,
) -> Result<String, String> {
    let extension = Path::new(&file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if extension != "zip" && extension != "mrpack" {
        return Err("Only ZIP and MRPACK chat attachments can be installed.".to_owned());
    }
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|_| "The launcher cache folder is unavailable.".to_owned())?
        .join("chat-modpacks");
    tokio::fs::create_dir_all(&cache)
        .await
        .map_err(|_| "The chat modpack cache could not be created.".to_owned())?;
    let destination = cache.join(format!("received-{}.{}", Uuid::new_v4(), extension));
    download_attachment_to_path(signed_url, destination.clone(), MAX_MODPACK_BYTES).await?;
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn remove_cached_chat_attachment(
    app: AppHandle,
    source_path: String,
) -> Result<(), String> {
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|_| "The launcher cache folder is unavailable.".to_owned())?
        .join("chat-modpacks");
    let source = PathBuf::from(source_path);
    let parent = source
        .parent()
        .ok_or_else(|| "The cached attachment path is invalid.".to_owned())?;
    let canonical_cache = std::fs::canonicalize(&cache)
        .map_err(|_| "The chat modpack cache is unavailable.".to_owned())?;
    let canonical_parent = std::fs::canonicalize(parent)
        .map_err(|_| "The cached attachment folder is unavailable.".to_owned())?;
    if canonical_parent != canonical_cache {
        return Err("Only cached chat attachments can be removed.".to_owned());
    }
    if source.is_file() {
        tokio::fs::remove_file(source)
            .await
            .map_err(|_| "The cached chat attachment could not be removed.".to_owned())?;
    }
    Ok(())
}

#[cfg(all(test, windows))]
mod tests {
    use super::{load_social_session_file, save_social_session_file};

    #[test]
    fn social_session_round_trips_through_windows_dpapi() {
        let directory =
            std::env::temp_dir().join(format!("aster-social-test-{}", uuid::Uuid::new_v4()));
        let path = directory.join(".social-session.bin");
        let payload = serde_json::json!({
            "access_token": "private-social-access-token",
            "refresh_token": "private-social-refresh-token",
            "expires_at": 4_000_000_000_u64,
            "token_type": "bearer"
        })
        .to_string();

        save_social_session_file(&path, &payload).expect("save encrypted social session");
        let encrypted = std::fs::read(&path).expect("read encrypted social session");
        assert!(!encrypted
            .windows("private-social-access-token".len())
            .any(|window| window == b"private-social-access-token"));

        let restored = load_social_session_file(&path)
            .expect("load encrypted social session")
            .expect("stored social session");
        assert_eq!(restored, payload);

        let _ = std::fs::remove_dir_all(directory);
    }
}
