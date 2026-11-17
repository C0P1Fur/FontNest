mod commands;

use std::sync::Mutex;

use fontnest_core::Library;

/// 全局状态。用 `Mutex` 而不是 `RwLock`：扫描本身要 &mut，
/// 而调用频率很低（一次启动 + 手动刷新），锁竞争不是瓶颈。
pub struct AppState {
    pub library: Mutex<Library>,
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            library: Mutex::new(Library::new()),
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_fonts,
            commands::scan_fonts,
            commands::set_favorite,
            commands::set_enabled,
            commands::reveal_font,
        ])
        .run(tauri::generate_context!())
        .expect("FontNest 启动失败");
}
