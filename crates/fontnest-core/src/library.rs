//! 库门面：一次扫描的结果 + 用户偏好（收藏）。
//!
//! 持久化用 JSON 而不是 SQLite：v0.1 只有"收藏"这一份会变的数据，
//! 加一个 SQLite 依赖不划算。等 FTS5 索引落地（字体量上万、需要增量扫描）时，
//! 这个文件整体替换为 db.rs，对外接口不变。

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::model::{Font, ScanSummary};
use crate::paths::{data_dir, platform_dirs};
use crate::scan::scan_dirs;

#[derive(Debug, Clone)]
pub enum CoreError {
    NotFound(String),
    Io(String),
}

impl std::fmt::Display for CoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CoreError::NotFound(id) => write!(formatter, "找不到字体：{id}"),
            CoreError::Io(message) => write!(formatter, "读写失败：{message}"),
        }
    }
}

impl std::error::Error for CoreError {}

#[derive(Debug, Default, Serialize, Deserialize)]
struct FavoritesFile {
    favorites: Vec<String>,
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

/// 读收藏。文件缺失、损坏、字段类型不对——一律当作"没有收藏"，
/// 绝不能因为一个偏好文件让整个应用起不来。
fn load_favorites(path: &Path) -> HashSet<String> {
    let raw = match std::fs::read_to_string(path) {
        Ok(value) => value,
        Err(_) => return HashSet::new(),
    };
    match serde_json::from_str::<FavoritesFile>(&raw) {
        Ok(file) => file.favorites.into_iter().collect(),
        Err(_) => HashSet::new(),
    }
}

/// 写收藏。先落临时文件再 rename，避免写到一半断电留下半个 JSON。
fn write_favorites(path: &Path, favorites: &HashSet<String>) -> Result<(), CoreError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| CoreError::Io(format!("创建目录失败：{error}")))?;
    }

    let mut sorted: Vec<&String> = favorites.iter().collect();
    sorted.sort();

    let payload = FavoritesFile {
        favorites: sorted.into_iter().cloned().collect(),
    };

    let json = serde_json::to_string_pretty(&payload)
        .map_err(|error| CoreError::Io(format!("序列化失败：{error}")))?;

    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, json)
        .map_err(|error| CoreError::Io(format!("写入失败：{error}")))?;
    std::fs::rename(&temporary, path)
        .map_err(|error| CoreError::Io(format!("替换失败：{error}")))?;

    Ok(())
}

pub struct Library {
    fonts: Vec<Font>,
    favorites: HashSet<String>,
    store_path: PathBuf,
}

impl Library {
    pub fn new() -> Self {
        Self::with_store(data_dir().join("favorites.json"))
    }

    /// 指定偏好文件位置。测试用，也为将来的"便携模式"留了口子。
    pub fn with_store(store_path: PathBuf) -> Self {
        let favorites = load_favorites(&store_path);
        Self {
            fonts: Vec::new(),
            favorites,
            store_path,
        }
    }

    pub fn fonts(&self) -> &[Font] {
        &self.fonts
    }

    pub fn is_empty(&self) -> bool {
        self.fonts.is_empty()
    }

    pub fn store_path(&self) -> &Path {
        &self.store_path
    }

    /// 全量扫描。同步阻塞，几万个字体约几百毫秒到两秒，由调用方决定放哪个线程。
    pub fn scan(&mut self) -> ScanSummary {
        let dirs = platform_dirs();
        let (mut fonts, failed) = scan_dirs(&dirs);

        for font in fonts.iter_mut() {
            font.favorite = self.favorites.contains(&font.id);
        }

        // 排序放到 Rust 侧，前端只管展示
        fonts.sort_by(|a, b| a.family.to_lowercase().cmp(&b.family.to_lowercase()));

        let count = fonts.len();
        self.fonts = fonts;

        ScanSummary {
            count,
            failed,
            finished_at: now_millis(),
        }
    }

    pub fn set_favorite(&mut self, id: &str, favorite: bool) -> Result<(), CoreError> {
        let font = self
            .fonts
            .iter_mut()
            .find(|item| item.id == id)
            .ok_or_else(|| CoreError::NotFound(id.to_string()))?;
        font.favorite = favorite;

        if favorite {
            self.favorites.insert(id.to_string());
        } else {
            self.favorites.remove(id);
        }

        write_favorites(&self.store_path, &self.favorites)
    }

    pub fn font_path(&self, id: &str) -> Option<PathBuf> {
        self.fonts
            .iter()
            .find(|item| item.id == id)
            .map(|item| PathBuf::from(&item.file_path))
    }
}

impl Default for Library {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "fontnest-test-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir.join("favorites.json")
    }

    fn set(items: &[&str]) -> HashSet<String> {
        items.iter().map(|item| item.to_string()).collect()
    }

    #[test]
    fn favorites_roundtrip_survives_reload() {
        let path = scratch("roundtrip");
        write_favorites(&path, &set(&["b-font", "a-font"])).expect("写入应成功");

        // 内容应是排序过的，diff 友好
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(raw.find("a-font").unwrap() < raw.find("b-font").unwrap());

        let loaded = load_favorites(&path);
        assert_eq!(loaded, set(&["a-font", "b-font"]));
    }

    #[test]
    fn corrupt_favorites_file_is_ignored() {
        let path = scratch("corrupt");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "this is not json {{{").unwrap();

        // 关键：不 panic，也不阻止应用启动
        assert!(load_favorites(&path).is_empty());
    }

    #[test]
    fn missing_file_reads_as_empty() {
        let path = scratch("missing");
        assert!(load_favorites(&path).is_empty());
    }

    #[test]
    fn unknown_id_is_reported_not_panicked() {
        let store = scratch("unknown");
        let mut library = Library::with_store(store);
        match library.set_favorite("does-not-exist", true) {
            Err(CoreError::NotFound(id)) => assert_eq!(id, "does-not-exist"),
            other => panic!("期望 NotFound，实际 {:?}", other),
        }
    }
}
