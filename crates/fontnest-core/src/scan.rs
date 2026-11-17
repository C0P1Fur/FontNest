//! 目录遍历与 Font 组装。
//!
//! 这一层只做"读"，不做任何系统写操作 —— 写字体目录属于 M2，
//! 必须配归属清单与哈希校验，不放在这里。

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::model::{Category, Font, Format, Source};
use crate::paths::FontDir;
use crate::sfnt::{self, FontInfo};

/// 目录递归深度上限，防止误扫到异常深的目录树
const MAX_DEPTH: usize = 6;
/// 单个 .ttc 里最多取多少个 face
const MAX_FACES: u32 = 32;

fn is_font_file(path: &Path) -> bool {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some(ext) => Format::from_extension(ext).is_some(),
        None => false,
    }
}

fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth > MAX_DEPTH {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(value) => value,
            Err(_) => continue,
        };

        // 显式跳过符号链接，避免环形目录
        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            walk(&path, depth + 1, out);
        } else if file_type.is_file() && is_font_file(&path) {
            out.push(path);
        }
    }
}

/// FNV-1a：稳定、无依赖、够短。用于从路径派生不随重启变化的 id。
fn stable_id(path: &str, face: u32) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in path.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash ^= face as u64;
    hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    format!("{hash:016x}")
}

/// 分类靠名称启发式。真正的分类应该来自 Panose / STAT，
/// 但那一层等 cmap 与 STAT 解析补齐后再替换。
fn classify(family: &str, subfamily: &str) -> Category {
    if family.chars().any(|c| ('\u{4E00}'..='\u{9FFF}').contains(&c)) {
        return Category::Cjk;
    }

    let name = format!("{family} {subfamily}").to_lowercase();

    const CJK: &[&str] = &[
        "yahei", "simsun", "simhei", "kaiti", "fangsong", "dengxian", "nsimsun", "ms gothic",
        "ms mincho", "yu gothic", "meiryo", "malgun", "jhenghei", "mingliu", "batang", "gulim",
        "song", "heiti", "zhunyuan", "source han", "noto sans cjk", "noto serif cjk",
    ];
    const MONO: &[&str] = &["mono", "consolas", "courier", "console", "code", "typewriter", "ocr"];
    const SCRIPT: &[&str] = &["script", "hand", "brush", "comic", "cursive", "chancery", "ink free"];
    const DISPLAY: &[&str] = &[
        "impact", "broadway", "stencil", "papyrus", "jokerman", "algerian", "bauhaus",
        "showcard", "cooper", "haettenschweiler", "blackadder", "chiller", "ravie",
    ];
    const SERIF: &[&str] = &[
        "serif", "times", "georgia", "garamond", "bodoni", "palatino", "cambria", "book",
        "roman", "baskerville", "perpetua", "constantia", "rockwell", "sitka", "bell",
        "antiqua", "century schoolbook", "minion", "garalde",
    ];

    let has = |list: &[&str]| list.iter().any(|needle| name.contains(needle));

    if has(CJK) {
        Category::Cjk
    } else if has(MONO) {
        Category::Mono
    } else if has(SCRIPT) {
        Category::Script
    } else if has(DISPLAY) {
        Category::Display
    } else if has(SERIF) {
        Category::Serif
    } else {
        Category::Sans
    }
}

fn build_font(path: &Path, dir: &FontDir, face: u32, info: &FontInfo, size_bytes: u64) -> Font {
    let family = info
        .family
        .clone()
        .or_else(|| info.full_name.clone())
        .unwrap_or_else(|| "未知字体".to_string());
    let subfamily = info.subfamily.clone().unwrap_or_else(|| "Regular".to_string());
    let full_name = info.full_name.clone().unwrap_or_else(|| {
        if subfamily == "Regular" {
            family.clone()
        } else {
            format!("{family} {subfamily}")
        }
    });
    let ps_name = info
        .ps_name
        .clone()
        .unwrap_or_else(|| format!("{}-{}", family.replace(' ', ""), subfamily.replace(' ', "")));

    let path_string = path.to_string_lossy().to_string();
    let category = classify(&family, &subfamily);
    let format = path
        .extension()
        .and_then(|ext| ext.to_str())
        .and_then(Format::from_extension)
        .unwrap_or(Format::Ttf);

    let year = info
        .copyright
        .as_deref()
        .map(sfnt::extract_year)
        .filter(|value| *value > 0)
        .or_else(|| info.version.as_deref().map(sfnt::extract_year))
        .unwrap_or(0);

    let scripts = match category {
        Category::Cjk => vec!["Latn".to_string(), "Hani".to_string()],
        _ => vec!["Latn".to_string()],
    };

    Font {
        id: stable_id(&path_string, face),
        family,
        subfamily,
        full_name,
        ps_name,
        category,
        format,
        weight: info.weight,
        italic: info.italic,
        variable: !info.axes.is_empty(),
        axes: info
            .axes
            .iter()
            .map(|axis| crate::model::Axis {
                tag: axis.tag.clone(),
                min: axis.min,
                max: axis.max,
                default_value: axis.default,
            })
            .collect(),
        instance_count: 0,
        glyph_count: info.glyph_count as u32,
        scripts,
        version: info.version.clone().unwrap_or_default(),
        designer: info
            .designer
            .clone()
            .or_else(|| info.manufacturer.clone())
            .unwrap_or_else(|| "未知".to_string()),
        foundry: info.manufacturer.clone().unwrap_or_else(|| "未知".to_string()),
        year,
        license: info.license.clone().unwrap_or_else(|| "未标注".to_string()),
        source: dir.source,
        enabled: true,
        favorite: false,
        file_path: path_string,
        size_bytes,
        collection_index: face,
    }
}

/// 扫描全部目录。返回 (字体列表, 解析失败数)。
pub fn scan_dirs(dirs: &[FontDir]) -> (Vec<Font>, usize) {
    let mut files: Vec<(PathBuf, Source)> = Vec::new();

    for dir in dirs {
        if !dir.path.exists() {
            continue;
        }
        let mut found = Vec::new();
        walk(&dir.path, 0, &mut found);
        found.sort();
        for path in found {
            files.push((path, dir.source));
        }
    }

    let mut fonts = Vec::new();
    let mut failed = 0usize;

    for (path, source) in &files {
        let metadata = match std::fs::metadata(path) {
            Ok(value) => value,
            Err(_) => {
                failed += 1;
                continue;
            }
        };

        if metadata.len() > sfnt::MAX_FONT_BYTES {
            failed += 1;
            continue;
        }

        let data = match std::fs::read(path) {
            Ok(value) => value,
            Err(_) => {
                failed += 1;
                continue;
            }
        };

        let dir = FontDir {
            path: path.parent().unwrap_or(path).to_path_buf(),
            source: *source,
        };

        let mut parsed_any = false;
        for face in 0..MAX_FACES {
            match sfnt::parse(&data, face) {
                Some(info) => {
                    parsed_any = true;
                    fonts.push(build_font(path, &dir, face, &info, metadata.len()));
                }
                None => break, // face 越界或该 face 损坏
            }
        }

        if !parsed_any {
            failed += 1;
        }
    }

    annotate_instance_counts(&mut fonts);
    (fonts, failed)
}

/// 同族样式数：字体管理器里"18 styles"的来源，必须在全量扫描后回填
fn annotate_instance_counts(fonts: &mut [Font]) {
    let mut counts: HashMap<String, u32> = HashMap::new();
    for font in fonts.iter() {
        *counts.entry(font.family.clone()).or_insert(0) += 1;
    }
    for font in fonts.iter_mut() {
        font.instance_count = counts.get(&font.family).copied().unwrap_or(1);
    }
}
