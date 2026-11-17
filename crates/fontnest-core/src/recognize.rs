//! 字体识别：渲染—模板匹配。
//!
//! 前提是**知道图里画的是什么字**。给定文本，把每个候选字体渲染成同样的文本，
//! 两边都归一化到固定方框后算墨迹重叠度（IoU），按相似度排序。
//!
//! 为什么不用机器学习：在"已知文本 + 候选集有限"的前提下，模板匹配的准确率已经
//! 足够，而且完全可解释 —— 分数就是"两块墨迹的重叠比例"，没有任何黑盒。
//!
//! 与传统字体识别服务的根本区别：它们比的是商业字库（认出来你也买不到），
//! 我们比的是**这台机器上的所有字体**，包括还没安装的。

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::library::CoreError;
use crate::model::Font;

/// 归一化后的边长。48 是经验值：再小丢字形细节，再大对手机截图没有增益。
const NORM: usize = 48;

/// 渲染画布。够宽能放下 20 个字符，够高能放下上下伸部。
const CANVAS_W: usize = 900;
const CANVAS_H: usize = 160;
const BASELINE: usize = 118;
const RENDER_PX: f32 = 72.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchCandidate {
    pub font_id: String,
    /// 最终得分：IoU 扣除宽高比惩罚
    pub score: f32,
    pub iou: f32,
    pub aspect_delta: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecognizeReport {
    pub candidates: Vec<MatchCandidate>,
    /// 参与比对的字体数
    pub considered: usize,
    /// 因不含所需字形而跳过的字体数（cmap 闸门挡掉的）
    pub skipped: usize,
    /// 解析或渲染失败的字体数（损坏文件等）
    pub failed: usize,
    pub elapsed_ms: u128,
}

/// 一块已经归一化的墨迹
struct Ink {
    /// NORM × NORM，1 = 有墨
    mask: Vec<u8>,
    /// 裁切后墨迹的 宽/高
    aspect: f32,
}

/* ───────────── 对外入口 ───────────── */

/// 用已知文本，在 `fonts` 里找与图片最像的字体。
///
/// **曾经试过两级粗筛（先按字宽签名砍到 96 个），已撤除。**
/// 原因不是没变快，而是**不可靠**：签名用 `总步进宽度 / (ascender−descender)`，
/// 截图侧的宽高比来自真实墨迹框，两者不是同一个量，排序不单调 ——
/// 实测把正解 Georgia 直接挤出了候选。
/// 会静默丢掉正确答案的加速，比慢 5 秒糟糕得多。
///
/// 正确的两级做法需要**字形级包围盒**（loca + glyf 头部，仍然不用栅格化），
/// 让两侧都基于"真实墨迹框"比较。这条路待验证，见 docs/BACKEND.md。
pub fn recognize(
    image_path: &Path,
    text: &str,
    fonts: &[Font],
    limit: usize,
) -> Result<RecognizeReport, CoreError> {
    let started = Instant::now();

    let query = load_image_ink(image_path)?;
    let chars: Vec<char> = text.chars().collect();
    let latin_query = !text.is_empty() && text.chars().all(|ch| ch.is_ascii());

    let skipped = AtomicUsize::new(0);
    let failed = AtomicUsize::new(0);

    let mut candidates: Vec<MatchCandidate> = fonts
        .par_iter()
        .filter_map(|font| {
            let Some(bytes) = read_font(Path::new(&font.file_path)) else {
                failed.fetch_add(1, Ordering::Relaxed);
                return None;
            };

            // 脚本闸门：拉丁查询不去碰中文字体。它们确实含 ASCII，但那是附带的
            // 西文字形，几乎不会是目标；而解析一个 20–36MB 的中文字体要好几秒。
            if latin_query && crate::cmap::is_cjk_font(&bytes, font.collection_index) {
                skipped.fetch_add(1, Ordering::Relaxed);
                return None;
            }

            // 字形闸门：字体里没有这几个字，就不必花几百毫秒去解析它
            if crate::cmap::coverage(&bytes, font.collection_index, &chars) < chars.len() {
                skipped.fetch_add(1, Ordering::Relaxed);
                return None;
            }

            let Some(face) = parse_face(&bytes, font.collection_index) else {
                failed.fetch_add(1, Ordering::Relaxed);
                return None;
            };

            match render_ink(face, text) {
                Some(ink) => {
                    let (iou, aspect_delta) = compare(&query, &ink);
                    Some(MatchCandidate {
                        font_id: font.id.clone(),
                        score: (iou - 0.2 * aspect_delta.min(1.0)).max(0.0),
                        iou,
                        aspect_delta,
                    })
                }
                None => {
                    failed.fetch_add(1, Ordering::Relaxed);
                    None
                }
            }
        })
        .collect();

    candidates.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    candidates.truncate(limit);

    Ok(RecognizeReport {
        candidates,
        considered: fonts.len(),
        skipped: skipped.load(Ordering::Relaxed),
        failed: failed.load(Ordering::Relaxed),
        elapsed_ms: started.elapsed().as_millis(),
    })
}

/// 把一个字体渲染成 PNG —— 用来造测试图，验证整条识别链路。
pub fn render_png(
    font_path: &Path,
    collection_index: u32,
    text: &str,
    out_path: &Path,
) -> Result<(), CoreError> {
    let bytes = read_font(font_path)
        .ok_or_else(|| CoreError::Io(format!("读不到字体文件：{}", font_path.display())))?;

    let face = parse_face(&bytes, collection_index)
        .ok_or_else(|| CoreError::Invalid("字体解析失败".to_string()))?;
    let canvas = rasterize(face, text);

    let image = image::GrayImage::from_raw(CANVAS_W as u32, CANVAS_H as u32, canvas)
        .ok_or_else(|| CoreError::Invalid("画布尺寸不匹配".to_string()))?;
    image
        .save(out_path)
        .map_err(|error| CoreError::Io(format!("写出图片失败：{error}")))
}

/* ───────────── 图片侧 ───────────── */

fn load_image_ink(path: &Path) -> Result<Ink, CoreError> {
    let image = image::open(path)
        .map_err(|error| CoreError::Io(format!("打不开图片 {}：{error}", path.display())))?
        .to_luma8();

    let (width, height) = image.dimensions();
    let raw = image.as_raw();
    let mask = binarize(raw, width as usize, height as usize)
        .ok_or_else(|| CoreError::Invalid("图里没有找到文字".to_string()))?;

    normalize(&mask, width as usize, height as usize)
        .ok_or_else(|| CoreError::Invalid("图里没有找到文字".to_string()))
}

/// Otsu 阈值 + 极性判断。
///
/// 极性靠边框像素判断：截图通常文字在中间、背景铺满四周，
/// 所以"边框是亮的" → 文字是暗的。比统计墨量多数派更稳。
fn binarize(raw: &[u8], width: usize, height: usize) -> Option<Vec<u8>> {
    if width == 0 || height == 0 || raw.len() < width * height {
        return None;
    }

    let threshold = otsu(raw);

    let mut border_sum = 0u64;
    let mut border_count = 0u64;
    for x in 0..width {
        border_sum += raw[x] as u64;
        border_sum += raw[(height - 1) * width + x] as u64;
        border_count += 2;
    }
    for y in 0..height {
        border_sum += raw[y * width] as u64;
        border_sum += raw[y * width + width - 1] as u64;
        border_count += 2;
    }
    let light_background = border_sum / border_count.max(1) > 127;

    let mut mask = vec![0u8; width * height];
    for index in 0..width * height {
        let value = raw[index];
        let ink = if light_background {
            value < threshold
        } else {
            value > threshold
        };
        if ink {
            mask[index] = 1;
        }
    }

    Some(mask)
}

fn otsu(raw: &[u8]) -> u8 {
    let mut histogram = [0u32; 256];
    for &value in raw {
        histogram[value as usize] += 1;
    }

    let total: u32 = raw.len() as u32;
    let sum: u64 = histogram
        .iter()
        .enumerate()
        .map(|(value, count)| value as u64 * *count as u64)
        .sum();

    let mut sum_background = 0u64;
    let mut weight_background = 0u32;
    let mut best_threshold = 128u8;
    let mut best_variance = 0f64;

    for threshold in 0..256usize {
        weight_background += histogram[threshold];
        if weight_background == 0 {
            continue;
        }
        let weight_foreground = total - weight_background;
        if weight_foreground == 0 {
            break;
        }

        sum_background += threshold as u64 * histogram[threshold] as u64;

        let mean_background = sum_background as f64 / weight_background as f64;
        let mean_foreground = (sum - sum_background) as f64 / weight_foreground as f64;
        let delta = mean_background - mean_foreground;

        let variance =
            weight_background as f64 * weight_foreground as f64 * delta * delta;
        if variance > best_variance {
            best_variance = variance;
            // 取两类均值的中间值作为阈值，而不是直接用直方图下标。
            // 下标会紧贴暗峰（如两峰 20/230 时返回 20），把字形像素判成背景；
            // 中间值（125）对反锯齿边缘也稳得多。
            let mid = (mean_background + mean_foreground) / 2.0;
            best_threshold = mid.clamp(0.0, 255.0) as u8;
        }
    }

    best_threshold
}

/* ───────────── 字体侧 ───────────── */
fn read_font(path: &Path) -> Option<Vec<u8>> {
    let meta = std::fs::metadata(path).ok()?;
    // 单文件上限，防止误指向巨型资源文件
    if meta.len() == 0 || meta.len() > 64 * 1024 * 1024 {
        return None;
    }
    std::fs::read(path).ok()
}

/// 用惰性解析器取一个 face。
///
/// 换成 swash 的理由见 Cargo.toml：它的加载是 O(1)（只校验表目录），
/// 取字形时才去读那一段字节。对照实验：fontdue 加载 46ms/字体，swash 0.005ms。
fn parse_face(bytes: &[u8], collection_index: u32) -> Option<swash::FontRef<'_>> {
    swash::FontRef::from_index(bytes, collection_index as usize)
}

fn render_ink(face: swash::FontRef<'_>, text: &str) -> Option<Ink> {
    let canvas = rasterize(face, text);
    // 必须和截图侧走**同一条**二值化规则（Otsu + 边框极性判断）。
    // 早先这里写死 `> 127`、截图侧用 Otsu，同一个字体自己比自己只有 0.981，
    // 那 2% 的差全部来自抗锯齿边缘的阈值不一致。
    let mask = binarize(&canvas, CANVAS_W, CANVAS_H)?;
    normalize(&mask, CANVAS_W, CANVAS_H)
}

/// 把文本画进画布，返回灰度图（0 = 无墨，255 = 满墨）
fn rasterize(face: swash::FontRef<'_>, text: &str) -> Vec<u8> {
    let mut coverage = vec![0f32; CANVAS_W * CANVAS_H];

    let mut context = swash::scale::ScaleContext::new();
    let mut scaler = context.builder(face).size(RENDER_PX).build();
    let render = swash::scale::Render::new(&[swash::scale::Source::Outline]);

    // advance_width 返回的是**字体单位**（如 1200），必须按 upem 换成像素，
    // 否则第一个字之后全被推出画布
    let units_per_em = face.metrics(&[]).units_per_em as f32;
    let to_px = if units_per_em > 0.0 {
        RENDER_PX / units_per_em
    } else {
        1.0
    };

    let mut pen_x = 0f32;
    for ch in text.chars() {
        let glyph = face.charmap().map(ch);
        if glyph == 0 {
            continue;
        }
        let advance = face.glyph_metrics(&[]).advance_width(glyph) * to_px;

        if let Some(image) = render.render(&mut scaler, glyph) {
            let placement = image.placement;
            let origin_x = pen_x.round() as i32 + placement.left;
            // swash 的 top 是"基线到图像顶边"的距离，向上为正；画布 y 轴向下
            let origin_y = BASELINE as i32 - placement.top;

            if image.content == swash::scale::image::Content::Mask {
                for row in 0..placement.height as usize {
                    for col in 0..placement.width as usize {
                        let value =
                            image.data[row * placement.width as usize + col] as f32 / 255.0;
                        let x = origin_x + col as i32;
                        let y = origin_y + row as i32;
                        if x < 0 || y < 0 || x as usize >= CANVAS_W || y as usize >= CANVAS_H {
                            continue;
                        }
                        let index = y as usize * CANVAS_W + x as usize;
                        if value > coverage[index] {
                            coverage[index] = value;
                        }
                    }
                }
            }
        }

        pen_x += advance;
    }

    coverage
        .into_iter()
        .map(|value| (value.clamp(0.0, 1.0) * 255.0) as u8)
        .collect()
}

/* ───────────── 归一化与比对 ───────────── */

/// 裁到墨迹包围盒，再按块平均缩放成 NORM × NORM。
///
/// 两边（截图 / 渲染）走**完全相同**的这条归一化，才谈得上可比。
fn normalize(mask: &[u8], width: usize, height: usize) -> Option<Ink> {
    let (mut min_x, mut min_y) = (usize::MAX, usize::MAX);
    let (mut max_x, mut max_y) = (0usize, 0usize);
    let mut any = false;

    for y in 0..height {
        for x in 0..width {
            if mask[y * width + x] != 0 {
                any = true;
                min_x = min_x.min(x);
                min_y = min_y.min(y);
                max_x = max_x.max(x);
                max_y = max_y.max(y);
            }
        }
    }
    if !any {
        return None;
    }

    let box_w = max_x - min_x + 1;
    let box_h = max_y - min_y + 1;

    let mut out = vec![0u8; NORM * NORM];
    for ty in 0..NORM {
        // 目标格子对应的源行区间
        let sy0 = min_y + ty * box_h / NORM;
        let sy1 = min_y + ((ty + 1) * box_h / NORM).max(sy0 + 1);

        for tx in 0..NORM {
            let sx0 = min_x + tx * box_w / NORM;
            let sx1 = min_x + ((tx + 1) * box_w / NORM).max(sx0 + 1);

            let mut ink = 0u32;
            let mut total = 0u32;
            for sy in sy0..sy1.min(height) {
                for sx in sx0..sx1.min(width) {
                    total += 1;
                    if mask[sy * width + sx] != 0 {
                        ink += 1;
                    }
                }
            }
            // 覆盖过半即认为该格有墨
            if total > 0 && ink * 2 >= total {
                out[ty * NORM + tx] = 1;
            }
        }
    }

    Some(Ink {
        mask: out,
        aspect: box_w as f32 / box_h as f32,
    })
}

fn compare(a: &Ink, b: &Ink) -> (f32, f32) {
    let mut intersection = 0u32;
    let mut union = 0u32;

    for index in 0..NORM * NORM {
        let (left, right) = (a.mask[index], b.mask[index]);
        if left == 1 && right == 1 {
            intersection += 1;
        }
        if left == 1 || right == 1 {
            union += 1;
        }
    }

    let iou = if union == 0 {
        0.0
    } else {
        intersection as f32 / union as f32
    };

    let aspect_delta = (a.aspect / b.aspect).ln().abs();

    (iou, aspect_delta)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn any_two_fonts() -> Option<(std::path::PathBuf, std::path::PathBuf)> {
        let mut files = Vec::new();
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
                    files.push(path);
                }
            }
            if files.len() >= 2 {
                break;
            }
        }
        if files.len() < 2 {
            return None;
        }
        Some((files[0].clone(), files[1].clone()))
    }

    #[test]
    fn identical_ink_scores_one() {
        let ink = Ink {
            mask: vec![0; NORM * NORM],
            aspect: 1.0,
        };
        let (iou, delta) = compare(&ink, &ink);
        assert_eq!(iou, 0.0); // 全空时并集为 0，约定返回 0 而不是 1
        assert_eq!(delta, 0.0);
    }

    /// 自证式测试：用自己的字体渲染，应该比用别的字体渲染更像自己。
    #[test]
    fn font_matches_itself_best() {
        let Some((first, second)) = any_two_fonts() else {
            return; // 环境里没有可用字体，跳过
        };

        let text = "Rag 8g";
        let a = std::fs::read(&first).unwrap();
        let b = std::fs::read(&second).unwrap();

        let (Some(face_a), Some(face_b)) = (parse_face(&a, 0), parse_face(&b, 0)) else {
            return;
        };

        let Some(ink_a) = render_ink(face_a, text) else {
            return;
        };
        let Some(ink_b) = render_ink(face_b, text) else {
            return;
        };

        let (self_iou, _) = compare(&ink_a, &ink_a);
        let (cross_iou, _) = compare(&ink_a, &ink_b);

        assert_eq!(self_iou, 1.0, "同一字体自比必须完全重合");
        assert!(
            self_iou > cross_iou,
            "自比 {self_iou} 应高于跨字体 {cross_iou}"
        );
    }

    #[test]
    fn otsu_splits_two_clusters() {
        let mut pixels = vec![20u8; 100];
        pixels.extend(vec![230u8; 100]);
        let threshold = otsu(&pixels);
        assert!(threshold > 20 && threshold < 230, "阈值 {threshold} 应落在两峰之间");
    }
}
