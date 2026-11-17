//! 手动导入字体文件。
//!
//! 存在的理由：B 类字体的许可**禁止我们转发文件**，用户只能自己去官网下载。
//! 下载完之后总得有地方放——否则那条路径就断在"下好了，然后呢"。
//!
//! 三条原则：
//!
//! 1. **只复制，不移动**。用户的原文件一个字节都不动。
//! 2. **必须能解析出字体名**才算导入成功。光看扩展名不够——改名的图片
//!    也会叫 .ttf，那种文件进了库会在渲染时炸掉。
//! 3. **按内容哈希去重**。同一份文件拖两次不该变成两条记录。

use std::path::{Path, PathBuf};

use crate::catalog::{self, FontMeta};
use crate::fetch;
use crate::library::CoreError;
use crate::sfnt;

/// 与下载侧保持一致的上限
const MAX_BYTES: u64 = 100 * 1024 * 1024;
const ALLOWED_EXTENSIONS: &[&str] = &["ttf", "otf", "ttc"];

#[derive(Debug, Clone)]
pub struct ImportOutcome {
    pub family: String,
    pub path: PathBuf,
    pub bytes: u64,
    pub sha256: String,
    /// 库里已经有同一份内容，这次只是确认了一次
    pub already_present: bool,
}

/// 导入单个字体文件到本地库。
///
/// 成功返回落库路径；失败返回可直接展示给用户的原因。
pub fn import_file(source: &Path) -> Result<ImportOutcome, CoreError> {
    if !source.is_file() {
        return Err(CoreError::Invalid(format!(
            "文件不存在：{}",
            source.display()
        )));
    }

    let extension = source
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        return Err(CoreError::Invalid(format!(
            "只支持 .ttf / .otf / .ttc，这个是 .{extension}"
        )));
    }

    let metadata = std::fs::metadata(source)
        .map_err(|error| CoreError::Io(format!("读取文件信息失败：{error}")))?;
    if metadata.len() > MAX_BYTES {
        return Err(CoreError::Invalid(format!(
            "文件超过 {} MB",
            MAX_BYTES / 1024 / 1024
        )));
    }

    let bytes = std::fs::read(source)
        .map_err(|error| CoreError::Io(format!("读取文件失败：{error}")))?;

    // 能解析出字体名，才说明这确实是一个完整的字体文件
    let info = sfnt::parse(&bytes, 0).ok_or_else(|| {
        CoreError::Invalid("无法解析为字体文件（可能已损坏，或根本不是字体）".to_string())
    })?;
    let family = info
        .family
        .clone()
        .or_else(|| info.full_name.clone())
        .unwrap_or_else(|| {
            source
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or("未命名字体")
                .to_string()
        });

    let sha256 = fetch::hex(&{
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        hasher.finalize()
    });

    // 用「族名 + 哈希前 8 位」作目录名：同名字体不会互相覆盖，重名也能共存
    let folder = format!("{}-{}", sanitize(&family), &sha256[..8]);
    let directory = catalog::library_root().join("imported").join(&folder);
    let file_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("font.ttf")
        .to_string();
    let target = directory.join(&file_name);

    if target.exists() {
        return Ok(ImportOutcome {
            family,
            path: target,
            bytes: metadata.len(),
            sha256,
            already_present: true,
        });
    }

    std::fs::create_dir_all(&directory)
        .map_err(|error| CoreError::Io(format!("创建目录失败：{error}")))?;
    std::fs::write(&target, &bytes)
        .map_err(|error| CoreError::Io(format!("写入失败：{error}")))?;

    // 记来源。以后排查"这个文件哪来的"时这是唯一线索：
    // 目录下载的有 URL，手动导入的只有原路径。
    FontMeta {
        font_id: format!("imported-{}", &sha256[..8]),
        variant: "imported".to_string(),
        file_name,
        sha256: sha256.clone(),
        source: "manual".to_string(),
        original_url: source.to_string_lossy().to_string(),
        downloaded_at: now_millis(),
    }
    .save()
    .ok(); // meta 写失败不该让导入失败

    Ok(ImportOutcome {
        family,
        path: target,
        bytes: metadata.len(),
        sha256,
        already_present: false,
    })
}

/// 批量导入。单条失败不影响其余，返回每条的结果。
pub fn import_files(sources: &[PathBuf]) -> Vec<Result<ImportOutcome, String>> {
    sources
        .iter()
        .map(|path| import_file(path).map_err(|error| error.to_string()))
        .collect()
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

/// 族名会拼进路径，必须挡住 `../`、斜杠和保留字符
fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|ch| {
            if ch.is_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('-');
    if trimmed.is_empty() {
        "font".to_string()
    } else {
        trimmed.chars().take(40).collect()
    }
}

/// 导入目录是不是空——前端可以据此决定要不要显示"还没有导入任何字体"
pub fn imported_count() -> usize {
    let root = catalog::library_root().join("imported");
    std::fs::read_dir(root)
        .map(|entries| entries.filter_map(Result::ok).count())
        .unwrap_or(0)
}

/// 导入的字体在扫描结果里长这样：Source::Custom，路径在库目录下。
pub fn is_import_path(path: &str) -> bool {
    path.contains("library/imported") || path.contains("library\\imported")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "fontnest-import-{name}-{}-{}",
            std::process::id(),
            now_millis()
        ))
    }

    #[test]
    fn rejects_wrong_extension() {
        let dir = scratch("ext");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.woff2");
        std::fs::write(&file, b"whatever").unwrap();

        let error = import_file(&file).unwrap_err();
        assert!(error.to_string().contains("只支持"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_missing_file() {
        let error = import_file(Path::new("C:/definitely/not/here.ttf")).unwrap_err();
        assert!(error.to_string().contains("不存在"));
    }

    /// 改名的非字体文件必须被挡住——这是导入链路上最重要的一道校验
    #[test]
    fn rejects_file_that_is_not_a_font() {
        let dir = scratch("fake");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("fake.ttf");
        std::fs::write(&file, b"this is plain text, not a font").unwrap();

        let error = import_file(&file).unwrap_err();
        assert!(error.to_string().contains("无法解析为字体"));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn sanitize_blocks_path_traversal() {
        assert_eq!(sanitize("../../etc/passwd"), "etc-passwd");
        assert_eq!(sanitize("Source Han Sans"), "Source-Han-Sans");
        assert_eq!(sanitize(""), "font");
        // 超长族名要截断，否则路径会超限
        assert!(sanitize(&"字".repeat(120)).chars().count() <= 40);
    }
}
