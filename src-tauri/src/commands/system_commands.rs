use serde::Serialize;

const GIBIBYTE: f64 = 1024.0 * 1024.0 * 1024.0;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMemoryInfo {
    total_memory_bytes: u64,
    total_memory_gb: u16,
}

#[cfg(windows)]
fn total_physical_memory() -> Result<u64, String> {
    use std::mem::{size_of, zeroed};
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};

    // SAFETY: MEMORYSTATUSEX is initialized with its documented structure size
    // before Windows writes the remaining fields.
    let mut status: MEMORYSTATUSEX = unsafe { zeroed() };
    status.dwLength = size_of::<MEMORYSTATUSEX>() as u32;

    if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 {
        return Err("Windows could not report the installed system memory.".to_owned());
    }

    Ok(status.ullTotalPhys)
}

#[cfg(not(windows))]
fn total_physical_memory() -> Result<u64, String> {
    Err("System memory detection is not available on this platform.".to_owned())
}

#[tauri::command]
pub fn get_system_memory_info() -> Result<SystemMemoryInfo, String> {
    let total_memory_bytes = total_physical_memory()?;
    let total_memory_gb = ((total_memory_bytes as f64 / GIBIBYTE).round() as u16).max(1);

    Ok(SystemMemoryInfo {
        total_memory_bytes,
        total_memory_gb,
    })
}

#[cfg(test)]
mod tests {
    use super::GIBIBYTE;

    #[test]
    fn gibibyte_constant_matches_binary_memory_units() {
        assert_eq!(GIBIBYTE as u64, 1_073_741_824);
    }
}
