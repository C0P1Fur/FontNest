//! 库门面：扫描结果 + 用户偏好（收藏、自定义目录）。
//!
//! 两份额外状态都用 JSON 存在应用数据目录：
//!   favorites.json     收藏的 font id
//!   custom_dirs.json   用户手动添加的字体目录
//!
//! 用 JSON 而不是 SQLite：v0.1 的可变数据只有这两小份。等 FTS5 索引落地时
//! 这个文件整体换成 db.rs，对外接口不变。

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::collection::{Collection, CollectionStore};
use crate::install::{
    install, reconcile, uninstall, FontHome, Manifest, ReconcileReport, Registry, WindowsRegistry,
};
use crate::model::{Font, ScanSummary, Source};
use crate::paths::{data_dir, platform_dirs, FontDir};
use crate::scan::scan_dirs;

#[derive(Debug, Clone)]
pub enum CoreError {
    NotFound(String),
    Invalid(String),
    Io(String),
}

impl std::fmt::Display for CoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CoreError::NotFound(id) => write!(formatter, "找不到字体：{id}"),
            CoreError::Invalid(message) => write!(formatter, "{message}"),
            CoreError::Io(message) => write!(formatter, "读写失败：{message}"),
        }
    }
}

impl std::error::Error for CoreError {}

#[derive(Debug, Default, Serialize, Deserialize)]
struct FavoritesFile {
    favorites: Vec<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct CustomDirsFile {
    #[serde(default)]
    dirs: Vec<String>,
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn load_json<T: Default + for<'de> Deserialize<'de>>(path: &Path) -> T {
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => return T::default(),
    };
    // Windows 上的编辑器（记事本、Notepad++ 等）常写 UTF-8 BOM，
    // serde_json 不认 BOM 会直接解析失败。用户手改配置时最容易踩。
    let cleaned = raw.trim_start_matches('\u{feff}');
    match serde_json::from_str::<T>(cleaned) {
        Ok(value) => value,
        Err(error) => {
            // 宁可丢弃偏好也不要让应用起不来，但必须留下线索
            eprintln!("[fontnest] 配置文件解析失败 {}: {error}", path.display());
            T::default()
        }
    }
}

/// 先写临时文件再 rename，避免写到一半断电留下半个 JSON
fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), CoreError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| CoreError::Io(format!("创建目录失败：{error}")))?;
    }
    let json = serde_json::to_string_pretty(value)
        .map_err(|error| CoreError::Io(format!("序列化失败：{error}")))?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, json)
        .map_err(|error| CoreError::Io(format!("写入失败：{error}")))?;
    std::fs::rename(&temporary, path).map_err(|error| CoreError::Io(format!("替换失败：{error}")))
}

fn load_favorites(path: &Path) -> HashSet<String> {
    let file: FavoritesFile = load_json(path);
    file.favorites.into_iter().collect()
}

fn write_favorites(path: &Path, favorites: &HashSet<String>) -> Result<(), CoreError> {
    let mut sorted: Vec<&String> = favorites.iter().collect();
    sorted.sort();
    write_json(
        path,
        &FavoritesFile {
            favorites: sorted.into_iter().cloned().collect(),
        },
    )
}

fn load_custom_dirs(path: &Path) -> Vec<PathBuf> {
    let file: CustomDirsFile = load_json(path);
    file.dirs.into_iter().map(PathBuf::from).collect()
}

fn write_custom_dirs(path: &Path, dirs: &[PathBuf]) -> Result<(), CoreError> {
    write_json(
        path,
        &CustomDirsFile {
            dirs: dirs
                .iter()
                .map(|dir| dir.to_string_lossy().to_string())
                .collect(),
        },
    )
}

pub struct Library {
    fonts: Vec<Font>,
    favorites: HashSet<String>,
    custom_dirs: Vec<PathBuf>,
    manifest: Manifest,
    collections: CollectionStore,
    home: FontHome,
    store_path: PathBuf,
    dirs_path: PathBuf,
}

impl Library {
    pub fn new() -> Self {
        // 沙箱模式下连数据目录一起隔离，端到端验证不会污染真实配置
        let base = match std::env::var_os("FONTNEST_SANDBOX_DIR") {
            Some(dir) => PathBuf::from(dir).join("data"),
            None => data_dir(),
        };
        Self::with_paths(base.join("favorites.json"), base.join("custom_dirs.json"))
    }

    /// 指定两个状态文件的位置。测试用，也为将来的"便携模式"留口子。
    /// 安装清单默认落在同一目录下的 installed.json。
    pub fn with_paths(store_path: PathBuf, dirs_path: PathBuf) -> Self {
        let favorites = load_favorites(&store_path);
        let custom_dirs = load_custom_dirs(&dirs_path);
        let manifest_path = store_path
            .parent()
            .map(|dir| dir.join("installed.json"))
            .unwrap_or_else(|| PathBuf::from("installed.json"));
        let collections_path = store_path
            .parent()
            .map(|dir| dir.join("collections.json"))
            .unwrap_or_else(|| PathBuf::from("collections.json"));

        Self {
            fonts: Vec::new(),
            favorites,
            custom_dirs,
            manifest: Manifest::load(manifest_path),
            collections: CollectionStore::load(collections_path),
            home: FontHome::from_env(),
            store_path,
            dirs_path,
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

    pub fn custom_dirs(&self) -> &[PathBuf] {
        &self.custom_dirs
    }

    pub fn font(&self, id: &str) -> Option<&Font> {
        self.fonts.iter().find(|item| item.id == id)
    }

    pub fn manifest(&self) -> &Manifest {
        &self.manifest
    }

    /// 启用 / 停用一个来自自定义目录的字体。
    ///
    /// 系统字体不在这条路径上 —— `install` 会拒绝非 `Custom` 来源的字体，
    /// 所以调用方不需要（也没办法）传错。
    pub fn set_enabled(&mut self, id: &str, enabled: bool) -> Result<(), CoreError> {
        // 先克隆路径：registry 若借用 self.home，就没法再 &mut self 了
        let registry_path = self.home.registry_path.clone();
        let registry = WindowsRegistry {
            path: &registry_path,
        };
        self.set_enabled_with(id, enabled, &registry).map(|_| ())
    }

    /// 返回是否真的发生了改变（已经是目标状态时返回 false）
    fn set_enabled_with(
        &mut self,
        id: &str,
        enabled: bool,
        registry: &dyn Registry,
    ) -> Result<bool, CoreError> {
        let font = self
            .font(id)
            .cloned()
            .ok_or_else(|| CoreError::NotFound(id.to_string()))?;

        if enabled == font.enabled {
            return Ok(false);
        }

        if enabled {
            install(&font, &self.home, registry, &mut self.manifest)?;
        } else {
            uninstall(id, &self.home, registry, &mut self.manifest)?;
        }

        if let Some(item) = self.fonts.iter_mut().find(|item| item.id == id) {
            item.enabled = enabled;
        }
        Ok(true)
    }

    /* ───────────── 分类 ───────────── */

    pub fn collections(&self) -> &[Collection] {
        self.collections.items()
    }

    pub fn create_collection(&mut self, name: &str) -> Result<Collection, CoreError> {
        self.collections.create(name)
    }

    pub fn rename_collection(&mut self, id: &str, name: &str) -> Result<(), CoreError> {
        self.collections.rename(id, name)
    }

    pub fn delete_collection(&mut self, id: &str) -> Result<(), CoreError> {
        self.collections.delete(id)
    }

    pub fn set_collection_fonts(
        &mut self,
        id: &str,
        font_ids: Vec<String>,
    ) -> Result<(), CoreError> {
        self.collections.set_fonts(id, font_ids)
    }

    /* ───────────── 对账 ───────────── */

    /// 启动时对账：让清单与磁盘/注册表的实际状态对齐。
    pub fn reconcile(&mut self) -> Result<ReconcileReport, CoreError> {
        let registry_path = self.home.registry_path.clone();
        let registry = WindowsRegistry {
            path: &registry_path,
        };

        let report = reconcile(&registry, &mut self.manifest)?;

        if report.missing > 0 {
            // 被移出清单的条目，内存里的 enabled 也要跟着改
            for font in self.fonts.iter_mut() {
                if font.source == Source::Custom {
                    font.enabled = self.manifest.owns(&font.id);
                }
            }
        }

        Ok(report)
    }

    /// 全量扫描：系统目录 + 用户目录 + 内置字体库 + 自定义目录。
    /// 自定义目录（含内置字体库）里的字体 `enabled = false` —— 它们在库里，但没装进系统。
    pub fn scan(&mut self) -> ScanSummary {
        let mut dirs = platform_dirs();

        // 从可选字体库下载下来的字体，等价于一个内置的自定义目录。
        //
        // 接入这里而不是另写一套流程，是因为「安装到系统」的整套语义
        // （只认 Source::Custom、复制到用户字体目录、写清单、可卸载）
        // 已经存在且验证过了。下载的字体走同一条路，就不需要第二套。
        //
        // 目录不存在时 scan_dirs 会自己跳过，不需要额外判断。
        dirs.push(FontDir {
            path: crate::catalog::library_root(),
            source: Source::Custom,
        });

        for path in &self.custom_dirs {
            dirs.push(FontDir {
                path: path.clone(),
                source: Source::Custom,
            });
        }

        let scanned = scan_dirs(&dirs, &self.manifest.target_paths());
        let mut fonts = scanned.fonts;

        for font in fonts.iter_mut() {
            font.favorite = self.favorites.contains(&font.id);
            // 系统/用户目录里的字体天然可用；自定义目录里的只有本工具装过才算启用
            font.enabled = match font.source {
                Source::Custom => self.manifest.owns(&font.id),
                _ => true,
            };
        }

        fonts.sort_by(|a, b| a.family.to_lowercase().cmp(&b.family.to_lowercase()));

        let count = fonts.len();
        self.fonts = fonts;

        ScanSummary {
            count,
            failed: scanned.failed,
            unsupported: scanned.unsupported,
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

    /// 添加自定义目录。会做四件检查：存在、是目录、能规范化、不与已知目录重复。
    pub fn add_custom_dir(&mut self, raw: &str) -> Result<(), CoreError> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err(CoreError::Invalid("目录路径不能为空".to_string()));
        }

        let path = PathBuf::from(trimmed);
        if !path.exists() {
            return Err(CoreError::Invalid(format!("目录不存在：{trimmed}")));
        }
        if !path.is_dir() {
            return Err(CoreError::Invalid(format!("不是目录：{trimmed}")));
        }

        // 规范化：消除 .. 与大小写差异，避免同一个目录被加两次
        let canonical = std::fs::canonicalize(&path)
            .map_err(|error| CoreError::Invalid(format!("无法解析路径：{error}")))?;

        let mut conflicts = false;
        for known in platform_dirs() {
            if let Ok(other) = std::fs::canonicalize(&known.path) {
                if other == canonical {
                    conflicts = true;
                    break;
                }
            }
        }
        if conflicts {
            return Err(CoreError::Invalid(
                "这个目录已经在系统扫描范围内了".to_string(),
            ));
        }
        if self.custom_dirs.iter().any(|dir| dir == &canonical) {
            return Err(CoreError::Invalid("目录已添加".to_string()));
        }

        self.custom_dirs.push(canonical);
        write_custom_dirs(&self.dirs_path, &self.custom_dirs)
    }

    pub fn remove_custom_dir(&mut self, raw: &str) -> Result<(), CoreError> {
        let target = PathBuf::from(raw.trim());
        let canonical = std::fs::canonicalize(&target).unwrap_or(target);

        let before = self.custom_dirs.len();
        self.custom_dirs
            .retain(|dir| dir != &canonical && dir != &PathBuf::from(raw.trim()));
        if self.custom_dirs.len() == before {
            return Err(CoreError::NotFound(raw.trim().to_string()));
        }

        write_custom_dirs(&self.dirs_path, &self.custom_dirs)
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

    fn scratch(name: &str) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "fontnest-test-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        (dir.join("favorites.json"), dir.join("custom_dirs.json"))
    }

    fn set(items: &[&str]) -> HashSet<String> {
        items.iter().map(|item| item.to_string()).collect()
    }

    #[test]
    fn favorites_roundtrip_survives_reload() {
        let (fav, dirs) = scratch("roundtrip");
        write_favorites(&fav, &set(&["b-font", "a-font"])).expect("写入应成功");

        let raw = std::fs::read_to_string(&fav).unwrap();
        assert!(raw.find("a-font").unwrap() < raw.find("b-font").unwrap());
        assert_eq!(load_favorites(&fav), set(&["a-font", "b-font"]));

        // 目录文件互不干扰
        assert!(Library::with_paths(fav, dirs).fonts().is_empty());
    }

    #[test]
    fn corrupt_favorites_file_is_ignored() {
        let (fav, _) = scratch("corrupt");
        std::fs::create_dir_all(fav.parent().unwrap()).unwrap();
        std::fs::write(&fav, "not json {{{").unwrap();
        assert!(load_favorites(&fav).is_empty());
    }

    #[test]
    fn utf8_bom_is_tolerated() {
        // 记事本 / Notepad++ 保存的 JSON 常带 BOM，不能让配置静默失效
        let (fav, _) = scratch("bom");
        std::fs::create_dir_all(fav.parent().unwrap()).unwrap();
        std::fs::write(&fav, "\u{feff}{\"favorites\":[\"abc\"]}").unwrap();
        assert_eq!(load_favorites(&fav), set(&["abc"]));
    }

    #[test]
    fn unknown_id_is_reported_not_panicked() {
        let (fav, dirs) = scratch("unknown");
        let mut library = Library::with_paths(fav, dirs);
        match library.set_favorite("does-not-exist", true) {
            Err(CoreError::NotFound(id)) => assert_eq!(id, "does-not-exist"),
            other => panic!("期望 NotFound，实际 {other:?}"),
        }
    }

    #[test]
    fn custom_dirs_persist_and_dedupe() {
        let (fav, dirs_path) = scratch("dirs");
        let target = std::env::temp_dir().join(format!("fontnest-dir-{}", std::process::id()));
        std::fs::create_dir_all(&target).unwrap();

        let mut library = Library::with_paths(fav.clone(), dirs_path.clone());
        library
            .add_custom_dir(target.to_str().unwrap())
            .expect("首次添加应成功");
        assert_eq!(library.custom_dirs().len(), 1);

        // 同一个目录加第二次要被拒
        assert!(library.add_custom_dir(target.to_str().unwrap()).is_err());

        // 重启后仍在
        let reloaded = Library::with_paths(fav, dirs_path);
        assert_eq!(reloaded.custom_dirs().len(), 1);

        let _ = std::fs::remove_dir_all(&target);
    }

    #[test]
    fn rejects_missing_or_file_paths() {
        let (fav, dirs) = scratch("reject");
        let mut library = Library::with_paths(fav, dirs);

        assert!(matches!(
            library.add_custom_dir(""),
            Err(CoreError::Invalid(_))
        ));
        assert!(matches!(
            library.add_custom_dir("C:\\definitely\\not\\here\\xyz"),
            Err(CoreError::Invalid(_))
        ));
    }
}
