use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentProject {
    pub id: String,
    pub name: String,
    pub author: String,
    pub description: String,
    pub categories: Vec<String>,
    pub downloads: u64,
    pub provider: String,
    pub versions: Vec<String>,
    pub icon_url: Option<String>,
    pub project_url: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchResult {
    pub projects: Vec<ContentProject>,
    pub total: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentRelease {
    pub id: String,
    pub display_name: String,
    pub version_number: String,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub dependency_count: usize,
    pub file_name: String,
    pub download_url: Option<String>,
    pub file_size: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentReleasePage {
    pub releases: Vec<ContentRelease>,
    pub total: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedContentFile {
    pub project_id: String,
    pub release_id: String,
    pub name: String,
    pub version_number: String,
    pub file_name: String,
    pub download_url: String,
    pub icon_url: Option<String>,
    pub is_dependency: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentInstallPlan {
    pub files: Vec<ResolvedContentFile>,
    pub dependency_count: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentErrorPayload {
    pub code: &'static str,
    pub message: String,
}
