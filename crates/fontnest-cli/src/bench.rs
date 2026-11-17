//! 对照实验：fontdue（全量解析） vs swash（惰性解析）。
//!
//! 目的不是"哪个库更好"，而是回答一个具体问题：
//! **我们只画 6 个字形，却为几千个字形付了解析钱 —— 换惰性解析器能省多少？**
//!
//! 结论（2026-11，60 个拉丁字体）：fontdue 加载 46.08 ms/字体，
//! swash 0.005 ms/字体（9000×）；渲染速度相同。全库 399 个：18.6 s → 0.2 s。
//! 生产代码因此已切到 swash，这里保留计时脚本以便复现。
//!
//! 用法：fontnest-cli bench-parse

use std::path::PathBuf;
use std::time::Instant;

const TEXT: &str = "Rag 8g";
const PX: f32 = 72.0;

fn collect_fonts(limit: usize) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for dir in fontnest_core::platform_dirs() {
        let Ok(entries) = std::fs::read_dir(&dir.path) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if ext.eq_ignore_ascii_case("ttf") || ext.eq_ignore_ascii_case("otf") {
                files.push(path);
            }
            if files.len() >= limit {
                return files;
            }
        }
    }
    files
}

pub fn run_bench() -> std::process::ExitCode {
    let files = collect_fonts(60);
    if files.is_empty() {
        eprintln!("没找到可用字体");
        return std::process::ExitCode::FAILURE;
    }

    let mut fontdue_load = 0f64;
    let mut fontdue_render = 0f64;
    let mut swash_load = 0f64;
    let mut swash_render = 0f64;
    let mut compared = 0usize;

    for path in &files {
        let Ok(bytes) = std::fs::read(path) else {
            continue;
        };
        compared += 1;

        // ── fontdue：加载时把全部字形展开成自己的轮廓表示 ──
        let started = Instant::now();
        let font = fontdue::Font::from_bytes(bytes.as_slice(), fontdue::FontSettings::default());
        fontdue_load += started.elapsed().as_secs_f64();

        if let Ok(font) = font {
            let started = Instant::now();
            for ch in TEXT.chars() {
                let _ = font.rasterize(ch, PX);
            }
            fontdue_render += started.elapsed().as_secs_f64();
        }

        // ── swash：加载只校验表目录，取一个字形才读那一个 ──
        let started = Instant::now();
        let face = swash::FontRef::from_index(&bytes, 0);
        swash_load += started.elapsed().as_secs_f64();

        if let Some(face) = face {
            let started = Instant::now();
            let mut context = swash::scale::ScaleContext::new();
            let mut scaler = context.builder(face).size(PX).build();
            let render = swash::scale::Render::new(&[swash::scale::Source::Outline]);
            for ch in TEXT.chars() {
                let id = face.charmap().map(ch);
                if id != 0 {
                    let _ = render.render(&mut scaler, id);
                }
            }
            swash_render += started.elapsed().as_secs_f64();
        }
    }

    let n = compared.max(1) as f64;
    println!("对照字体数：{compared}（文本 \"{TEXT}\"，{PX}px）\n");
    println!("{:<28} {:>12} {:>14}", "阶段", "总计 ms", "每个字体 ms");
    println!("{}", "-".repeat(58));
    println!(
        "{:<28} {:>12.1} {:>14.3}",
        "fontdue 加载",
        fontdue_load * 1000.0,
        fontdue_load * 1000.0 / n
    );
    println!(
        "{:<28} {:>12.1} {:>14.3}",
        "fontdue 渲染 6 字形",
        fontdue_render * 1000.0,
        fontdue_render * 1000.0 / n
    );
    println!(
        "{:<28} {:>12.1} {:>14.3}",
        "swash 加载",
        swash_load * 1000.0,
        swash_load * 1000.0 / n
    );
    println!(
        "{:<28} {:>12.1} {:>14.3}",
        "swash 渲染 6 字形",
        swash_render * 1000.0,
        swash_render * 1000.0 / n
    );

    let fontdue_total = fontdue_load + fontdue_render;
    let swash_total = swash_load + swash_render;
    println!("{}", "-".repeat(58));
    println!(
        "合计：fontdue {:.1} ms  vs  swash {:.1} ms  →  {:.0}× ",
        fontdue_total * 1000.0,
        swash_total * 1000.0,
        if swash_total > 0.0 {
            fontdue_total / swash_total
        } else {
            0.0
        }
    );

    // 按 399 个字体外推
    println!(
        "\n外推到全库 399 个：fontdue ≈ {:.1} s，swash ≈ {:.1} s",
        fontdue_total / n * 399.0,
        swash_total / n * 399.0
    );

    std::process::ExitCode::SUCCESS
}

