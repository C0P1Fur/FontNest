mod commands;

use std::path::Path;
use std::sync::Mutex;

use fontnest_core::Library;
use tauri::http::{Request, Response};
use tauri::Manager;

/// 全局状态。用 `Mutex` 而不是 `RwLock`：扫描本身要 &mut，
/// 而调用频率很低（一次启动 + 手动刷新），锁竞争不是瓶颈。
pub struct AppState {
    pub library: Mutex<Library>,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            library: Mutex::new(Library::new()),
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
        ])
        .run(tauri::generate_context!())
        .expect("FontNest 启动失败");
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
