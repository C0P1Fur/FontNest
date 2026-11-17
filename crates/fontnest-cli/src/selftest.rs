//! 随机抽样自测：从本机字体库里随便挑几个字体，用它们渲染样例图，
//! 再跑一遍识别，看"正确答案"排第几。
//!
//! 这是整条链路唯一的端到端度量。它测不出真实截图的准确率
//! （那些图不是我们渲染的），但能保证**当输入是已知字体时，链路没有坏掉**。
//!
//! 用法：fontnest-cli selftest [--count 12] [--seed 12345]

use std::path::Path;
use std::process::ExitCode;

use fontnest_core::{assess, Assessment, Library};

/// 拉丁样本：'g' 和 'R' 的区分度最高
const LATIN: &str = "Rag 8g";
/// 中文样本：永字八法全覆盖，结构复杂
const CJK: &str = "永和九年";

/// 线性同余伪随机：固定种子可复现
struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 33
    }
}

pub fn run(args: &[String]) -> ExitCode {
    let count: usize = crate::flag(args, "--count")
        .and_then(|value| value.parse().ok())
        .unwrap_or(12);
    let seed: u64 = crate::flag(args, "--seed")
        .and_then(|value| value.parse().ok())
        .unwrap_or(2026_1123);

    let mut library = Library::new();
    library.scan();
    let fonts = library.fonts().to_vec();
    if fonts.is_empty() {
        eprintln!("字体库是空的");
        return ExitCode::FAILURE;
    }

    println!(
        "随机抽样 {} 个字体（种子 {}），库内共 {} 个\n",
        count,
        seed,
        fonts.len()
    );

    let mut rng = Lcg(seed);
    let mut tested = 0usize;
    let mut exact = 0usize;
    let mut family = 0usize;
    let mut rank_sum = 0usize;
    let mut ties = 0usize;
    let mut attempted = 0usize;

    while tested < count && attempted < count * 20 {
        attempted += 1;
        let font = &fonts[(rng.next() as usize) % fonts.len()];

        let Ok(bytes) = std::fs::read(Path::new(&font.file_path)) else {
            continue;
        };

        // 选一个这款字体确实渲染得出来的文本
        let text = match assess(&bytes, font.collection_index, LATIN) {
            Assessment::Ready(_) => LATIN,
            Assessment::Rejected(_) => match assess(&bytes, font.collection_index, CJK) {
                Assessment::Ready(_) => CJK,
                Assessment::Rejected(_) => continue,
            },
        };

        let image = std::env::temp_dir().join(format!(
            "fontnest-selftest-{}.png",
            std::process::id()
        ));

        if fontnest_core::render_png(
            Path::new(&font.file_path),
            font.collection_index,
            text,
            &image,
        )
        .is_err()
        {
            continue;
        }

        let Ok(report) = fontnest_core::recognize(&image, text, &fonts, 10) else {
            continue;
        };

        let rank = report
            .candidates
            .iter()
            .position(|candidate| candidate.font_id == font.id)
            .map(|position| position + 1)
            .unwrap_or(0);

        let top_family = report
            .candidates
            .first()
            .and_then(|candidate| fonts.iter().find(|item| item.id == candidate.font_id))
            .map(|item| item.family.clone())
            .unwrap_or_else(|| "?".to_string());

        let top_score = report
            .candidates
            .first()
            .map(|candidate| candidate.score)
            .unwrap_or(0.0);

        tested += 1;
        rank_sum += rank;
        if rank == 1 {
            exact += 1;
        }
        if rank == 1 || top_family == font.family {
            family += 1;
        }

        // 自己也是满分但排在别人后面 = 并列。这不是排序错，是这些字体在
        // 48×48 的掩膜上确实一模一样（Segoe UI / Ebrima / Gadugi 等共用拉丁字形）。
        let own_score = report
            .candidates
            .iter()
            .find(|candidate| candidate.font_id == font.id)
            .map(|candidate| candidate.score)
            .unwrap_or(0.0);
        let tied = rank != 1 && (top_score - own_score).abs() < 1e-6;
        if tied {
            ties += 1;
        }

        let verdict = if rank == 1 {
            "✓ 命中"
        } else if tied {
            "= 并列"
        } else if top_family == font.family {
            "≈ 同族"
        } else {
            "✗ 跑偏"
        };

        println!(
            "{:>2}. {:<26} 「{}」名次 {:>2}  {}  （第一名 {} {:.3}）",
            tested, font.family, text, rank, verdict, top_family, top_score
        );
    }

    let _ = std::fs::remove_file(std::env::temp_dir().join(format!(
        "fontnest-selftest-{}.png",
        std::process::id()
    )));

    if tested == 0 {
        eprintln!("没有一个样本能跑通，检查字体库是否正常");
        return ExitCode::FAILURE;
    }

    println!(
        "\n汇总：精确命中 {exact}/{tested}（{:.0}%），其中并列 {ties} 个，真正跑偏 {} 个",
        exact as f64 / tested as f64 * 100.0,
        tested - exact - ties
    );
    println!(
        "同族命中 {family}/{tested}（{:.0}%），平均名次 {:.2}",
        family as f64 / tested as f64 * 100.0,
        rank_sum as f64 / tested as f64
    );

    ExitCode::SUCCESS
}
