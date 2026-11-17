use tauri::State;

use fontnest_core::{Collection, Font, ReconcileReport, RecognizeReport, ScanSummary};

use crate::{AppState, ClipFrame};

const BUSY: &str = "字体索引被占用，请重试";

fn lock_error() -> String {
    BUSY.to_string()
}

/// 首次调用时惰性扫描。前端启动即拉全量，所以这里要把"还没扫过"当成正常路径。
///
/// 顺序很重要：**先对账再扫描**。对账会把"清单里有、磁盘上已经没了"的条目
/// 清掉，扫描才据此算出正确的 enabled 状态。反过来就会先展示一批幽灵字体。
#[tauri::command]
pub fn list_fonts(state: State<'_, AppState>) -> Result<Vec<Font>, String> {
    let mut library = state.library.lock().map_err(|_| lock_error())?;
    if library.is_empty() {
        if let Err(error) = library.reconcile() {
            eprintln!("[fontnest] 启动对账失败：{error}");
        }
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

/* ───────────── 启动对账 ───────────── */

/* ───────────── 字体识别 ───────────── */

/// 用已知文本在本地全部字体里做视觉比对。
///
/// 几个必须注意的点：
/// · 复制字体列表后**立刻释放锁**。识别要好几秒，占着锁会把"刷新索引"之类的
///   操作一起卡死。
/// · 走 `spawn_blocking`，绝不阻塞 IPC 线程。
/// · 只读，不改任何文件 —— 识别是纯查询。
#[tauri::command]
pub async fn recognize_fonts(
    state: State<'_, AppState>,
    image: String,
    text: String,
    limit: usize,
) -> Result<RecognizeReport, String> {
    let fonts = {
        let library = state.library.lock().map_err(|_| lock_error())?;
        library.fonts().to_vec()
    };

    tauri::async_runtime::spawn_blocking(move || {
        fontnest_core::recognize(std::path::Path::new(&image), &text, &fonts, limit)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

/* ───────────── 热键抓剪贴板 ───────────── */

/// 从剪贴板读一张图。
///
/// 返回 `None` 是**正常路径**而不是错误：用户很可能按热键之前忘了先截图。
/// 把它当错误会让热键看起来"坏了"。
pub fn capture_clipboard() -> Option<ClipFrame> {
    let mut clipboard = arboard::Clipboard::new().ok()?;
    let image = clipboard.get_image().ok()?;

    // arboard 给的是 RGBA8。尺寸和字节数先对一遍，坏数据别往下游传。
    if image.width == 0 || image.height == 0 {
        return None;
    }
    let expected = image.width.checked_mul(image.height)?.checked_mul(4)?;
    if image.bytes.len() < expected {
        return None;
    }

    Some(ClipFrame {
        width: image.width as u32,
        height: image.height as u32,
        rgba: image.bytes.to_vec(),
    })
}

/// 用上一次热键抓到的截图识别。
///
/// 像素始终留在 Rust 侧，前端只发文字 —— 一张截图几百 KB，
/// 让它往返一趟 IPC 既慢又要多写两遍 base64。
#[tauri::command]
pub async fn recognize_fonts_from_clipboard(
    state: State<'_, AppState>,
    text: String,
    limit: usize,
) -> Result<RecognizeReport, String> {
    let (width, height, rgba, fonts) = {
        let library = state.library.lock().map_err(|_| lock_error())?;
        let frame = state
            .clip_frame
            .lock()
            .map_err(|_| "剪贴板截图被占用".to_string())?;
        let frame = frame
            .as_ref()
            .ok_or_else(|| format!("还没有抓到截图：先截图，再按 {}", crate::HOTKEY_ACCELERATOR))?;

        (
            frame.width,
            frame.height,
            frame.rgba.clone(),
            library.fonts().to_vec(),
        )
    };

    tauri::async_runtime::spawn_blocking(move || {
        fontnest_core::recognize_rgba(width, height, &rgba, &text, &fonts, limit)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    /// 给 UI 显示用的快捷键文案
    pub hotkey: String,
    /// 真的注册上了没有。false 时 UI 不该再劝用户按它。
    pub hotkey_ready: bool,
}

/// 启动信息：热键到底注册上了没有。
///
/// 单独一个命令而不是塞进 `list_fonts`：热键状态与字体库无关。
/// 混在一起，"字体加载慢"会连带这个提示一起迟到。
#[tauri::command]
pub fn app_status(state: State<'_, AppState>) -> AppStatus {
    AppStatus {
        hotkey: crate::HOTKEY_ACCELERATOR.to_string(),
        hotkey_ready: state
            .hotkey_ready
            .load(std::sync::atomic::Ordering::Relaxed),
    }
}

#[tauri::command]
pub fn reconcile_fonts(state: State<'_, AppState>) -> Result<ReconcileReport, String> {
    let mut library = state.library.lock().map_err(|_| lock_error())?;
    let report = library.reconcile().map_err(|error| error.to_string())?;
    library.scan();
    Ok(report)
}

/* ───────────── 分类 ───────────── */

#[tauri::command]
pub fn list_collections(state: State<'_, AppState>) -> Result<Vec<Collection>, String> {
    let library = state.library.lock().map_err(|_| lock_error())?;
    Ok(library.collections().to_vec())
}

#[tauri::command]
pub fn create_collection(state: State<'_, AppState>, name: String) -> Result<Collection, String> {
    let mut library = state.library.lock().map_err(|_| lock_error())?;
    library
        .create_collection(&name)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn rename_collection(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<(), String> {
    let mut library = state.library.lock().map_err(|_| lock_error())?;
    library
        .rename_collection(&id, &name)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_collection(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut library = state.library.lock().map_err(|_| lock_error())?;
    library
        .delete_collection(&id)
        .map_err(|error| error.to_string())
}

/// 参数故意叫 `fonts` 而不是 `font_ids`：单词参数不存在蛇形/驼峰转换歧义。
#[tauri::command]
pub fn set_collection_fonts(
    state: State<'_, AppState>,
    id: String,
    fonts: Vec<String>,
) -> Result<(), String> {
    let mut library = state.library.lock().map_err(|_| lock_error())?;
    library
        .set_collection_fonts(&id, fonts)
        .map_err(|error| error.to_string())
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
