//! Publish a source-owned SQL Server activity sample through the collector, diagnosis engine,
//! S3 recovery and ClickHouse writer. Both endpoints belong to the disposable native test.
use culprit_auth::{AccessKeyCredential, AccessKeyProvider};
use culprit_blob_s3::{S3Config, S3Transport};
use culprit_checks::Pipeline;
use culprit_collector::{
    analytical::test_support::LocalCaptureFixture,
    delivery::{
        object_store::ObjectRecoveryStore,
        recovery::stage_and_commit,
        sink::{DeliveryAttempt, TelemetrySink, VerificationBudget, dispatch_range, verify},
    },
    diagnostics::{DiagnosticPolicies, analyze_pending},
    outbox::CompletedCaptureBudget,
    synthesis::{AutomaticSynthesis, SynthesisTurn},
};
use culprit_core::{
    Result,
    limits::OperationGuard,
    telemetry::{ActivityPolicy, CollectionSubject},
};
use culprit_engine::ChecksSynthesizer;
use culprit_evidence::{analytical::test_support, delivery::contract::Contract};
use culprit_read::cancellation::CollectionCancellation;
use culprit_store_clickhouse::{
    catalog::SchemaCatalog,
    client::{ClickHouseConfig, Credentials},
    ingestion::{ClickHouseIngestor, WritePolicy},
};
use std::{env, error::Error, sync::Arc, time::Duration};
use zeroize::Zeroizing;

struct DisposableKeys;
#[async_trait::async_trait]
impl AccessKeyProvider for DisposableKeys {
    async fn access_keys(&self) -> Result<AccessKeyCredential> {
        Ok(AccessKeyCredential {
            key_id: Zeroizing::new("fixture-access-key".into()),
            secret_key: Zeroizing::new("fixture-secret-key".into()),
            session_token: None,
            expires_at: None,
        })
    }
}
fn loopback(variable: &str) -> std::result::Result<String, Box<dyn Error>> {
    let port = env::var(variable)?.parse::<u16>()?;
    Ok(format!("http://127.0.0.1:{port}"))
}
async fn incident_captures() -> std::result::Result<LocalCaptureFixture, Box<dyn Error>> {
    let analyzer =
        ChecksSynthesizer::new(Arc::new(Pipeline::builtin()), "native-browser-acceptance")?;
    let automatic = AutomaticSynthesis::new(Arc::new(analyzer), CompletedCaptureBudget::default())?;
    let (source, records) = test_support::blocking_evidence(test_support::BlockingCase::Matched);
    let mut captured =
        LocalCaptureFixture::with_automatic_synthesis(source, records, &automatic).await;
    let outbox = captured
        .outbox
        .as_mut()
        .expect("fixture owns a collector outbox");
    let policy = DiagnosticPolicies::for_activity(
        "local-evidence",
        CollectionSubject::Database,
        ActivityPolicy::default(),
    )?;
    let count =
        analyze_pending(outbox, &policy, &CollectionCancellation::default(), 8, None).await?;
    if count == 0 {
        return Err("collector received no activity capture".into());
    }
    for _ in 0..32 {
        let guard = OperationGuard::new(Duration::from_secs(30))?;
        match outbox
            .delivery()
            .synthesize_pending(&automatic, guard.handle(), ())
            .await?
        {
            SynthesisTurn::Committed { .. } => continue,
            SynthesisTurn::Idle => return Ok(captured),
            turn => return Err(format!("fixture synthesis did not commit: {turn:?}").into()),
        }
    }
    Err("fixture synthesis exceeded its capture budget".into())
}
#[tokio::main]
async fn main() -> std::result::Result<(), Box<dyn Error>> {
    let captured = incident_captures()
        .await
        .map_err(|e| format!("seal and analyze original: {e:?}"))?;
    let outbox = captured.outbox.as_ref().expect("sealed fixture");
    let credentials = Credentials::new(
        "culprit_fixture".into(),
        Zeroizing::new("owned-fixture-password".into()),
    )?;
    let ingestion = Arc::new(ClickHouseIngestor::new(
        ClickHouseConfig {
            endpoint: loopback("CULPRIT_TEST_CLICKHOUSE_PORT")?,
            database: "culprit_fixture".into(),
        },
        credentials,
        WritePolicy::default(),
    )?);
    let client = ingestion.query_transport();
    let contract = Contract::new(
        "incident-browser".into(),
        "shard-0".into(),
        client.destination().into(),
        SchemaCatalog::new()?.digest().into(),
    )?;
    let s3 = Arc::new(S3Transport::new(
        S3Config {
            bucket: "delivery-fixture".into(),
            region: "us-east-1".into(),
            prefix: "incident/shard".into(),
            endpoint: Some(loopback("CULPRIT_TEST_S3_PORT")?),
            expected_owner: None,
        },
        Arc::new(DisposableKeys),
    )?);
    let store = Arc::new(ObjectRecoveryStore::create(s3.clone(), contract.clone()).await?);
    let owner = store
        .acquire()
        .await
        .map_err(|e| format!("acquire recovery owner: {e:?}"))?;
    let spool = tempfile::tempdir()?;
    let sink = culprit_store_clickhouse::sink::new(
        contract.clone(),
        store.clone(),
        s3,
        ingestion,
        client,
        spool.path(),
    )?;
    let mut status = outbox.status(32, None).await?;
    if status.next_cursor.is_some() || status.entries.len() < 3 {
        return Err("original, controller and derived evidence required".into());
    }
    // Recovery admits a diagnostic revision only after the original it consumes has committed.
    status.entries.sort_by_key(|entry| {
        entry
            .capture
            .revision
            .as_ref()
            .expect("owned outbox revision")
            .sequence
            .parse::<u64>()
            .expect("decimal outbox sequence")
    });
    let mut head = None;
    for entry in status.entries {
        eprintln!(
            "Publishing fixture {:?} {:?}",
            entry.request.selection.collection(),
            entry.state
        );
        let prepared = outbox
            .delivery()
            .prepare(&entry.capture.observation_id, contract.clone(), vec![])
            .await
            .map_err(|e| format!("prepare capture: {e:?}"))?;
        let committed = stage_and_commit(store.as_ref(), &owner, head.as_deref(), &prepared)
            .await
            .map_err(|e| format!("commit original: {e:?}"))?;
        head = Some(committed.manifest().range_id.clone());
        let attempt = DeliveryAttempt::new(1)?;
        dispatch_range(&sink, &committed, &attempt)
            .await
            .map_err(|e| format!("dispatch: {e:?}"))?;
        let proof = verify(&sink, &committed, VerificationBudget::default())
            .await
            .map_err(|e| format!("verify landing rows: {e:?}"))?;
        let publication = sink
            .publish(&proof, &DeliveryAttempt::new(2)?)
            .await
            .map_err(|e| format!("publish: {e:?}"))?;
        if !sink.publication_visible(&publication, &committed).await? {
            return Err("publication is missing".into());
        }
    }
    Ok(())
}
