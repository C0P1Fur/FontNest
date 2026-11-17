//! 领域模型。
//!
//! 字段顺序与命名必须与 `src/types/font.ts` 严格一致：
//! serde 用 `camelCase` 输出，TypeScript 那边直接消费，不做二次映射。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    Sans,
    Serif,
    Mono,
    Script,
    Display,
    Cjk,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Ttf,
    Otf,
    Ttc,
    Otc,
}

impl Format {
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_ascii_lowercase().as_str() {
            "ttf" => Some(Format::Ttf),
            "otf" => Some(Format::Otf),
            "ttc" => Some(Format::Ttc),
            "otc" => Some(Format::Otc),
            _ => None,
        }
    }
}

/// 字体文件来源。只有 `User` 与 `Custom` 目录里的字体才可能被本工具改动。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    System,
    User,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Axis {
    /// OpenType 轴标记，如 wght / wdth / opsz
    pub tag: String,
    pub min: f32,
    pub max: f32,
    pub default_value: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Font {
    pub id: String,
    pub family: String,
    pub subfamily: String,
    pub full_name: String,
    pub ps_name: String,
    pub category: Category,
    pub format: Format,
    pub weight: u16,
    pub italic: bool,
    pub variable: bool,
    pub axes: Vec<Axis>,
    /// 同族样式数，扫描结束后统一回填
    pub instance_count: u32,
    pub glyph_count: u32,
    pub scripts: Vec<String>,
    pub version: String,
    pub designer: String,
    pub foundry: String,
    pub year: u16,
    pub license: String,
    pub source: Source,
    pub enabled: bool,
    pub favorite: bool,
    pub file_path: String,
    pub size_bytes: u64,
    pub collection_index: u32,
}

/// 一次扫描的结果摘要，给 UI 的进度提示用
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub count: usize,
    pub failed: usize,
    pub finished_at: u64,
}
