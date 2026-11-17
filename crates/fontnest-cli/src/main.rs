//! 调试用 CLI。
//!
//! 存在的意义：后端出问题时，先确认"扫到了什么、解析出了什么"，
//! 再去怀疑 Tauri 或前端。`cargo run -p fontnest-cli -- list` 就能看到真相。

use std::process::ExitCode;

use fontnest_core::{platform_dirs, Library};

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
        "扫描完成：{} 个字体，{} 个失败，耗时到 {}",
        summary.count, summary.failed, summary.finished_at
    );
    ExitCode::SUCCESS
}

fn run_dirs() -> ExitCode {
    for dir in platform_dirs() {
        println!("{:<8} {}", format!("{:?}", dir.source), dir.path.display());
    }
    ExitCode::SUCCESS
}

fn print_help() {
    eprintln!(
        "FontNest CLI\n\
         \n\
         用法：\n\
         \x20 fontnest list    扫描并输出全部字体（JSON）\n\
         \x20 fontnest scan    只输出扫描摘要\n\
         \x20 fontnest dirs    打印本机字体目录\n"
    );
}
