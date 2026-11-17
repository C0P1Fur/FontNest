//! 字体分类：用户自定义的命名分组，**只用于筛选**。
//!
//! 它不承担"批量启用/停用"的语义 —— 那会让一个纯展示概念拥有改系统文件的能力，
//! 也会让用户误以为点一下就能把系统字体装回去。装/卸始终由单个字体触发。
//!
//! 只存 id 列表，不缓存字体内容。删掉一个字体不会连带删分类条目，
//! 展示时按当时仍然存在的字体取交集即可。

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::install::now_millis;
use crate::library::CoreError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub font_ids: Vec<String>,
    pub created_at: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct CollectionsFile {
    #[serde(default)]
    collections: Vec<Collection>,
}

pub struct CollectionStore {
    path: PathBuf,
    items: Vec<Collection>,
}

impl CollectionStore {
    pub fn load(path: PathBuf) -> Self {
        let raw = std::fs::read_to_string(&path).ok();
        let cleaned = raw.as_deref().unwrap_or("").trim_start_matches('\u{feff}');
        let items = if cleaned.is_empty() {
            Vec::new()
        } else {
            match serde_json::from_str::<CollectionsFile>(cleaned) {
                Ok(file) => file.collections,
                Err(error) => {
                    eprintln!(
                        "[fontnest] 分类配置解析失败 {}: {error}",
                        path.display()
                    );
                    Vec::new()
                }
            }
        };
        Self { path, items }
    }

    pub fn items(&self) -> &[Collection] {
        &self.items
    }

    pub fn get(&self, id: &str) -> Option<&Collection> {
        self.items.iter().find(|item| item.id == id)
    }

    pub fn create(&mut self, name: &str) -> Result<Collection, CoreError> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(CoreError::Invalid("集合名称不能为空".to_string()));
        }
        if self.items.iter().any(|item| item.name == trimmed) {
            return Err(CoreError::Invalid(format!("已存在同名集合：{trimmed}")));
        }

        let now = now_millis();
        let collection = Collection {
            id: format!("c{now}-{}", self.items.len()),
            name: trimmed.to_string(),
            font_ids: Vec::new(),
            created_at: now,
        };
        self.items.push(collection.clone());
        self.save()?;
        Ok(collection)
    }

    pub fn rename(&mut self, id: &str, name: &str) -> Result<(), CoreError> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(CoreError::Invalid("集合名称不能为空".to_string()));
        }
        if self
            .items
            .iter()
            .any(|item| item.name == trimmed && item.id != id)
        {
            return Err(CoreError::Invalid(format!("已存在同名集合：{trimmed}")));
        }

        let target = self
            .items
            .iter_mut()
            .find(|item| item.id == id)
            .ok_or_else(|| CoreError::NotFound(id.to_string()))?;
        target.name = trimmed.to_string();
        self.save()
    }

    pub fn delete(&mut self, id: &str) -> Result<(), CoreError> {
        let before = self.items.len();
        self.items.retain(|item| item.id != id);
        if self.items.len() == before {
            return Err(CoreError::NotFound(id.to_string()));
        }
        self.save()
    }

    /// 整体替换成员列表（去重，保持顺序）
    pub fn set_fonts(&mut self, id: &str, font_ids: Vec<String>) -> Result<(), CoreError> {
        let target = self
            .items
            .iter_mut()
            .find(|item| item.id == id)
            .ok_or_else(|| CoreError::NotFound(id.to_string()))?;

        let mut seen = std::collections::HashSet::new();
        target.font_ids = font_ids.into_iter().filter(|id| seen.insert(id.clone())).collect();
        self.save()
    }

    pub fn save(&self) -> Result<(), CoreError> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| CoreError::Io(format!("创建目录失败：{error}")))?;
        }
        let json = serde_json::to_string_pretty(&CollectionsFile {
            collections: self.items.clone(),
        })
        .map_err(|error| CoreError::Io(format!("序列化失败：{error}")))?;

        let temporary = self.path.with_extension("json.tmp");
        std::fs::write(&temporary, json)
            .map_err(|error| CoreError::Io(format!("写入失败：{error}")))?;
        std::fs::rename(&temporary, &self.path)
            .map_err(|error| CoreError::Io(format!("替换失败：{error}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "fontnest-collection-{name}-{}-{}",
            std::process::id(),
            now_millis()
        ));
        dir.join("collections.json")
    }

    #[test]
    fn create_rename_delete_roundtrip() {
        let path = scratch("crud");
        let mut store = CollectionStore::load(path.clone());

        let created = store.create("字幕用").expect("创建应成功");
        assert_eq!(store.items().len(), 1);

        store.rename(&created.id, "字幕字体").unwrap();
        assert_eq!(store.get(&created.id).unwrap().name, "字幕字体");

        // 重载后仍在
        let reloaded = CollectionStore::load(path.clone());
        assert_eq!(reloaded.items().len(), 1);
        assert_eq!(reloaded.items()[0].name, "字幕字体");

        let mut store = reloaded;
        store.delete(&created.id).unwrap();
        assert!(store.items().is_empty());
        assert!(CollectionStore::load(path).items().is_empty());
    }

    #[test]
    fn rejects_empty_and_duplicate_names() {
        let path = scratch("names");
        let mut store = CollectionStore::load(path);
        store.create("A").unwrap();

        assert!(store.create("  ").is_err());
        assert!(store.create("A").is_err());
    }

    #[test]
    fn set_fonts_dedupes_and_persists() {
        let path = scratch("members");
        let mut store = CollectionStore::load(path.clone());
        let created = store.create("组").unwrap();

        store
            .set_fonts(
                &created.id,
                vec!["a".into(), "b".into(), "a".into()],
            )
            .unwrap();
        assert_eq!(store.get(&created.id).unwrap().font_ids, vec!["a", "b"]);

        let reloaded = CollectionStore::load(path);
        assert_eq!(reloaded.get(&created.id).unwrap().font_ids.len(), 2);
    }

    #[test]
    fn unknown_id_is_reported() {
        let path = scratch("unknown");
        let mut store = CollectionStore::load(path);
        assert!(store.rename("nope", "x").is_err());
        assert!(store.delete("nope").is_err());
        assert!(store.set_fonts("nope", vec![]).is_err());
    }
}
