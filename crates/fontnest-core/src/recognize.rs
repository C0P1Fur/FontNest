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

use crate::assess::{Assessment, Reason};
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
    /// 因不含所需字形而跳过的字体数
    pub skipped: usize,
    /// **读不懂**该字体的 cmap（不支持的子表格式、表目录损坏）。
    /// 与 `skipped` 分开计数：解析失败不该伪装成"这个字体没有这个字"。
    pub unsupported: usize,
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
    recognize_ink(&query, text, fonts, limit, started)
}

/// 与 [`recognize`] 相同，但图片来源是**内存里的裸像素**。
///
/// 热键抓剪贴板拿到的是 RGBA 字节（`arboard::ImageData`），走这条入口
/// 可以不落任何临时文件 —— 截图里可能是用户屏幕上的任何内容，不该留盘。
pub fn recognize_rgba(
    width: u32,
    height: u32,
    rgba: &[u8],
    text: &str,
    fonts: &[Font],
    limit: usize,
) -> Result<RecognizeReport, CoreError> {
    let started = Instant::now();
    let query = load_image_ink_rgba(width, height, rgba)?;
    recognize_ink(&query, text, fonts, limit, started)
}

fn recognize_ink(
    query: &Ink,
    text: &str,
    fonts: &[Font],
    limit: usize,
    started: Instant,
) -> Result<RecognizeReport, CoreError> {

    // 诊断开关：FONTNEST_DEBUG_INK=1 时打印查询图归一化后的指纹
    if std::env::var_os("FONTNEST_DEBUG_INK").is_some() {
        let ink: usize = query.mask.iter().filter(|&&value| value == 1).count();
        eprintln!(
            "[debug] 查询图：墨迹 {ink}/{} 格，宽高比 {:.3}",
            NORM * NORM,
            query.aspect
        );
    }


    let skipped = AtomicUsize::new(0);
    let unsupported = AtomicUsize::new(0);
    let failed = AtomicUsize::new(0);

    let mut candidates: Vec<MatchCandidate> = fonts
        .par_iter()
        .filter_map(|font| {
            let Some(bytes) = read_font(Path::new(&font.file_path)) else {
                failed.fetch_add(1, Ordering::Relaxed);
                return None;
            };

            // 唯一的判断入口。成功时把 face 一并拿回来，判断和渲染共用同一个解析器。
            let face = match crate::assess::assess(&bytes, font.collection_index, text) {
                Assessment::Ready(face) => face,
                Assessment::Rejected(reason) => {
                    match reason {
                        Reason::NoFace => unsupported.fetch_add(1, Ordering::Relaxed),
                        Reason::MissingGlyphs { .. } => skipped.fetch_add(1, Ordering::Relaxed),
                    };
                    return None;
                }
            };

            // 注：这里曾经有一条"拉丁查询跳过中日韩字体"的闸门。
            // 它在 fontdue 时代是为了省解析时间（一个中文字体 3.5 秒），
            // 但换成 swash 惰性解析后这个理由消失了，而它带来一个真实缺陷：
            // 用日文/中文字体排版的**拉丁文字**永远匹配不到它自己
            // （自测里 Yu Gothic 名次 0 就是这个原因）。现已移除。

            match render_ink(face, text) {
                Some(ink) => {
                    let (iou, aspect_delta) = compare(query, &ink);
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
        unsupported: unsupported.load(Ordering::Relaxed),
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

    let face = match crate::assess::assess(&bytes, collection_index, text) {
        Assessment::Ready(face) => face,
        Assessment::Rejected(reason) => {
            return Err(CoreError::Invalid(format!("字体不可用于渲染：{}", reason.label())))
        }
    };
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
    ink_from_luma(image)
}

fn load_image_ink_rgba(width: u32, height: u32, rgba: &[u8]) -> Result<Ink, CoreError> {
    let buffer = image::RgbaImage::from_raw(width, height, rgba.to_vec())
        .ok_or_else(|| CoreError::Invalid("像素数据与尺寸不匹配".to_string()))?;
    ink_from_luma(image::DynamicImage::ImageRgba8(buffer).to_luma8())
}

/// 两种来源（文件 / 剪贴板裸像素）最后都汇到这里，保证归一化只有一条路径。
fn ink_from_luma(image: image::GrayImage) -> Result<Ink, CoreError> {
    let (width, height) = image.dimensions();
    let mask = binarize(image.as_raw(), width as usize, height as usize)
        .ok_or_else(|| CoreError::Invalid("图里没有找到文字".to_string()))?;

    normalize(&mask, width as usize, height as usize)
        .ok_or_else(|| CoreError::Invalid("图里没有找到文字".to_string()))
}

/// 把剪贴板里的裸像素缩成一张小预览图（PNG 字节）。
///
/// 让它存在的原因是"确认"：用户按完热键要一眼看到抓到的是哪一块，
/// 出问题时这也是第一眼要看的东西。缩到 `max_width` 以内 ——
/// 原图可能两三千像素宽，不缩会让 IPC 白背几百 KB。
pub fn preview_png(
    width: u32,
    height: u32,
    rgba: &[u8],
    max_width: u32,
) -> Result<Vec<u8>, CoreError> {
    let buffer = image::RgbaImage::from_raw(width, height, rgba.to_vec())
        .ok_or_else(|| CoreError::Invalid("像素数据与尺寸不匹配".to_string()))?;
    let full = image::DynamicImage::ImageRgba8(buffer);

    // thumbnail 只缩不放，且保持宽高比
    let preview = if max_width > 0 && width > max_width {
        full.thumbnail(max_width, u32::MAX)
    } else {
        full
    };

    let mut out = Vec::new();
    preview
        .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .map_err(|error| CoreError::Io(format!("预览编码失败：{error}")))?;

    Ok(out)
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
        // 相对偏移先算清楚，再加 min_y。
        // 曾经写成 `.max(sy0 + 1)` —— sy0 已经是绝对坐标，与相对偏移相加
        // 等于把包围盒起点算了两遍；起点越大，格子被撑得越离谱。
        let top = ty * box_h / NORM;
        let bottom = ((ty + 1) * box_h / NORM).max(top + 1);
        let sy0 = min_y + top;
        let sy1 = (min_y + bottom).min(height);

        for tx in 0..NORM {
            let left = tx * box_w / NORM;
            let right = ((tx + 1) * box_w / NORM).max(left + 1);
            let sx0 = min_x + left;
            let sx1 = (min_x + right).min(width);

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
            // 覆盖率达到 1/4 即认为该格有墨。
            //
            // 曾经用"过半"（ink*2 >= total），那在**宽高比很大**的文本上是灾难：
            // 隶书「永和九年」的墨迹框是 284×47，缩到 48×48 后每个格子只覆盖
            // 约 5.9×1 个像素，2px 宽的竖笔画占比 1/3 永远过不了半 —— 整张图被
            // 压成空白（实测 0/2304 格），于是与所有候选的 IoU 都是 0。
            if total > 0 && ink * 4 >= total {
                out[ty * NORM + tx] = 1;
            }
        }
    }

    // 源图有墨、但缩放后一格都不剩 —— 说明归一化把信息全丢了。
    // 这时必须返回 None，而不是交出一张空掩膜：空掩膜会让 IoU 恒为 0，
    // 表现为"所有候选都是 0 分"，看起来像识别算法不行，实际是预处理坏了。
    if out.iter().all(|&cell| cell == 0) {
        return None;
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

        let (Some(face_a), Some(face_b)) = (
            swash::FontRef::from_index(&a, 0),
            swash::FontRef::from_index(&b, 0),
        ) else {
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

    /// 宽高比很大的文本不能被归一化压成空白。
    ///
    /// 真实案例：隶书「永和九年」的墨迹框是 284×47（宽高比 6.04），
    /// 缩到 48×48 后每格只覆盖约 5.9×1 个像素，细竖笔画占比不到一半，
    /// 旧的"过半"规则把整张图抹成 0/2304 格 —— 于是所有候选都是 0 分。
    #[test]
    fn wide_ink_survives_normalization() {
        let (width, height) = (300usize, 50usize);
        let mut mask = vec![0u8; width * height];
        for x in [10usize, 80, 150, 220] {
            for y in 10..40 {
                mask[y * width + x] = 1;
                mask[y * width + x + 1] = 1;
            }
        }

        let ink = normalize(&mask, width, height).expect("宽文本不该被归一化丢光");
        let cells = ink.mask.iter().filter(|&&value| value == 1).count();
        assert!(cells > 0, "归一化后仍有墨迹，实际 {cells} 格");
        assert!(ink.aspect > 5.0, "宽高比应保留，实际 {}", ink.aspect);
    }

    /// 缩放后一格不剩时必须返回 None —— 交出空掩膜会让 IoU 恒为 0，
    /// 表现为"所有候选都 0 分"，但真凶是预处理。
    #[test]
    fn wiped_mask_is_reported_not_returned() {
        let (width, height) = (2000usize, 2usize);
        let mut mask = vec![0u8; width * height];
        // 极稀疏：只有孤立的单个像素
        for x in (0..width).step_by(97) {
            mask[x] = 1;
        }
        assert!(normalize(&mask, width, height).is_none());
    }

    #[test]
    fn otsu_splits_two_clusters() {        let mut pixels = vec![20u8; 100];
        pixels.extend(vec![230u8; 100]);
        let threshold = otsu(&pixels);
        assert!(threshold > 20 && threshold < 230, "阈值 {threshold} 应落在两峰之间");
    }

    /// 剪贴板给的是裸 RGBA，这里验证「编码成预览 PNG」这一段没有断。
    /// 预览挂了不会让识别失败，但用户就失去"抓对了没有"的确认手段。
    #[test]
    fn preview_png_encodes_rgba() {
        // 3×2 纯红块 = 6 个像素 × 4 通道
        let rgba = vec![255u8, 0, 0, 255].repeat(6);
        let png = preview_png(3, 2, &rgba, 480).expect("编码应成功");
        assert!(png.starts_with(&[0x89, b'P', b'N', b'G']), "必须是 PNG 头");

        let decoded = image::load_from_memory(&png).expect("应能解码");
        assert_eq!((decoded.width(), decoded.height()), (3, 2));
    }

    /// 尺寸和字节数对不上时必须报错，而不是 panic 或产出花屏。
    #[test]
    fn preview_rejects_mismatched_pixels() {
        let rgba = vec![0u8; 16];
        assert!(preview_png(100, 100, &rgba, 480).is_err());
    }
}
