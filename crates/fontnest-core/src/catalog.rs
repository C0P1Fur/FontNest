//! 可选字体目录：数据结构、加载、校验与落库路径。
//!
//! 这一层**不联网**——下载在 `fetch` 模块里。分开的原因很简单：目录逻辑
//! 要能独立单测，不能因为网络不通就测不了。
//!
//! 一条硬规则贯穿整个文件：
//!
//! > `redistributable: false` 的条目**不允许**携带文件源。
//!
//! 这是法律边界，所以在**加载期**就强制丢弃违规条目并报告，
//! 而不是等到下载时才发现。宁可少一个字体，不能多一次违约。

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::library::CoreError;

/// 随二进制分发的目录。用 include_str! 嵌入，
/// 避免"配置文件找不到"这类运行时问题，也让测试能直接验证真实数据。
const CATALOG_JSON: &str = include_str!("../data/catalog.json");

/// 允许下载的域名白名单。
///
/// 精确匹配，不用通配符——`evil-github.com` 这种不该过。
/// 因为这份目录一旦被篡改，它决定的就是"从哪里下载什么文件"。
pub const ALLOWED_HOSTS: &[&str] = &[
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
    "raw.githubusercontent.com",
    "fonts.gstatic.com",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub version: u32,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub fonts: Vec<CatalogFont>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogFont {
    pub id: String,
    pub family: String,
    /// 中文别名。开源中文字体的 family 是英文的，而用户永远搜中文名，
    /// 没有别名就等于搜不到自己刚装好的字体。
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub name_zh: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub scripts: Vec<String>,
    /// 字符集覆盖：`GB18030-2022` / `GB2312` / `display` 等。
    /// 中文用户判断"能不能用"的第一标准。
    #[serde(default)]
    pub coverage: String,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub license_url: String,
    /// 法律开关：许可是否允许我们再分发这个字体文件
    pub redistributable: bool,
    #[serde(default)]
    pub homepage: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub variants: Vec<CatalogVariant>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogVariant {
    pub name: String,
    pub file_name: String,
    #[serde(default)]
    pub size: u64,
    /// 若下载的是压缩包，这里是包内的字体文件名。
    ///
    /// 存在这个字段时，`sources[].sha256` 校验的是**下载到的归档文件**，
    /// 不是解出来的字体——因为校验必须针对"传输中的那份字节"。
    /// 解包是确定性的后续步骤，不再单独校验。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub member: Option<String>,
    #[serde(default)]
    pub sources: Vec<CatalogSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSource {
    pub url: String,
    /// 是否本项目镜像（优先尝试）
    #[serde(default)]
    pub mirror: bool,
    /// 64 位十六进制。空表示尚未生成——这种条目不可下载
    #[serde(default)]
    pub sha256: String,
}

/// 校验发现的问题。带字体 id 便于定位是哪一条目录数据出错。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogIssue {
    pub font_id: String,
    pub message: String,
}

impl CatalogIssue {
    fn new(font_id: &str, message: impl Into<String>) -> Self {
        Self {
            font_id: font_id.to_string(),
            message: message.into(),
        }
    }
}

impl Default for Catalog {
    fn default() -> Self {
        Self {
            version: 0,
            updated_at: String::new(),
            fonts: Vec::new(),
        }
    }
}

impl Catalog {
    pub fn parse(json: &str) -> Result<Self, CoreError> {
        serde_json::from_str(json.trim_start_matches('\u{feff}'))
            .map_err(|error| CoreError::Invalid(format!("字体目录解析失败：{error}")))
    }

    /// 加载随二进制分发的目录，并剔除违规条目。
    ///
    /// 返回被剔除的原因，调用方（CLI / 设置面板）应当显示出来——
    /// 目录数据坏了不能静默变成"字体变少了"。
    pub fn load() -> (Self, Vec<CatalogIssue>) {
        let mut catalog = match Self::parse(CATALOG_JSON) {
            Ok(catalog) => catalog,
            Err(error) => {
                eprintln!("[fontnest] {error}");
                return (Self::default(), Vec::new());
            }
        };
        let issues = catalog.sanitize();
        (catalog, issues)
    }

    /// 剔除违规条目，返回问题清单。幂等。
    pub fn sanitize(&mut self) -> Vec<CatalogIssue> {
        let mut issues = Vec::new();
        let mut seen: Vec<String> = Vec::new();
        let mut kept: Vec<CatalogFont> = Vec::new();

        for font in std::mem::take(&mut self.fonts) {
            if font.id.trim().is_empty() || font.family.trim().is_empty() {
                issues.push(CatalogIssue::new(&font.id, "缺少 id 或 family"));
                continue;
            }
            if seen.contains(&font.id) {
                issues.push(CatalogIssue::new(&font.id, "id 重复"));
                continue;
            }
            // 法律红线：不可再分发的条目不得携带文件源
            if !font.redistributable && !font.variants.is_empty() {
                issues.push(CatalogIssue::new(
                    &font.id,
                    "标记为不可入库，却携带了文件源——已丢弃该条目",
                ));
                continue;
            }
            seen.push(font.id.clone());
            kept.push(font);
        }

        self.fonts = kept;
        issues
    }

    /// 结构性检查（不修改数据）。用于 `catalog check` 与测试。
    pub fn validate(&self) -> Vec<CatalogIssue> {
        let mut issues = Vec::new();

        for font in &self.fonts {
            if font.redistributable && font.variants.is_empty() {
                issues.push(CatalogIssue::new(
                    &font.id,
                    "标记为可入库，却没有文件源",
                ));
            }

            if !font.redistributable && !font.variants.is_empty() {
                issues.push(CatalogIssue::new(
                    &font.id,
                    "不可入库的条目携带了文件源",
                ));
            }

            for variant in &font.variants {
                if variant.file_name.trim().is_empty() {
                    issues.push(CatalogIssue::new(
                        &font.id,
                        format!("变体 {} 缺少文件名", variant.name),
                    ));
                }
                if variant.sources.is_empty() {
                    issues.push(CatalogIssue::new(
                        &font.id,
                        format!("变体 {} 没有任何下载源", variant.name),
                    ));
                }
                for source in &variant.sources {
                    if !is_allowed_url(&source.url) {
                        issues.push(CatalogIssue::new(
                            &font.id,
                            format!("下载源不在白名单内：{}", source.url),
                        ));
                    }
                    if !is_sha256(&source.sha256) {
                        issues.push(CatalogIssue::new(
                            &font.id,
                            format!("变体 {} 的源缺少合法 sha256", variant.name),
                        ));
                    }
                }
            }
        }

        issues
    }

    pub fn find(&self, id: &str) -> Option<&CatalogFont> {
        self.fonts.iter().find(|font| font.id == id)
    }

    pub fn only_redistributable(&self) -> impl Iterator<Item = &CatalogFont> {
        self.fonts.iter().filter(|font| font.redistributable)
    }

    pub fn only_link_only(&self) -> impl Iterator<Item = &CatalogFont> {
        self.fonts.iter().filter(|font| !font.redistributable)
    }
}

impl CatalogFont {
    /// 搜索匹配：family / 中文名 / 别名 / id 任一命中。
    pub fn matches(&self, query: &str) -> bool {
        let query = query.trim().to_lowercase();
        if query.is_empty() {
            return true;
        }
        let haystacks = std::iter::once(&self.family)
            .chain(std::iter::once(&self.name_zh))
            .chain(std::iter::once(&self.id))
            .chain(self.aliases.iter());
        haystacks.into_iter().any(|text| text.to_lowercase().contains(&query))
    }
}

/// 从 https URL 取出 host，并拒绝非 443 的显式端口与带 userinfo 的写法。
fn https_host(url: &str) -> Option<&str> {
    let rest = url.strip_prefix("https://")?;
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..end];
    if authority.is_empty() || authority.contains('@') {
        return None;
    }
    match authority.rsplit_once(':') {
        Some((host, port)) if port != "443" => {
            let _ = host;
            None
        }
        Some((host, _)) => Some(host),
        None => Some(authority),
    }
}

pub fn is_allowed_url(url: &str) -> bool {
    match https_host(url) {
        Some(host) => ALLOWED_HOSTS.contains(&host),
        None => false,
    }
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|ch| ch.is_ascii_hexdigit())
}

/* ───────────── 落库路径 ───────────── */

fn data_dir() -> PathBuf {
    // 与 Library 一致地尊重沙箱变量
    match std::env::var_os("FONTNEST_SANDBOX_DIR") {
        Some(dir) => PathBuf::from(dir).join("data"),
        None => crate::paths::data_dir(),
    }
}

/// 下载下来的字体躺在这里。**注意：这不是系统字体目录。**
/// 用户在库里看到它，但 Photoshop 还看不到——要再点一次「装进系统」。
pub fn library_root() -> PathBuf {
    data_dir().join("library")
}

pub fn font_dir(id: &str) -> PathBuf {
    library_root().join(safe_id(id))
}

/// id 会拼进文件路径，必须挡住 `../` 这类穿越。
fn safe_id(id: &str) -> String {
    let cleaned: String = id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "unnamed".to_string()
    } else {
        cleaned
    }
}

/// 每个已落库字体的来源记录。排查"这个文件哪来的"时的第一手证据。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontMeta {
    pub font_id: String,
    pub variant: String,
    pub file_name: String,
    pub sha256: String,
    /// `mirror` / `upstream` / `manual`
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub original_url: String,
    #[serde(default)]
    pub downloaded_at: u64,
}

impl FontMeta {
    pub fn path_for(id: &str) -> PathBuf {
        font_dir(id).join("meta.json")
    }

    pub fn load(id: &str) -> Option<Self> {
        let raw = std::fs::read_to_string(Self::path_for(id)).ok()?;
        serde_json::from_str(raw.trim_start_matches('\u{feff}')).ok()
    }

    pub fn save(&self) -> Result<(), CoreError> {
        let path = Self::path_for(&self.font_id);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| CoreError::Io(format!("创建目录失败：{error}")))?;
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|error| CoreError::Io(format!("序列化失败：{error}")))?;
        let temporary = path.with_extension("json.tmp");
        std::fs::write(&temporary, json)
            .map_err(|error| CoreError::Io(format!("写入失败：{error}")))?;
        std::fs::rename(&temporary, &path)
            .map_err(|error| CoreError::Io(format!("替换失败：{error}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_SHA: &str =
        "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

    fn sample_json(redistributable: bool, with_variant: bool) -> String {
        let variants = if with_variant {
            format!(
                r#"[{{"name":"Regular","fileName":"Demo.otf","size":1000,
                     "sources":[{{"url":"https://github.com/a/b/releases/download/v1/Demo.otf",
                                  "mirror":true,"sha256":"{SAMPLE_SHA}"}}]}}]"#
            )
        } else {
            "[]".to_string()
        };
        format!(
            r#"{{"version":1,"updatedAt":"2026-01-01","fonts":[
                {{"id":"demo","family":"Demo Sans","nameZh":"演示黑",
                  "aliases":["演示黑","demo"],"category":"sans","scripts":["hans"],
                  "coverage":"GB18030-2022","license":"OFL-1.1",
                  "licenseUrl":"https://example.com/l",
                  "redistributable":{redistributable},
                  "homepage":"https://example.com","variants":{variants}}}]}}"#
        )
    }

    #[test]
    fn parses_and_validates_clean_entry() {
        let catalog = Catalog::parse(&sample_json(true, true)).expect("应能解析");
        assert_eq!(catalog.fonts.len(), 1);
        assert!(catalog.validate().is_empty(), "干净的条目不应有问题");
    }

    #[test]
    fn drops_non_redistributable_entry_with_sources() {
        // 法律红线的守门测试：宁可丢条目，也不能留下可下载的违约源
        let mut catalog = Catalog::parse(&sample_json(false, true)).unwrap();
        let issues = catalog.sanitize();

        assert!(catalog.fonts.is_empty(), "违规条目必须被丢弃");
        assert_eq!(issues.len(), 1);
        assert!(issues[0].message.contains("不可入库"));
    }

    #[test]
    fn keeps_link_only_entry_without_sources() {
        let mut catalog = Catalog::parse(&sample_json(false, false)).unwrap();
        let issues = catalog.sanitize();

        assert_eq!(catalog.fonts.len(), 1, "仅链接条目应当保留");
        assert!(issues.is_empty());
        assert_eq!(catalog.only_link_only().count(), 1);
        assert_eq!(catalog.only_redistributable().count(), 0);
    }

    #[test]
    fn rejects_duplicate_ids() {
        let json = r#"{"version":1,"fonts":[
            {"id":"a","family":"A","redistributable":false,"variants":[]},
            {"id":"a","family":"B","redistributable":false,"variants":[]}]}"#;
        let mut catalog = Catalog::parse(json).unwrap();
        let issues = catalog.sanitize();

        assert_eq!(catalog.fonts.len(), 1);
        assert_eq!(issues.len(), 1);
        assert!(issues[0].message.contains("重复"));
    }

    #[test]
    fn flags_missing_sha256() {
        let json = r#"{"version":1,"fonts":[
            {"id":"a","family":"A","redistributable":true,"variants":[
              {"name":"Regular","fileName":"A.otf",
               "sources":[{"url":"https://github.com/a/b/x.otf","sha256":""}]}]}]}"#;
        let catalog = Catalog::parse(json).unwrap();
        let issues = catalog.validate();

        assert!(issues.iter().any(|issue| issue.message.contains("sha256")));
    }

    #[test]
    fn rejects_untrusted_urls() {
        assert!(is_allowed_url("https://github.com/a/b/c.otf"));
        assert!(is_allowed_url("https://objects.githubusercontent.com/x"));

        // 明文
        assert!(!is_allowed_url("http://github.com/a/b/c.otf"));
        // 山寨域名
        assert!(!is_allowed_url("https://evil-github.com/a.otf"));
        // 子域名不放行
        assert!(!is_allowed_url("https://github.com.evil.com/a.otf"));
        // 带 userinfo 的伪装
        assert!(!is_allowed_url("https://github.com@evil.com/a.otf"));
        // 非常规端口
        assert!(!is_allowed_url("https://github.com:8080/a.otf"));
    }

    #[test]
    fn empty_sha256_is_not_accepted_as_hash() {
        assert!(!is_sha256(""));
        assert!(is_sha256(SAMPLE_SHA));
        assert!(!is_sha256(&SAMPLE_SHA[..63]));
        assert!(!is_sha256(&format!("{SAMPLE_SHA}0")));
    }

    #[test]
    fn search_matches_chinese_alias() {
        let catalog = Catalog::parse(&sample_json(true, true)).unwrap();
        let font = &catalog.fonts[0];

        assert!(font.matches("演示黑"), "必须能搜中文别名");
        assert!(font.matches("demo"), "英文 id 也要能搜");
        assert!(font.matches("DEMO SANS"), "大小写不敏感");
        assert!(!font.matches("不存在的字体"));
    }

    #[test]
    fn safe_id_blocks_path_traversal() {
        assert_eq!(safe_id("../../etc/passwd"), "------etc-passwd");
        assert_eq!(safe_id("normal-id_1"), "normal-id_1");
        assert_eq!(safe_id(""), "unnamed");
    }

    /// 真实数据的守门测试：随二进制分发的目录必须自洽。
    #[test]
    fn embedded_catalog_is_consistent() {
        let (catalog, issues) = Catalog::load();
        assert!(issues.is_empty(), "内置目录有问题：{issues:?}");
        assert!(catalog.validate().is_empty(), "内置目录校验未通过");
    }
}
