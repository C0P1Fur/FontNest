//! 最小 sfnt 解析器：只读 name / OS/2 / head / maxp / fvar 五张表。
//!
//! 为什么不用现成 crate：这一层是唯一需要"逐字节正确"的地方，而当前环境
//! 无法执行 `cargo check`。自己写意味着零第三方 API 依赖 —— 不会因为某个
//! crate 改了方法名而整体编不过。所有读取都走 `Option`，任何越界或畸形数据
//! 一律返回 `None`，绝不 panic（损坏字体是外部输入）。
//!
//! 后续硬化时可以把本文件整体替换为 `read-fonts` / `ttf-parser`，
//! 对外只暴露 `FontInfo`，替换成本被限制在这一个文件里。

/// 单个字体文件的大小上限，超过直接拒绝（防内存炸弹）
pub const MAX_FONT_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Default, Clone)]
pub struct FontInfo {
    pub family: Option<String>,
    pub subfamily: Option<String>,
    pub full_name: Option<String>,
    pub ps_name: Option<String>,
    pub version: Option<String>,
    pub designer: Option<String>,
    pub manufacturer: Option<String>,
    pub license: Option<String>,
    pub copyright: Option<String>,
    pub weight: u16,
    pub italic: bool,
    pub glyph_count: u16,
    pub units_per_em: u16,
    pub axes: Vec<AxisInfo>,
}

#[derive(Debug, Clone)]
pub struct AxisInfo {
    pub tag: String,
    pub min: f32,
    pub max: f32,
    pub default: f32,
}

/* ───────────────────── 字节读取 ───────────────────── */

fn u16_at(data: &[u8], off: usize) -> Option<u16> {
    let end = off.checked_add(2)?;
    let slice = data.get(off..end)?;
    Some(u16::from_be_bytes([slice[0], slice[1]]))
}

fn u32_at(data: &[u8], off: usize) -> Option<u32> {
    let end = off.checked_add(4)?;
    let slice = data.get(off..end)?;
    Some(u32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn i32_at(data: &[u8], off: usize) -> Option<i32> {
    let end = off.checked_add(4)?;
    let slice = data.get(off..end)?;
    Some(i32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

/* ───────────────────── 表目录 ───────────────────── */

struct Tables {
    entries: Vec<([u8; 4], usize, usize)>, // tag, offset, length
}

impl Tables {
    fn get(&self, tag: &[u8; 4]) -> Option<(usize, usize)> {
        self.entries
            .iter()
            .find(|(t, _, _)| t == tag)
            .map(|(_, offset, length)| (*offset, *length))
    }
}

/// .ttc / .otc 是多个 face 共享一个文件，必须先定位到目标 face 的 sfnt 头
fn sfnt_base(data: &[u8], face_index: u32) -> Option<usize> {
    let tag = data.get(0..4)?;
    if tag == b"ttcf" {
        let count = u32_at(data, 8)?;
        if face_index >= count {
            return None;
        }
        let entry = 12usize.checked_add((face_index as usize).checked_mul(4)?)?;
        let offset = u32_at(data, entry)? as usize;
        if offset >= data.len() {
            return None;
        }
        Some(offset)
    } else {
        if face_index != 0 {
            return None;
        }
        Some(0)
    }
}

fn read_tables(data: &[u8], base: usize) -> Option<Tables> {
    let num_tables = u16_at(data, base.checked_add(4)?)? as usize;
    if num_tables == 0 || num_tables > 512 {
        return None;
    }

    let mut entries = Vec::with_capacity(num_tables);
    for index in 0..num_tables {
        let record = base.checked_add(12)?.checked_add(index.checked_mul(16)?)?;
        let tag_bytes = data.get(record..record.checked_add(4)?)?;
        let tag = [tag_bytes[0], tag_bytes[1], tag_bytes[2], tag_bytes[3]];
        let offset = u32_at(data, record.checked_add(8)?)? as usize;
        let length = u32_at(data, record.checked_add(12)?)? as usize;
        if offset.checked_add(length)? > data.len() {
            continue; // 单张表越界：跳过它，不影响其他表
        }
        entries.push((tag, offset, length));
    }

    if entries.is_empty() {
        None
    } else {
        Some(Tables { entries })
    }
}

/* ───────────────────── name 表 ───────────────────── */

struct NameRecord {
    platform_id: u16,
    language_id: u16,
    name_id: u16,
    text: String,
}

fn read_names(data: &[u8], offset: usize, length: usize) -> Vec<NameRecord> {
    let mut out = Vec::new();
    let end = match offset.checked_add(length) {
        Some(v) => v,
        None => return out,
    };
    let table = match data.get(offset..end) {
        Some(v) => v,
        None => return out,
    };

    let count = match u16_at(table, 2) {
        Some(v) => v as usize,
        None => return out,
    };
    let string_offset = match u16_at(table, 4) {
        Some(v) => v as usize,
        None => return out,
    };

    for index in 0..count {
        let record = match index.checked_mul(12).and_then(|v| v.checked_add(6)) {
            Some(v) => v,
            None => break,
        };
        let platform_id = match u16_at(table, record) {
            Some(v) => v,
            None => break,
        };
        let language_id = match u16_at(table, record + 4) {
            Some(v) => v,
            None => break,
        };
        let name_id = match u16_at(table, record + 6) {
            Some(v) => v,
            None => break,
        };
        let str_len = match u16_at(table, record + 8) {
            Some(v) => v as usize,
            None => break,
        };
        let str_off = match u16_at(table, record + 10) {
            Some(v) => v as usize,
            None => break,
        };

        let start = match string_offset.checked_add(str_off) {
            Some(v) => v,
            None => break,
        };
        let stop = match start.checked_add(str_len) {
            Some(v) => v,
            None => break,
        };
        let raw = match table.get(start..stop) {
            Some(v) => v,
            None => break,
        };

        if let Some(text) = decode_name(platform_id, raw) {
            let trimmed = text.trim_matches('\u{0}').trim();
            if !trimmed.is_empty() {
                out.push(NameRecord {
                    platform_id,
                    language_id,
                    name_id,
                    text: trimmed.to_string(),
                });
            }
        }
    }

    out
}

fn decode_name(platform_id: u16, raw: &[u8]) -> Option<String> {
    match platform_id {
        // 0 = Unicode, 3 = Windows：都是 UTF-16BE
        0 | 3 => {
            if raw.len() % 2 != 0 || raw.is_empty() {
                return None;
            }
            let units: Vec<u16> = raw
                .chunks_exact(2)
                .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
                .collect();
            Some(String::from_utf16_lossy(&units))
        }
        // 1 = Macintosh：按 Latin-1 近似，足够做兜底
        _ => {
            if raw.is_empty() {
                None
            } else {
                Some(raw.iter().map(|&b| b as char).collect())
            }
        }
    }
}

/// 名称优先级：简体中文 > 英文 > 任意 Windows > Unicode > Mac。
/// 中文用户看到"思源黑体"而不是"Source Han Sans"就是靠这段。
fn pick(records: &[NameRecord], name_id: u16) -> Option<String> {
    let mut best: Option<(u8, String)> = None;

    for record in records {
        if record.name_id != name_id {
            continue;
        }
        let rank = match (record.platform_id, record.language_id) {
            (3, 0x0804) => 0, // zh-Hans
            (3, 0x0409) => 1, // en-US
            (3, _) => 2,
            (0, _) => 3,
            _ => 4,
        };
        if best.as_ref().map_or(true, |(r, _)| rank < *r) {
            best = Some((rank, record.text.clone()));
        }
    }

    best.map(|(_, text)| text)
}

/* ───────────────────── 各表读取 ───────────────────── */

fn read_os2(data: &[u8], offset: usize, length: usize) -> (u16, bool) {
    let mut weight = 400u16;
    let mut italic = false;

    if length < 64 {
        return (weight, italic);
    }

    if let Some(value) = u16_at(data, offset + 4) {
        if (1..=1000).contains(&value) {
            weight = value;
        }
    }

    // fsSelection 位于 OS/2 偏移 62，bit 0 = ITALIC
    if let Some(selection) = u16_at(data, offset + 62) {
        italic = selection & 0b1 != 0;
    }

    (weight, italic)
}

fn read_fvar(data: &[u8], offset: usize, length: usize) -> Vec<AxisInfo> {
    let mut axes = Vec::new();
    if length < 16 {
        return axes;
    }

    let axes_array_offset = match u16_at(data, offset + 4) {
        Some(v) => v as usize,
        None => return axes,
    };
    let axis_count = match u16_at(data, offset + 8) {
        Some(v) => v as usize,
        None => return axes,
    };
    let axis_size = match u16_at(data, offset + 10) {
        Some(v) => v as usize,
        None => return axes,
    };

    if axis_count == 0 || axis_count > 64 || axis_size < 20 {
        return axes;
    }

    for index in 0..axis_count {
        let start = match offset
            .checked_add(axes_array_offset)
            .and_then(|v| v.checked_add(index.checked_mul(axis_size)?))
        {
            Some(v) => v,
            None => break,
        };

        let tag_bytes = match data.get(start..start + 4) {
            Some(v) => v,
            None => break,
        };
        let tag = match std::str::from_utf8(tag_bytes) {
            Ok(v) => v.to_string(),
            Err(_) => break,
        };

        let min = fixed16_16(data, start + 4);
        let default = fixed16_16(data, start + 8);
        let max = fixed16_16(data, start + 12);

        axes.push(AxisInfo {
            tag,
            min,
            max,
            default,
        });
    }

    axes
}

/// OpenType 的 16.16 定点数 → f32，保留三位小数避免 399.99997 这种脏数据
fn fixed16_16(data: &[u8], off: usize) -> f32 {
    match i32_at(data, off) {
        Some(raw) => {
            let value = raw as f32 / 65536.0;
            (value * 1000.0).round() / 1000.0
        }
        None => 0.0,
    }
}

/// 从版权/版本字符串里抠出四位年份，抠不到返回 0
pub fn extract_year(text: &str) -> u16 {
    let bytes: Vec<char> = text.chars().collect();
    let mut index = 0;

    while index + 4 <= bytes.len() {
        let window: String = bytes[index..index + 4].iter().collect();
        if window.chars().all(|c| c.is_ascii_digit()) {
            if let Ok(year) = window.parse::<u16>() {
                if (1900..=2100).contains(&year) {
                    return year;
                }
            }
        }
        index += 1;
    }

    0
}

/* ───────────────────── 对外入口 ───────────────────── */

pub fn parse(data: &[u8], face_index: u32) -> Option<FontInfo> {
    let base = sfnt_base(data, face_index)?;
    let tables = read_tables(data, base)?;

    let mut info = FontInfo {
        weight: 400,
        ..FontInfo::default()
    };

    let mut names = Vec::new();
    if let Some((offset, length)) = tables.get(b"name") {
        names = read_names(data, offset, length);
    }

    info.family = pick(&names, 16).or_else(|| pick(&names, 1));
    info.subfamily = pick(&names, 17).or_else(|| pick(&names, 2));
    info.full_name = pick(&names, 4);
    info.ps_name = pick(&names, 6);
    info.version = pick(&names, 5);
    info.designer = pick(&names, 9);
    info.manufacturer = pick(&names, 8);
    info.license = pick(&names, 13);
    info.copyright = pick(&names, 0);

    if let Some((offset, length)) = tables.get(b"OS/2") {
        let (weight, italic) = read_os2(data, offset, length);
        info.weight = weight;
        info.italic = italic;
    }

    if let Some((offset, _)) = tables.get(b"head") {
        if let Some(upem) = u16_at(data, offset + 18) {
            if upem > 0 {
                info.units_per_em = upem;
            }
        }
    }

    if let Some((offset, _)) = tables.get(b"maxp") {
        if let Some(count) = u16_at(data, offset + 4) {
            info.glyph_count = count;
        }
    }

    if let Some((offset, length)) = tables.get(b"fvar") {
        info.axes = read_fvar(data, offset, length);
    }

    // 家族名都没有的文件不是我们关心的字体
    if info.family.is_none() && info.full_name.is_none() {
        return None;
    }

    Some(info)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf16be_roundtrip() {
        // "Ab" + 汉字"体"，全部按 UTF-16BE 排布
        let raw = [0x00, 0x41, 0x00, 0x62, 0x4F, 0x53];
        assert_eq!(decode_name(3, &raw).as_deref(), Some("Ab体"));
    }

    #[test]
    fn year_scanning() {
        assert_eq!(extract_year("Copyright 2004 Microsoft"), 2004);
        assert_eq!(extract_year("(c) 2019-2021 Example"), 2019);
        assert_eq!(extract_year("no digits here"), 0);
        assert_eq!(extract_year("version 65535"), 0);
    }

    #[test]
    fn truncated_input_never_panics() {
        assert!(parse(&[], 0).is_none());
        assert!(parse(&[0x00], 0).is_none());
        assert!(parse(&[0x00, 0x01, 0x00, 0x00], 0).is_none());
        let junk = vec![0xAA; 512];
        assert!(parse(&junk, 0).is_none());
    }
}
