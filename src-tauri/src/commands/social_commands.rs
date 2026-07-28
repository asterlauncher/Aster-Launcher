use std::path::{Path, PathBuf};

use reqwest::{header, Client, Url};
use serde::Serialize;

const MAX_SCREENSHOT_BYTES: u64 = 12 * 1024 * 1024;
const MAX_MODPACK_BYTES: u64 = 250 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadedChatAttachment {
    file_name: String,
    mime_type: String,
    size: u64,
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
    let download_url = validate_supabase_url(&signed_url, "sign")?;
    if download_url.query_pairs().all(|(key, _)| key != "token") {
        return Err("The signed download token is missing.".to_owned());
    }
    let hard_limit = MAX_MODPACK_BYTES.max(MAX_SCREENSHOT_BYTES);
    let limit = max_bytes.clamp(1, hard_limit);
    let destination = PathBuf::from(destination_path);
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
