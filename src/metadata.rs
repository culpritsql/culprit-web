use crate::access::Actor;
use culprit_core::{PublishedResourceSelector, WarehouseConnectionRef};
use rusqlite::{Connection, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    sync::{Arc, Mutex},
};

const SCHEMA:&str = "
CREATE TABLE IF NOT EXISTS access_audit (
 id INTEGER PRIMARY KEY, at INTEGER NOT NULL DEFAULT(unixepoch()), issuer TEXT NOT NULL,
 subject TEXT NOT NULL, operation TEXT NOT NULL, archive TEXT, namespace TEXT, database_id TEXT, decision TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS saved_views (
 id INTEGER PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL, document TEXT NOT NULL,
 UNIQUE(issuer,subject,document)
);";
const MAX_SAVED: i64 = 100;

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum View {
    Incident,
    Workload,
    Changes,
    Coverage,
    Timeline,
    Operations,
    Schema,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArchiveRange {
    from: String,
    until: String,
    recorded_before: String,
}
impl ArchiveRange {
    fn valid(&self) -> bool {
        let parse = chrono::DateTime::parse_from_rfc3339;
        matches!((parse(&self.from),parse(&self.until)),(Ok(from),Ok(until)) if from<until)
            && parse(&self.recorded_before).is_ok()
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavedView {
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<ArchiveRange>,
    pub connection: WarehouseConnectionRef,
    pub resource: PublishedResourceSelector,
    pub around: String,
    pub view: View,
    pub incident: Option<String>,
}
impl SavedView {
    pub fn valid(&self) -> bool {
        !self.title.trim().is_empty()
            && self.title.chars().count() <= 120
            && self.bounds.as_ref().is_none_or(ArchiveRange::valid)
            && self.resource.validate().is_ok()
            && self.connection.name.len() <= 256
            && self.connection.revision.len() <= 128
            && self.around.len() <= 40
            && chrono::DateTime::parse_from_rfc3339(&self.around).is_ok()
            && self
                .incident
                .as_ref()
                .is_none_or(|id| !id.is_empty() && id.len() <= 256)
    }
}
#[derive(Serialize)]
pub struct Bookmark {
    pub id: i64,
    #[serde(flatten)]
    pub view: SavedView,
}

#[derive(Clone)]
pub struct Metadata(Arc<Mutex<Connection>>);
#[derive(Debug)]
pub enum StoreError {
    Unavailable,
    Limit,
}
impl From<rusqlite::Error> for StoreError {
    fn from(_: rusqlite::Error) -> Self {
        Self::Unavailable
    }
}
impl From<serde_json::Error> for StoreError {
    fn from(_: serde_json::Error) -> Self {
        Self::Unavailable
    }
}

impl Metadata {
    pub fn open(path: &Path) -> Result<Self, rusqlite::Error> {
        let db = Connection::open(path)?;
        db.execute_batch(SCHEMA)?;
        Ok(Self(Arc::new(Mutex::new(db))))
    }
    async fn transact<T: Send + 'static>(
        &self,
        job: impl FnOnce(&mut Connection) -> Result<T, StoreError> + Send + 'static,
    ) -> Result<T, StoreError> {
        let owner = Arc::clone(&self.0);
        tokio::task::spawn_blocking(move || {
            let mut db = owner.lock().map_err(|_| StoreError::Unavailable)?;
            job(&mut db)
        })
        .await
        .map_err(|_| StoreError::Unavailable)?
    }
    pub async fn audit(
        &self,
        actor: Actor,
        operation: &'static str,
        archive: Option<String>,
        resource: Option<PublishedResourceSelector>,
        decision: &'static str,
    ) -> Result<(), StoreError> {
        self.transact(move |db|{
            let namespace=resource.as_ref().map(|r|r.namespace_id.as_str());
            let database=resource.as_ref().map(|r|r.database.key());
            db.execute("INSERT INTO access_audit(issuer,subject,operation,archive,namespace,database_id,decision) VALUES(?,?,?,?,?,?,?)",
                params![actor.issuer,actor.subject,operation,archive,namespace,database,decision])?;
            Ok(())
        }).await
    }
    pub async fn list(&self, actor: Actor) -> Result<Vec<Bookmark>, StoreError> {
        self.transact(move |db| {
            let mut select = db.prepare(
                "SELECT id,document FROM saved_views WHERE issuer=? AND subject=? ORDER BY id DESC",
            )?;
            let mut rows = select.query(params![actor.issuer, actor.subject])?;
            let mut result = Vec::new();
            while let Some(row) = rows.next()? {
                result.push(Bookmark {
                    id: row.get(0)?,
                    view: serde_json::from_str(&row.get::<_, String>(1)?)?,
                });
            }
            Ok(result)
        })
        .await
    }
    pub async fn save(&self, actor: Actor, view: SavedView) -> Result<(), StoreError> {
        let document = serde_json::to_string(&view)?;
        self.transact(move |db| {
            let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let changed = tx.execute(
                "INSERT OR IGNORE INTO saved_views(issuer,subject,document) VALUES(?,?,?)",
                params![actor.issuer, actor.subject, document],
            )?;
            if changed > 0 {
                let count: i64 = tx.query_row(
                    "SELECT count(*) FROM saved_views WHERE issuer=? AND subject=?",
                    params![actor.issuer, actor.subject],
                    |r| r.get(0),
                )?;
                if count > MAX_SAVED {
                    return Err(StoreError::Limit);
                }
            }
            tx.commit()?;
            Ok(())
        })
        .await
    }
    pub async fn remove(&self, actor: Actor, id: i64) -> Result<(), StoreError> {
        self.transact(move |db| {
            db.execute(
                "DELETE FROM saved_views WHERE id=? AND issuer=? AND subject=?",
                params![id, actor.issuer, actor.subject],
            )?;
            Ok(())
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn actor(issuer: &str, subject: &str) -> Actor {
        Actor {
            issuer: issuer.into(),
            subject: subject.into(),
        }
    }
    fn view(index: i64) -> SavedView {
        serde_json::from_value(serde_json::json!({
            "title":format!("View {index}"),"connection":{"name":"prod","revision":"revision"},
            "resource":{"namespace_id":"a".repeat(64),"database":"b".repeat(64)},
            "around":"2026-10-11T12:10:00Z","view":"workload","incident":null
        }))
        .unwrap()
    }
    #[tokio::test]
    async fn saves_are_idempotent_limited_and_owned_by_issuer_and_subject() {
        let store = Metadata::open(Path::new(":memory:")).unwrap();
        let owner = actor("one", "sam");
        for n in 0..MAX_SAVED {
            store.save(owner.clone(), view(n)).await.unwrap();
        }
        store.save(owner.clone(), view(0)).await.unwrap();
        assert!(matches!(
            store.save(owner.clone(), view(MAX_SAVED)).await,
            Err(StoreError::Limit)
        ));
        let private = store.list(owner.clone()).await.unwrap();
        assert_eq!(private.len(), MAX_SAVED as usize);
        for other in [actor("two", "sam"), actor("one", "alex")] {
            assert!(store.list(other.clone()).await.unwrap().is_empty());
            store.remove(other, private[0].id).await.unwrap();
        }
        assert_eq!(
            store.list(owner.clone()).await.unwrap().len(),
            private.len()
        );
        store.remove(owner.clone(), private[0].id).await.unwrap();
        store.save(owner, view(MAX_SAVED)).await.unwrap();
    }
    #[tokio::test]
    async fn decisions_survive_reopening_the_database() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("workspace.sqlite3");
        let store = Metadata::open(&path).unwrap();
        store
            .audit(
                actor("issuer", "sam"),
                "export",
                Some("prod".into()),
                Some(view(0).resource),
                "denied",
            )
            .await
            .unwrap();
        drop(store);
        let db = Connection::open(path).unwrap();
        let result:String=db.query_row("SELECT decision FROM access_audit WHERE issuer='issuer' AND subject='sam' AND operation='export' AND archive='prod'",[],|row|row.get(0)).unwrap();
        assert_eq!(result, "denied");
    }
}
