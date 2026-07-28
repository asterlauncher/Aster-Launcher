use std::collections::{HashSet, VecDeque};

use reqwest::{Client, StatusCode};
use serde::Deserialize;

use crate::models::content::{
    ContentErrorPayload, ContentInstallPlan, ContentProject, ContentRelease, ContentReleasePage,
    ContentSearchResult, ResolvedContentFile,
};

const MODRINTH_API: &str = "https://api.modrinth.com/v2";
const CURSEFORGE_API: &str = "https://api.curseforge.com/v1";
const MINECRAFT_GAME_ID: u32 = 432;
const USER_AGENT: &str =
    "AsterLauncher/0.4.8 (https://github.com/asterlauncher/Aster-Launcher)";

pub async fn search(
    provider: &str,
    content_type: &str,
    query: &str,
    game_version: Option<&str>,
    category: Option<&str>,
    loader: Option<&str>,
    sort: &str,
    offset: usize,
    limit: usize,
) -> Result<ContentSearchResult, ContentErrorPayload> {
    let limit = limit.clamp(1, 50);
    match provider {
        "modrinth" => {
            search_modrinth(
                content_type,
                query,
                game_version,
                category,
                loader,
                sort,
                offset,
                limit,
            )
            .await
        }
        "curseforge" => {
            search_curseforge(
                content_type,
                query,
                game_version,
                loader,
                sort,
                offset,
                limit,
            )
            .await
        }
        _ => Err(ContentErrorPayload {
            code: "invalid_provider",
            message: "This content provider is not supported.".to_owned(),
        }),
    }
}

pub async fn releases(
    provider: &str,
    project_id: &str,
    game_version: Option<&str>,
    offset: usize,
    limit: usize,
) -> Result<ContentReleasePage, ContentErrorPayload> {
    let limit = limit.clamp(1, 20);
    match provider {
        "modrinth" => modrinth_releases(project_id, game_version, offset, limit).await,
        "curseforge" => curseforge_releases(project_id, game_version, offset, limit).await,
        _ => Err(ContentErrorPayload {
            code: "invalid_provider",
            message: "This content provider is not supported.".to_owned(),
        }),
    }
}

pub async fn resolve_install_plan(
    provider: &str,
    project_id: &str,
    release_id: &str,
    game_version: &str,
    loader: &str,
) -> Result<ContentInstallPlan, ContentErrorPayload> {
    if !valid_provider_id(project_id) || !valid_provider_id(release_id) {
        return Err(ContentErrorPayload {
            code: "invalid_release",
            message: "The selected content release is invalid.".to_owned(),
        });
    }
    match provider {
        "modrinth" => resolve_modrinth_install(project_id, release_id, game_version, loader).await,
        "curseforge" => {
            resolve_curseforge_install(project_id, release_id, game_version, loader).await
        }
        _ => Err(ContentErrorPayload {
            code: "invalid_provider",
            message: "This content provider is not supported.".to_owned(),
        }),
    }
}

fn valid_provider_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
}

fn release_matches(release: &ModrinthRelease, game_version: &str, loader: &str) -> bool {
    let game_matches = game_version.is_empty()
        || release
            .game_versions
            .iter()
            .any(|value| value == game_version);
    let normalized_loader = loader.to_ascii_lowercase();
    let loader_matches = normalized_loader.is_empty()
        || normalized_loader == "vanilla"
        || release
            .loaders
            .iter()
            .any(|value| value.eq_ignore_ascii_case(&normalized_loader));
    game_matches && loader_matches
}

async fn fetch_modrinth_release(
    client: &Client,
    version_id: &str,
) -> Result<ModrinthRelease, ContentErrorPayload> {
    if !valid_provider_id(version_id) {
        return Err(invalid_dependency());
    }
    let response = client
        .get(format!("{MODRINTH_API}/version/{version_id}"))
        .send()
        .await
        .map_err(network_error)?;
    if !response.status().is_success() {
        return Err(provider_error("Modrinth", response.status()));
    }
    response
        .json()
        .await
        .map_err(|_| invalid_response("Modrinth"))
}

async fn select_modrinth_dependency(
    client: &Client,
    dependency: &ModrinthDependency,
    game_version: &str,
    loader: &str,
) -> Result<ModrinthRelease, ContentErrorPayload> {
    if let Some(version_id) = dependency.version_id.as_deref() {
        let release = fetch_modrinth_release(client, version_id).await?;
        return release_matches(&release, game_version, loader)
            .then_some(release)
            .ok_or_else(incompatible_dependency);
    }
    let project_id = dependency
        .project_id
        .as_deref()
        .filter(|value| valid_provider_id(value))
        .ok_or_else(invalid_dependency)?;
    let game_versions = serde_json::to_string(&[game_version]).map_err(|_| internal_error())?;
    let loaders =
        serde_json::to_string(&[loader.to_ascii_lowercase()]).map_err(|_| internal_error())?;
    let response = client
        .get(format!("{MODRINTH_API}/project/{project_id}/version"))
        .query(&[
            ("game_versions", game_versions.as_str()),
            ("loaders", loaders.as_str()),
        ])
        .send()
        .await
        .map_err(network_error)?;
    if !response.status().is_success() {
        return Err(provider_error("Modrinth", response.status()));
    }
    response
        .json::<Vec<ModrinthRelease>>()
        .await
        .map_err(|_| invalid_response("Modrinth"))?
        .into_iter()
        .find(|release| release_matches(release, game_version, loader))
        .ok_or_else(incompatible_dependency)
}

async fn resolve_modrinth_install(
    project_id: &str,
    release_id: &str,
    game_version: &str,
    loader: &str,
) -> Result<ContentInstallPlan, ContentErrorPayload> {
    let client = client()?;
    let root = fetch_modrinth_release(&client, release_id).await?;
    if root.project_id != project_id || !release_matches(&root, game_version, loader) {
        return Err(incompatible_dependency());
    }

    let mut queue = VecDeque::from([(root, false)]);
    let mut visited = HashSet::new();
    let mut files = Vec::new();
    while let Some((release, is_dependency)) = queue.pop_front() {
        if !visited.insert(release.id.clone()) {
            continue;
        }
        if visited.len() > 64 {
            return Err(ContentErrorPayload {
                code: "dependency_limit",
                message: "This mod has more than 64 nested dependencies.".to_owned(),
            });
        }
        for dependency in release
            .dependencies
            .iter()
            .filter(|dependency| dependency.dependency_type == "required")
        {
            queue.push_back((
                select_modrinth_dependency(&client, dependency, game_version, loader).await?,
                true,
            ));
        }
        let file = release
            .files
            .iter()
            .find(|file| file.primary)
            .or_else(|| release.files.first())
            .ok_or_else(invalid_dependency)?;
        files.push(ResolvedContentFile {
            project_id: release.project_id,
            release_id: release.id,
            name: release.name,
            version_number: release.version_number,
            file_name: file.filename.clone(),
            download_url: file.url.clone(),
            icon_url: None,
            is_dependency,
        });
    }
    files.reverse();
    let dependency_count = files.iter().filter(|file| file.is_dependency).count();
    Ok(ContentInstallPlan {
        files,
        dependency_count,
    })
}

async fn fetch_curseforge_file(
    client: &Client,
    api_key: &str,
    project_id: u64,
    release_id: u64,
) -> Result<CurseForgeFile, ContentErrorPayload> {
    let response = client
        .get(format!(
            "{CURSEFORGE_API}/mods/{project_id}/files/{release_id}"
        ))
        .header("x-api-key", api_key)
        .send()
        .await
        .map_err(network_error)?;
    if !response.status().is_success() {
        return Err(provider_error("CurseForge", response.status()));
    }
    response
        .json::<CurseForgeFileResponse>()
        .await
        .map(|response| response.data)
        .map_err(|_| invalid_response("CurseForge"))
}

async fn select_curseforge_dependency(
    client: &Client,
    api_key: &str,
    project_id: u64,
    game_version: &str,
    loader: &str,
) -> Result<CurseForgeFile, ContentErrorPayload> {
    let mut request = client
        .get(format!("{CURSEFORGE_API}/mods/{project_id}/files"))
        .header("x-api-key", api_key)
        .query(&[
            ("gameVersion", game_version.to_owned()),
            ("pageSize", "50".to_owned()),
        ]);
    if let Some(loader_type) = curseforge_loader(loader) {
        request = request.query(&[("modLoaderType", loader_type)]);
    }
    let response = request.send().await.map_err(network_error)?;
    if !response.status().is_success() {
        return Err(provider_error("CurseForge", response.status()));
    }
    response
        .json::<CurseForgeFiles>()
        .await
        .map_err(|_| invalid_response("CurseForge"))?
        .data
        .into_iter()
        .find(|file| {
            file.game_versions.iter().any(|value| value == game_version)
                && (loader.is_empty()
                    || loader.eq_ignore_ascii_case("vanilla")
                    || file
                        .game_versions
                        .iter()
                        .any(|value| value.eq_ignore_ascii_case(loader)))
        })
        .ok_or_else(incompatible_dependency)
}

async fn curseforge_download_url(
    client: &Client,
    api_key: &str,
    file: &CurseForgeFile,
) -> Result<String, ContentErrorPayload> {
    if let Some(url) = file.download_url.clone() {
        return Ok(url);
    }
    let response = client
        .get(format!(
            "{CURSEFORGE_API}/mods/{}/files/{}/download-url",
            file.mod_id, file.id
        ))
        .header("x-api-key", api_key)
        .send()
        .await
        .map_err(network_error)?;
    if !response.status().is_success() {
        return Err(provider_error("CurseForge", response.status()));
    }
    response
        .json::<CurseForgeDownloadUrl>()
        .await
        .map(|response| response.data)
        .map_err(|_| invalid_response("CurseForge"))
}

async fn resolve_curseforge_install(
    project_id: &str,
    release_id: &str,
    game_version: &str,
    loader: &str,
) -> Result<ContentInstallPlan, ContentErrorPayload> {
    let project_id = project_id
        .parse::<u64>()
        .map_err(|_| invalid_dependency())?;
    let release_id = release_id
        .parse::<u64>()
        .map_err(|_| invalid_dependency())?;
    let api_key = curseforge_api_key().ok_or_else(|| ContentErrorPayload {
        code: "curseforge_not_configured",
        message: "CurseForge dependency downloads need an API key.".to_owned(),
    })?;
    let client = client()?;
    let root = fetch_curseforge_file(&client, &api_key, project_id, release_id).await?;
    if root.mod_id != project_id {
        return Err(invalid_dependency());
    }
    let mut queue = VecDeque::from([(root, false)]);
    let mut visited = HashSet::new();
    let mut files = Vec::new();
    while let Some((file, is_dependency)) = queue.pop_front() {
        if !visited.insert(file.id) {
            continue;
        }
        if visited.len() > 64 {
            return Err(ContentErrorPayload {
                code: "dependency_limit",
                message: "This mod has more than 64 nested dependencies.".to_owned(),
            });
        }
        for dependency in file
            .dependencies
            .iter()
            .filter(|dependency| dependency.relation_type == 3)
        {
            queue.push_back((
                select_curseforge_dependency(
                    &client,
                    &api_key,
                    dependency.mod_id,
                    game_version,
                    loader,
                )
                .await?,
                true,
            ));
        }
        let download_url = curseforge_download_url(&client, &api_key, &file).await?;
        files.push(ResolvedContentFile {
            project_id: file.mod_id.to_string(),
            release_id: file.id.to_string(),
            name: file.display_name.clone(),
            version_number: file.display_name,
            file_name: file.file_name,
            download_url,
            icon_url: None,
            is_dependency,
        });
    }
    files.reverse();
    let dependency_count = files.iter().filter(|file| file.is_dependency).count();
    Ok(ContentInstallPlan {
        files,
        dependency_count,
    })
}

pub fn open_project(project_url: &str) -> Result<(), ContentErrorPayload> {
    let url = url::Url::parse(project_url).map_err(|_| invalid_project_url())?;
    let host = url.host_str().unwrap_or_default();
    let trusted = url.scheme() == "https"
        && (host == "modrinth.com"
            || host.ends_with(".modrinth.com")
            || host == "curseforge.com"
            || host.ends_with(".curseforge.com"));

    if !trusted {
        return Err(invalid_project_url());
    }

    open::that_detached(url.as_str()).map_err(|_| ContentErrorPayload {
        code: "open_failed",
        message: "The project page could not be opened.".to_owned(),
    })
}

async fn search_modrinth(
    content_type: &str,
    query: &str,
    game_version: Option<&str>,
    category: Option<&str>,
    loader: Option<&str>,
    sort: &str,
    offset: usize,
    limit: usize,
) -> Result<ContentSearchResult, ContentErrorPayload> {
    let project_type = modrinth_project_type(content_type)?;
    let mut facets = vec![vec![format!("project_type:{project_type}")]];
    if let Some(version) = game_version.filter(|value| !value.is_empty()) {
        facets.push(vec![format!("versions:{version}")]);
    }
    if let Some(category) = category.filter(|value| !value.is_empty()) {
        facets.push(vec![format!("categories:{category}")]);
    }
    if let Some(loader) = loader.filter(|value| !value.is_empty()) {
        facets.push(vec![format!("categories:{}", loader.to_ascii_lowercase())]);
    }
    let facets = serde_json::to_string(&facets).map_err(|_| internal_error())?;
    let index = modrinth_sort(sort);
    let offset = offset.to_string();
    let limit = limit.to_string();

    let response = client()?
        .get(format!("{MODRINTH_API}/search"))
        .query(&[
            ("query", query),
            ("facets", facets.as_str()),
            ("index", index),
            ("offset", offset.as_str()),
            ("limit", limit.as_str()),
        ])
        .send()
        .await
        .map_err(network_error)?;

    if !response.status().is_success() {
        return Err(provider_error("Modrinth", response.status()));
    }

    let result = response
        .json::<ModrinthSearch>()
        .await
        .map_err(|_| invalid_response("Modrinth"))?;

    Ok(ContentSearchResult {
        total: result.total_hits,
        projects: result
            .hits
            .into_iter()
            .map(|project| ContentProject {
                id: project.project_id,
                project_url: format!("https://modrinth.com/{project_type}/{}", project.slug),
                name: project.title,
                author: project.author,
                description: project.description,
                categories: project.display_categories.into_iter().take(3).collect(),
                downloads: project.downloads,
                provider: "Modrinth".to_owned(),
                versions: project.versions,
                icon_url: project.icon_url,
            })
            .collect(),
    })
}

async fn search_curseforge(
    content_type: &str,
    query: &str,
    game_version: Option<&str>,
    loader: Option<&str>,
    sort: &str,
    offset: usize,
    limit: usize,
) -> Result<ContentSearchResult, ContentErrorPayload> {
    let api_key = curseforge_api_key().ok_or_else(|| ContentErrorPayload {
        code: "curseforge_not_configured",
        message: "CurseForge browsing needs an API key. Modrinth is available now.".to_owned(),
    })?;
    let class_id = curseforge_class_id(content_type)?;
    let mut request = client()?
        .get(format!("{CURSEFORGE_API}/mods/search"))
        .header("x-api-key", api_key)
        .query(&[
            ("gameId", MINECRAFT_GAME_ID.to_string()),
            ("classId", class_id.to_string()),
            ("searchFilter", query.to_owned()),
            ("sortField", curseforge_sort(sort).to_string()),
            ("sortOrder", "desc".to_owned()),
            ("index", offset.to_string()),
            ("pageSize", limit.to_string()),
        ]);

    if let Some(version) = game_version.filter(|value| !value.is_empty()) {
        request = request.query(&[("gameVersion", version)]);
        if let Some(loader) = loader.and_then(curseforge_loader) {
            request = request.query(&[("modLoaderType", loader)]);
        }
    }

    let response = request.send().await.map_err(network_error)?;
    if !response.status().is_success() {
        return Err(provider_error("CurseForge", response.status()));
    }

    let result = response
        .json::<CurseForgeSearch>()
        .await
        .map_err(|_| invalid_response("CurseForge"))?;

    Ok(ContentSearchResult {
        total: result.pagination.total_count,
        projects: result
            .data
            .into_iter()
            .map(|project| {
                let versions = project
                    .latest_files_indexes
                    .into_iter()
                    .map(|file| file.game_version)
                    .collect();
                ContentProject {
                    id: project.id.to_string(),
                    project_url: project
                        .links
                        .map(|links| links.website_url)
                        .unwrap_or_else(|| "https://www.curseforge.com/minecraft".to_owned()),
                    name: project.name,
                    author: project
                        .authors
                        .into_iter()
                        .next()
                        .map(|author| author.name)
                        .unwrap_or_else(|| "Unknown".to_owned()),
                    description: project.summary,
                    categories: project
                        .categories
                        .into_iter()
                        .map(|category| category.name)
                        .take(3)
                        .collect(),
                    downloads: project.download_count.max(0.0) as u64,
                    provider: "CurseForge".to_owned(),
                    versions,
                    icon_url: project.logo.map(|logo| logo.thumbnail_url),
                }
            })
            .collect(),
    })
}

async fn modrinth_releases(
    project_id: &str,
    game_version: Option<&str>,
    offset: usize,
    limit: usize,
) -> Result<ContentReleasePage, ContentErrorPayload> {
    let mut request = client()?.get(format!("{MODRINTH_API}/project/{project_id}/version"));
    if let Some(version) = game_version.filter(|value| !value.is_empty()) {
        let versions = serde_json::to_string(&[version]).map_err(|_| internal_error())?;
        request = request.query(&[("game_versions", versions)]);
    }

    let response = request.send().await.map_err(network_error)?;
    if !response.status().is_success() {
        return Err(provider_error("Modrinth", response.status()));
    }
    let releases = response
        .json::<Vec<ModrinthRelease>>()
        .await
        .map_err(|_| invalid_response("Modrinth"))?;

    let total = releases.len();
    let releases = releases
        .into_iter()
        .skip(offset)
        .take(limit)
        .map(|release| {
            let file = release
                .files
                .iter()
                .find(|file| file.primary)
                .or_else(|| release.files.first());
            ContentRelease {
                id: release.id,
                display_name: release.name,
                version_number: release.version_number,
                game_versions: release.game_versions,
                loaders: release.loaders,
                dependency_count: release.dependencies.len(),
                file_name: file.map(|file| file.filename.clone()).unwrap_or_default(),
                download_url: file.map(|file| file.url.clone()),
                file_size: file.map(|file| file.size).unwrap_or_default(),
            }
        })
        .collect();

    Ok(ContentReleasePage { releases, total })
}

async fn curseforge_releases(
    project_id: &str,
    game_version: Option<&str>,
    offset: usize,
    limit: usize,
) -> Result<ContentReleasePage, ContentErrorPayload> {
    let api_key = curseforge_api_key().ok_or_else(|| ContentErrorPayload {
        code: "curseforge_not_configured",
        message: "CurseForge browsing needs an API key. Modrinth is available now.".to_owned(),
    })?;
    let mut request = client()?
        .get(format!("{CURSEFORGE_API}/mods/{project_id}/files"))
        .header("x-api-key", api_key)
        .query(&[
            ("index", offset.to_string()),
            ("pageSize", limit.to_string()),
        ]);
    if let Some(version) = game_version.filter(|value| !value.is_empty()) {
        request = request.query(&[("gameVersion", version)]);
    }

    let response = request.send().await.map_err(network_error)?;
    if !response.status().is_success() {
        return Err(provider_error("CurseForge", response.status()));
    }
    let releases = response
        .json::<CurseForgeFiles>()
        .await
        .map_err(|_| invalid_response("CurseForge"))?;

    let total = releases.pagination.total_count as usize;
    let releases = releases
        .data
        .into_iter()
        .map(|release| {
            let loaders = release
                .game_versions
                .iter()
                .filter(|value| is_loader(value))
                .cloned()
                .collect();
            ContentRelease {
                id: release.id.to_string(),
                display_name: release.display_name,
                version_number: release.file_name.clone(),
                game_versions: release.game_versions,
                loaders,
                dependency_count: release.dependencies.len(),
                file_name: release.file_name,
                download_url: release.download_url,
                file_size: release.file_length,
            }
        })
        .collect();

    Ok(ContentReleasePage { releases, total })
}

fn client() -> Result<Client, ContentErrorPayload> {
    Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|_| internal_error())
}

fn modrinth_project_type(content_type: &str) -> Result<&'static str, ContentErrorPayload> {
    match content_type {
        "modpacks" => Ok("modpack"),
        "mods" => Ok("mod"),
        "resourcepacks" => Ok("resourcepack"),
        "shaders" => Ok("shader"),
        "datapacks" => Ok("datapack"),
        _ => Err(invalid_content_type()),
    }
}

fn curseforge_class_id(content_type: &str) -> Result<u32, ContentErrorPayload> {
    match content_type {
        "modpacks" => Ok(4471),
        "mods" => Ok(6),
        "resourcepacks" => Ok(12),
        "shaders" => Ok(6552),
        "datapacks" => Ok(6945),
        _ => Err(invalid_content_type()),
    }
}

fn modrinth_sort(sort: &str) -> &'static str {
    match sort {
        "relevance" => "relevance",
        "updated" => "updated",
        "newest" => "newest",
        _ => "downloads",
    }
}

fn curseforge_sort(sort: &str) -> u8 {
    match sort {
        "updated" => 3,
        "newest" => 11,
        "downloads" => 6,
        _ => 2,
    }
}

fn curseforge_loader(loader: &str) -> Option<&'static str> {
    match loader.to_ascii_lowercase().as_str() {
        "forge" => Some("1"),
        "fabric" => Some("4"),
        "quilt" => Some("5"),
        "neoforge" => Some("6"),
        _ => None,
    }
}

pub(crate) fn curseforge_api_key() -> Option<String> {
    std::env::var("CURSEFORGE_API_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            option_env!("CURSEFORGE_API_KEY")
                .filter(|value| !value.trim().is_empty())
                .map(str::to_owned)
        })
}

fn invalid_content_type() -> ContentErrorPayload {
    ContentErrorPayload {
        code: "invalid_content_type",
        message: "This content type is not supported.".to_owned(),
    }
}

fn invalid_project_url() -> ContentErrorPayload {
    ContentErrorPayload {
        code: "invalid_project_url",
        message: "Only official Modrinth and CurseForge project links can be opened.".to_owned(),
    }
}

fn is_loader(value: &str) -> bool {
    matches!(
        value.to_ascii_lowercase().as_str(),
        "fabric" | "forge" | "neoforge" | "quilt" | "liteloader"
    )
}

fn internal_error() -> ContentErrorPayload {
    ContentErrorPayload {
        code: "internal",
        message: "The content browser could not prepare its request.".to_owned(),
    }
}

fn network_error(_: reqwest::Error) -> ContentErrorPayload {
    ContentErrorPayload {
        code: "offline",
        message: "The content provider could not be reached. Check your connection.".to_owned(),
    }
}

fn invalid_response(provider: &str) -> ContentErrorPayload {
    ContentErrorPayload {
        code: "invalid_response",
        message: format!("{provider} returned an unexpected response."),
    }
}

fn invalid_dependency() -> ContentErrorPayload {
    ContentErrorPayload {
        code: "invalid_dependency",
        message: "A required dependency returned incomplete provider metadata.".to_owned(),
    }
}

fn incompatible_dependency() -> ContentErrorPayload {
    ContentErrorPayload {
        code: "incompatible_dependency",
        message: "A required dependency has no release for this Minecraft version and mod loader."
            .to_owned(),
    }
}

fn provider_error(provider: &str, status: StatusCode) -> ContentErrorPayload {
    let message = if status == StatusCode::TOO_MANY_REQUESTS {
        format!("{provider} is receiving too many requests. Try again shortly.")
    } else if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        format!("{provider} rejected the launcher API credentials.")
    } else {
        format!("{provider} could not complete the search.")
    };
    ContentErrorPayload {
        code: "provider_error",
        message,
    }
}

#[derive(Debug, Deserialize)]
struct ModrinthSearch {
    hits: Vec<ModrinthProject>,
    total_hits: u64,
}

#[derive(Debug, Deserialize)]
struct ModrinthProject {
    project_id: String,
    slug: String,
    title: String,
    description: String,
    author: String,
    #[serde(default)]
    display_categories: Vec<String>,
    #[serde(default)]
    versions: Vec<String>,
    downloads: u64,
    icon_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ModrinthRelease {
    id: String,
    project_id: String,
    name: String,
    version_number: String,
    #[serde(default)]
    game_versions: Vec<String>,
    #[serde(default)]
    loaders: Vec<String>,
    #[serde(default)]
    dependencies: Vec<ModrinthDependency>,
    #[serde(default)]
    files: Vec<ModrinthFile>,
}

#[derive(Debug, Deserialize)]
struct ModrinthFile {
    url: String,
    filename: String,
    size: u64,
    #[serde(default)]
    primary: bool,
}

#[derive(Debug, Deserialize)]
struct ModrinthDependency {
    dependency_type: String,
    project_id: Option<String>,
    version_id: Option<String>,
    #[allow(dead_code)]
    file_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CurseForgeSearch {
    data: Vec<CurseForgeProject>,
    pagination: CurseForgePagination,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseForgeProject {
    id: u64,
    name: String,
    summary: String,
    download_count: f64,
    #[serde(default)]
    authors: Vec<CurseForgeAuthor>,
    #[serde(default)]
    categories: Vec<CurseForgeCategory>,
    #[serde(default)]
    latest_files_indexes: Vec<CurseForgeFileIndex>,
    logo: Option<CurseForgeLogo>,
    links: Option<CurseForgeLinks>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseForgeAuthor {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseForgeCategory {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseForgeFileIndex {
    game_version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseForgeLogo {
    thumbnail_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseForgeLinks {
    website_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseForgePagination {
    total_count: u64,
}

#[derive(Debug, Deserialize)]
struct CurseForgeFiles {
    data: Vec<CurseForgeFile>,
    pagination: CurseForgePagination,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseForgeFile {
    id: u64,
    mod_id: u64,
    display_name: String,
    file_name: String,
    #[serde(default)]
    game_versions: Vec<String>,
    #[serde(default)]
    dependencies: Vec<CurseForgeDependency>,
    download_url: Option<String>,
    file_length: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseForgeDependency {
    mod_id: u64,
    relation_type: u8,
}

#[derive(Debug, Deserialize)]
struct CurseForgeFileResponse {
    data: CurseForgeFile,
}

#[derive(Debug, Deserialize)]
struct CurseForgeDownloadUrl {
    data: String,
}
