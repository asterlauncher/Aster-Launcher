mod auth;
mod commands;
mod content;
mod errors;
mod models;

use auth::{AuthService, AuthState};
use tauri::Manager;

fn aster_window_icon() -> tauri::image::Image<'static> {
    const SIZE: u32 = 64;
    const SAMPLES: u32 = 4;
    const SAMPLE_COUNT: u32 = SAMPLES * SAMPLES;
    const STAR: [(f64, f64); 8] = [
        (32.0, 14.0),
        (36.5, 27.5),
        (50.0, 32.0),
        (36.5, 36.5),
        (32.0, 50.0),
        (27.5, 36.5),
        (14.0, 32.0),
        (27.5, 27.5),
    ];

    let mut rgba = Vec::with_capacity((SIZE * SIZE * 4) as usize);

    for y in 0..SIZE {
        for x in 0..SIZE {
            let mut covered = 0_u32;
            let mut red = 0_u32;
            let mut green = 0_u32;
            let mut blue = 0_u32;

            for sample_y in 0..SAMPLES {
                for sample_x in 0..SAMPLES {
                    let px = x as f64 + (sample_x as f64 + 0.5) / SAMPLES as f64;
                    let py = y as f64 + (sample_y as f64 + 0.5) / SAMPLES as f64;
                    let distance = ((px - 32.0).powi(2) + (py - 32.0).powi(2)).sqrt();

                    if distance <= 30.0 {
                        covered += 1;
                        let is_white = distance >= 27.5 || point_in_polygon(px, py, &STAR);
                        let color = if is_white {
                            [247_u32, 247_u32, 247_u32]
                        } else {
                            [17_u32, 16_u32, 20_u32]
                        };
                        red += color[0];
                        green += color[1];
                        blue += color[2];
                    }
                }
            }

            if covered == 0 {
                rgba.extend_from_slice(&[0, 0, 0, 0]);
            } else {
                rgba.extend_from_slice(&[
                    (red / covered) as u8,
                    (green / covered) as u8,
                    (blue / covered) as u8,
                    ((covered * 255) / SAMPLE_COUNT) as u8,
                ]);
            }
        }
    }

    tauri::image::Image::new_owned(rgba, SIZE, SIZE)
}

fn point_in_polygon(x: f64, y: f64, points: &[(f64, f64)]) -> bool {
    let mut inside = false;
    let mut previous = points.len() - 1;

    for current in 0..points.len() {
        let (current_x, current_y) = points[current];
        let (previous_x, previous_y) = points[previous];
        let crosses = (current_y > y) != (previous_y > y)
            && x < (previous_x - current_x) * (y - current_y) / (previous_y - current_y)
                + current_x;
        if crosses {
            inside = !inside;
        }
        previous = current;
    }

    inside
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.set_icon(aster_window_icon())?;
            }

            let skin_directory = app.path().app_local_data_dir()?.join("skins");
            std::fs::create_dir_all(&skin_directory)?;
            let service = AuthService::new(skin_directory)?;
            app.manage(AuthState::new(service));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth_commands::begin_microsoft_login,
            commands::auth_commands::complete_microsoft_login,
            commands::auth_commands::get_active_account,
            commands::auth_commands::refresh_active_account,
            commands::auth_commands::sign_out,
            commands::auth_commands::get_auth_status,
            commands::content_commands::search_content,
            commands::content_commands::get_content_releases,
            commands::content_commands::resolve_content_install,
            commands::content_commands::open_content_project,
            commands::instance_commands::open_instance_folder,
            commands::instance_commands::open_launcher_data_folder,
            commands::instance_commands::create_instance_structure,
            commands::instance_commands::list_instance_content,
            commands::instance_commands::scan_instance_mods,
            commands::instance_commands::import_instance_content,
            commands::instance_commands::set_instance_content_enabled,
            commands::instance_commands::remove_instance_content,
            commands::instance_commands::open_instance_content_folder,
            commands::instance_commands::download_instance_content,
            commands::instance_commands::set_instance_icon,
            commands::launch_commands::list_minecraft_versions,
            commands::launch_commands::launch_instance,
            commands::modpack_commands::install_modpack,
            commands::modpack_commands::export_modpack,
            commands::modpack_commands::export_modpack_for_sharing,
            commands::modpack_commands::import_modpack,
            commands::social_commands::upload_chat_attachment,
            commands::social_commands::download_chat_attachment,
            commands::social_commands::download_chat_modpack_for_import,
            commands::social_commands::remove_cached_chat_attachment,
            commands::update_commands::check_launcher_update,
            commands::update_commands::open_launcher_downloads,
            commands::update_commands::download_launcher_update,
            commands::update_commands::install_launcher_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Aster Launcher");
}
