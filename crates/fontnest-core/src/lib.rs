//! FontNest 核心：扫盘、解析、索引、偏好、安装。
//!
//! 这个 crate 不依赖 Tauri，也不依赖任何 GUI —— 所以它能用 `cargo test` 单独跑，
//! 也能被 CLI 直接使用。Tauri 壳只做参数搬运与错误转换。

pub mod assess;
pub mod collection;
pub mod install;
pub mod library;
pub mod model;
pub mod paths;
pub mod recognize;
pub mod scan;
pub mod sfnt;
pub mod ui;

pub use assess::{assess, Assessment, Reason};

pub use collection::{Collection, CollectionStore};
pub use install::{FontHome, Manifest, ReconcileReport, Registry, WindowsRegistry};
pub use library::{CoreError, Library};
pub use model::{Axis, Category, Font, Format, ScanSummary, Source, UnsupportedExt};
pub use paths::{data_dir, platform_dirs, FontDir};
pub use recognize::{
    preview_png, recognize, recognize_rgba, render_png, MatchCandidate, RecognizeReport,
};
pub use scan::{scan_dirs, ScanResult};
pub use ui::UiState;
