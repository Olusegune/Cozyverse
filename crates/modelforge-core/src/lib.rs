//! Shared Meshy + Tripo generation clients.
//!
//! `models`, `tripo`, and `meshy` are copied verbatim from ModelForge's
//! `src-tauri/src/` (same file names) so the two apps stay bug-for-bug
//! identical on the parts that talk to the providers — the upload-token
//! dance, the version-pinned endpoint paths, the status normalization, and
//! every live-verified quirk documented in those files' comments.
//!
//! ModelForge keeps `catalog.rs` / `storage.rs` / `mesh.rs` / its poll loop
//! locally; only the provider transport moves here. Cozyverse Studio depends
//! on this crate directly and runs its own worker (see the bridge plan), so
//! nothing has to POST to a second running process.

pub mod meshy;
pub mod models;
pub mod tripo;

use models::{Operation, Provider, TaskResult, TaskStatus};
use serde_json::Value;
use std::collections::HashMap;
use std::time::Duration;

pub use meshy::MeshyClient;
pub use tripo::TripoClient;

/// One handle that owns whichever provider clients have a key configured.
/// Cozyverse builds this once per decomposition job from keyring-held keys.
pub struct Clients {
    pub meshy: Option<MeshyClient>,
    pub tripo: Option<TripoClient>,
}

impl Clients {
    pub fn new(meshy_key: Option<&str>, tripo_key: Option<&str>) -> Self {
        Self {
            meshy: meshy_key.filter(|k| !k.trim().is_empty()).map(MeshyClient::new),
            tripo: tripo_key.filter(|k| !k.trim().is_empty()).map(TripoClient::new),
        }
    }

    pub fn has(&self, provider: &Provider) -> bool {
        match provider {
            Provider::Meshy => self.meshy.is_some(),
            Provider::Tripo => self.tripo.is_some(),
        }
    }

    pub async fn submit(
        &self,
        operation: Operation,
        params: HashMap<String, Value>,
    ) -> Result<TaskResult, String> {
        match operation.provider() {
            Provider::Meshy => {
                self.meshy
                    .as_ref()
                    .ok_or("Meshy API key not configured")?
                    .submit(operation, params)
                    .await
            }
            Provider::Tripo => {
                self.tripo
                    .as_ref()
                    .ok_or("Tripo API key not configured")?
                    .submit(operation, params)
                    .await
            }
        }
    }

    pub async fn poll(&self, operation: &Operation, task_id: &str) -> Result<TaskResult, String> {
        match operation.provider() {
            Provider::Meshy => {
                self.meshy
                    .as_ref()
                    .ok_or("Meshy API key not configured")?
                    .poll(operation, task_id)
                    .await
            }
            Provider::Tripo => {
                self.tripo
                    .as_ref()
                    .ok_or("Tripo API key not configured")?
                    .poll(operation, task_id)
                    .await
            }
        }
    }

    /// Submit, then poll on a fixed cadence until the task reaches a terminal
    /// state or `deadline` elapses. `on_progress` is called after every poll
    /// so the caller can emit UI events. Transient poll errors (429/5xx and
    /// network blips) are swallowed and retried until the deadline — the same
    /// policy ModelForge's own loop uses; see `models::provider_http_error`.
    pub async fn submit_and_wait(
        &self,
        operation: Operation,
        params: HashMap<String, Value>,
        poll_every: Duration,
        deadline: Duration,
        mut on_progress: impl FnMut(&TaskResult),
    ) -> Result<TaskResult, String> {
        let submitted = self.submit(operation.clone(), params).await?;
        on_progress(&submitted);
        if !submitted.status.is_active() {
            return Ok(submitted);
        }

        let started = std::time::Instant::now();
        let mut last = submitted;
        loop {
            tokio::time::sleep(poll_every).await;
            if started.elapsed() > deadline {
                last.status = TaskStatus::Failed;
                last.error = Some(format!(
                    "Timed out after {}s waiting for {} to finish",
                    deadline.as_secs(),
                    operation.label()
                ));
                return Ok(last);
            }
            match self.poll(&operation, &last.task_id).await {
                Ok(updated) => {
                    let terminal = !updated.status.is_active();
                    last = updated;
                    on_progress(&last);
                    if terminal {
                        return Ok(last);
                    }
                }
                Err(message) => {
                    // Keep waiting through transient failures; a persistent
                    // one still ends the run at the deadline branch above.
                    if !is_transient(&message) {
                        return Err(message);
                    }
                }
            }
        }
    }
}

fn is_transient(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    ["429", "500", "502", "503", "504", "timed out", "timeout", "network error"]
        .iter()
        .any(|needle| lower.contains(needle))
}
