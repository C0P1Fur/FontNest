//! 平台约定：字体目录、数据目录、家目录。
//!
//! 所有路径知识集中在这一个文件里 —— 这是跨平台差异最硬的地方，
//! 散落到别处以后就没法一眼看清"我们到底碰了系统的哪些目录"。

use std::path::PathBuf;

use crate::model::Source;

#[derive(Debug, Clone)]
pub struct FontDir {
    pub path: PathBuf,
    pub source: Source,
}

pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

/* ───────────── Windows ───────────── */

/// 沙箱模式下只扫沙箱自己的字体目录，形成一个彻底隔离的世界：
/// 验证安装/卸载时既不会读到真实系统字体，也不会写进去。
pub fn platform_dirs() -> Vec<FontDir> {
    if let Some(root) = std::env::var_os("FONTNEST_SANDBOX_DIR") {
        return vec![FontDir {
            path: PathBuf::from(root).join("Fonts"),
            source: Source::User,
        }];
    }
    platform_dirs_impl()
}

#[cfg(target_os = "windows")]
fn platform_dirs_impl() -> Vec<FontDir> {
    let mut dirs = Vec::new();

    let windir = std::env::var_os("SystemRoot")
        .or_else(|| std::env::var_os("WINDIR"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("C:\\Windows"));

    dirs.push(FontDir {
        path: windir.join("Fonts"),
        source: Source::System,
    });

    // Win10 1809 起的当前用户字体目录：无需提权即可写入
    if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        dirs.push(FontDir {
            path: local.join("Microsoft").join("Windows").join("Fonts"),
            source: Source::User,
        });
    }

    dirs
}

/* ───────────── macOS ───────────── */

#[cfg(target_os = "macos")]
fn platform_dirs_impl() -> Vec<FontDir> {
    let mut dirs = vec![
        FontDir {
            path: PathBuf::from("/System/Library/Fonts"),
            source: Source::System,
        },
        FontDir {
            path: PathBuf::from("/Library/Fonts"),
            source: Source::System,
        },
    ];

    if let Some(home) = home_dir() {
        dirs.push(FontDir {
            path: home.join("Library").join("Fonts"),
            source: Source::User,
        });
    }

    dirs
}

/* ───────────── Linux ───────────── */

#[cfg(all(unix, not(target_os = "macos")))]
fn platform_dirs_impl() -> Vec<FontDir> {
    let mut dirs = vec![
        FontDir {
            path: PathBuf::from("/usr/share/fonts"),
            source: Source::System,
        },
        FontDir {
            path: PathBuf::from("/usr/local/share/fonts"),
            source: Source::System,
        },
    ];

    if let Some(home) = home_dir() {
        dirs.push(FontDir {
            path: home.join(".local").join("share").join("fonts"),
            source: Source::User,
        });
        // 老发行版仍在用的兼容路径
        dirs.push(FontDir {
            path: home.join(".fonts"),
            source: Source::User,
        });
    }

    dirs
}

/* ───────────── 应用数据目录 ───────────── */

#[cfg(target_os = "windows")]
pub fn data_dir() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("FontNest")
}

#[cfg(target_os = "macos")]
pub fn data_dir() -> PathBuf {
    home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Library")
        .join("Application Support")
        .join("FontNest")
}

#[cfg(all(unix, not(target_os = "macos")))]
pub fn data_dir() -> PathBuf {
    if let Some(xdg) = std::env::var_os("XDG_DATA_HOME") {
        return PathBuf::from(xdg).join("fontnest");
    }
    home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".local")
        .join("share")
        .join("fontnest")
}
