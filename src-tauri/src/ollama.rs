//! Local text generation via Ollama (http://127.0.0.1:11434 by default) — used by the Prompt
//! Assistant to turn a loose concept into image/video/audio/SFX prompt drafts. Kept as its own
//! module (mirrors the "separate provider integrations" split already used for providers.rs and
//! video_export.rs) since this is a distinct kind of backend: local, no API key, optional.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

const DEFAULT_SERVER_URL: &str = "http://127.0.0.1:11434";

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OllamaSettings {
    server_url: String,
    model: String,
}

impl Default for OllamaSettings {
    fn default() -> Self {
        Self { server_url: DEFAULT_SERVER_URL.into(), model: String::new() }
    }
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| format!("Could not prepare settings folder: {error}"))?;
    Ok(dir.join("ollama_settings.json"))
}

#[tauri::command]
pub fn ollama_get_settings(app: AppHandle) -> Result<OllamaSettings, String> {
    let path = settings_path(&app)?;
    if !path.exists() { return Ok(OllamaSettings::default()); }
    let contents = fs::read_to_string(&path).map_err(|error| format!("Could not read Ollama settings: {error}"))?;
    serde_json::from_str(&contents).map_err(|error| format!("Ollama settings file is corrupted: {error}"))
}

#[tauri::command]
pub fn ollama_save_settings(app: AppHandle, settings: OllamaSettings) -> Result<(), String> {
    let path = settings_path(&app)?;
    let contents = serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?;
    crate::write_json_atomic(path, &contents)
}

fn ollama_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|error| error.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaConnectionStatus {
    reachable: bool,
    detail: String,
}

/// Read-only reachability check — GET /api/tags is the lightest endpoint Ollama exposes and also
/// happens to double as the model list, but this command only reports reachability so
/// ollama_list_models can be called separately without re-explaining connection failures.
#[tauri::command]
pub async fn ollama_test_connection(server_url: String) -> Result<OllamaConnectionStatus, String> {
    let client = ollama_http_client()?;
    let url = format!("{}/api/tags", server_url.trim_end_matches('/'));
    match client.get(&url).send().await {
        Ok(response) if response.status().is_success() => {
            Ok(OllamaConnectionStatus { reachable: true, detail: "Ollama is running and reachable.".into() })
        }
        Ok(response) => Ok(OllamaConnectionStatus { reachable: false, detail: format!("Ollama responded with status {}.", response.status()) }),
        Err(error) => Ok(OllamaConnectionStatus {
            reachable: false,
            detail: format!("Could not reach Ollama at {server_url}: {error}. Is Ollama running? (Start it, or run `ollama serve`.)"),
        }),
    }
}

#[tauri::command]
pub async fn ollama_list_models(server_url: String) -> Result<Vec<String>, String> {
    let client = ollama_http_client()?;
    let url = format!("{}/api/tags", server_url.trim_end_matches('/'));
    let response = client.get(&url).send().await.map_err(|error| format!("Could not reach Ollama at {server_url}: {error}"))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() { return Err(format!("Ollama request failed ({status}): {text}")); }
    let value: Value = serde_json::from_str(&text).map_err(|error| format!("Ollama returned unreadable JSON: {error}"))?;
    let models = value.get("models").and_then(Value::as_array).ok_or("Ollama response did not include a models list")?;
    Ok(models.iter().filter_map(|model| model.get("name").and_then(Value::as_str).map(str::to_owned)).collect())
}

/// Plain non-streaming text generation via Ollama's /api/generate. `system` sets the task/context
/// instructions (World Bible, scene state, target model idiom); `prompt` is the user's own concept.
/// stream:false so the whole response comes back as one JSON object rather than needing an SSE
/// reader on the frontend — acceptable latency here since this is a short creative-writing call,
/// not a long-form chat response.
#[tauri::command]
pub async fn ollama_generate(server_url: String, model: String, system: String, prompt: String) -> Result<String, String> {
    if model.trim().is_empty() { return Err("No Ollama model selected — pick one in Settings.".into()); }
    let client = ollama_http_client()?;
    let url = format!("{}/api/generate", server_url.trim_end_matches('/'));
    let body = serde_json::json!({ "model": model, "system": system, "prompt": prompt, "stream": false });
    let response = client.post(&url).json(&body).send().await.map_err(|error| {
        format!("Could not reach Ollama at {server_url}: {error}. Is Ollama running?")
    })?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() { return Err(format!("Ollama request failed ({status}): {text}")); }
    let value: Value = serde_json::from_str(&text).map_err(|error| format!("Ollama returned unreadable JSON: {error}"))?;
    let response_text = value.get("response").and_then(Value::as_str).ok_or_else(|| format!("Ollama did not return a text response: {value}"))?;
    if response_text.trim().is_empty() { return Err("Ollama returned an empty response.".into()); }
    Ok(response_text.to_owned())
}
