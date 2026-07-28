use crate::{
    content,
    models::content::{ContentErrorPayload, ContentSearchResult},
};

#[tauri::command]
pub async fn search_content(
    provider: String,
    content_type: String,
    query: String,
    game_version: Option<String>,
    category: Option<String>,
    loader: Option<String>,
    sort: String,
    offset: usize,
    limit: usize,
) -> Result<ContentSearchResult, ContentErrorPayload> {
    content::search(
        &provider,
        &content_type,
        query.trim(),
        game_version.as_deref(),
        category.as_deref(),
        loader.as_deref(),
        &sort,
        offset,
        limit,
    )
    .await
}

#[tauri::command]
pub async fn get_content_releases(
    provider: String,
    project_id: String,
    game_version: Option<String>,
    offset: usize,
    limit: usize,
) -> Result<crate::models::content::ContentReleasePage, ContentErrorPayload> {
    content::releases(
        &provider,
        &project_id,
        game_version.as_deref(),
        offset,
        limit,
    )
    .await
}

#[tauri::command]
pub async fn resolve_content_install(
    provider: String,
    project_id: String,
    release_id: String,
    game_version: String,
    loader: String,
) -> Result<crate::models::content::ContentInstallPlan, ContentErrorPayload> {
    content::resolve_install_plan(&provider, &project_id, &release_id, &game_version, &loader).await
}

#[tauri::command]
pub fn open_content_project(project_url: String) -> Result<(), ContentErrorPayload> {
    content::open_project(&project_url)
}
