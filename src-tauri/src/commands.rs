use tauri::State;

use fontnest_core::{Collection, Font, ReconcileReport, RecognizeReport, ScanSummary, UiState};

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

/* ───────────── UI 偏好（引导是否看过） ───────────── */

#[tauri::command]
pub fn get_ui_state() -> Result<UiState, String> {
    Ok(fontnest_core::ui::load())
}

#[tauri::command]
pub fn save_ui_state(state: UiState) -> Result<(), String> {
    fontnest_core::ui::save(&state).map_err(|error| error.to_string())
}

/* ───────────── 可选字体库 ───────────── */

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogItem {
    pub id: String,
    pub family: String,
    pub name_zh: String,
    pub aliases: Vec<String>,
    pub category: String,
    pub coverage: String,
    pub license: String,
    pub license_url: String,
    pub redistributable: bool,
    pub homepage: String,
    pub note: String,
    /// 主变体的体积（目录里第一个变体）
    pub size: u64,
    /// 文件是否已在本地库
    pub downloaded: bool,
    /// 是否已装进系统
    pub installed: bool,
    /// 本地库里的 Font.id；前端用它调 set_enabled
    pub font_id: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogListing {
    pub items: Vec<CatalogItem>,
    pub issues: Vec<String>,
}

#[tauri::command]
pub fn catalog_list(state: State<AppState>) -> Result<CatalogListing, String> {
    let (catalog, issues) = fontnest_core::fetch::load_catalog();

    // 已落库的字体是否"装进了系统"，只能从扫描结果里看 —— 那是唯一真相
    let library = state.library.lock().map_err(|_| lock_error())?;

    let items = catalog
        .fonts
        .iter()
        .map(|font| {
            let path = fontnest_core::fetch::downloaded_path(font);
            let scanned = path.as_ref().and_then(|target| {
                let text = target.to_string_lossy().to_string();
                library.fonts().iter().find(|item| item.file_path == text)
            });
            CatalogItem {
                id: font.id.clone(),
                family: font.family.clone(),
                name_zh: font.name_zh.clone(),
                aliases: font.aliases.clone(),
                category: font.category.clone(),
                coverage: font.coverage.clone(),
                license: font.license.clone(),
                license_url: font.license_url.clone(),
                redistributable: font.redistributable,
                homepage: font.homepage.clone(),
                note: font.note.clone(),
                size: font.variants.first().map(|item| item.size).unwrap_or(0),
                downloaded: path.is_some(),
                installed: scanned.map(|item| item.enabled).unwrap_or(false),
                font_id: scanned.map(|item| item.id.clone()),
            }
        })
        .collect();

    Ok(CatalogListing {
        items,
        issues: issues
            .into_iter()
            .map(|issue| format!("{}：{}", issue.font_id, issue.message))
            .collect(),
    })
}

/// 下载是阻塞的（curl 子进程），必须放到阻塞线程池，否则会卡住 UI 线程
#[tauri::command]
pub async fn catalog_fetch(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (catalog, _) = fontnest_core::fetch::load_catalog();
        let font = catalog
            .find(&id)
            .ok_or_else(|| format!("目录里没有 {id}"))?;

        if !font.redistributable {
            return Err(format!(
                "{} 的许可不允许第三方分发，请从官网获取：{}",
                font.family, font.homepage
            ));
        }
        let variant = font
            .variants
            .first()
            .map(|item| item.name.clone())
            .ok_or_else(|| format!("{} 没有可下载的变体", font.family))?;

        fontnest_core::fetch::download_variant(font, &variant, |_| {})
            .map(|_| ())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn catalog_remove(id: String) -> Result<(), String> {
    let (catalog, _) = fontnest_core::fetch::load_catalog();
    let font = catalog
        .find(&id)
        .ok_or_else(|| format!("目录里没有 {id}"))?;
    fontnest_core::fetch::remove_download(font).map_err(|error| error.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    /// 新导入的字体族名
    pub imported: Vec<String>,
    /// 库里已有同一份内容
    pub skipped: Vec<String>,
    /// "族名或文件名：原因"
    pub failed: Vec<String>,
}

/// 手动导入（B 类：许可禁止我们分发，只能用户自己去官网下）
#[tauri::command]
pub async fn import_font_files(paths: Vec<String>) -> Result<ImportSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut imported = Vec::new();
        let mut skipped = Vec::new();
        let mut failed = Vec::new();

        for path in &paths {
            match fontnest_core::import::import_file(std::path::Path::new(path)) {
                Ok(outcome) if outcome.already_present => skipped.push(outcome.family),
                Ok(outcome) => imported.push(outcome.family),
                Err(error) => failed.push(format!("{}：{error}", short_name(path))),
            }
        }

        ImportSummary {
            imported,
            skipped,
            failed,
        }
    })
    .await
    .map_err(|error| error.to_string())
}

fn short_name(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path)
        .to_string()
}

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
