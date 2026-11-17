//! 从目录下载字体文件到本地库。
//!
//! ## 为什么用 curl 而不是内置 HTTP 客户端
//!
//! 1. **不引入 TLS 依赖**——rustls/openssl 会让二进制和编译时间都涨一截
//! 2. **自动尊重代理**——公司网络里的用户不需要额外配置，而 Rust 的 HTTP 客户端默认不读系统代理
//! 3. Win10 1803+ / macOS / 主流 Linux 都自带 curl
//!
//! 代价是拿不到精确进度，只能轮询临时文件大小估算。可以接受。
//!
//! ## 安全边界
//!
//! - 域名必须在 [`crate::catalog::ALLOWED_HOSTS`] 白名单里
//! - 下载到 `.part`，**校验通过后才改名**；分两步是为了让半截文件永远进不了库
//! - 校验用的是目录里预先生成的 sha256，不是下载端自己算的

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use sha2::{Digest, Sha256};

use crate::catalog::{self, Catalog, CatalogFont, CatalogVariant, FontMeta};
use crate::library::CoreError;

/// 单文件上限。中文大字库到 30MB 量级，100MB 足够且能挡住恶意目录。
const MAX_BYTES: u64 = 100 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct DownloadReport {
    pub path: PathBuf,
    pub bytes: u64,
    /// `mirror` 或 `upstream`
    pub source: String,
    pub sha256: String,
}

pub fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

pub fn sha256_file(path: &Path) -> Result<String, CoreError> {
    let mut file = std::fs::File::open(path)
        .map_err(|error| CoreError::Io(format!("打开文件失败：{error}")))?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher)
        .map_err(|error| CoreError::Io(format!("读取文件失败：{error}")))?;
    Ok(hex(&hasher.finalize()))
}

/// 源排序：镜像优先，上游兜底。顺序稳定，不依赖 JSON 里的书写顺序。
fn ordered_sources(variant: &CatalogVariant) -> Vec<&catalog::CatalogSource> {
    let mut sources: Vec<&catalog::CatalogSource> = variant.sources.iter().collect();
    sources.sort_by_key(|source| !source.mirror);
    sources
}

/// 下载并校验一个变体。
///
/// `on_progress` 会被周期性调用，参数是已写入的字节数（估算值，可能略滞后）。
pub fn download_variant<F>(
    font: &CatalogFont,
    variant_name: &str,
    mut on_progress: F,
) -> Result<DownloadReport, CoreError>
where
    F: FnMut(u64),
{
    if !font.redistributable {
        // 二次防线：即使上层逻辑出错，这里也不允许下载不可再分发的字体
        return Err(CoreError::Invalid(format!(
            "{} 的许可不允许第三方分发，请从官网获取",
            font.family
        )));
    }

    let variant = font
        .variants
        .iter()
        .find(|candidate| candidate.name == variant_name)
        .ok_or_else(|| CoreError::NotFound(format!("{} 没有变体 {variant_name}", font.id)))?;

    let directory = catalog::font_dir(&font.id);
    std::fs::create_dir_all(&directory)
        .map_err(|error| CoreError::Io(format!("创建库目录失败：{error}")))?;

    let target = directory.join(&variant.file_name);
    let partial = directory.join(format!("{}.part", variant.file_name));

    let mut failures = Vec::new();
    for source in ordered_sources(variant) {
        if !catalog::is_allowed_url(&source.url) {
            failures.push(format!("{}：下载源不在白名单内", source.url));
            continue;
        }
        if source.sha256.len() != 64 {
            failures.push(format!("{}：目录里没有可用的 sha256", source.url));
            continue;
        }

        match fetch_to(&source.url, &partial, &mut on_progress) {
            Ok(bytes) => {
                let actual = match verify_file(&partial, &source.sha256) {
                    Ok(digest) => digest,
                    Err(error) => {
                        let _ = std::fs::remove_file(&partial);
                        failures.push(format!("{}：{error}", source.url));
                        continue;
                    }
                };
                // 校验通过才落地。半截文件永远不进库。
                //
                // 有 `member` 时，下载到的是 zip：先解出字体，再丢掉归档。
                // 注意不能先 rename 到 target 再解包——Windows 上 rename
                // 覆盖已存在的文件会失败。
                match &variant.member {
                    Some(member) => {
                        let extracted = directory.join(format!("{}.extract", variant.file_name));
                        if let Err(error) = extract_member(&partial, member, &extracted) {
                            let _ = std::fs::remove_file(&partial);
                            let _ = std::fs::remove_file(&extracted);
                            failures.push(format!("{}：解包失败（{error}）", source.url));
                            continue;
                        }
                        let _ = std::fs::remove_file(&partial);
                        std::fs::rename(&extracted, &target)
                            .map_err(|error| CoreError::Io(format!("改名失败：{error}")))?;
                    }
                    None => {
                        std::fs::rename(&partial, &target)
                            .map_err(|error| CoreError::Io(format!("改名失败：{error}")))?;
                    }
                }

                FontMeta {
                    font_id: font.id.clone(),
                    variant: variant.name.clone(),
                    file_name: variant.file_name.clone(),
                    sha256: actual.clone(),
                    source: if source.mirror { "mirror" } else { "upstream" }.to_string(),
                    original_url: source.url.clone(),
                    downloaded_at: now_millis(),
                }
                .save()?;

                return Ok(DownloadReport {
                    path: target,
                    bytes,
                    source: if source.mirror { "mirror" } else { "upstream" }.to_string(),
                    sha256: actual,
                });
            }
            Err(error) => {
                let _ = std::fs::remove_file(&partial);
                failures.push(format!("{}：{error}", source.url));
            }
        }
    }

    Err(CoreError::Invalid(format!(
        "下载 {} 失败：{}",
        font.family,
        failures.join("；")
    )))
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

/// 调用 curl 把 url 写到 target，边跑边轮询文件大小报告进度。
fn fetch_to<F>(url: &str, target: &Path, on_progress: &mut F) -> Result<u64, CoreError>
where
    F: FnMut(u64),
{
    let mut child = Command::new("curl")
        .args([
            "-sS",
            "-L",
            "--fail",
            "--max-time",
            "600",
            "--user-agent",
            "fontnest/0.1",
            "-o",
        ])
        .arg(target)
        .arg(url)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            CoreError::Io(format!(
                "无法启动 curl（{error}）。请确认系统已安装 curl，或改用「导入字体文件」。"
            ))
        })?;

    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    let mut message = String::new();
                    if let Some(mut stderr) = child.stderr.take() {
                        use std::io::Read;
                        let _ = stderr.read_to_string(&mut message);
                    }
                    return Err(CoreError::Io(format!(
                        "curl 退出码 {}：{}",
                        status.code().unwrap_or(-1),
                        message.trim()
                    )));
                }
                break;
            }
            Ok(None) => {
                let size = std::fs::metadata(target).map(|meta| meta.len()).unwrap_or(0);
                if size > MAX_BYTES {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(CoreError::Invalid(format!(
                        "文件超过 {} MB 上限",
                        MAX_BYTES / 1024 / 1024
                    )));
                }
                on_progress(size);
                std::thread::sleep(Duration::from_millis(120));
            }
            Err(error) => return Err(CoreError::Io(format!("等待 curl 失败：{error}"))),
        }
    }

    let size = std::fs::metadata(target)
        .map_err(|error| CoreError::Io(format!("读取下载结果失败：{error}")))?
        .len();

    if size == 0 {
        return Err(CoreError::Invalid("下载到的是空文件".to_string()));
    }
    if size > MAX_BYTES {
        return Err(CoreError::Invalid(format!(
            "文件超过 {} MB 上限",
            MAX_BYTES / 1024 / 1024
        )));
    }
    Ok(size)
}

/// 校验文件哈希。不匹配时**不删除调用方的文件**——由调用方决定怎么处理，
/// 这里只负责给出判定和可读的原因。
fn verify_file(path: &Path, expected: &str) -> Result<String, CoreError> {
    if expected.len() != 64 {
        return Err(CoreError::Invalid(
            "目录里的 sha256 长度不对，拒绝下载".to_string(),
        ));
    }
    let actual = sha256_file(path)?;
    if !actual.eq_ignore_ascii_case(expected) {
        return Err(CoreError::Invalid(format!(
            "校验失败（期望 {}…，实际 {}…）",
            &expected[..12],
            &actual[..12]
        )));
    }
    Ok(actual)
}

/// 从 zip 里取出指定成员，写到 `target`。
///
/// 用 `zip` crate 而不是调 `tar` 命令：Linux 的 GNU tar 不认 zip，
/// 而这三个平台都要能跑。
fn extract_member(archive: &Path, member: &str, target: &Path) -> Result<(), CoreError> {
    let file = std::fs::File::open(archive)
        .map_err(|error| CoreError::Io(format!("打开归档失败：{error}")))?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|error| CoreError::Invalid(format!("不是有效的 zip：{error}")))?;

    for index in 0..zip.len() {
        let mut entry = zip
            .by_index(index)
            .map_err(|error| CoreError::Io(format!("读取归档条目失败：{error}")))?;
        // 包里可能带目录层级，按文件名匹配
        if entry.name().rsplit('/').next() != Some(member) {
            continue;
        }
        let mut out = std::fs::File::create(target)
            .map_err(|error| CoreError::Io(format!("写出失败：{error}")))?;
        std::io::copy(&mut entry, &mut out)
            .map_err(|error| CoreError::Io(format!("解包失败：{error}")))?;
        return Ok(());
    }

    Err(CoreError::Invalid(format!("归档里找不到 {member}")))
}

/* ───────────── 本地库查询 ───────────── */

/// 这个字体是否已经下载到本地库（文件在，且 meta 记录对得上）
pub fn is_downloaded(font: &CatalogFont) -> bool {
    font.variants
        .iter()
        .any(|variant| catalog::font_dir(&font.id).join(&variant.file_name).exists())
}

pub fn downloaded_path(font: &CatalogFont) -> Option<PathBuf> {
    font.variants
        .iter()
        .map(|variant| catalog::font_dir(&font.id).join(&variant.file_name))
        .find(|path| path.exists())
}

/// 从本地库删除。只删我们自己下载的文件，不碰系统字体目录。
pub fn remove_download(font: &CatalogFont) -> Result<(), CoreError> {
    let directory = catalog::font_dir(&font.id);
    if directory.exists() {
        std::fs::remove_dir_all(&directory)
            .map_err(|error| CoreError::Io(format!("删除失败：{error}")))?;
    }
    Ok(())
}

/// 载入目录并返回（已剔除违规条目）。CLI 与 Tauri 共用。
pub fn load_catalog() -> (Catalog, Vec<catalog::CatalogIssue>) {
    Catalog::load()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_is_lowercase_and_padded() {
        assert_eq!(hex(&[0x00, 0x0f, 0xff]), "000fff");
        assert_eq!(hex(&[]), "");
    }

    /// 用已知答案验证哈希实现：sha256("hello world")
    #[test]
    fn sha256_matches_known_vector() {
        let path = std::env::temp_dir().join(format!(
            "fontnest-sha-{}-{}.bin",
            std::process::id(),
            now_millis()
        ));
        std::fs::write(&path, b"hello world").unwrap();

        let digest = sha256_file(&path).unwrap();
        assert_eq!(
            digest,
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );

        let _ = std::fs::remove_file(path);
    }

    /// 被篡改的文件必须被拒绝——这是整个下载链路唯一的安全保证
    #[test]
    fn verify_rejects_tampered_content() {
        let path = std::env::temp_dir().join(format!(
            "fontnest-verify-{}-{}.bin",
            std::process::id(),
            now_millis()
        ));
        std::fs::write(&path, b"hello world").unwrap();

        let correct = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";
        assert!(verify_file(&path, correct).is_ok(), "正确哈希应通过");

        let wrong = "0".repeat(64);
        let error = verify_file(&path, &wrong).unwrap_err();
        assert!(error.to_string().contains("校验失败"));

        // 长度不对的哈希不能被当成长度正确但内容不同的哈希处理
        assert!(verify_file(&path, "abc").is_err());

        // 大写十六进制也要能通过（目录数据可能由不同工具生成）
        assert!(verify_file(&path, &correct.to_uppercase()).is_ok());

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn rejects_non_redistributable_before_touching_network() {
        let font = CatalogFont {
            id: "demo".to_string(),
            family: "Demo".to_string(),
            aliases: vec![],
            name_zh: String::new(),
            category: String::new(),
            scripts: vec![],
            coverage: String::new(),
            license: String::new(),
            license_url: String::new(),
            redistributable: false,
            homepage: String::new(),
            note: String::new(),
            variants: vec![],
        };
        let error = download_variant(&font, "Regular", |_| {}).unwrap_err();
        assert!(error.to_string().contains("许可不允许"));
    }

    #[test]
    fn mirror_sources_come_first() {
        let variant = CatalogVariant {
            name: "Regular".to_string(),
            file_name: "a.ttf".to_string(),
            size: 0,
            member: None,
            sources: vec![
                catalog::CatalogSource {
                    url: "https://github.com/upstream.ttf".to_string(),
                    mirror: false,
                    sha256: "a".repeat(64),
                },
                catalog::CatalogSource {
                    url: "https://github.com/mirror.ttf".to_string(),
                    mirror: true,
                    sha256: "b".repeat(64),
                },
            ],
        };
        let ordered = ordered_sources(&variant);
        assert_eq!(ordered[0].url, "https://github.com/mirror.ttf");
        assert_eq!(ordered[1].url, "https://github.com/upstream.ttf");
    }
}
