//! 从灰度图里提取"文字墨迹"。
//!
//! 截图侧和渲染侧都走这一个函数 —— 任何不对称都会让 IoU 失去意义。
//!
//! 流程（对应设计文档里的 2/3/4/5/7）：
//!
//! 1. **局部背景**：大窗口均值当作"这张图如果没有文字会是什么样"，
//!    原图减掉它 → 亮度渐变、整体明暗都不再重要（对应"背景建模"）
//! 2. **局部对比度阈值**：残差超过 `CONTRAST_MIN` 才算墨，比全局 Otsu 稳
//! 3. **双极性**：亮字和暗字各算一份，选"更像文字"的那一份
//!    （判错黑白会让掩膜完全颠倒，以前只能靠猜边框颜色）
//! 4. **连通域过滤**：扔掉灰尘大小的碎点和铺满全屏的巨型块
//! 5. **质量门槛**：不像文字就直接拒绝，而不是硬排一个名次出来
//!
//! 归一化（压空白列、缩到 48×48）在 recognize 里，不在这里。

/// 残差超过这个灰度差才算墨。文字与背景的对比度通常远大于 16
const CONTRAST_MIN: f32 = 16.0;

/// 组件面积小于整图这个比例 → 视为灰尘
const SPECK_RATIO: f32 = 0.000_15;
/// 组件包围盒面积超过整图这个比例 → 视为"背景块"而不是字
const SLAB_RATIO: f32 = 0.85;

/// 质量门槛
const MIN_INK_RATIO: f32 = 0.02;
const MAX_INK_RATIO: f32 = 0.75;
const MAX_COMPONENTS: usize = 512;
const MIN_ASPECT: f32 = 0.4;
const MAX_ASPECT: f32 = 20.0;

/// 提取结果：清洗过的二值掩膜（1 = 墨）
#[derive(Debug)]
pub struct Prep {
    pub mask: Vec<u8>,
    pub width: usize,
    pub height: usize,
}

/// 拒绝的原因。每一种都对应一句能直接给用户看的话。
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Reject {
    /// 一个墨点都没找到
    NoInk,
    /// 找到的东西太稀疏或太满，不像一行字
    InkRatio(f32),
    /// 碎块太多，多半是背景纹理
    Fragmented(usize),
    /// 形状不像一行字（太细长或太方正）
    Aspect(f32),
}

impl Reject {
    pub fn message(self) -> String {
        match self {
            Self::NoInk => "图里没有找到文字".to_string(),
            Self::InkRatio(ratio) => format!(
                "这张图的明暗不适合识别（墨迹占比 {:.0}%），换一张或换块区域试试",
                ratio * 100.0
            ),
            Self::Fragmented(count) => format!(
                "这张图的背景太复杂（有 {count} 块碎片），建议换一张背景更干净的图"
            ),
            Self::Aspect(aspect) => format!(
                "这一块的形状不像一行文字（宽高比 {aspect:.1}）"
            ),
        }
    }
}

/// 主入口
pub fn extract(gray: &[u8], width: usize, height: usize) -> Result<Prep, Reject> {
    if width == 0 || height == 0 || gray.len() < width * height {
        return Err(Reject::NoInk);
    }

    let background = background_field(gray, width, height);

    // 双极性：亮字 / 暗字各算一份
    let light = polarity_mask(gray, &background, true);
    let dark = polarity_mask(gray, &background, false);

    let light = clean(light, width, height);
    let dark = clean(dark, width, height);

    // 选"更像文字"的那一份。判错的典型后果是把整片背景当成墨
    let light_score = textness(&light, width, height);
    let dark_score = textness(&dark, width, height);

    let (mask, score) = if light_score >= dark_score {
        (light, light_score)
    } else {
        (dark, dark_score)
    };

    if score <= 0.0 {
        return Err(Reject::NoInk);
    }

    let cleaned = drop_components(&mask, width, height);
    let (ink, count, min_x, min_y, max_x, max_y) = stats(&cleaned, width, height);

    if ink == 0 || count == 0 {
        return Err(Reject::NoInk);
    }

    let box_w = max_x - min_x + 1;
    let box_h = max_y - min_y + 1;
    let ink_ratio = ink as f32 / (box_w * box_h) as f32;
    if !(MIN_INK_RATIO..=MAX_INK_RATIO).contains(&ink_ratio) {
        return Err(Reject::InkRatio(ink_ratio));
    }

    if count > MAX_COMPONENTS {
        return Err(Reject::Fragmented(count));
    }

    let aspect = box_w as f32 / box_h as f32;
    if !(MIN_ASPECT..=MAX_ASPECT).contains(&aspect) {
        return Err(Reject::Aspect(aspect));
    }

    Ok(Prep {
        mask: cleaned,
        width,
        height,
    })
}

/// 大窗口均值：把它当成"这张图没有文字时的样子"
fn background_field(gray: &[u8], width: usize, height: usize) -> Vec<f32> {
    let radius = (height / 3).clamp(6, 80);
    let integral = integral_image(gray, width, height);
    let mut field = vec![0f32; width * height];

    for y in 0..height {
        for x in 0..width {
            field[y * width + x] = window_mean(&integral, width, height, x, y, radius);
        }
    }

    field
}

fn integral_image(gray: &[u8], width: usize, height: usize) -> Vec<u64> {
    let stride = width + 1;
    let mut integral = vec![0u64; stride * (height + 1)];

    for y in 0..height {
        let mut row_sum = 0u64;
        for x in 0..width {
            row_sum += gray[y * width + x] as u64;
            integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row_sum;
        }
    }

    integral
}

fn window_mean(
    integral: &[u64],
    width: usize,
    height: usize,
    x: usize,
    y: usize,
    radius: usize,
) -> f32 {
    let stride = width + 1;
    let x0 = x.saturating_sub(radius);
    let y0 = y.saturating_sub(radius);
    let x1 = (x + radius + 1).min(width);
    let y1 = (y + radius + 1).min(height);

    let sum = integral[y1 * stride + x1] + integral[y0 * stride + x0]
        - integral[y0 * stride + x1]
        - integral[y1 * stride + x0];
    let count = ((x1 - x0) * (y1 - y0)).max(1);

    sum as f32 / count as f32
}

/// 残差法：比局部背景明显更亮（或更暗）的像素算墨
fn polarity_mask(gray: &[u8], background: &[f32], light: bool) -> Vec<u8> {
    let mut mask = vec![0u8; gray.len()];
    for (index, &value) in gray.iter().enumerate() {
        let residual = value as f32 - background[index];
        let hits = if light {
            residual > CONTRAST_MIN
        } else {
            residual < -CONTRAST_MIN
        };
        if hits {
            mask[index] = 1;
        }
    }
    mask
}

/// 去掉碎点与巨型块
fn clean(mask: Vec<u8>, width: usize, height: usize) -> Vec<u8> {
    drop_components(&mask, width, height)
}

/// 连通域过滤。四连通，栈式 flood fill。
fn drop_components(mask: &[u8], width: usize, height: usize) -> Vec<u8> {
    let total = width * height;
    let speck = (total as f32 * SPECK_RATIO).max(4.0) as usize;
    let slab = (total as f32 * SLAB_RATIO) as usize;

    let mut out = vec![0u8; total];
    let mut seen = vec![false; total];
    let mut stack: Vec<usize> = Vec::new();

    for start in 0..total {
        if mask[start] == 0 || seen[start] {
            continue;
        }

        stack.clear();
        stack.push(start);
        seen[start] = true;
        let mut cells = Vec::new();

        while let Some(index) = stack.pop() {
            cells.push(index);
            let x = index % width;
            let y = index / width;

            if x > 0 {
                let next = index - 1;
                if mask[next] == 1 && !seen[next] {
                    seen[next] = true;
                    stack.push(next);
                }
            }
            if x + 1 < width {
                let next = index + 1;
                if mask[next] == 1 && !seen[next] {
                    seen[next] = true;
                    stack.push(next);
                }
            }
            if y > 0 {
                let next = index - width;
                if mask[next] == 1 && !seen[next] {
                    seen[next] = true;
                    stack.push(next);
                }
            }
            if y + 1 < height {
                let next = index + width;
                if mask[next] == 1 && !seen[next] {
                    seen[next] = true;
                    stack.push(next);
                }
            }
        }

        let area = cells.len();
        if area < speck || area > slab {
            continue;
        }

        for index in cells {
            out[index] = 1;
        }
    }

    out
}

fn stats(mask: &[u8], width: usize, height: usize) -> (usize, usize, usize, usize, usize, usize) {
    let mut ink = 0usize;
    let mut min_x = usize::MAX;
    let mut min_y = usize::MAX;
    let mut max_x = 0usize;
    let mut max_y = 0usize;

    for y in 0..height {
        for x in 0..width {
            if mask[y * width + x] != 0 {
                ink += 1;
                min_x = min_x.min(x);
                min_y = min_y.min(y);
                max_x = max_x.max(x);
                max_y = max_y.max(y);
            }
        }
    }

    if ink == 0 {
        return (0, 0, 0, 0, 0, 0);
    }

    let components = count_components(mask, width, height);
    (ink, components, min_x, min_y, max_x, max_y)
}

fn count_components(mask: &[u8], width: usize, height: usize) -> usize {
    let total = width * height;
    let mut seen = vec![false; total];
    let mut stack: Vec<usize> = Vec::new();
    let mut count = 0usize;

    for start in 0..total {
        if mask[start] == 0 || seen[start] {
            continue;
        }
        count += 1;
        stack.clear();
        stack.push(start);
        seen[start] = true;

        while let Some(index) = stack.pop() {
            let x = index % width;
            let y = index / width;
            let push = |next: usize, seen: &mut Vec<bool>, stack: &mut Vec<usize>| {
                if mask[next] == 1 && !seen[next] {
                    seen[next] = true;
                    stack.push(next);
                }
            };
            if x > 0 {
                push(index - 1, &mut seen, &mut stack);
            }
            if x + 1 < width {
                push(index + 1, &mut seen, &mut stack);
            }
            if y > 0 {
                push(index - width, &mut seen, &mut stack);
            }
            if y + 1 < height {
                push(index + width, &mut seen, &mut stack);
            }
        }
    }

    count
}

/// "像文字"的程度。
///
/// 文字的典型特征：**若干互不相连、大小相近的小块**。
/// 判错极性时拿到的是"整片背景"，通常表现为一个巨型连通块 —— 分数会很低。
fn textness(mask: &[u8], width: usize, height: usize) -> f32 {
    let (ink, components, min_x, min_y, max_x, max_y) = stats(mask, width, height);
    if ink == 0 || components == 0 {
        return 0.0;
    }

    let box_w = max_x - min_x + 1;
    let box_h = max_y - min_y + 1;
    let ratio = ink as f32 / (box_w * box_h).max(1) as f32;

    // 块数越多越像文字；墨迹占比过高（整片实心）越可疑
    let mut score = components as f32;
    if ratio > 0.8 {
        score *= 0.1;
    }
    if components == 1 && ratio > 0.5 {
        score *= 0.1;
    }

    score
}

#[cfg(test)]
mod tests {
    use super::*;

    fn canvas(width: usize, height: usize, background: u8) -> Vec<u8> {
        vec![background; width * height]
    }

    /// 在画布上画几条竖线，模拟文字
    fn draw_strokes(
        gray: &mut [u8],
        width: usize,
        xs: &[usize],
        top: usize,
        bottom: usize,
        value: u8,
    ) {
        for &x in xs {
            for y in top..bottom {
                gray[y * width + x] = value;
                gray[y * width + x + 1] = value;
                gray[y * width + x + 2] = value;
            }
        }
    }

    #[test]
    fn dark_text_on_light_solid_background() {
        let (w, h) = (200, 80);
        let mut gray = canvas(w, h, 235);
        draw_strokes(&mut gray, w, &[20, 60, 100, 140], 20, 60, 20);

        let prep = extract(&gray, w, h).expect("纯色浅底深字应当通过");
        let ink: usize = prep.mask.iter().filter(|&&v| v == 1).count();
        assert!(ink > 0, "应当提取到墨迹");
    }

    #[test]
    fn light_text_on_dark_solid_background() {
        let (w, h) = (200, 80);
        let mut gray = canvas(w, h, 15);
        draw_strokes(&mut gray, w, &[20, 60, 100, 140], 20, 60, 240);

        let prep = extract(&gray, w, h).expect("纯色深底浅字应当通过");
        let ink: usize = prep.mask.iter().filter(|&&v| v == 1).count();
        assert!(ink > 0);
    }

    /// 渐变背景：以前全局 Otsu 会吃掉一端，现在靠局部背景抵消
    #[test]
    fn gradient_background_still_works() {
        let (w, h) = (240, 80);
        let mut gray = vec![0u8; w * h];
        for y in 0..h {
            for x in 0..w {
                gray[y * w + x] = (40 + (x * 170 / w)) as u8;
            }
        }
        draw_strokes(&mut gray, w, &[20, 80, 140, 200], 20, 60, 5);

        let prep = extract(&gray, w, h).expect("渐变背景上的深字应当仍可提取");
        let ink: usize = prep.mask.iter().filter(|&&v| v == 1).count();
        assert!(ink > 0);
    }

    #[test]
    fn pure_background_is_rejected() {
        let (w, h) = (200, 80);
        let gray = canvas(w, h, 128);
        assert_eq!(extract(&gray, w, h).unwrap_err(), Reject::NoInk);
    }

    #[test]
    fn garbage_input_is_rejected_not_panicking() {
        assert!(extract(&[], 0, 0).is_err());
        assert!(extract(&[0u8; 10], 100, 100).is_err());
    }

    #[test]
    fn reject_messages_are_user_facing() {
        assert!(!Reject::NoInk.message().is_empty());
        assert!(Reject::Fragmented(999).message().contains("999"));
        assert!(Reject::InkRatio(0.9).message().contains("90%"));
    }
}
