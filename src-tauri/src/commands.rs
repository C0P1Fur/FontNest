use tauri::State;

use fontnest_core::{Font, ScanSummary};

use crate::AppState;

const BUSY: &str = "字体索引被占用，请重试";

/// 首次调用时惰性扫描。前端启动即拉全量，所以这里要把"还没扫过"当成正常路径。
#[tauri::command]
pub fn list_fonts(state: State<'_, AppState>) -> Result<Vec<Font>, String> {
    let mut library = state.library.lock().map_err(|_| BUSY.to_string())?;
    if library.is_empty() {
        library.scan();
    }
    Ok(library.fonts().to_vec())
}

#[tauri::command]
pub fn scan_fonts(state: State<'_, AppState>) -> Result<ScanSummary, String> {
    let mut library = state.library.lock().map_err(|_| BUSY.to_string())?;
    Ok(library.scan())
}

#[tauri::command]
pub fn set_favorite(state: State<'_, AppState>, id: String, favorite: bool) -> Result<(), String> {
    let mut library = state.library.lock().map_err(|_| BUSY.to_string())?;
    library
        .set_favorite(&id, favorite)
        .map_err(|error| error.to_string())
}

/// 启用 / 停用 —— 属于计划里的 M2。
///
/// 这里刻意返回错误而不是假装成功：它要写系统字体目录并登记注册表，
/// 一旦实现不当就是"删掉用户花钱买的字库"级别的事故，必须配齐
/// 归属清单 + 哈希校验 + 回收站之后才能开放。返回错误能让 UI 诚实地回滚。
///
/// 注意：参数名必须与前端传来的键名一致（`ids` / `enabled`），
/// 不能加下划线前缀 —— Tauri 是按参数标识符做键映射的。
#[tauri::command]
pub fn set_enabled(ids: Vec<String>, enabled: bool) -> Result<(), String> {
    let _ = (ids, enabled);
    Err("启用/停用尚未实现：需要写系统字体目录并登记注册表，计划在 M2 交付".to_string())
}

#[tauri::command]
pub fn reveal_font(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let path = {
        let library = state.library.lock().map_err(|_| BUSY.to_string())?;
        library.font_path(&id)
    };

    let path = path.ok_or_else(|| "找不到该字体的文件".to_string())?;
    reveal_in_file_manager(&path)
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
