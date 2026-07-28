use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use ring::signature::{UnparsedPublicKey, ED25519};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::{ipc::Channel, AppHandle};
use tokio::io::AsyncWriteExt;

const GITHUB_LATEST_RELEASE_API: &str =
    "https://api.github.com/repos/asterlauncher/Aster-Launcher/releases/latest";
const LEGACY_UPDATE_MANIFEST_URL: &str =
    "https://github.com/asterlauncher/Aster-Launcher/releases/latest/download/aster-update.json";
const RELEASES_PAGE_URL: &str = "https://github.com/asterlauncher/Aster-Launcher/releases";
const UPDATE_MANIFEST_ASSET: &str = "aster-update.json";
const UPDATE_PUBLIC_KEY: &str = "mRKRFNcmFw2xTxU8n7NFYJ1LtE+Jjau0HgS+NAwZyck=";
const MAX_UPDATE_BYTES: u64 = 300 * 1024 * 1024;

#[cfg(target_os = "windows")]
fn is_store_package() -> bool {
    use std::ptr::null_mut;
    use windows_sys::Win32::{
        Foundation::ERROR_INSUFFICIENT_BUFFER, Storage::Packaging::Appx::GetCurrentPackageFullName,
    };

    let mut package_name_length = 0_u32;
    let result = unsafe { GetCurrentPackageFullName(&mut package_name_length, null_mut()) };

    result == ERROR_INSUFFICIENT_BUFFER || (result == 0 && package_name_length > 0)
}

#[cfg(not(target_os = "windows"))]
fn is_store_package() -> bool {
    false
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherUpdateManifest {
    version: String,
    name: String,
    description: String,
    published_at: String,
    url: String,
    sha256: String,
    signature: String,
}

#[derive(Clone, Debug, Deserialize)]
struct GithubReleaseAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Clone, Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<GithubReleaseAsset>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum UpdateDownloadEvent {
    Started {
        #[serde(rename = "contentLength")]
        content_length: Option<u64>,
    },
    Progress {
        #[serde(rename = "chunkLength")]
        chunk_length: usize,
    },
    Finished,
}

fn canonical_payload(update: &LauncherUpdateManifest) -> String {
    [
        update.version.as_str(),
        update.name.as_str(),
        update.description.as_str(),
        update.published_at.as_str(),
        update.url.as_str(),
        update.sha256.as_str(),
    ]
    .join("\n")
}

fn verify_update(update: &LauncherUpdateManifest) -> Result<(), String> {
    let public_key = BASE64
        .decode(UPDATE_PUBLIC_KEY)
        .map_err(|_| "The embedded update key is invalid.".to_owned())?;
    let signature = BASE64
        .decode(&update.signature)
        .map_err(|_| "The update signature is invalid.".to_owned())?;

    UnparsedPublicKey::new(&ED25519, public_key)
        .verify(canonical_payload(update).as_bytes(), &signature)
        .map_err(|_| "This update was not signed by Aster Launcher.".to_owned())?;

    let version = Version::parse(update.version.trim_start_matches('v'))
        .map_err(|_| "The update version is invalid.".to_owned())?;
    if version.major > 99 {
        return Err("The update version is invalid.".to_owned());
    }

    if update.sha256.len() != 64
        || !update
            .sha256
            .bytes()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("The update checksum is invalid.".to_owned());
    }

    let parsed_url =
        url::Url::parse(&update.url).map_err(|_| "The update URL is invalid.".to_owned())?;
    if parsed_url.scheme() != "https"
        || parsed_url.host_str() != Some("github.com")
        || !parsed_url
            .path()
            .starts_with("/asterlauncher/Aster-Launcher/releases/download/")
    {
        return Err("The update download source is not trusted.".to_owned());
    }

    Ok(())
}

fn update_manifest_asset_url(release: &GithubRelease) -> Result<String, String> {
    if release.draft || release.prerelease {
        return Err("The latest launcher release is not publicly available.".to_owned());
    }
    if !release.tag_name.starts_with("app-v") {
        return Err("The latest launcher release has an invalid tag.".to_owned());
    }

    release
        .assets
        .iter()
        .find(|asset| asset.name == UPDATE_MANIFEST_ASSET)
        .map(|asset| asset.browser_download_url.clone())
        .ok_or_else(|| "The latest launcher release has no update manifest.".to_owned())
}

async fn fetch_update_manifest_url(
    client: &reqwest::Client,
    url: &str,
) -> Result<LauncherUpdateManifest, String> {
    let response = client
        .get(url)
        .header("Accept", "application/json")
        .header("Cache-Control", "no-cache")
        .send()
        .await
        .map_err(|_| "The update manifest could not be reached.".to_owned())?;

    if !response.status().is_success() {
        return Err(format!(
            "The update manifest returned status {}.",
            response.status().as_u16()
        ));
    }

    response
        .json::<LauncherUpdateManifest>()
        .await
        .map_err(|_| "The update manifest contains invalid data.".to_owned())
}

async fn fetch_update_manifest_from_github(
    client: &reqwest::Client,
) -> Result<LauncherUpdateManifest, String> {
    let response = client
        .get(GITHUB_LATEST_RELEASE_API)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("Cache-Control", "no-cache")
        .send()
        .await
        .map_err(|_| "GitHub's release service could not be reached.".to_owned())?;

    if !response.status().is_success() {
        return Err(format!(
            "GitHub's release service returned status {}.",
            response.status().as_u16()
        ));
    }

    let release = response
        .json::<GithubRelease>()
        .await
        .map_err(|_| "GitHub returned invalid release information.".to_owned())?;
    let manifest_url = update_manifest_asset_url(&release)?;
    fetch_update_manifest_url(client, &manifest_url).await
}

async fn fetch_update_manifest(client: &reqwest::Client) -> Result<LauncherUpdateManifest, String> {
    match fetch_update_manifest_from_github(client).await {
        Ok(update) => Ok(update),
        Err(primary_error) => {
            match fetch_update_manifest_url(client, LEGACY_UPDATE_MANIFEST_URL).await {
                Ok(update) => Ok(update),
                Err(fallback_error) => Err(format!(
                    "Update check failed: {primary_error} Fallback: {fallback_error}"
                )),
            }
        }
    }
}

#[tauri::command]
pub async fn check_launcher_update(
    app: AppHandle,
) -> Result<Option<LauncherUpdateManifest>, String> {
    // Microsoft Store packages are serviced by the Store. Running the external
    // NSIS updater from a packaged app would break the package identity.
    if is_store_package() {
        return Ok(None);
    }

    let client = reqwest::Client::builder()
        .user_agent(format!(
            "AsterLauncher-Updater/{}",
            app.package_info().version
        ))
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|_| "The update service could not be initialized.".to_owned())?;
    let update = fetch_update_manifest(&client).await?;
    verify_update(&update)?;

    let current = app.package_info().version.clone();
    let available = Version::parse(update.version.trim_start_matches('v'))
        .map_err(|_| "The update version is invalid.".to_owned())?;

    if available > current {
        Ok(Some(update))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn open_launcher_downloads() -> Result<(), String> {
    open::that_detached(RELEASES_PAGE_URL)
        .map_err(|_| "The launcher download page could not be opened.".to_owned())
}

fn update_file_path(version: &str) -> PathBuf {
    let safe_version: String = version
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '.')
        .collect::<String>()
        .trim_matches('.')
        .to_owned();
    std::env::temp_dir().join(format!("aster-launcher-update-{safe_version}.exe"))
}

#[tauri::command]
pub async fn download_launcher_update(
    update: LauncherUpdateManifest,
    on_event: Channel<UpdateDownloadEvent>,
) -> Result<String, String> {
    verify_update(&update)?;

    let response = reqwest::Client::new()
        .get(&update.url)
        .header("User-Agent", "AsterLauncher-Updater")
        .timeout(std::time::Duration::from_secs(10 * 60))
        .send()
        .await
        .map_err(|_| "The launcher update download could not be started.".to_owned())?;

    if !response.status().is_success() {
        return Err(format!(
            "The update download returned status {}.",
            response.status().as_u16()
        ));
    }

    let content_length = response.content_length();
    if content_length.is_some_and(|length| length > MAX_UPDATE_BYTES) {
        return Err("The launcher update is unexpectedly large.".to_owned());
    }

    let _ = on_event.send(UpdateDownloadEvent::Started { content_length });
    let destination = update_file_path(&update.version);
    let partial = destination.with_extension("exe.part");
    let mut file = tokio::fs::File::create(&partial)
        .await
        .map_err(|_| "The update file could not be created.".to_owned())?;
    let mut response = response;
    let mut hasher = Sha256::new();
    let mut downloaded = 0_u64;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The update download was interrupted.".to_owned())?
    {
        downloaded += chunk.len() as u64;
        if downloaded > MAX_UPDATE_BYTES {
            let _ = tokio::fs::remove_file(&partial).await;
            return Err("The launcher update is unexpectedly large.".to_owned());
        }

        file.write_all(&chunk)
            .await
            .map_err(|_| "The update file could not be saved.".to_owned())?;
        hasher.update(&chunk);
        let _ = on_event.send(UpdateDownloadEvent::Progress {
            chunk_length: chunk.len(),
        });
    }

    file.flush()
        .await
        .map_err(|_| "The update file could not be finalized.".to_owned())?;
    drop(file);

    let actual_hash = format!("{:x}", hasher.finalize());
    if !actual_hash.eq_ignore_ascii_case(&update.sha256) {
        let _ = tokio::fs::remove_file(&partial).await;
        return Err("The downloaded update failed its integrity check.".to_owned());
    }

    if tokio::fs::try_exists(&destination).await.unwrap_or(false) {
        let _ = tokio::fs::remove_file(&destination).await;
    }
    tokio::fs::rename(&partial, &destination)
        .await
        .map_err(|_| "The update file could not be finalized.".to_owned())?;
    let _ = on_event.send(UpdateDownloadEvent::Finished);

    Ok(destination.to_string_lossy().into_owned())
}

#[cfg(target_os = "windows")]
fn powershell_literal(path: &Path) -> String {
    path.to_string_lossy().replace('\'', "''")
}

#[tauri::command]
pub fn install_launcher_update(app: AppHandle, installer_path: String) -> Result<(), String> {
    if is_store_package() {
        return Err("Microsoft Store installs are updated by the Store.".to_owned());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, installer_path);
        return Err("Automatic installation is currently available on Windows.".to_owned());
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        let installer = PathBuf::from(installer_path)
            .canonicalize()
            .map_err(|_| "The downloaded update no longer exists.".to_owned())?;
        let temp = std::env::temp_dir()
            .canonicalize()
            .map_err(|_| "The Windows temporary directory is unavailable.".to_owned())?;
        let trusted_name = installer
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| {
                name.starts_with("aster-launcher-update-") && name.ends_with(".exe")
            });

        if !installer.starts_with(&temp) || !trusted_name {
            return Err("The update installer path is not trusted.".to_owned());
        }

        let current_executable = std::env::current_exe()
            .map_err(|_| "The launcher executable could not be located.".to_owned())?;
        let helper_path = temp.join(format!(
            "aster-launcher-update-helper-{}.ps1",
            std::process::id()
        ));
        let script = format!(
            "$ErrorActionPreference='SilentlyContinue'\n\
             Wait-Process -Id {} -ErrorAction SilentlyContinue\n\
             $installer = Start-Process -FilePath '{}' -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru\n\
             if ($installer.ExitCode -eq 0) {{ Start-Process -FilePath '{}' -WindowStyle Hidden }}\n\
             Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue\n",
            std::process::id(),
            powershell_literal(&installer),
            powershell_literal(&current_executable),
        );
        std::fs::write(&helper_path, script)
            .map_err(|_| "The update installer helper could not be created.".to_owned())?;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-WindowStyle",
                "Hidden",
                "-File",
                &helper_path.to_string_lossy(),
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|_| "The update installer could not be started.".to_owned())?;

        app.exit(0);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        canonical_payload, update_file_path, update_manifest_asset_url, verify_update,
        GithubRelease, GithubReleaseAsset, LauncherUpdateManifest,
    };

    fn example_update() -> LauncherUpdateManifest {
        LauncherUpdateManifest {
            version: "0.2.0".to_owned(),
            name: "Starlight Update".to_owned(),
            description: "Launcher fixes".to_owned(),
            published_at: "2026-07-27T12:00:00Z".to_owned(),
            url: "https://github.com/asterlauncher/Aster-Launcher/releases/download/app-v0.2.0/Aster.exe".to_owned(),
            sha256: "a".repeat(64),
            signature: "kITVjEqwmqRIj0ptrja95bSUm8j9GyT4MtxsFjetY7M8HxcH37bMKzzh//NM6wV2Y4Tdj8yn/Ka/2N2lfuyXDQ==".to_owned(),
        }
    }

    #[test]
    fn canonical_payload_has_stable_field_order() {
        let payload = canonical_payload(&example_update());
        assert!(payload.starts_with("0.2.0\nStarlight Update\nLauncher fixes\n"));
        assert!(payload.ends_with(&"a".repeat(64)));
    }

    #[test]
    fn update_filename_strips_unsafe_characters() {
        let path = update_file_path("../../0.2.0 beta");
        assert_eq!(
            path.file_name().and_then(|name| name.to_str()),
            Some("aster-launcher-update-0.2.0beta.exe")
        );
    }

    #[test]
    fn accepts_manifest_signed_by_the_embedded_public_key() {
        assert!(verify_update(&example_update()).is_ok());
    }

    fn example_release(assets: Vec<GithubReleaseAsset>) -> GithubRelease {
        GithubRelease {
            tag_name: "app-v0.4.9".to_owned(),
            draft: false,
            prerelease: false,
            assets,
        }
    }

    #[test]
    fn selects_the_exact_update_manifest_asset() {
        let release = example_release(vec![
            GithubReleaseAsset {
                name: "aster-update-0.4.9.json".to_owned(),
                browser_download_url: "https://example.invalid/wrong".to_owned(),
            },
            GithubReleaseAsset {
                name: "aster-update.json".to_owned(),
                browser_download_url: "https://example.invalid/correct".to_owned(),
            },
        ]);

        assert_eq!(
            update_manifest_asset_url(&release).as_deref(),
            Ok("https://example.invalid/correct")
        );
    }

    #[test]
    fn rejects_a_release_without_the_stable_manifest_name() {
        let release = example_release(vec![GithubReleaseAsset {
            name: "aster-update-0.4.9.json".to_owned(),
            browser_download_url: "https://example.invalid/wrong".to_owned(),
        }]);

        assert!(update_manifest_asset_url(&release).is_err());
    }
}
