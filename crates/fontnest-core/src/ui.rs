//! UI 偏好：记录引导是否看过、看到第几步。
//!
//! 为什么不用 localStorage：本项目所有持久化都在 Rust 侧（收藏、分类、目录、安装清单），
//! 引导状态再单独放前端会变成第二套存储习惯。统一在 `data_dir()/ui.json`。
//!
//! 判断"首次启动"用 `tour_seen == false`，**不能靠"文件不存在"**——
//! 万一写入失败，用户每次启动都会看一遍引导。

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::library::CoreError;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiState {
    /// 引导是否已完成或跳过
    #[serde(default)]
    pub tour_seen: bool,
    /// 中途退出时停在第几步（下次可从断点续）
    #[serde(default)]
    pub tour_step: u32,
    /// 完成/跳过的时间戳，便于以后判断要不要为新版本重放
    #[serde(default)]
    pub tour_seen_at: u64,
}

fn state_path() -> PathBuf {
    // 与 Library 一致地尊重沙箱变量，测试和端到端验证不会污染真实配置
    match std::env::var_os("FONTNEST_SANDBOX_DIR") {
        Some(dir) => PathBuf::from(dir).join("data").join("ui.json"),
        None => crate::paths::data_dir().join("ui.json"),
    }
}

pub fn load() -> UiState {
    load_from(&state_path())
}

pub fn save(state: &UiState) -> Result<(), CoreError> {
    save_to(&state_path(), state)
}

/// 显式路径版本。测试用它将状态写到临时目录 ——
/// 不要在测试里改 `FONTNEST_SANDBOX_DIR`，那是进程级全局变量，
/// 并行跑的两个测试会互相踩。
pub fn load_from(path: &std::path::Path) -> UiState {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return UiState::default();
    };
    // 与其它配置文件一样容忍 UTF-8 BOM
    serde_json::from_str(raw.trim_start_matches('\u{feff}')).unwrap_or_else(|error| {
        eprintln!("[fontnest] ui.json 解析失败 {}: {error}", path.display());
        UiState::default()
    })
}

pub fn save_to(path: &std::path::Path, state: &UiState) -> Result<(), CoreError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| CoreError::Io(format!("创建目录失败：{error}")))?;
    }
    let json = serde_json::to_string_pretty(state)
        .map_err(|error| CoreError::Io(format!("序列化失败：{error}")))?;

    // 先写临时文件再替换，避免写一半崩溃留下坏文件
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, json)
        .map_err(|error| CoreError::Io(format!("写入失败：{error}")))?;
    std::fs::rename(&temporary, path).map_err(|error| CoreError::Io(format!("替换失败：{error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        std::env::temp_dir()
            .join(format!(
                "fontnest-ui-{name}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
            ))
            .join("ui.json")
    }

    #[test]
    fn roundtrip() {
        let path = scratch("roundtrip");

        // 文件不存在时是默认值，不 panic
        let fresh = load_from(&path);
        assert!(!fresh.tour_seen);

        let state = UiState {
            tour_seen: true,
            tour_step: 2,
            tour_seen_at: 123,
        };
        save_to(&path, &state).expect("保存应成功");

        let reloaded = load_from(&path);
        assert!(reloaded.tour_seen);
        assert_eq!(reloaded.tour_step, 2);
        assert_eq!(reloaded.tour_seen_at, 123);

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn broken_json_falls_back_to_default() {
        let path = scratch("broken");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{ 这不是 json").unwrap();

        let state = load_from(&path);
        assert!(!state.tour_seen, "坏文件应当退回默认值而不是 panic");

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
