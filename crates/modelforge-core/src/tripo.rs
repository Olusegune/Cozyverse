// tripo.rs - Tripo API client. Tripo uses a single task-creation endpoint
// with a `type` discriminator field, plus one shared status-polling endpoint.

use crate::models::{provider_http_error, Operation, Provider, TaskResult, TaskStatus};
use reqwest::Client;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::time::Duration;

const BASE_URL: &str = "https://api.tripo3d.ai";

/// Tripo's `output.model` is not always a GLB. Quad-topology retopology and
/// convert_model requests for OBJ/FBX bundle geometry + materials + textures
/// into a `.zip`, since those formats need multiple files — verified live
/// 2026-08-07: `retopology` with `format: OBJ, quad: true` returned
/// `output.model` ending in `.zip` with `result.model.type == "zip"`.
/// Hardcoding this as `"glb"` made the viewer try to parse a ZIP archive as
/// glTF JSON ("expected value at line 1 column 1") after a real generation
/// had already succeeded and spent credits. Detecting the real extension
/// keeps the existing behavior for genuine GLBs (the common case) while
/// routing anything else to a distinct, non-previewable download key.
fn model_format_from_url(url: &str) -> &'static str {
    let path = url.split('?').next().unwrap_or(url);
    match path
        .rsplit('.')
        .next()
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("zip") => "zip",
        Some("fbx") => "fbx",
        Some("obj") => "obj",
        Some("usdz") => "usdz",
        Some("stl") => "stl",
        Some("gltf") => "gltf",
        _ => "glb",
    }
}

fn model_urls_from_poll_data(data: &Value) -> HashMap<String, String> {
    let mut model_urls = HashMap::new();
    if let Some(output) = data.get("output") {
        if let Some(model_url) = output.get("model").and_then(Value::as_str) {
            model_urls.insert(
                model_format_from_url(model_url).to_string(),
                model_url.to_string(),
            );
        }
        if let Some(pbr_url) = output.get("pbr_model").and_then(Value::as_str) {
            model_urls.insert("pbr_glb".to_string(), pbr_url.to_string());
        }
    }
    if let Some(results) = data.get("results").and_then(Value::as_array) {
        for result in results {
            if let Some(asset) = result.get("asset").and_then(Value::as_str) {
                let format = result
                    .get("asset_type")
                    .and_then(Value::as_str)
                    .unwrap_or("glb");
                model_urls.insert(format.to_ascii_lowercase(), asset.to_string());
            }
        }
    }
    model_urls
}

pub struct TripoClient {
    http: Client,
    api_key: String,
}

impl TripoClient {
    pub fn new(api_key: &str) -> Self {
        Self {
            http: Client::builder()
                .timeout(Duration::from_secs(120))
                .build()
                .expect("failed to build reqwest client"),
            api_key: api_key.to_string(),
        }
    }

    /// Splits a `data:image/png;base64,...` URI into (extension, bytes).
    fn decode_data_uri(uri: &str) -> Result<(String, Vec<u8>), String> {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        let rest = uri
            .strip_prefix("data:")
            .ok_or("Expected a data: URI for the image")?;
        let (meta, b64) = rest
            .split_once(",")
            .ok_or("Malformed data URI (no comma separator)")?;
        let mime = meta.split(';').next().unwrap_or("image/png");
        let ext = match mime {
            "image/jpeg" | "image/jpg" => "jpeg",
            "image/webp" => "webp",
            _ => "png",
        };
        let bytes = STANDARD
            .decode(b64)
            .map_err(|e| format!("Failed decoding image data URI: {}", e))?;
        Ok((ext.to_string(), bytes))
    }

    /// Tripo does not accept inline image data or arbitrary URLs on its task
    /// endpoint — images must first be POSTed to /v2/openapi/upload, which
    /// returns an `image_token` that the task body then references as
    /// `file: { type, file_token }`. Verified live 2026-08-03.
    async fn upload_image(&self, data_uri: &str) -> Result<(String, String), String> {
        let (ext, bytes) = Self::decode_data_uri(data_uri)?;

        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name(format!("upload.{}", ext))
            .mime_str(&format!("image/{}", ext))
            .map_err(|e| format!("Bad mime for Tripo upload: {}", e))?;
        let form = reqwest::multipart::Form::new().part("file", part);

        let response = self
            .http
            .post(format!("{}/v2/openapi/upload", BASE_URL))
            .bearer_auth(&self.api_key)
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("Network error uploading image to Tripo: {}", e))?;

        let text = response
            .text()
            .await
            .map_err(|e| format!("Failed reading Tripo upload response: {}", e))?;
        let raw: Value = serde_json::from_str(&text)
            .map_err(|e| format!("Failed parsing Tripo upload JSON: {} — body: {}", e, text))?;

        let token = raw
            .get("data")
            .and_then(|d| d.get("image_token").or_else(|| d.get("file_token")))
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("Tripo upload response missing image_token: {}", text))?
            .to_string();

        Ok((ext, token))
    }

    /// Replaces data-URI image params with Tripo's uploaded-file references.
    async fn resolve_images(
        &self,
        operation: &Operation,
        params: &mut HashMap<String, Value>,
    ) -> Result<(), String> {
        use Operation::*;

        // Single-image operations. TripoRetexture's uploaded file ends up
        // under the intermediate key "texture_image_file" — build_body below
        // folds it (plus the flat "texture_prompt" text field) into the
        // nested `texture_prompt: { text, image }` shape Tripo actually wants.
        // Probed live 2026-08-04: a flat string texture_prompt gets rejected
        // at the request-SHAPE validation stage (400 "request body is
        // malformed") before Tripo even looks at the task id; the object
        // shape passes that check.
        let single_key = match operation {
            TripoImageTo3D => Some("image_url"),
            TripoRetexture => Some("texture_image_url"),
            _ => None,
        };
        if let Some(key) = single_key {
            if let Some(Value::String(uri)) = params.get(key).cloned() {
                if uri.starts_with("data:") {
                    let (ext, token) = self.upload_image(&uri).await?;
                    params.remove(key);
                    let field = if matches!(operation, TripoImageTo3D) {
                        "file"
                    } else {
                        "texture_image_file"
                    };
                    params.insert(
                        field.to_string(),
                        json!({ "type": ext, "file_token": token }),
                    );
                }
            }
        }

        // Tripo's four array positions carry meaning even when a side is omitted:
        // [front, left, back, right]. Preserve empty UI slots as `{}` rather
        // than compacting the array and accidentally relabelling Back as Left.
        if matches!(operation, TripoMultiviewTo3D) {
            if let Some(Value::Array(list)) = params.get("image_urls").cloned() {
                let mut files = Vec::new();
                for index in 0..4 {
                    match list.get(index) {
                        Some(Value::String(uri)) if uri.starts_with("data:") => {
                            let (ext, token) = self.upload_image(&uri).await?;
                            files.push(json!({ "type": ext, "file_token": token }));
                        }
                        Some(Value::String(uri)) if !uri.is_empty() => {
                            files.push(json!({ "url": uri }));
                        }
                        _ => files.push(json!({})),
                    }
                }
                let populated = files
                    .iter()
                    .filter(|file| file.as_object().is_some_and(|object| !object.is_empty()))
                    .count();
                let front_present = files[0]
                    .as_object()
                    .is_some_and(|object| !object.is_empty());
                if !front_present || populated < 2 {
                    return Err(
                        "Tripo Multiview needs a Front image plus at least one other named angle."
                            .into(),
                    );
                }
                params.remove("image_urls");
                params.insert("files".to_string(), Value::Array(files));
            }
        }

        Ok(())
    }

    /// Tripo distinguishes operations via a `type` field in a single POST body,
    /// rather than distinct URL paths (per their v2 openapi/task endpoint).
    fn build_body(
        &self,
        operation: &Operation,
        params: &HashMap<String, Value>,
    ) -> Result<Value, String> {
        use Operation::*;

        let mut body = Map::new();
        for (k, v) in params.iter() {
            body.insert(k.clone(), v.clone());
        }

        // `compress` is a plain on/off checkbox in the UI, but Tripo's wire
        // format wants either the string "geometry" or the key absent
        // entirely — there's no documented "off" value to send. Verified live
        // 2026-08-04 that Tripo accepts the field being missing (that's the
        // default/meshopt path) alongside a battery of other advanced fields.
        match body.get("compress") {
            Some(Value::Bool(true)) => {
                body.insert("compress".into(), json!("geometry"));
            }
            Some(Value::Bool(false)) | None => {
                body.remove("compress");
            }
            _ => {} // already a string (shouldn't happen from the UI, but leave as-is)
        }

        // Tripo's texture_model wants `texture_prompt` as an OBJECT —
        // `{ text, image }` — not the flat `texture_prompt` string and
        // `texture_image_url` fields the form collects. Confirmed live
        // 2026-08-04: the flat-string shape is rejected before Tripo even
        // resolves the task id (400 "request body is malformed"); the nested
        // shape passes that check. See resolve_images for where the uploaded
        // image ends up under "texture_image_file" before reaching here.
        if matches!(operation, TripoRetexture) {
            let text = body.remove("texture_prompt");
            let image = body.remove("texture_image_file");
            if text.is_some() || image.is_some() {
                let mut prompt_obj = Map::new();
                if let Some(Value::String(t)) = text {
                    if !t.is_empty() {
                        prompt_obj.insert("text".into(), json!(t));
                    }
                }
                if let Some(img) = image {
                    prompt_obj.insert("image".into(), img);
                }
                if !prompt_obj.is_empty() {
                    body.insert("texture_prompt".into(), Value::Object(prompt_obj));
                }
            }
        }

        let task_type = match operation {
            TripoTextTo3D => "text_to_model",
            TripoImageTo3D => "image_to_model",
            TripoMultiviewTo3D => "multiview_to_model",
            TripoRetexture => "texture_model",
            // Verified real live 2026-08-04 — "segment_model" (the previous
            // value) was never recognised by Tripo; the correct type is
            // "mesh_segmentation" (confirmed by official docs and a bogus-
            // task-id probe returning 404 "not found" rather than a 400
            // "malformed request").
            TripoSegment => "mesh_segmentation",
            TripoRetopology => "convert_model", // quad=true path
            // animate_rig produces a rigged skeleton (rig_type/spec params);
            // animate_retarget applies a preset animation. These used to be
            // conflated into one operation with a fabricated field name — see
            // the comment block in catalog.rs. Tripo's docs claim
            // animate_retarget works on an unrigged model directly; a real
            // paid run 2026-08-04 disproved that (400 "original task type is
            // not supported" on a raw model, success on the same model after
            // Auto-Rig) — see catalog.rs's TripoAnimate comment for the detail.
            TripoRigAnimate => "animate_rig",
            TripoAnimate => "animate_retarget",
            TripoPreRigCheck => "animate_prerigcheck",
            TripoHighpolyToLowpoly => "highpoly_to_lowpoly",
            TripoConvertFormat => "convert_model",
            _ => return Err("Not a Tripo operation".into()),
        };

        body.insert("type".into(), json!(task_type));

        Ok(Value::Object(body))
    }

    pub async fn submit(
        &self,
        operation: Operation,
        params: HashMap<String, Value>,
    ) -> Result<TaskResult, String> {
        let mut params = params;
        self.resolve_images(&operation, &mut params).await?;
        let body = self.build_body(&operation, &params)?;

        let response = self
            .http
            .post(format!("{}/v2/openapi/task", BASE_URL))
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Network error calling Tripo: {}", e))?;

        let status_code = response.status();
        let text = response
            .text()
            .await
            .map_err(|e| format!("Failed reading Tripo response: {}", e))?;

        if !status_code.is_success() {
            return Err(provider_http_error("Tripo", status_code, &text));
        }

        let raw: Value = serde_json::from_str(&text)
            .map_err(|e| format!("Failed parsing Tripo JSON: {} — body: {}", e, text))?;

        let task_id = raw
            .get("data")
            .and_then(|d| d.get("task_id"))
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("Tripo response missing task_id: {}", text))?
            .to_string();

        Ok(TaskResult {
            task_id,
            provider: Provider::Tripo,
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
        let response = self
            .http
            .get(format!("{}/v2/openapi/task/{}", BASE_URL, task_id))
            .bearer_auth(&self.api_key)
            // See meshy.rs::poll for why this is shorter than the client's
            // 120s default: a status GET should never take that long, and
            // without an override a hung poll makes the app look frozen.
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .map_err(|e| format!("Network error polling Tripo: {}", e))?;

        let status_code = response.status();
        let text = response
            .text()
            .await
            .map_err(|e| format!("Failed reading Tripo poll response: {}", e))?;

        if !status_code.is_success() {
            return Err(provider_http_error("Tripo", status_code, &text));
        }

        let raw: Value = serde_json::from_str(&text)
            .map_err(|e| format!("Failed parsing Tripo poll JSON: {} — body: {}", e, text))?;

        let data = raw.get("data").cloned().unwrap_or(Value::Null);

        let status_str = data
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("pending")
            .to_lowercase();

        let status = match status_str.as_str() {
            "success" | "succeeded" | "finished" => TaskStatus::Succeeded,
            "failed" | "failure" => TaskStatus::Failed,
            "running" | "in_progress" => TaskStatus::Running,
            "cancelled" | "canceled" => TaskStatus::Cancelled,
            _ => TaskStatus::Pending,
        };

        let progress = data.get("progress").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;

        // Official v2 responses nest assets under output; retain support for
        // the results-array proxy shape used by some Tripo-compatible hosts.
        let model_urls = model_urls_from_poll_data(&data);

        let thumbnail_url = data
            .get("output")
            .and_then(|o| o.get("rendered_image"))
            .and_then(|v| v.as_str())
            .map(String::from);

        let error = data
            .get("failure_reason")
            .or_else(|| data.get("error"))
            .and_then(|v| v.as_str())
            .map(String::from);

        Ok(TaskResult {
            task_id: task_id.to_string(),
            provider: Provider::Tripo,
            operation: operation.clone(),
            status,
            progress,
            model_urls,
            // Tripo has no equivalent of Meshy's separate texture_urls array
            // (base_color/metallic/roughness PNGs) — its documented response
            // shape only ever nests `model`/`pbr_model` under `output`.
            // Textures are baked into that GLB, not exposed as standalone
            // image files. This is genuinely empty, not an unparsed field:
            // an OBJ export from a Tripo task can only ever get an MTL
            // companion (if `model_urls_from_poll_data` found one via the
            // results-array proxy shape), never separate texture images.
            texture_urls: vec![],
            thumbnail_url,
            error,
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

    pub async fn get_balance(&self) -> Result<Value, String> {
        let response = self
            .http
            .get(format!("{}/v2/openapi/user/balance", BASE_URL))
            .bearer_auth(&self.api_key)
            .send()
            .await
            .map_err(|e| format!("Network error fetching Tripo balance: {}", e))?;

        let text = response.text().await.unwrap_or_default();
        serde_json::from_str(&text).map_err(|e| format!("Failed parsing balance: {} ({})", e, text))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_official_v2_poll_asset_shape() {
        let data = json!({
            "status": "success",
            "output": {
                "model": "https://cdn.example/model.glb",
                "pbr_model": "https://cdn.example/model-pbr.glb"
            }
        });
        let urls = model_urls_from_poll_data(&data);
        assert_eq!(urls["glb"], "https://cdn.example/model.glb");
        assert_eq!(urls["pbr_glb"], "https://cdn.example/model-pbr.glb");
    }

    #[test]
    fn quad_obj_retopology_zip_is_not_mislabeled_as_glb() {
        // Real shape observed live 2026-08-07: retopology with
        // format=OBJ, quad=true returns output.model as a signed .zip URL,
        // not a GLB. Mislabeling it "glb" made the viewer try to parse a
        // ZIP archive as glTF JSON and fail with a confusing error after
        // the generation had already succeeded and spent credits.
        let data = json!({
            "status": "success",
            "output": {
                "model": "https://tripo-data.example/tripo_convert_abc.zip?Signature=xyz"
            }
        });
        let urls = model_urls_from_poll_data(&data);
        assert!(!urls.contains_key("glb"));
        assert_eq!(
            urls["zip"],
            "https://tripo-data.example/tripo_convert_abc.zip?Signature=xyz"
        );
    }

    #[test]
    fn model_format_from_url_detects_real_extension() {
        assert_eq!(
            model_format_from_url("https://x.example/m.glb?sig=1"),
            "glb"
        );
        assert_eq!(
            model_format_from_url("https://x.example/m.zip?sig=1"),
            "zip"
        );
        assert_eq!(model_format_from_url("https://x.example/m.fbx"), "fbx");
        assert_eq!(model_format_from_url("https://x.example/m.obj"), "obj");
        assert_eq!(model_format_from_url("https://x.example/m.usdz"), "usdz");
        assert_eq!(model_format_from_url("https://x.example/m.stl"), "stl");
        assert_eq!(model_format_from_url("https://x.example/m.gltf"), "gltf");
        // No/unknown extension defaults to glb — preserves prior behavior
        // for the common case rather than silently dropping the URL.
        assert_eq!(model_format_from_url("https://x.example/m"), "glb");
    }

    #[test]
    fn current_generation_and_animation_request_types_match_v2_schema() {
        let client = TripoClient::new("test");
        let generation = client
            .build_body(
                &Operation::TripoImageTo3D,
                &HashMap::from([
                    ("model_version".into(), json!("v3.1-20260211")),
                    ("file".into(), json!({"type":"png","file_token":"fixture"})),
                ]),
            )
            .unwrap();
        assert_eq!(generation["type"], "image_to_model");
        assert_eq!(generation["model_version"], "v3.1-20260211");
        let walk = client
            .build_body(
                &Operation::TripoAnimate,
                &HashMap::from([
                    ("original_model_task_id".into(), json!("rig-task")),
                    ("animation".into(), json!("preset:walk")),
                ]),
            )
            .unwrap();
        assert_eq!(walk["type"], "animate_retarget");
    }
}
