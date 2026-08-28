// meshy.rs - Meshy API client covering all 13 operations.

use crate::models::{provider_http_error, Operation, Provider, TaskResult, TaskStatus};
use reqwest::Client;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::time::Duration;

const BASE_URL: &str = "https://api.meshy.ai";

fn generic_model_urls(raw: &Value) -> HashMap<String, String> {
    raw.get("model_urls")
        .and_then(Value::as_object)
        .map(|urls| {
            urls.iter()
                .filter_map(|(format, url)| {
                    url.as_str().map(|url| (format.clone(), url.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

pub struct MeshyClient {
    http: Client,
    api_key: String,
}

impl MeshyClient {
    pub fn new(api_key: &str) -> Self {
        Self {
            http: Client::builder()
                .timeout(Duration::from_secs(120))
                .build()
                .expect("failed to build reqwest client"),
            api_key: api_key.to_string(),
        }
    }

    /// Maps an Operation + params into (method, path) and a JSON body.
    /// Returns an error string if the operation isn't a Meshy operation.
    fn build_request(
        &self,
        operation: &Operation,
        params: &HashMap<String, Value>,
    ) -> Result<(String, Value), String> {
        use Operation::*;

        let mut body = Map::new();
        for (k, v) in params.iter() {
            body.insert(k.clone(), v.clone());
        }

        // The named-angle UI stores four stable positions so an omitted Left
        // can never make Back slide into its place. Meshy does not use fixed
        // placeholders, so compact only at this provider boundary.
        if matches!(operation, MeshyMultiImageTo3D) {
            if let Some(Value::Array(images)) = body.get("image_urls").cloned() {
                let populated: Vec<Value> = images
                    .into_iter()
                    .filter(|image| image.as_str().is_some_and(|value| !value.is_empty()))
                    .collect();
                if populated.len() < 2 {
                    return Err("Meshy Multi-Image needs a Front image plus at least one other named angle.".into());
                }
                body.insert("image_urls".into(), Value::Array(populated));
            }
        }

        // Remesh's target_formats is a []string on Meshy's side, but the form
        // renders it as a single-choice select. Verified live 2026-08-03:
        // sending a bare string returns "cannot unmarshal string into Go struct
        // field ... target_formats of type []string".
        if let Some(Value::String(fmt)) = body.get("target_formats").cloned() {
            body.insert("target_formats".into(), json!([fmt]));
        }

        // Some fields are gated on the meshy-6 model family, and Meshy rejects
        // their mere PRESENCE on older models — verified live 2026-08-03:
        // `remove_lighting: false` with ai_model=meshy-5 still returns 400
        // "remove_lighting is only supported for meshy-6", while omitting the
        // key returns 202. Probing every optional field on image-to-3d found
        // exactly these two to be gated (enable_pbr, topology, target_polycount,
        // symmetry_mode, should_remesh, is_a_t_pose and moderation are all fine
        // on meshy-5). So drop them rather than send them when the selected
        // model can't accept them.
        const MESHY6_ONLY_FIELDS: [&str; 2] = ["remove_lighting", "image_enhancement"];
        // COZYVERSE PATCH (not in ModelForge 1.3.0): the original checked
        // `starts_with("meshy-6")` only. Meshy 7 — and the `"latest"` alias,
        // which resolves to the newest tier — inherit the meshy-6 field set
        // (remove_lighting / image_enhancement in, art_style out), so gate on
        // "meshy-6 or newer" instead. Re-apply this when re-lifting meshy.rs.
        let meshy_major = |m: &str| -> Option<u32> {
            m.strip_prefix("meshy-")?
                .split(['-', '.'])
                .next()?
                .parse()
                .ok()
        };
        let model_is_meshy6 = body
            .get("ai_model")
            .and_then(|v| v.as_str())
            .map(|m| m == "latest" || meshy_major(m).map(|n| n >= 6).unwrap_or(false))
            .unwrap_or(false);
        if !model_is_meshy6 {
            for field in MESHY6_ONLY_FIELDS {
                body.remove(field);
            }
        }

        // The inverse of the gating above: Meshy's docs (2026-08-04) flag
        // art_style as "Not supported by Meshy-6; may cause errors" — drop it
        // on meshy-6 and newer, rather than let a stale/default value silently
        // break the request.
        if model_is_meshy6 {
            body.remove("art_style");
        }

        // Meshy's animation docs describe operation_type/fps as nested inside
        // a `post_process` object, not flat top-level fields — fold the
        // form's flat fields into that shape. Only build the object when
        // operation_type is actually set (it's optional; fps alone means
        // nothing to Meshy without it). NOT independently live-verified — see
        // the comment on MeshyAnimation's catalog entry.
        if matches!(operation, MeshyAnimation) {
            if let Some(op_type) = body.remove("operation_type") {
                let fps = body.remove("fps");
                let mut post_process = Map::new();
                post_process.insert("operation_type".into(), op_type);
                if let Some(fps) = fps {
                    post_process.insert("fps".into(), fps);
                }
                body.insert("post_process".into(), Value::Object(post_process));
            } else {
                body.remove("fps");
            }
        }

        let path = match operation {
            MeshyTextTo3DPreview => {
                body.insert("mode".into(), json!("preview"));
                "/openapi/v2/text-to-3d"
            }
            MeshyTextTo3DRefine => {
                body.insert("mode".into(), json!("refine"));
                // Meshy expects the preview task id under `preview_task_id`
                "/openapi/v2/text-to-3d"
            }
            // NOTE: image-to-3d and multi-image-to-3d live on v1, not v2 —
            // verified live 2026-08-03: POST /openapi/v2/image-to-3d returns
            // 404 {"message":"Not found"} while /openapi/v1/image-to-3d
            // returns 202 with a task id. Only text-to-3d is on v2.
            MeshyImageTo3D => "/openapi/v1/image-to-3d",
            MeshyMultiImageTo3D => "/openapi/v1/multi-image-to-3d",
            MeshyRetexture => "/openapi/v1/retexture",
            MeshyRemesh => "/openapi/v1/remesh",
            MeshyRigging => "/openapi/v1/rigging",
            MeshyAnimation => "/openapi/v1/animations",
            MeshyTextToImage => "/openapi/v1/text-to-image",
            MeshyImageToImage => "/openapi/v1/image-to-image",
            MeshyAnalyzePrintability => "/openapi/v1/analyze-printability",
            MeshyRepairPrintability => "/openapi/v1/repair-printability",
            MeshyMultiColorPrint => "/openapi/v1/multi-color-print",
            _ => return Err("Not a Meshy operation".into()),
        };

        Ok((path.to_string(), Value::Object(body)))
    }

    /// The GET path used to poll a task's status. Meshy nests this under the
    /// same resource family AND API version as the creating endpoint — a task
    /// created at /openapi/v2/text-to-3d 404s if polled under /openapi/v1/.
    /// Verified live 2026-08-03: polling a v2-created text-to-3d task under
    /// v1 returned 404 {"message":"NoMatchingRoute..."}.
    fn status_path(operation: &Operation, task_id: &str) -> String {
        use Operation::*;
        let (version, resource) = match operation {
            MeshyTextTo3DPreview | MeshyTextTo3DRefine => ("v2", "text-to-3d"),
            // Must match the version used to create the task (see build_request):
            // polling a v1-created image-to-3d task at v2 returns NoMatchingRoute.
            MeshyImageTo3D => ("v1", "image-to-3d"),
            MeshyMultiImageTo3D => ("v1", "multi-image-to-3d"),
            MeshyRetexture => ("v1", "retexture"),
            MeshyRemesh => ("v1", "remesh"),
            MeshyRigging => ("v1", "rigging"),
            MeshyAnimation => ("v1", "animations"),
            MeshyTextToImage => ("v1", "text-to-image"),
            MeshyImageToImage => ("v1", "image-to-image"),
            MeshyAnalyzePrintability => ("v1", "analyze-printability"),
            MeshyRepairPrintability => ("v1", "repair-printability"),
            MeshyMultiColorPrint => ("v1", "multi-color-print"),
            _ => ("v2", "text-to-3d"),
        };
        format!("/openapi/{}/{}/{}", version, resource, task_id)
    }

    pub async fn submit(
        &self,
        operation: Operation,
        params: HashMap<String, Value>,
    ) -> Result<TaskResult, String> {
        let (path, body) = self.build_request(&operation, &params)?;

        let response = self
            .http
            .post(format!("{}{}", BASE_URL, path))
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Network error calling Meshy: {}", e))?;

        let status_code = response.status();
        let text = response
            .text()
            .await
            .map_err(|e| format!("Failed reading Meshy response: {}", e))?;

        if !status_code.is_success() {
            return Err(provider_http_error("Meshy", status_code, &text));
        }

        let raw: Value = serde_json::from_str(&text)
            .map_err(|e| format!("Failed parsing Meshy JSON: {} — body: {}", e, text))?;

        let task_id = raw
            .get("result")
            .and_then(|v| v.as_str())
            .or_else(|| raw.get("id").and_then(|v| v.as_str()))
            .ok_or_else(|| format!("Meshy response missing task id: {}", text))?
            .to_string();

        Ok(TaskResult {
            task_id,
            provider: Provider::Meshy,
            operation,
            status: TaskStatus::Pending,
            progress: 0.0,
            model_urls: HashMap::new(),
            texture_urls: vec![],
            thumbnail_url: None,
            error: None,
            raw_response: Some(raw),
            created_at: chrono::Utc::now().to_rfc3339(),
            finished_at: None,
            credits_used: None,
            version_id: None,
            parent_version_id: None,
            source_task_id: None,
            rig_type: None,
            // Stamped by submit_generation/spawn_poll_loop in main.rs, which
            // know which project is active — provider clients have no
            // concept of "project" and must never guess one.
            project_id: None,
        })
    }

    pub async fn poll(&self, operation: &Operation, task_id: &str) -> Result<TaskResult, String> {
        let path = Self::status_path(operation, task_id);

        let response = self
            .http
            .get(format!("{}{}", BASE_URL, path))
            .bearer_auth(&self.api_key)
            // A poll is a tiny status GET on a 2s cadence; it should never
            // legitimately need the 120s timeout submit/upload use. Without
            // an override, a single hung poll silently stalls the progress
            // bar for up to 2 minutes and looks like the app froze.
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .map_err(|e| format!("Network error polling Meshy: {}", e))?;

        let status_code = response.status();
        let text = response
            .text()
            .await
            .map_err(|e| format!("Failed reading Meshy poll response: {}", e))?;

        if !status_code.is_success() {
            return Err(provider_http_error("Meshy", status_code, &text));
        }

        let raw: Value = serde_json::from_str(&text)
            .map_err(|e| format!("Failed parsing Meshy poll JSON: {} — body: {}", e, text))?;

        let status_str = raw
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("PENDING")
            .to_uppercase();

        let status = match status_str.as_str() {
            "SUCCEEDED" => TaskStatus::Succeeded,
            "FAILED" => TaskStatus::Failed,
            "IN_PROGRESS" => TaskStatus::Running,
            "CANCELED" | "CANCELLED" => TaskStatus::Cancelled,
            _ => TaskStatus::Pending,
        };

        let progress = raw.get("progress").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;

        let mut model_urls = generic_model_urls(&raw);
        // Auto-Rig's response shape is completely different from every other
        // Meshy task: no top-level `model_urls` at all — everything lives
        // under `result.rigged_character_*_url`, and a successful rig comes
        // bundled with free walk/run animations under
        // `result.basic_animations.*`. Verified live 2026-08-04 (the first
        // real SUCCEEDED rigging response this app has ever gotten — every
        // prior attempt failed at pose estimation before reaching this
        // stage). Without this, a successful rig showed "no model output
        // available" in the UI despite Meshy having genuinely produced one.
        if matches!(operation, Operation::MeshyRigging) {
            if let Some(result) = raw.get("result") {
                if let Some(u) = result
                    .get("rigged_character_glb_url")
                    .and_then(|v| v.as_str())
                {
                    model_urls.insert("glb".into(), u.to_string());
                }
                if let Some(u) = result
                    .get("rigged_character_fbx_url")
                    .and_then(|v| v.as_str())
                {
                    model_urls.insert("fbx".into(), u.to_string());
                }
                // basic_animations also has *_fbx_url and *_armature_glb_url
                // (skeleton-only, no mesh) variants for both — not exposed
                // here since the format dropdown just needs one good option
                // per motion, not every permutation.
                if let Some(anims) = result.get("basic_animations") {
                    if let Some(u) = anims.get("walking_glb_url").and_then(|v| v.as_str()) {
                        model_urls.insert("walk_glb".into(), u.to_string());
                    }
                    if let Some(u) = anims.get("running_glb_url").and_then(|v| v.as_str()) {
                        model_urls.insert("run_glb".into(), u.to_string());
                    }
                }
            }
        }
        // MeshyAnimation has its own distinct result shape too — verified live
        // 2026-08-04 (action_id 1 "Walking_Woman" on a rigged model, the
        // second operation this app has ever gotten to actually succeed,
        // right after Auto-Rig above). The processed_*_url fields only
        // populate when `post_process` was requested; empty string when it
        // wasn't, so they're skipped unless non-empty.
        if matches!(operation, Operation::MeshyAnimation) {
            if let Some(result) = raw.get("result") {
                if let Some(u) = result.get("animation_glb_url").and_then(|v| v.as_str()) {
                    model_urls.insert("glb".into(), u.to_string());
                }
                if let Some(u) = result.get("animation_fbx_url").and_then(|v| v.as_str()) {
                    model_urls.insert("fbx".into(), u.to_string());
                }
                for (key, label) in [
                    ("processed_usdz_url", "usdz"),
                    ("processed_armature_fbx_url", "armature_fbx"),
                    ("processed_animation_fps_fbx_url", "retimed_fbx"),
                ] {
                    if let Some(u) = result.get(key).and_then(|v| v.as_str()) {
                        if !u.is_empty() {
                            model_urls.insert(label.into(), u.to_string());
                        }
                    }
                }
            }
        }

        let texture_urls = raw
            .get("texture_urls")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|t| t.as_object())
                    .map(|obj| {
                        obj.iter()
                            .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                            .collect::<HashMap<_, _>>()
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        let error = raw
            .get("task_error")
            .and_then(|v| v.get("message"))
            .and_then(|v| v.as_str())
            .map(String::from);

        let thumbnail_url = raw
            .get("thumbnail_url")
            .and_then(|v| v.as_str())
            .map(String::from);

        let credits_used = raw
            .get("consumed_credits")
            .or_else(|| raw.get("precede_credits"))
            .and_then(|v| v.as_f64())
            .map(|f| f as f32);

        Ok(TaskResult {
            task_id: task_id.to_string(),
            provider: Provider::Meshy,
            operation: operation.clone(),
            status,
            progress,
            model_urls,
            texture_urls,
            thumbnail_url,
            error,
            raw_response: Some(raw),
            created_at: chrono::Utc::now().to_rfc3339(),
            finished_at: None,
            credits_used,
            version_id: None,
            parent_version_id: None,
            source_task_id: None,
            rig_type: None,
            // Stamped by submit_generation/spawn_poll_loop in main.rs, which
            // know which project is active — provider clients have no
            // concept of "project" and must never guess one.
            project_id: None,
        })
    }

    pub async fn delete_task(&self, operation: &Operation, task_id: &str) -> Result<(), String> {
        let path = Self::status_path(operation, task_id);
        let response = self
            .http
            .delete(format!("{}{}", BASE_URL, path))
            .bearer_auth(&self.api_key)
            .send()
            .await
            .map_err(|e| format!("Network error deleting Meshy task: {}", e))?;

        if !response.status().is_success() {
            let text = response.text().await.unwrap_or_default();
            return Err(format!("Failed to delete task: {}", text));
        }
        Ok(())
    }

    pub async fn get_balance(&self) -> Result<Value, String> {
        let response = self
            .http
            .get(format!("{}/openapi/v1/balance", BASE_URL))
            .bearer_auth(&self.api_key)
            .send()
            .await
            .map_err(|e| format!("Network error fetching Meshy balance: {}", e))?;

        let text = response.text().await.unwrap_or_default();
        serde_json::from_str(&text).map_err(|e| format!("Failed parsing balance: {} ({})", e, text))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_official_model_url_shape() {
        let urls = generic_model_urls(&json!({
            "status": "SUCCEEDED",
            "model_urls": {
                "glb": "https://assets.example/model.glb",
                "fbx": "https://assets.example/model.fbx"
            }
        }));
        assert_eq!(urls["glb"], "https://assets.example/model.glb");
        assert_eq!(urls["fbx"], "https://assets.example/model.fbx");
    }

    #[test]
    fn request_and_poll_paths_match_current_public_api_versions() {
        let client = MeshyClient::new("test");
        let (image_path, _) = client
            .build_request(&Operation::MeshyImageTo3D, &HashMap::new())
            .unwrap();
        assert_eq!(image_path, "/openapi/v1/image-to-3d");
        assert_eq!(
            MeshyClient::status_path(&Operation::MeshyTextTo3DPreview, "fixture"),
            "/openapi/v2/text-to-3d/fixture"
        );
        let (animation_path, animation_body) = client
            .build_request(
                &Operation::MeshyAnimation,
                &HashMap::from([
                    ("rig_task_id".into(), json!("rig-fixture")),
                    ("action_id".into(), json!(1)),
                ]),
            )
            .unwrap();
        assert_eq!(animation_path, "/openapi/v1/animations");
        assert_eq!(animation_body["action_id"], 1);
    }
}
