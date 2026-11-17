use tauri::State;

use fontnest_core::{Font, ScanSummary};

use crate::AppState;

const BUSY: &str = "字体索引被占用，请重试";

fn lock_error() -> String {
    BUSY.to_string()
}

/// 首次调用时惰性扫描。前端启动即拉全量，所以这里要把"还没扫过"当成正常路径。
#[tauri::command]
pub fn list_fonts(state: State<'_, AppState>) -> Result<Vec<Font>, String> {
    let mut library = state.library.lock().map_err(|_| lock_error())?;
    if library.is_empty() {
        library.scan();
    }
    Ok(library.fonts().to_vec())
}

#[tauri::command]
pub fn scan_fonts(state: State<'_, AppState>) -> Result<ScanSummary, String> {
    let mut library = state.library.lock().map_err(|_| lock_error())?;
    Ok(library.scan())
}

#[tauri::command]
pub fn set_favorite(state: State<'_, AppState>, id: String, favorite: bool) -> Result<(), String> {
    let mut library = state.library.lock().map_err(|_| lock_error())?;
    library
        .set_favorite(&id, favorite)
        .map_err(|error| error.to_string())
}

/* ───────────── 自定义扫描目录 ───────────── */

fn dir_strings(library: &fontnest_core::Library) -> Vec<String> {
    library
        .custom_dirs()
        .iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect()
}

#[tauri::command]
pub fn get_custom_dirs(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let library = state.library.lock().map_err(|_| lock_error())?;
    Ok(dir_strings(&library))
}

/// 添加目录后立即重扫，返回新的目录列表。
/// 前端拿到列表后再 `list_fonts` 一次即可刷新整个网格。
#[tauri::command]
pub fn add_custom_dir(state: State<'_, AppState>, path: String) -> Result<Vec<String>, String> {
    let mut library = state.library.lock().map_err(|_| lock_error())?;
    library
        .add_custom_dir(&path)
        .map_err(|error| error.to_string())?;
    library.scan();
    Ok(dir_strings(&library))
}

#[tauri::command]
pub fn remove_custom_dir(state: State<'_, AppState>, path: String) -> Result<Vec<String>, String> {
    let mut library = state.library.lock().map_err(|_| lock_error())?;
    library
        .remove_custom_dir(&path)
        .map_err(|error| error.to_string())?;
    library.scan();
    Ok(dir_strings(&library))
}

/// 启用 / 停用。
///
/// 只对来自自定义目录的字体有效：安装 = 复制到当前用户字体目录 + 写 HKCU 登记项；
/// 卸载 = 校验哈希后删登记项、把文件移入回收站。系统字体一律拒绝改动。
#[tauri::command]
pub fn set_enabled(state: State<'_, AppState>, ids: Vec<String>, enabled: bool) -> Result<(), String> {
    let mut library = state.library.lock().map_err(|_| lock_error())?;

    for id in &ids {
        library
            .set_enabled(id, enabled)
            .map_err(|error| error.to_string())?;
    }

    // 安装/卸载改变了磁盘布局，重扫一次让状态与事实一致
    library.scan();
    Ok(())
}

#[tauri::command]
pub fn reveal_font(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let path = {
        let library = state.library.lock().map_err(|_| lock_error())?;
        library.font(&id).map(|font| font.file_path.clone())
    };

    let path = path.ok_or_else(|| "找不到该字体的文件".to_string())?;
    reveal_in_file_manager(std::path::Path::new(&path))
}

#[cfg(target_os = "windows")]
fn reveal_in_file_manager(path: &std::path::Path) -> Result<(), String> {
    // /select 的逗号必须紧跟路径，且整体作为一个参数
    let argument = format!("/select,{}", path.display());
    std::process::Command::new("explorer")
        .arg(argument)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("打开资源管理器失败：{error}"))
}

#[cfg(target_os = "macos")]
fn reveal_in_file_manager(path: &std::path::Path) -> Result<(), String> {
    std::process::Command::new("open")
        .arg("-R")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("打开访达失败：{error}"))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal_in_file_manager(path: &std::path::Path) -> Result<(), String> {
    let directory = path.parent().unwrap_or(path);
    std::process::Command::new("xdg-open")
        .arg(directory)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("打开文件管理器失败：{error}"))
}
