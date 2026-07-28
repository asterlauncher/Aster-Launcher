use std::{
    path::{Path, PathBuf},
    time::Duration,
};

use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;

use crate::errors::AuthError;

const MINECRAFT_LOGIN_URL: &str =
    "https://api.minecraftservices.com/authentication/login_with_xbox";
const ENTITLEMENTS_URL: &str = "https://api.minecraftservices.com/entitlements/mcstore";
const PROFILE_URL: &str = "https://api.minecraftservices.com/minecraft/profile";
const MAX_SKIN_BYTES: usize = 2 * 1024 * 1024;

pub struct MinecraftToken {
    pub access_token: String,
    pub expires_at: i64,
}

pub struct MinecraftProfile {
    pub id: String,
    pub name: String,
    pub active_skin_url: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MinecraftLoginRequest {
    identity_token: String,
}

#[derive(Deserialize)]
struct MinecraftLoginResponse {
    access_token: String,
    expires_in: i64,
}

#[derive(Deserialize)]
struct EntitlementsResponse {
    items: Vec<Entitlement>,
}

#[derive(Deserialize)]
struct Entitlement {
    name: String,
}

#[derive(Deserialize)]
struct ProfileResponse {
    id: String,
    name: String,
    #[serde(default)]
    skins: Vec<Skin>,
}

#[derive(Deserialize)]
struct Skin {
    state: String,
    url: String,
}

pub async fn authenticate(
    client: &Client,
    user_hash: &str,
    xsts_token: &str,
    now: i64,
) -> Result<MinecraftToken, AuthError> {
    if user_hash.is_empty() || xsts_token.is_empty() {
        return Err(AuthError::MinecraftAuthentication);
    }
    let response = client
        .post(MINECRAFT_LOGIN_URL)
        .timeout(Duration::from_secs(20))
        .json(&MinecraftLoginRequest {
            identity_token: format!("XBL3.0 x={user_hash};{xsts_token}"),
        })
        .send()
        .await
        .map_err(map_network_error)?;
    if !response.status().is_success() {
        return Err(AuthError::MinecraftAuthentication);
    }

    let payload = response
        .json::<MinecraftLoginResponse>()
        .await
        .map_err(|_| AuthError::MinecraftAuthentication)?;
    if payload.access_token.is_empty() || payload.expires_in <= 0 {
        return Err(AuthError::MinecraftAuthentication);
    }

    Ok(MinecraftToken {
        access_token: payload.access_token,
        expires_at: now.saturating_add(payload.expires_in),
    })
}

pub async fn verify_java_ownership(client: &Client, access_token: &str) -> Result<(), AuthError> {
    let response = client
        .get(ENTITLEMENTS_URL)
        .timeout(Duration::from_secs(20))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(map_network_error)?;
    if !response.status().is_success() {
        return Err(AuthError::MinecraftNotOwned);
    }
    let payload = response
        .json::<EntitlementsResponse>()
        .await
        .map_err(|_| AuthError::MinecraftNotOwned)?;

    let owns_java = payload.items.iter().any(|item| {
        matches!(
            item.name.as_str(),
            "game_minecraft" | "product_minecraft" | "minecraft"
        )
    });
    owns_java.then_some(()).ok_or(AuthError::MinecraftNotOwned)
}

pub async fn fetch_profile(
    client: &Client,
    access_token: &str,
) -> Result<MinecraftProfile, AuthError> {
    let response = client
        .get(PROFILE_URL)
        .timeout(Duration::from_secs(20))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(map_network_error)?;
    if !response.status().is_success() {
        return Err(AuthError::MinecraftProfileUnavailable);
    }

    let payload = response
        .json::<ProfileResponse>()
        .await
        .map_err(|_| AuthError::MinecraftProfileUnavailable)?;
    if payload.id.len() != 32
        || !payload
            .id
            .chars()
            .all(|character| character.is_ascii_hexdigit())
        || payload.name.trim().is_empty()
    {
        return Err(AuthError::MinecraftProfileUnavailable);
    }

    let active_skin_url = payload
        .skins
        .into_iter()
        .find(|skin| skin.state.eq_ignore_ascii_case("ACTIVE"))
        .map(|skin| skin.url);

    Ok(MinecraftProfile {
        id: payload.id,
        name: payload.name,
        active_skin_url,
    })
}

pub async fn cache_skin(
    client: &Client,
    skin_url: &str,
    profile_id: &str,
    skin_directory: &Path,
) -> Result<PathBuf, AuthError> {
    let parsed = Url::parse(skin_url).map_err(|_| AuthError::SkinDownloadFailed)?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("textures.minecraft.net") {
        return Err(AuthError::SkinDownloadFailed);
    }

    let response = client
        .get(parsed)
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|_| AuthError::SkinDownloadFailed)?;
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|length| length as usize > MAX_SKIN_BYTES)
    {
        return Err(AuthError::SkinDownloadFailed);
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|_| AuthError::SkinDownloadFailed)?;
    validate_skin_png(&bytes)?;

    tokio::fs::create_dir_all(skin_directory)
        .await
        .map_err(|_| AuthError::SkinDownloadFailed)?;
    let digest = Sha256::digest(&bytes);
    let fingerprint = digest[..12]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let destination = skin_directory.join(format!("{profile_id}-{fingerprint}.png"));
    let temporary = skin_directory.join(format!(".{profile_id}-{fingerprint}.tmp"));
    tokio::fs::write(&temporary, &bytes)
        .await
        .map_err(|_| AuthError::SkinDownloadFailed)?;
    if destination.exists() {
        let _ = tokio::fs::remove_file(&temporary).await;
    } else {
        tokio::fs::rename(&temporary, &destination)
            .await
            .map_err(|_| AuthError::SkinDownloadFailed)?;
    }

    if let Ok(mut entries) = tokio::fs::read_dir(skin_directory).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path == destination {
                continue;
            }
            let is_previous_skin =
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| {
                        name == format!("{profile_id}.png")
                            || (name.starts_with(&format!("{profile_id}-"))
                                && name.ends_with(".png"))
                    });
            if is_previous_skin {
                let _ = tokio::fs::remove_file(path).await;
            }
        }
    }
    Ok(destination)
}

fn validate_skin_png(bytes: &[u8]) -> Result<(), AuthError> {
    const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if bytes.len() < 24 || bytes.len() > MAX_SKIN_BYTES || &bytes[..8] != PNG_SIGNATURE {
        return Err(AuthError::SkinDownloadFailed);
    }

    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap_or_default());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap_or_default());
    if width != 64 || !matches!(height, 32 | 64) {
        return Err(AuthError::SkinDownloadFailed);
    }
    Ok(())
}

fn map_network_error(error: reqwest::Error) -> AuthError {
    if error.is_connect() || error.is_timeout() {
        AuthError::Offline
    } else {
        AuthError::MinecraftAuthentication
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_skin_payload_is_rejected() {
        assert!(matches!(
            validate_skin_png(b"not a png"),
            Err(AuthError::SkinDownloadFailed)
        ));
    }
}
