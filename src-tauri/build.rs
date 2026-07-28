use std::{env, fs, path::Path};

fn main() {
    println!("cargo:rerun-if-changed=../.env");
    println!("cargo:rerun-if-changed=icons/icon.png");

    if let Some(client_id) = read_env_value(Path::new("../.env"), "VITE_MICROSOFT_CLIENT_ID")
        .or_else(|| env::var("VITE_MICROSOFT_CLIENT_ID").ok())
        .filter(|value| !value.trim().is_empty())
    {
        println!("cargo:rustc-env=VITE_MICROSOFT_CLIENT_ID={client_id}");
    }

    tauri_build::build()
}

fn read_env_value(path: &Path, key: &str) -> Option<String> {
    let contents = fs::read_to_string(path).ok()?;
    contents.lines().find_map(|line| {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            return None;
        }
        let (candidate, value) = line.split_once('=')?;
        (candidate.trim() == key).then(|| value.trim().trim_matches('"').to_owned())
    })
}
