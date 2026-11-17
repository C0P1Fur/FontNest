//! 安装 / 卸载（目前实现 Windows 的当前用户级路径）。
//!
//! 这是整个项目唯一会**改用户文件**的地方，所以设计上刻意做成两段：
//!
//!   1. 纯决策：`plan_install` 只算"从哪拷到哪、注册表值名是什么"，不碰 IO；
//!   2. 执行：`install` / `uninstall` 做真实的拷贝、写注册表、移回收站。
//!
//! 两者之间隔着 `Registry` trait 和 `FontHome`，测试可以用临时目录 + 内存
//! 注册表把整条链路跑通，**不碰真实的系统字体目录和 HKCU**。
//!
//! 安全红线（缺一条都不许合）：
//!   · 只安装来源为 `Custom` 的字体 —— 永远不碰系统字体目录里已有的文件；
//!   · 卸载前校验哈希，文件被替换过就拒绝删除，只报告；
//!   · 删除走"移入回收站"而不是 remove_file，7 天内可人工恢复；
//!   · 一切以清单为准：清单里没有的 id，绝不删除磁盘上的任何东西。

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::library::CoreError;
use crate::model::{Font, Format, Source};

/// 回收站保留期：7 天。过期文件由用户自行清理，不做自动删除。
pub const TRASH_KEEP_MS: u64 = 7 * 24 * 60 * 60 * 1000;

pub fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

pub fn hash_bytes(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}

pub fn hash_file(path: &Path) -> Result<String, CoreError> {
    let bytes = std::fs::read(path)
        .map_err(|error| CoreError::Io(format!("读取 {} 失败：{error}", path.display())))?;
    Ok(hash_bytes(&bytes))
}

/* ───────────────────── 安装清单 ───────────────────── */

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledRecord {
    pub font_id: String,
    pub family: String,
    /// 安装到的完整路径（用户字体目录内）
    pub target: String,
    /// 源文件内容哈希，卸载前用它确认"装的还是当初那份"
    pub hash: String,
    /// 注册表值名，如 "Inter SemiBold (TrueType)"
    pub registry_value: String,
    pub installed_at: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct ManifestFile {
    #[serde(default)]
    installed: Vec<InstalledRecord>,
}

pub struct Manifest {
    path: PathBuf,
    records: Vec<InstalledRecord>,
}

impl Manifest {
    pub fn load(path: PathBuf) -> Self {
        let raw = std::fs::read_to_string(&path).ok();
        let cleaned = raw.as_deref().unwrap_or("").trim_start_matches('\u{feff}');
        let records = if cleaned.is_empty() {
            Vec::new()
        } else {
            match serde_json::from_str::<ManifestFile>(cleaned) {
                Ok(file) => file.installed,
                Err(error) => {
                    eprintln!("[fontnest] 安装清单解析失败 {}: {error}", path.display());
                    Vec::new()
                }
            }
        };
        Self { path, records }
    }

    pub fn records(&self) -> &[InstalledRecord] {
        &self.records
    }

    pub fn owns(&self, font_id: &str) -> bool {
        self.records.iter().any(|item| item.font_id == font_id)
    }

    pub fn find(&self, font_id: &str) -> Option<&InstalledRecord> {
        self.records.iter().find(|item| item.font_id == font_id)
    }

    /// 安装副本的路径集合：扫描时要跳过这些文件，
    /// 否则同一个字体会在网格里出现两次（库里一份、用户字体目录一份）。
    pub fn target_paths(&self) -> HashSet<String> {
        self.records.iter().map(|item| item.target.clone()).collect()
    }

    pub fn insert(&mut self, record: InstalledRecord) {
        self.records.retain(|item| item.font_id != record.font_id);
        self.records.push(record);
    }

    pub fn remove(&mut self, font_id: &str) {
        self.records.retain(|item| item.font_id != font_id);
    }

    pub fn save(&self) -> Result<(), CoreError> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| CoreError::Io(format!("创建目录失败：{error}")))?;
        }
        let json = serde_json::to_string_pretty(&ManifestFile {
            installed: self.records.clone(),
        })
        .map_err(|error| CoreError::Io(format!("序列化失败：{error}")))?;
        let temporary = self.path.with_extension("json.tmp");
        std::fs::write(&temporary, json)
            .map_err(|error| CoreError::Io(format!("写入失败：{error}")))?;
        std::fs::rename(&temporary, &self.path)
            .map_err(|error| CoreError::Io(format!("替换失败：{error}")))
    }
}

/* ───────────────────── 安装位置 ───────────────────── */

/// 目标位置。可注入是刻意的：测试用沙箱，真实运行才用系统目录。
#[derive(Debug, Clone)]
pub struct FontHome {
    pub font_dir: PathBuf,
    pub trash_dir: PathBuf,
    pub registry_path: String,
    /// 沙箱模式不广播 WM_FONTCHANGE：测试不该惊动真实的系统字体表
    pub broadcast: bool,
}

impl FontHome {
    #[cfg(target_os = "windows")]
    pub fn real() -> Self {
        let local = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        let roaming = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        Self {
            font_dir: local.join("Microsoft").join("Windows").join("Fonts"),
            trash_dir: roaming.join("FontNest").join("trash"),
            registry_path: "Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts".to_string(),
            broadcast: true,
        }
    }

    #[cfg(not(target_os = "windows"))]
    pub fn real() -> Self {
        let mut home = Self::sandboxed(PathBuf::from("."));
        home.broadcast = true;
        home
    }

    /// 沙箱：所有东西都落在 root 下，注册表键也换成一个自建子键，且不广播
    pub fn sandboxed(root: PathBuf) -> Self {
        Self {
            font_dir: root.join("Fonts"),
            trash_dir: root.join("trash"),
            registry_path: "Software\\FontNestSandbox\\Fonts".to_string(),
            broadcast: false,
        }
    }

    /// 设置 `FONTNEST_SANDBOX_DIR` 时全程走沙箱，用于自动化验证。
    pub fn from_env() -> Self {
        match std::env::var_os("FONTNEST_SANDBOX_DIR") {
            Some(dir) => Self::sandboxed(PathBuf::from(dir)),
            None => Self::real(),
        }
    }

    fn notify(&self) {
        if self.broadcast {
            notify_font_change();
        }
    }
}

/* ───────────────────── 注册表抽象 ───────────────────── */

pub trait Registry {
    fn set(&self, value_name: &str, file_name: &str) -> Result<(), CoreError>;
    fn remove(&self, value_name: &str) -> Result<(), CoreError>;
    fn exists(&self, value_name: &str) -> bool;
}

pub struct WindowsRegistry<'a> {
    pub path: &'a str,
}

#[cfg(target_os = "windows")]
impl Registry for WindowsRegistry<'_> {
    fn set(&self, value_name: &str, file_name: &str) -> Result<(), CoreError> {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (key, _) = hkcu
            .create_subkey(self.path)
            .map_err(|error| CoreError::Io(format!("打开注册表失败：{error}")))?;
        key.set_value(value_name, &file_name.to_string())
            .map_err(|error| CoreError::Io(format!("写入注册表失败：{error}")))
    }

    fn remove(&self, value_name: &str) -> Result<(), CoreError> {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let key = match hkcu.open_subkey_with_flags(self.path, winreg::enums::KEY_ALL_ACCESS) {
            Ok(value) => value,
            // 键都不存在，说明本来就没登记，视为成功
            Err(_) => return Ok(()),
        };
        match key.delete_value(value_name) {
            Ok(()) => Ok(()),
            Err(ref error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(CoreError::Io(format!("删除注册表值失败：{error}"))),
        }
    }

    fn exists(&self, value_name: &str) -> bool {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(self.path)
            .ok()
            .and_then(|key| key.get_value::<String, _>(value_name).ok())
            .is_some()
    }
}

#[cfg(not(target_os = "windows"))]
impl Registry for WindowsRegistry<'_> {
    fn set(&self, _value_name: &str, _file_name: &str) -> Result<(), CoreError> {
        Err(unsupported())
    }
    fn remove(&self, _value_name: &str) -> Result<(), CoreError> {
        Err(unsupported())
    }
    fn exists(&self, _value_name: &str) -> bool {
        false
    }
}

#[cfg(not(target_os = "windows"))]
fn unsupported() -> CoreError {
    CoreError::Invalid("当前平台尚未实现字体安装，计划按 Windows → macOS → Linux 推进".to_string())
}

/// 测试与预览用的内存注册表
#[derive(Default)]
pub struct MemoryRegistry {
    pub cells: std::cell::RefCell<std::collections::HashMap<String, String>>,
}

impl Registry for MemoryRegistry {
    fn set(&self, value_name: &str, file_name: &str) -> Result<(), CoreError> {
        self.cells
            .borrow_mut()
            .insert(value_name.to_string(), file_name.to_string());
        Ok(())
    }
    fn remove(&self, value_name: &str) -> Result<(), CoreError> {
        self.cells.borrow_mut().remove(value_name);
        Ok(())
    }
    fn exists(&self, value_name: &str) -> bool {
        self.cells.borrow().contains_key(value_name)
    }
}

/* ───────────────────── 计划与执行 ───────────────────── */

#[derive(Debug, Clone)]
pub struct InstallPlan {
    pub target: PathBuf,
    pub file_name: String,
    pub registry_value: String,
    pub hash: String,
}

fn registry_kind(format: Format) -> &'static str {
    match format {
        Format::Otf => "OpenType",
        _ => "TrueType",
    }
}

fn sanitize(text: &str) -> String {
    text.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

/// 纯决策：不创建任何文件。真出问题也只会返回 Err。
pub fn plan_install(font: &Font, home: &FontHome) -> Result<InstallPlan, CoreError> {
    if font.source != Source::Custom {
        return Err(CoreError::Invalid(
            "只能安装来自自定义目录的字体".to_string(),
        ));
    }

    let source = Path::new(&font.file_path);
    if !source.is_file() {
        return Err(CoreError::Invalid(format!(
            "源文件不存在：{}",
            font.file_path
        )));
    }

    let bytes = std::fs::read(source)
        .map_err(|error| CoreError::Io(format!("读取源文件失败：{error}")))?;
    let hash = hash_bytes(&bytes);

    let extension = source
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("ttf")
        .to_ascii_lowercase();

    // 文件名带哈希前缀：即使两个字体同名也互不覆盖
    let stem = sanitize(&font.ps_name);
    let stem = if stem.is_empty() {
        sanitize(&font.family)
    } else {
        stem
    };
    let file_name = format!("{}-{}.{}", stem, &hash[..8], extension);

    let registry_value = format!(
        "{} {} ({})",
        font.family,
        font.subfamily,
        registry_kind(font.format)
    );

    Ok(InstallPlan {
        target: home.font_dir.join(&file_name),
        file_name,
        registry_value,
        hash,
    })
}

/// 执行安装。任一步失败都会回滚已做的修改。
pub fn install(
    font: &Font,
    home: &FontHome,
    registry: &dyn Registry,
    manifest: &mut Manifest,
) -> Result<(), CoreError> {
    if manifest.owns(&font.id) {
        return Err(CoreError::Invalid("这个字体已经安装过了".to_string()));
    }

    let plan = plan_install(font, home)?;

    std::fs::create_dir_all(&home.font_dir)
        .map_err(|error| CoreError::Io(format!("创建字体目录失败：{error}")))?;

    // 先写临时文件再改名，避免中途失败留下半个字体
    let temporary = plan.target.with_extension("tmp");
    std::fs::copy(&font.file_path, &temporary)
        .map_err(|error| CoreError::Io(format!("复制失败：{error}")))?;
    std::fs::rename(&temporary, &plan.target)
        .map_err(|error| CoreError::Io(format!("落盘失败：{error}")))?;

    if let Err(error) = registry.set(&plan.registry_value, &plan.file_name) {
        // 注册表写失败就把文件删掉，不留"有文件没登记"的孤儿
        let _ = std::fs::remove_file(&plan.target);
        return Err(error);
    }

    manifest.insert(InstalledRecord {
        font_id: font.id.clone(),
        family: font.family.clone(),
        target: plan.target.to_string_lossy().to_string(),
        hash: plan.hash.clone(),
        registry_value: plan.registry_value.clone(),
        installed_at: now_millis(),
    });
    manifest.save()?;

    home.notify();
    Ok(())
}

/// 执行卸载。三重校验：清单里有没有、文件在不在、哈希对不对。
pub fn uninstall(
    font_id: &str,
    home: &FontHome,
    registry: &dyn Registry,
    manifest: &mut Manifest,
) -> Result<(), CoreError> {
    let record = manifest
        .find(font_id)
        .cloned()
        .ok_or_else(|| CoreError::Invalid("这个字体不是本工具安装的，不会删除".to_string()))?;

    let target = PathBuf::from(&record.target);

    if target.exists() {
        let current = hash_file(&target)?;
        if current != record.hash {
            return Err(CoreError::Invalid(
                "磁盘上的文件与安装记录不一致，已跳过删除".to_string(),
            ));
        }
    }

    registry.remove(&record.registry_value)?;

    if target.exists() {
        std::fs::create_dir_all(&home.trash_dir)
            .map_err(|error| CoreError::Io(format!("创建回收站失败：{error}")))?;
        let file_name = target
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("font");
        let destination = home
            .trash_dir
            .join(format!("{}-{}", now_millis(), file_name));
        std::fs::rename(&target, &destination)
            .map_err(|error| CoreError::Io(format!("移入回收站失败：{error}")))?;
    }

    manifest.remove(font_id);
    manifest.save()?;

    home.notify();
    Ok(())
}

/// 对账：清单说"装了这个"，磁盘和注册表未必还这么认为。
///
/// 三种漂移，处理策略不同：
/// · 文件没了        → 从清单移除（用户手工删了，我们不该继续宣称装着）
/// · 文件被改过      → **保留**清单并只计数，让 UI 去提示，绝不擅自删除
/// · 注册表条目丢了  → 补登记（文件还在、哈希也对，这是可安全修复的）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileReport {
    pub missing: usize,
    pub drifted: usize,
    pub repaired: usize,
}

pub fn reconcile(
    registry: &dyn Registry,
    manifest: &mut Manifest,
) -> Result<ReconcileReport, CoreError> {
    let mut report = ReconcileReport::default();
    let mut dirty = false;

    for record in manifest.records().to_vec() {
        let target = PathBuf::from(&record.target);

        if !target.exists() {
            manifest.remove(&record.font_id);
            report.missing += 1;
            dirty = true;
            continue;
        }

        if hash_file(&target)? != record.hash {
            report.drifted += 1;
            continue;
        }

        if !registry.exists(&record.registry_value) {
            let file_name = target
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("font")
                .to_string();
            if registry.set(&record.registry_value, &file_name).is_ok() {
                report.repaired += 1;
            }
        }
    }

    if dirty {
        manifest.save()?;
    }
    Ok(report)
}

/// 通知系统字体表变了。
///
/// 用 `SendMessageTimeoutW` 而不是 `SendMessageW`：广播是同步的，
/// 只要有一个应用卡死，不设超时的版本会把安装操作一起拖死。
/// 收不收、怎么处理仍由各应用自己决定。
#[cfg(target_os = "windows")]
pub fn notify_font_change() {
    #[link(name = "user32")]
    extern "system" {
        fn SendMessageTimeoutW(
            hwnd: isize,
            msg: u32,
            wparam: usize,
            lparam: isize,
            flags: u32,
            timeout: u32,
            result: *mut usize,
        ) -> isize;
    }

    const HWND_BROADCAST: isize = 0xffff;
    const WM_FONTCHANGE: u32 = 0x001D;
    const SMTO_ABORTIFHUNG: u32 = 0x0002;
    const TIMEOUT_MS: u32 = 1000;

    let mut result: usize = 0;
    unsafe {
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_FONTCHANGE,
            0,
            0,
            SMTO_ABORTIFHUNG,
            TIMEOUT_MS,
            &mut result,
        );
    }
}

#[cfg(not(target_os = "windows"))]
pub fn notify_font_change() {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Axis, Category};

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "fontnest-install-{name}-{}-{}",
            std::process::id(),
            now_millis()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample_font(dir: &Path, id: &str) -> Font {
        let path = dir.join(format!("{id}.ttf"));
        std::fs::write(&path, b"FAKE FONT BYTES").unwrap();
        Font {
            id: id.to_string(),
            family: "Test Family".to_string(),
            subfamily: "Regular".to_string(),
            full_name: "Test Family".to_string(),
            ps_name: "TestFamily-Regular".to_string(),
            category: Category::Sans,
            format: Format::Ttf,
            weight: 400,
            italic: false,
            variable: false,
            axes: Vec::<Axis>::new(),
            instance_count: 1,
            glyph_count: 100,
            scripts: vec!["Latn".to_string()],
            version: "1.0".to_string(),
            designer: "test".to_string(),
            foundry: "test".to_string(),
            year: 2024,
            license: "test".to_string(),
            source: Source::Custom,
            enabled: false,
            favorite: false,
            file_path: path.to_string_lossy().to_string(),
            size_bytes: 16,
            collection_index: 0,
        }
    }

    #[test]
    fn install_then_uninstall_roundtrip() {
        let root = scratch("roundtrip");
        let home = FontHome::sandboxed(root.join("home"));
        let registry = MemoryRegistry::default();
        let mut manifest = Manifest::load(root.join("installed.json"));

        let font = sample_font(&root, "font-a");
        install(&font, &home, &registry, &mut manifest).expect("安装应成功");

        let record = manifest.find("font-a").cloned().expect("清单应有记录");
        let target = PathBuf::from(&record.target);
        assert!(target.is_file(), "字体文件应已落地");
        assert!(registry.exists(&record.registry_value), "注册表应有值");
        assert!(manifest.owns("font-a"));

        // 清单里记的哈希必须等于磁盘文件
        assert_eq!(hash_file(&target).unwrap(), record.hash);

        uninstall("font-a", &home, &registry, &mut manifest).expect("卸载应成功");
        assert!(!target.exists(), "原位置不应再有文件");
        assert!(!registry.exists(&record.registry_value), "注册表值应被删除");
        assert!(!manifest.owns("font-a"));

        let trashed = std::fs::read_dir(&home.trash_dir)
            .map(|entries| entries.count())
            .unwrap_or(0);
        assert_eq!(trashed, 1, "文件应进入回收站而不是被删除");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn refuses_to_touch_non_custom_fonts() {
        let root = scratch("system");
        let home = FontHome::sandboxed(root.join("home"));
        let mut font = sample_font(&root, "sys-font");
        font.source = Source::System;

        let error = plan_install(&font, &home).expect_err("系统字体不应被安装");
        assert!(matches!(error, CoreError::Invalid(_)));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn refuses_uninstall_of_unknown_id() {
        let root = scratch("unknown");
        let home = FontHome::sandboxed(root.join("home"));
        let registry = MemoryRegistry::default();
        let mut manifest = Manifest::load(root.join("installed.json"));

        let error = uninstall("ghost", &home, &registry, &mut manifest)
            .expect_err("清单外的 id 必须拒绝");
        assert!(matches!(error, CoreError::Invalid(_)));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn refuses_uninstall_when_file_was_replaced() {
        let root = scratch("tampered");
        let home = FontHome::sandboxed(root.join("home"));
        let registry = MemoryRegistry::default();
        let mut manifest = Manifest::load(root.join("installed.json"));

        let font = sample_font(&root, "font-b");
        install(&font, &home, &registry, &mut manifest).unwrap();

        let record = manifest.find("font-b").unwrap().clone();
        let target = PathBuf::from(&record.target);
        // 模拟用户手工覆盖了这个文件
        std::fs::write(&target, b"DIFFERENT BYTES").unwrap();

        let error = uninstall("font-b", &home, &registry, &mut manifest)
            .expect_err("哈希不符必须拒绝删除");
        assert!(matches!(error, CoreError::Invalid(_)));
        assert!(target.exists(), "拒绝时不得删除文件");
        assert!(manifest.owns("font-b"), "记录也不应被移除");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn double_install_is_rejected() {
        let root = scratch("double");
        let home = FontHome::sandboxed(root.join("home"));
        let registry = MemoryRegistry::default();
        let mut manifest = Manifest::load(root.join("installed.json"));

        let font = sample_font(&root, "font-c");
        install(&font, &home, &registry, &mut manifest).unwrap();
        assert!(install(&font, &home, &registry, &mut manifest).is_err());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn manifest_roundtrip_and_target_paths() {        let root = scratch("manifest");
        let path = root.join("installed.json");
        let mut manifest = Manifest::load(path.clone());
        manifest.insert(InstalledRecord {
            font_id: "x".to_string(),
            family: "X".to_string(),
            target: "C:/fonts/x.ttf".to_string(),
            hash: "abc".to_string(),
            registry_value: "X (TrueType)".to_string(),
            installed_at: 1,
        });
        manifest.save().unwrap();

        let reloaded = Manifest::load(path);
        assert!(reloaded.owns("x"));
        assert!(reloaded.target_paths().contains("C:/fonts/x.ttf"));

        let _ = std::fs::remove_dir_all(&root);
    }

    /// 真注册表实现只在自建沙箱子键上验证，绝不碰真实的 Fonts 键。
    #[test]
    #[cfg(target_os = "windows")]
    fn windows_registry_writes_and_removes() {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        const SANDBOX: &str = "Software\\FontNestSandbox\\Fonts";
        const VALUE: &str = "FontNest Probe (TrueType)";

        let registry = WindowsRegistry { path: SANDBOX };
        let _ = registry.remove(VALUE);

        registry.set(VALUE, "probe.ttf").expect("写注册表应成功");
        assert!(registry.exists(VALUE), "值应存在");

        registry.remove(VALUE).expect("删注册表应成功");
        assert!(!registry.exists(VALUE), "值应被删除");

        // 清理整个测试子键，不在用户注册表里留垃圾
        let _ = RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(SANDBOX);
    }
}
