//! cmap 解析：只回答一个问题 —— **这个字体到底有没有这几个字符**。
//!
//! 在字体识别里它是闸门。实测：全库 399 个字体逐个喂给 fontdue 解析要 123 秒，
//! 而慢的几乎全是 20–36MB 的 CJK 字体 —— 为找一个拉丁字体，白解析了三百多兆。
//! 先用 cmap 判定"没这个字"，再贵的字体也能零成本跳过。
//!
//! 支持 format 4（BMP）和 format 12（超 BMP），这两种覆盖了现实中的绝大多数字体。

/// TTC/OTC 是"一个文件装多个 face"，每个 face 有自己的表目录，
/// 从文件头偏移表跳过去；单 face 字体直接把 0 当作目录起点。
///
/// **漏了这一步的后果**：把 TTC 的 `numFonts` 当成表数量、从错误位置读记录，
/// 找不到 cmap，于是判定"该字体没有这个字"，字体被静默排除在候选之外。
/// 本机 23 个 TTC face（宋体、新宋体、微软雅黑…）曾因此全部失联。
fn face_offset(data: &[u8], index: u32) -> Option<usize> {
    if data.get(0..4)? == b"ttcf" {
        let count = u32_at(data, 8)? as usize;
        if index as usize >= count {
            return None;
        }
        Some(u32_at(data, 12 + index as usize * 4)? as usize)
    } else if index == 0 {
        Some(0)
    } else {
        // 单 face 文件里不存在第 1 个 face
        None
    }
}

/// 返回 `chars` 中有多少个能在该字体里找到字形。
///
/// `index` 是 TTC/OTC 里的 face 序号（单 face 字体传 0）。
/// 返回 `0` 表示"一个都没有"，调用方据此跳过；返回 `chars.len()` 才是全覆盖。
pub fn coverage(data: &[u8], index: u32, chars: &[char]) -> usize {
    if chars.is_empty() {
        return 0;
    }
    match glyph_ids(data, index, chars) {
        Some(ids) => ids.iter().filter(|&&id| id != 0).count(),
        None => 0,
    }
}

/// 每个字符对应的字形 id（缺失为 0）。
///
/// `None` 表示连可用子表都没有 —— 与"覆盖 0 个"区分开，调用方可据此放弃该字体。
pub(crate) fn glyph_ids(data: &[u8], index: u32, chars: &[char]) -> Option<Vec<u16>> {
    let subtable = find_best_subtable(data, index)?;
    Some(
        chars
            .iter()
            .map(|ch| glyph_id(&subtable, *ch as u32).unwrap_or(0))
            .collect(),
    )
}

/// 判断这是不是一款"以中日韩为主"的字体。
///
/// 中文/日文字体几乎都带 ASCII 字形（西文是附带的），所以"含这几个字母"不足以
/// 说明它该参与拉丁查询的比对。而它们动辄 20–36MB，**解析一次要 3 秒**，
/// 是全库识别的主要耗时来源。
///
/// 抽样几十个常用汉字：覆盖过半即认定为 CJK 字体。
pub fn is_cjk_font(data: &[u8], index: u32) -> bool {
    // 常用汉字抽样（覆盖 U+4E00..U+9FA5 的各个区段）
    const SAMPLE: &[char] = &[
        '的', '一', '是', '不', '了', '在', '人', '有', '我', '他', '这', '个', '们', '中', '来',
        '上', '大', '为', '和', '国', '地', '到', '以', '发', '成', '事', '时', '要', '就', '出',
        '会', '可', '也', '你', '对', '生', '能', '而', '子', '那', '得', '于', '着', '下', '自',
        '之', '年', '过', '发', '后', '作', '里', '用', '道', '行', '所', '然', '家', '种', '事',
    ];

    let covered = coverage(data, index, SAMPLE);
    covered * 2 >= SAMPLE.len()
}

fn u16_at(data: &[u8], offset: usize) -> Option<u16> {    let slice = data.get(offset..offset + 2)?;
    Some(u16::from_be_bytes([slice[0], slice[1]]))
}

fn u32_at(data: &[u8], offset: usize) -> Option<u32> {
    let slice = data.get(offset..offset + 4)?;
    Some(u32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

/// 在表目录里找 cmap，然后在它的编码记录里挑一个我们能读的子表。
fn find_best_subtable(data: &[u8], index: u32) -> Option<Vec<u8>> {
    // sfnt 文件头：sfntVersion(4) numTables(2) ...
    // TTC 要先跳到对应 face 的表目录
    let base = face_offset(data, index)?;
    let num_tables = u16_at(data, base + 4)? as usize;

    let mut cmap_offset = None;
    for slot in 0..num_tables {
        let record = base + 12 + slot * 16;
        let tag = data.get(record..record + 4)?;
        if tag == b"cmap" {
            cmap_offset = Some(u32_at(data, record + 8)? as usize);
            break;
        }
    }

    let cmap = cmap_offset?;
    let count = u16_at(data, cmap + 2)? as usize;

    let mut best: Option<(u8, usize)> = None; // (优先级, 子表绝对偏移)
    for index in 0..count {
        let record = cmap + 4 + index * 8;
        let platform = u16_at(data, record)?;
        let encoding = u16_at(data, record + 2)?;
        let offset = cmap + u32_at(data, record + 4)? as usize;

        // 优先级：format 12 能表示超 BMP（emoji、生僻字），优先
        let priority = match (platform, encoding) {
            (3, 10) | (0, 4) | (0, 6) => Some(2),
            (3, 1) | (0, 3) => Some(1),
            _ => None,
        };

        if let Some(priority) = priority {
            if best.map(|(current, _)| priority > current).unwrap_or(true) {
                best = Some((priority, offset));
            }
        }
    }

    let (_, offset) = best?;

    // 只有 format 4 / 12 能查，其余直接放弃（按"无覆盖"处理，宁可漏不可错）
    match u16_at(data, offset)? {
        4 | 12 => data.get(offset..).map(|slice| slice.to_vec()),
        _ => None,
    }
}

fn glyph_id(subtable: &[u8], code: u32) -> Option<u16> {
    match u16_at(subtable, 0)? {
        4 => glyph_id_format4(subtable, code),
        12 => glyph_id_format12(subtable, code),
        _ => None,
    }
}

/// format 4：BMP 分段映射，段内用 idDelta / idRangeOffset 两套规则。
fn glyph_id_format4(table: &[u8], code: u32) -> Option<u16> {
    if code > 0xFFFF {
        return None;
    }
    let code = code as u16;

    let seg_count_x2 = u16_at(table, 6)? as usize;
    let seg_count = seg_count_x2 / 2;

    let end_codes = 14;
    let start_codes = end_codes + seg_count_x2 + 2; // +2 跳过 reservedPad
    let id_deltas = start_codes + seg_count_x2;
    let id_range_offsets = id_deltas + seg_count_x2;

    // 段尾是有序的，二分找第一个 endCode >= code
    let mut low = 0usize;
    let mut high = seg_count;
    while low < high {
        let mid = (low + high) / 2;
        if u16_at(table, end_codes + mid * 2)? < code {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    if low >= seg_count {
        return None;
    }

    let start = u16_at(table, start_codes + low * 2)?;
    if start > code {
        return None;
    }

    let delta = u16_at(table, id_deltas + low * 2)?;
    let range_offset = u16_at(table, id_range_offsets + low * 2)?;

    if range_offset == 0 {
        return Some(code.wrapping_add(delta));
    }

    // glyphIdArray 里的位置 = 该段 idRangeOffset 的位置 + range_offset + 2*(code-start)
    let address =
        id_range_offsets + low * 2 + range_offset as usize + 2 * (code - start) as usize;
    let raw = u16_at(table, address)?;
    if raw == 0 {
        return Some(0);
    }
    Some(raw.wrapping_add(delta))
}

/// format 12：分组映射，每组 [start, end] → 连续 glyph id。
fn glyph_id_format12(table: &[u8], code: u32) -> Option<u16> {
    let groups = u32_at(table, 12)? as usize;
    let base = 16usize;

    let mut low = 0usize;
    let mut high = groups;
    while low < high {
        let mid = (low + high) / 2;
        let start = u32_at(table, base + mid * 12)?;
        let end = u32_at(table, base + mid * 12 + 4)?;

        if code < start {
            high = mid;
        } else if code > end {
            low = mid + 1;
        } else {
            let start_glyph = u32_at(table, base + mid * 12 + 8)?;
            let id = start_glyph + (code - start);
            // 超出 u16 的字形 id 在这里没有意义，按缺失处理
            return u16::try_from(id).ok();
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn any_font() -> Option<Vec<u8>> {
        for dir in crate::platform_dirs() {
            let Ok(entries) = std::fs::read_dir(&dir.path) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                let is_ttf = path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| ext.eq_ignore_ascii_case("ttf"))
                    .unwrap_or(false);
                if is_ttf && std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0) > 50_000 {
                    return std::fs::read(&path).ok();
                }
            }
        }
        None
    }

    #[test]
    fn latin_font_covers_ascii() {
        let Some(data) = any_font() else {
            return;
        };
        let chars: Vec<char> = "Rag8".chars().collect();
        assert_eq!(
            coverage(&data, 0, &chars),
            chars.len(),
            "普通字体应当覆盖这几个 ASCII 字符"
        );
    }

    #[test]
    fn latin_font_misses_han() {
        let Some(data) = any_font() else {
            return;
        };
        // 取一个几乎不可能出现在拉丁字体里的汉字
        let chars = vec!['\u{9F98}'];
        let covered = coverage(&data, 0, &chars);
        assert!(
            covered <= 1,
            "拉丁字体理论上不该覆盖生僻汉字，实际覆盖 {covered}"
        );
    }

    /// TTC 回归测试：文件头是 `ttcf` 时，表目录在偏移表之后，不是文件头。
    /// 漏了这一步会让所有 TTC face（宋体、新宋体、微软雅黑…）被误判为"无此字形"。
    #[test]
    fn ttc_faces_are_readable() {
        let mut found = None;
        'outer: for dir in crate::platform_dirs() {
            let Ok(entries) = std::fs::read_dir(&dir.path) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                let is_ttc = path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| ext.eq_ignore_ascii_case("ttc"))
                    .unwrap_or(false);
                if is_ttc {
                    found = std::fs::read(&path).ok();
                    break 'outer;
                }
            }
        }

        let Some(data) = found else {
            return; // 本机没有 TTC 字体，跳过
        };

        assert_eq!(data.get(0..4), Some(b"ttcf".as_slice()), "应当确实是 TTC");
        let covered = coverage(&data, 0, &['A']);

        if covered == 0 {
            // 也允许确实不含拉丁字形的中文字体，但那样它必须能覆盖汉字
            let han = coverage(&data, 0, &['的']);
            assert!(han > 0, "TTC face 0 既无拉丁也无汉字，说明表目录解析错了");
        }
    }

    #[test]
    fn garbage_input_does_not_panic() {
        assert_eq!(coverage(&[], 0, &['a']), 0);
        assert_eq!(coverage(&[0, 1, 0, 0, 0], 0, &['a']), 0);
        assert_eq!(coverage(&[0u8; 64], 0, &['a']), 0);
    }
}
