//! 判断「这个字体能不能参与比对」的**唯一入口**。
//!
//! 存在的理由：过去覆盖率判断（手写 cmap）与实际渲染（swash）是两套解析器，
//! 结论随时可能分叉。TTC 那次 bug 就是这样：手写解析器说"没有这个字"，
//! 而 swash 明明能渲染出来。现在两者共用 swash 的 charmap，**判断者就是执行者**。
//!
//! 第二条约束：**不许静默跳过**。每个被排除的字体都必须带一个原因 ——
//! "没有这个字"和"我读不懂"是两件完全不同的事，混成一个数字就会掩盖 bug。

use swash::FontRef;

/// 被排除的原因
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reason {
    /// 建立不了 face：格式不认识、集合索引越界、文件损坏
    NoFace,
    /// 字体能读，但缺这些字形
    MissingGlyphs { missing: usize },
}

impl Reason {
    /// 给用户看的一句话
    pub fn label(self) -> &'static str {
        match self {
            Self::NoFace => "读不懂",
            Self::MissingGlyphs { .. } => "无此字形",
        }
    }
}

/// 判断结果
pub enum Assessment<'a> {
    Ready(FontRef<'a>),
    Rejected(Reason),
}

/// 判断一个 face 能不能渲染 `text`。
///
/// 成功时把 face 一并返回 —— 调用方接下来就要用它渲染，
/// 避免再解析一次，也避免"判断用 A、渲染用 B"这种分叉。
pub fn assess<'a>(data: &'a [u8], index: u32, text: &str) -> Assessment<'a> {
    let Some(face) = FontRef::from_index(data, index as usize) else {
        return Assessment::Rejected(Reason::NoFace);
    };

    let charmap = face.charmap();
    let missing = text
        .chars()
        .filter(|ch| charmap.map(*ch) == 0)
        .count();

    if missing > 0 {
        return Assessment::Rejected(Reason::MissingGlyphs { missing });
    }

    Assessment::Ready(face)
}

/// 是否以中日韩为主。
///
/// 拉丁查询不该去碰这类字体：中文/日文字体确实含 ASCII，但那是附带的西文字形，
/// 几乎不会是用户想找的那一款；而它们动辄 20–36MB。
pub fn is_cjk(face: &FontRef<'_>) -> bool {
    const SAMPLE: &[char] = &[
        '的', '一', '是', '不', '了', '在', '人', '有', '我', '他', '这', '个', '们', '中', '来',
        '上', '大', '为', '和', '国', '地', '到', '以', '发', '成', '事', '时', '要', '就', '出',
        '会', '可', '也', '你', '对', '生', '能', '而', '子', '那', '得', '于', '着', '下', '自',
        '之', '年', '过', '后', '作', '里', '用', '道', '行', '所', '然', '家', '种', '面', '现',
    ];

    let charmap = face.charmap();
    let covered = SAMPLE.iter().filter(|ch| charmap.map(**ch) != 0).count();
    covered * 2 >= SAMPLE.len()
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
    fn readable_font_is_ready_for_ascii() {
        let Some(data) = any_font() else {
            return;
        };
        assert!(matches!(
            assess(&data, 0, "Rag8"),
            Assessment::Ready(_)
        ));
    }

    #[test]
    fn missing_glyph_is_reported_not_hidden() {
        let Some(data) = any_font() else {
            return;
        };
        // 生僻汉字几乎不可能出现在拉丁字体里
        match assess(&data, 0, "\u{9F98}") {
            Assessment::Rejected(Reason::MissingGlyphs { missing }) => assert_eq!(missing, 1),
            Assessment::Rejected(Reason::NoFace) => {
                panic!("不该判成读不懂 —— 这正是 TTC bug 犯的错")
            }
            Assessment::Ready(_) => panic!("拉丁字体不该有生僻汉字"),
        }
    }

    #[test]
    fn garbage_is_no_face() {
        assert!(matches!(
            assess(&[], 0, "a"),
            Assessment::Rejected(Reason::NoFace)
        ));
        assert!(matches!(
            assess(&[0u8; 64], 0, "a"),
            Assessment::Rejected(Reason::NoFace)
        ));
    }

    #[test]
    fn labels_are_distinct() {
        assert_ne!(
            Reason::NoFace.label(),
            Reason::MissingGlyphs { missing: 1 }.label()
        );
    }
}
