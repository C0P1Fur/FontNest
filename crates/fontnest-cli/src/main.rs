//! 调试用 CLI。
//!
//! 存在的意义：后端出问题时，先确认"扫到了什么、解析出了什么"，
//! 再去怀疑 Tauri 或前端。`cargo run -p fontnest-cli -- list` 就能看到真相。

use std::path::Path;
use std::process::ExitCode;

use fontnest_core::{platform_dirs, Library};

mod bench;
mod selftest;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let command = args.first().map(String::as_str).unwrap_or("list");

    match command {
        "list" => run_list(),
        "scan" => run_scan(),
        "dirs" => run_dirs(),
        "favorite" | "fav" => run_favorite(&args, true),
        "unfavorite" | "unfav" => run_favorite(&args, false),
        "install" | "enable" => run_set_enabled(&args, true),
        "uninstall" | "disable" => run_set_enabled(&args, false),
        "render" => run_render(&args),
        "diag" => run_diag(),
        "selftest" => selftest::run(&args),
        "bench-parse" | "bench" => bench::run_bench(),
        "recognize" | "recognise" => run_recognize(&args),
        "catalog" => run_catalog(&args),
        "import" => run_import(&args),
        "help" | "--help" | "-h" => {
            print_help();
            ExitCode::SUCCESS
        }
        other => {
            eprintln!("未知命令：{other}");
            print_help();
            ExitCode::FAILURE
        }
    }
}

/// 往真实偏好文件里写一条收藏，并回读验证 —— 端到端验证持久化路径。
fn run_favorite(args: &[String], value: bool) -> ExitCode {    let id = match args.get(1) {
        Some(value) => value,
        None => {
            eprintln!("用法：fontnest favorite <id>");
            return ExitCode::FAILURE;
        }
    };

    let mut library = Library::new();
    library.scan();

    match library.set_favorite(id, value) {
        Ok(()) => {
            println!("{id} -> favorite={value}");
            println!("存储位置：{}", library.store_path().display());
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("失败：{error}");
            ExitCode::FAILURE
        }
    }
}

/// 启用 / 停用：走完整的 install / uninstall 链路。
/// 配合 `FONTNEST_SANDBOX_DIR` 使用即可在不碰真实系统的情况下验证。
fn run_set_enabled(args: &[String], value: bool) -> ExitCode {
    let id = match args.get(1) {
        Some(value) => value,
        None => {
            eprintln!("用法：fontnest install|uninstall <font-id>");
            return ExitCode::FAILURE;
        }
    };

    let mut library = Library::new();
    library.scan();

    match library.set_enabled(id, value) {
        Ok(()) => {
            println!("{id} -> enabled={value}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("失败：{error}");
            ExitCode::FAILURE
        }
    }
}

fn run_list() -> ExitCode {
    let mut library = Library::new();
    let summary = library.scan();

    match serde_json::to_string_pretty(library.fonts()) {
        Ok(json) => println!("{json}"),
        Err(error) => {
            eprintln!("序列化失败：{error}");
            return ExitCode::FAILURE;
        }
    }

    eprintln!("共 {} 个字体，{} 个文件解析失败", summary.count, summary.failed);
    ExitCode::SUCCESS
}

fn run_scan() -> ExitCode {
    let mut library = Library::new();
    let summary = library.scan();
    println!(
        "扫描完成：{} 个字体，{} 个解析失败",
        summary.count, summary.failed
    );

    // 被格式挡在门外的文件必须被点名，否则用户只会觉得"加了文件夹没反应"
    if summary.unsupported.is_empty() {
        println!("没有因格式被跳过的文件。");
    } else {
        let total: usize = summary.unsupported.iter().map(|item| item.count).sum();
        println!("另有 {total} 个文件格式不受支持（未计入字体数）：");
        for item in &summary.unsupported {
            println!("  .{} × {}", item.ext, item.count);
        }
    }

    ExitCode::SUCCESS
}

fn run_dirs() -> ExitCode {
    for dir in platform_dirs() {
        println!("{:<8} {}", format!("{:?}", dir.source), dir.path.display());
    }
    ExitCode::SUCCESS
}

/// 体检：把"读不懂"的字体点名列出。
///
/// 存在理由：识别流程会对读不懂的字体**静默跳过**，
/// 如果只看一个总数，没人能发现是哪几个、为什么。
fn run_diag() -> ExitCode {
    let mut library = Library::new();
    library.scan();
    let fonts = library.fonts();

    let mut unreadable: Vec<(String, String)> = Vec::new();
    let mut unreadable_bytes = 0u64;

    for font in fonts {
        let path = Path::new(&font.file_path);
        let Ok(bytes) = std::fs::read(path) else {
            unreadable.push((format!("{} (读不到文件)", font.family), font.file_path.clone()));
            continue;
        };
        // 空文本 = 只问"这个 face 能不能建立"，不问有没有某个字
        let readable = matches!(
            fontnest_core::assess(&bytes, font.collection_index, ""),
            fontnest_core::Assessment::Ready(_)
        );
        if !readable {
            unreadable_bytes += bytes.len() as u64;
            unreadable.push((
                format!("{} [{:?} idx={}]", font.family, font.format, font.collection_index),
                font.file_path.clone(),
            ));
        }
    }

    println!("字体总数：{}", fonts.len());
    println!("cmap 读不懂：{}（共 {:.1} MB）", unreadable.len(), unreadable_bytes as f64 / 1_048_576.0);
    for (label, path) in &unreadable {
        println!("  {label}\n      {path}");
    }

    if unreadable.is_empty() {
        println!("全部字体都能被识别流程读取。");
    }

    ExitCode::SUCCESS
}

fn print_help() {
    eprintln!(
        "FontNest CLI\n\
         \n\
         用法：\n\
         \x20 fontnest list        扫描并输出全部字体（JSON）\n\
         \x20 fontnest scan        只输出扫描摘要\n\
         \x20 fontnest dirs        打印本机字体目录\n\
         \x20 fontnest render <字体文件> --text \"Rag 8g\" --out q.png [--index N]\n\
         \x20 fontnest recognize <图片> --text \"Rag 8g\" [--top 8]\n\
         \x20 fontnest catalog list              列出可选字体库\n\
         \x20 fontnest catalog check             校验目录数据\n\
         \x20 fontnest catalog fetch <id> [变体]  下载某款字体到本地库\n\
         \x20 fontnest catalog remove <id>       从本地库删除\n"
    );
}

/* ───────────── 可选字体库 ───────────── */

/* ───────────── 手动导入 ───────────── */

fn run_import(args: &[String]) -> ExitCode {
    let paths: Vec<std::path::PathBuf> = args
        .iter()
        .skip(1)
        .filter(|arg| !arg.starts_with("--"))
        .map(std::path::PathBuf::from)
        .collect();

    if paths.is_empty() {
        eprintln!("用法：fontnest import <字体文件> [更多文件…]");
        return ExitCode::FAILURE;
    }

    let mut failed = 0;
    for path in &paths {
        match fontnest_core::import::import_file(path) {
            Ok(outcome) => {
                let mark = if outcome.already_present { "已存在" } else { "已导入" };
                println!(
                    "  {mark}  {}  ({:.1} MB) → {}",
                    outcome.family,
                    outcome.bytes as f64 / 1024.0 / 1024.0,
                    outcome.path.display()
                );
            }
            Err(error) => {
                failed += 1;
                eprintln!("  失败  {}：{error}", path.display());
            }
        }
    }

    if failed > 0 {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}

fn run_catalog(args: &[String]) -> ExitCode {
    let sub = args.get(1).map(String::as_str).unwrap_or("list");

    match sub {
        "list" => {
            let (catalog, issues) = fontnest_core::fetch::load_catalog();
            for issue in &issues {
                eprintln!("[目录告警] {}：{}", issue.font_id, issue.message);
            }

            let downloaded = catalog
                .fonts
                .iter()
                .filter(|font| fontnest_core::fetch::is_downloaded(font))
                .count();

            println!(
                "可下载 {} 条 · 仅链接 {} 条 · 本地已有 {} 条",
                catalog.only_redistributable().count(),
                catalog.only_link_only().count(),
                downloaded
            );
            println!();
            for font in &catalog.fonts {
                let mark = if font.redistributable {
                    if fontnest_core::fetch::is_downloaded(font) {
                        "已下载"
                    } else {
                        "可下载"
                    }
                } else {
                    "仅链接"
                };
                let size = font
                    .variants
                    .first()
                    .map(|variant| format!("{:.1} MB", variant.size as f64 / 1024.0 / 1024.0))
                    .unwrap_or_else(|| "—".to_string());
                println!(
                    "  {:<12} {:<22} {:<16} {:<6} {}",
                    mark,
                    font.id,
                    font.name_zh,
                    font.coverage,
                    size
                );
            }
            ExitCode::SUCCESS
        }

        "check" => {
            let (catalog, dropped) = fontnest_core::fetch::load_catalog();
            let issues = catalog.validate();
            let total = catalog.fonts.len();

            if dropped.is_empty() && issues.is_empty() {
                println!("目录干净：{total} 条，无问题。");
                return ExitCode::SUCCESS;
            }
            for issue in dropped.iter().chain(issues.iter()) {
                eprintln!("  {}：{}", issue.font_id, issue.message);
            }
            eprintln!("共 {} 个问题（目录 {total} 条）", dropped.len() + issues.len());
            ExitCode::FAILURE
        }

        "fetch" => {
            let Some(id) = args.get(2) else {
                eprintln!("用法：fontnest catalog fetch <id> [变体]");
                return ExitCode::FAILURE;
            };
            let (catalog, _) = fontnest_core::fetch::load_catalog();
            let Some(font) = catalog.find(id) else {
                eprintln!("目录里没有 {id}");
                return ExitCode::FAILURE;
            };

            let variant = args
                .get(3)
                .cloned()
                .or_else(|| font.variants.first().map(|item| item.name.clone()))
                .unwrap_or_default();

            if !font.redistributable {
                eprintln!("{} 的许可不允许第三方分发，请从官网获取：{}", font.family, font.homepage);
                return ExitCode::FAILURE;
            }

            println!("下载 {} / {variant} …", font.family);
            let mut last = 0u64;
            match fontnest_core::fetch::download_variant(font, &variant, |bytes| {
                // 每 4MB 报一次，避免刷屏
                if bytes > last + 4 * 1024 * 1024 {
                    last = bytes;
                    println!("  {:.1} MB", bytes as f64 / 1024.0 / 1024.0);
                }
            }) {
                Ok(report) => {
                    println!("完成：{}", report.path.display());
                    println!(
                        "  {:.2} MB · 来源 {} · sha256 {}",
                        report.bytes as f64 / 1024.0 / 1024.0,
                        report.source,
                        &report.sha256[..16]
                    );
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("失败：{error}");
                    ExitCode::FAILURE
                }
            }
        }

        "remove" => {
            let Some(id) = args.get(2) else {
                eprintln!("用法：fontnest catalog remove <id>");
                return ExitCode::FAILURE;
            };
            let (catalog, _) = fontnest_core::fetch::load_catalog();
            let Some(font) = catalog.find(id) else {
                eprintln!("目录里没有 {id}");
                return ExitCode::FAILURE;
            };
            match fontnest_core::fetch::remove_download(font) {
                Ok(()) => {
                    println!("已从本地库删除 {id}");
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("删除失败：{error}");
                    ExitCode::FAILURE
                }
            }
        }

        other => {
            eprintln!("未知的 catalog 子命令：{other}");
            ExitCode::FAILURE
        }
    }
}

fn run_render(args: &[String]) -> ExitCode {
    let Some(font) = args.get(1) else {
        eprintln!("用法：fontnest render <字体文件> --text \"Rag 8g\" --out q.png");
        return ExitCode::FAILURE;
    };

    let text = flag(args, "--text").unwrap_or_else(|| "Rag 8g".to_string());
    let out = flag(args, "--out").unwrap_or_else(|| "query.png".to_string());
    let index: u32 = flag(args, "--index")
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);

    match fontnest_core::render_png(Path::new(font), index, &text, Path::new(&out)) {
        Ok(()) => {
            println!("已渲染 → {out}");
            println!("文本：{text}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("渲染失败：{error}");
            ExitCode::FAILURE
        }
    }
}

fn run_recognize(args: &[String]) -> ExitCode {
    let Some(image) = args.get(1) else {
        eprintln!("用法：fontnest recognize <图片> --text \"Rag 8g\" [--top 8]");
        return ExitCode::FAILURE;
    };

    let text = flag(args, "--text").unwrap_or_else(|| "Rag 8g".to_string());
    let top: usize = flag(args, "--top")
        .and_then(|value| value.parse().ok())
        .unwrap_or(8);

    let mut library = Library::new();
    library.scan();

    let max: usize = flag(args, "--max")
        .and_then(|value| value.parse().ok())
        .unwrap_or(usize::MAX);
    let repeat: usize = flag(args, "--repeat")
        .and_then(|value| value.parse().ok())
        .unwrap_or(1);

    let fonts = &library.fonts()[..max.min(library.fonts().len())];

    // 连跑多次用来看缓存效果：第 1 次冷，后续应该显著变快
    let mut last = None;
    for round in 1..=repeat {
        match fontnest_core::recognize(Path::new(image), &text, fonts, top) {
            Ok(report) => {
                if repeat > 1 {
                    println!("第 {round} 次：{}ms", report.elapsed_ms);
                }
                last = Some(report);
            }
            Err(error) => {
                eprintln!("识别失败：{error}");
                return ExitCode::FAILURE;
            }
        }
    }

    let Some(report) = last else {
        eprintln!("识别失败");
        return ExitCode::FAILURE;
    };

    println!(
        "比对 {} 个字体（无此字形 {}，读不懂 {}，失败 {}），耗时 {}ms\n",
        report.considered,
        report.skipped,
        report.unsupported,
        report.failed,
        report.elapsed_ms
    );
    for (rank, candidate) in report.candidates.iter().enumerate() {
        let family = library
            .font(&candidate.font_id)
            .map(|font| font.family.clone())
            .unwrap_or_else(|| "?".to_string());
        println!(
            "{:>2}. {:<30} 分数 {:.3}  重叠 {:.3}  宽高比差 {:.3}",
            rank + 1,
            family,
            candidate.score,
            candidate.iou,
            candidate.aspect_delta
        );
    }
    ExitCode::SUCCESS
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|arg| arg == name)
        .and_then(|index| args.get(index + 1))
        .cloned()
}
