mod commands;

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use fontnest_core::Library;
use tauri::http::{Request, Response};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// 全局热键。选 Control+Alt+F：三大平台都不与常见系统快捷键冲突，
/// 且 Control 与 Alt 相邻，单手按得到。
pub const HOTKEY_ACCELERATOR: &str = "Ctrl+Alt+F";

/// 预览图的最大宽度。够看清是不是抓对了，又不会把事件 payload 撑肥。
const PREVIEW_WIDTH: u32 = 480;

/// 一张留在内存里的剪贴板截图。
///
/// 不写临时文件：屏幕内容可能包含任何东西，不该在磁盘上留下痕迹，
/// 而且那会破坏"只动字体和 AppData"这条既有边界。
pub struct ClipFrame {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// 全局状态。用 `Mutex` 而不是 `RwLock`：扫描本身要 &mut，
/// 而调用频率很低（一次启动 + 手动刷新），锁竞争不是瓶颈。
pub struct AppState {
    pub library: Mutex<Library>,
    /// 等前端输入文字期间，截图先停在这里
    pub clip_frame: Mutex<Option<ClipFrame>>,
    /// 热键是否注册成功。失败必须能告诉用户 —— 静默失联比不支持更糟
    pub hotkey_ready: AtomicBool,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                // 只认按下那一刻：长按会连着来 Pressed/Released，
                // 每一下都去读剪贴板会让热键"粘手"
                .with_handler(|app, _shortcut, event| {
                    if matches!(event.state(), ShortcutState::Pressed) {
                        on_hotkey(app);
                    }
                })
                .build(),
        )
        .manage(AppState {
            library: Mutex::new(Library::new()),
            clip_frame: Mutex::new(None),
            hotkey_ready: AtomicBool::new(false),
        })
        .setup(|app| {
            // 注册放这里而不是插件 Builder 的 with_shortcut：只有这样才能
            // 拿到失败原因。热键被别的软件占用是常见情况，必须能落到 UI 上。
            let ready = match app.handle().global_shortcut().register(Shortcut::new(
                Some(Modifiers::CONTROL | Modifiers::ALT),
                Code::KeyF,
            )) {
                Ok(()) => true,
                Err(error) => {
                    eprintln!("[hotkey] 注册 {HOTKEY_ACCELERATOR} 失败：{error}");
                    false
                }
            };
            app.state::<AppState>()
                .hotkey_ready
                .store(ready, Ordering::Relaxed);
            Ok(())
        })
        // 字体文件通过自定义协议提供给 WebView，走 @font-face 渲染。
        // 只接受"字体 id"，由库反查真实路径 —— 不存在任意文件读取面。
        .register_uri_scheme_protocol("font", |ctx, request| {
            serve_font(ctx.app_handle(), &request)
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_fonts,
            commands::scan_fonts,
            commands::set_favorite,
            commands::set_enabled,
            commands::reveal_font,
            commands::get_custom_dirs,
            commands::add_custom_dir,
            commands::remove_custom_dir,
            commands::reconcile_fonts,
            commands::list_collections,
            commands::create_collection,
            commands::rename_collection,
            commands::delete_collection,
            commands::set_collection_fonts,
            commands::recognize_fonts,
            commands::recognize_fonts_from_clipboard,
            commands::get_ui_state,
            commands::save_ui_state,
            commands::catalog_list,
            commands::catalog_fetch,
            commands::catalog_remove,
            commands::import_font_files,
            commands::app_status,
        ])
        .run(tauri::generate_context!())
        .expect("FontNest 启动失败");
}

/// 热键按下时做的事：抓剪贴板 → 存起来 → 通知前端 → 把窗口叫到前面。
///
/// 顺序有讲究：**先抓再通知**。反过来的话，前端可能先开始渲染"读取中"，
/// 而用户此刻又复制了别的东西，抓到的就不是他以为的那一张。
fn on_hotkey(app: &tauri::AppHandle) {
    let frame = commands::capture_clipboard();

    let notice = match &frame {
        Some(clip) => CaptureNotice {
            has_image: true,
            width: clip.width,
            height: clip.height,
            preview: preview_data_url(clip.width, clip.height, &clip.rgba),
        },
        None => CaptureNotice {
            has_image: false,
            width: 0,
            height: 0,
            preview: String::new(),
        },
    };

    if let Ok(mut slot) = app.state::<AppState>().clip_frame.lock() {
        *slot = frame;
    }

    // 预览失败不该拦着流程：前端拿不到 preview 就只显示尺寸
    let _ = app.emit("recognize-capture", notice);

    // 窗口可能被最小化或被别的窗口埋着。不叫到前面，用户会以为热键没反应。
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn preview_data_url(width: u32, height: u32, rgba: &[u8]) -> String {
    use base64::Engine as _;

    match fontnest_core::preview_png(width, height, rgba, PREVIEW_WIDTH) {
        Ok(png) => format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(png)
        ),
        Err(error) => {
            eprintln!("[hotkey] 预览图生成失败：{error}");
            String::new()
        }
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureNotice {
    has_image: bool,
    width: u32,
    height: u32,
    preview: String,
}

fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("otf") => "font/otf",
        Some("ttc") | Some("otc") => "font/collection",
        _ => "font/ttf",
    }
}

fn not_found() -> Response<Vec<u8>> {
    Response::builder()
        .status(404)
        .header("Access-Control-Allow-Origin", "*")
        .body(Vec::new())
        .expect("构造 404 响应不应失败")
}

fn serve_font(app: &tauri::AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    // 路径形如 /<font-id>，可能带查询串；id 是十六进制，无需 URL 解码
    let raw = request.uri().path().trim_start_matches('/');
    let id = raw.split(['?', '#']).next().unwrap_or("").trim();
    if id.is_empty() || id.len() > 64 {
        return not_found();
    }

    let (file_path, mime) = {
        let state = app.state::<AppState>();
        let library = match state.library.lock() {
            Ok(value) => value,
            Err(_) => return not_found(),
        };
        match library.font(id) {
            Some(font) => {
                let path = Path::new(&font.file_path);
                (path.to_path_buf(), mime_for(path))
            }
            None => return not_found(),
        }
    };

    let bytes = match std::fs::read(&file_path) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("[font://] 读取失败 {}: {error}", file_path.display());
            return not_found();
        }
    };

    // 跨源字体必须给 CORS，否则 WebView 会静默丢弃这个 @font-face
    Response::builder()
        .status(200)
        .header("Content-Type", mime)
        .header("Access-Control-Allow-Origin", "*")
        .header("Cache-Control", "no-store")
        .body(bytes)
        .unwrap_or_else(|_| not_found())
}
