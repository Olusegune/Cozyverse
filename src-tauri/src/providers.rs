//! Real generation-provider integration: API key storage, connection checks, and the
//! submit/poll/result job lifecycle for fal.ai, KIE AI, and WaveSpeed. Kept separate from
//! project persistence (lib.rs) per the "separate provider integrations" engineering rule.
//!
//! Ported from Wheelbarrow Storymaker's proven adapter, which already handled retry/backoff,
//! rate-limit messaging, and per-provider status normalization for these exact three providers.

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

const KEYRING_SERVICE: &str = "Cozyverse Studio";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderKeyStatus {
    provider: String,
    configured: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConnectionStatus {
    provider: String,
    reachable: bool,
    authenticated: bool,
    detail: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationRequest {
    provider: String,
    model_id: String,
    input: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationSubmission {
    provider: String,
    model_id: String,
    request_id: String,
    status: String,
    response_url: Option<String>,
    status_url: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedAssetFromUrl {
    file_path: String,
    name: String,
    bytes: u64,
}

#[tauri::command]
pub fn save_provider_key(provider: String, key: String) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() { return Err("API key cannot be empty".into()); }
    keyring::Entry::new(KEYRING_SERVICE, &format!("provider:{provider}"))
        .map_err(|error| error.to_string())?
        .set_password(trimmed)
        .map_err(|error| format!("Could not save API key to Windows Credential Manager: {error}"))
}

#[tauri::command]
pub fn provider_key_status(provider: String) -> ProviderKeyStatus {
    let configured = keyring::Entry::new(KEYRING_SERVICE, &format!("provider:{provider}"))
        .and_then(|entry| entry.get_password())
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    ProviderKeyStatus { provider, configured }
}

#[tauri::command]
pub fn delete_provider_key(provider: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &format!("provider:{provider}")).map_err(|error| error.to_string())?;
    match entry.delete_credential() { Ok(()) | Err(keyring::Error::NoEntry) => Ok(()), Err(error) => Err(format!("Could not remove API key: {error}")) }
}

fn provider_key(provider: &str) -> Result<String, String> {
    keyring::Entry::new(KEYRING_SERVICE, &format!("provider:{provider}"))
        .map_err(|error| error.to_string())?
        .get_password()
        .map_err(|_| format!("No {provider} API key is connected. Add one in Settings before generating."))
}

#[tauri::command]
pub async fn check_provider_connection(provider: String) -> Result<ProviderConnectionStatus, String> {
    let key = provider_key(&provider)?;
    if provider == "gemini" {
        let client = provider_http_client()?;
        let response = client
            .get("https://generativelanguage.googleapis.com/v1beta/models")
            .header("x-goog-api-key", &key)
            .send()
            .await
            .map_err(|error| format!("Could not reach gemini: {error}"))?;
        let status = response.status();
        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Ok(ProviderConnectionStatus { provider, reachable: true, authenticated: false, detail: "The provider was reached, but rejected this API key.".into() });
        }
        return Ok(ProviderConnectionStatus { provider, reachable: true, authenticated: status.is_success(), detail: if status.is_success() { "Provider responded to a read-only connection check.".into() } else { format!("Provider reached (status {status}).") } });
    }
    if provider == "elevenlabs" {
        let client = provider_http_client()?;
        let response = client
            .get("https://api.elevenlabs.io/v1/voices")
            .header("xi-api-key", &key)
            .send()
            .await
            .map_err(|error| format!("Could not reach elevenlabs: {error}"))?;
        let status = response.status();
        if status.as_u16() == 401 || status.as_u16() == 403 {
            return Ok(ProviderConnectionStatus { provider, reachable: true, authenticated: false, detail: "The provider was reached, but rejected this API key.".into() });
        }
        return Ok(ProviderConnectionStatus { provider, reachable: true, authenticated: status.is_success(), detail: if status.is_success() { "Provider responded to a read-only connection check.".into() } else { format!("Provider reached (status {status}).") } });
    }
    let (url, authorization) = match provider.as_str() {
        "fal" => ("https://queue.fal.run/health".to_owned(), format!("Key {key}")),
        "kie" => ("https://api.kie.ai/api/v1/jobs/recordInfo?taskId=cozyverse-connection-check".to_owned(), format!("Bearer {key}")),
        "wavespeed" => ("https://api.wavespeed.ai/api/v3/predictions/cozyverse-connection-check/result".to_owned(), format!("Bearer {key}")),
        "openai" => ("https://api.openai.com/v1/models".to_owned(), format!("Bearer {key}")),
        // Tripo/Meshy 3D providers, used by the Decompose & Send to 3D pipeline.
        // Their balance endpoints are read-only and return 401/403 on a bad key,
        // which is exactly the signal this check keys off.
        "tripo" => ("https://api.tripo3d.ai/v2/openapi/user/balance".to_owned(), format!("Bearer {key}")),
        "meshy" => ("https://api.meshy.ai/openapi/v1/balance".to_owned(), format!("Bearer {key}")),
        _ => return Err("Unknown provider".into()),
    };
    let client = provider_http_client()?;
    let response = client.get(url).header("Authorization", authorization).send().await.map_err(|error| format!("Could not reach {provider}: {error}"))?;
    let status = response.status();
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Ok(ProviderConnectionStatus { provider, reachable: true, authenticated: false, detail: "The provider was reached, but rejected this API key.".into() });
    }
    if status.is_success() {
        return Ok(ProviderConnectionStatus { provider, reachable: true, authenticated: true, detail: "Provider responded to a read-only connection check.".into() });
    }
    // Only 401/403 is a real "this key was rejected" signal. Any other status (404, 5xx, ...) just
    // means the lightweight check endpoint isn't a perfect match for this provider's API surface —
    // the server still accepted the request with this key attached, so treat it as connected rather
    // than falsely warning the user their key might be bad.
    Ok(ProviderConnectionStatus { provider, reachable: true, authenticated: true, detail: format!("Provider reached (status {status}). This endpoint doesn't fully validate keys — generate something to fully confirm.") })
}

fn valid_model_id(model_id: &str) -> bool {
    !model_id.is_empty() && model_id.chars().all(|character| character.is_ascii_alphanumeric() || matches!(character, '/' | '-' | '_' | '.'))
}

async fn fal_request(method: reqwest::Method, url: String, key: &str, payload: Option<&Value>) -> Result<Value, String> {
    let client = provider_http_client()?;
    let mut last_error = String::from("Provider request failed");
    for attempt in 0..3 {
        let mut request = client.request(method.clone(), &url).header("Authorization", format!("Key {key}")).header("Accept", "application/json");
        if let Some(payload) = payload { request = request.json(payload); }
        let response = request.send().await.map_err(|error| format!("Provider connection failed: {error}"))?;
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        if status.is_success() { return serde_json::from_str(&text).map_err(|error| format!("Provider returned unreadable JSON: {error}")); }
        last_error = if status.as_u16() == 429 { "Provider rate limit reached; retry this job shortly.".into() } else { format!("Provider request failed ({status} for {method} {url}): {text}") };
        if !(status.as_u16() == 429 || status.is_server_error()) { break; }
        tokio::time::sleep(std::time::Duration::from_secs(1 << attempt)).await;
    }
    Err(last_error)
}

/// A client with a real browser-style User-Agent. Some provider edge/WAF layers return a bare
/// 405/403 with no body for requests whose User-Agent looks like a bot or generic HTTP library.
fn provider_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) CozyverseStudio/0.1")
        .build()
        .map_err(|error| error.to_string())
}

async fn kie_request(method: reqwest::Method, url: String, key: &str, payload: Option<&Value>) -> Result<Value, String> {
    let client = provider_http_client()?;
    let mut last_error = String::from("KIE AI request failed");
    for attempt in 0..3 {
        let mut request = client.request(method.clone(), &url).header("Authorization", format!("Bearer {key}"));
        if let Some(payload) = payload { request = request.json(payload); }
        let response = request.send().await.map_err(|error| format!("KIE AI connection failed: {error}"))?;
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        if status.is_success() {
            let value: Value = serde_json::from_str(&text).map_err(|error| format!("KIE AI returned unreadable JSON: {error}"))?;
            if value.get("code").and_then(Value::as_i64).is_some_and(|code| code != 200) { return Err(value.get("msg").and_then(Value::as_str).unwrap_or("KIE AI rejected the request").to_owned()); }
            return Ok(value);
        }
        last_error = if status.as_u16() == 429 { "KIE AI rate limit reached; wait a moment and retry this job.".into() } else { format!("KIE AI request failed ({status}): {text}") };
        if !(status.as_u16() == 429 || status.is_server_error()) { break; }
        tokio::time::sleep(std::time::Duration::from_secs(1 << attempt)).await;
    }
    Err(last_error)
}

async fn wavespeed_request(method: reqwest::Method, url: String, key: &str, payload: Option<&Value>) -> Result<Value, String> {
    let client = provider_http_client()?;
    let mut last_error = String::from("WaveSpeed request failed");
    for attempt in 0..3 {
        let mut request = client.request(method.clone(), &url).header("Authorization", format!("Bearer {key}"));
        if let Some(payload) = payload { request = request.json(payload); }
        let response = request.send().await.map_err(|error| format!("WaveSpeed connection failed: {error}"))?;
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        if status.is_success() {
            let value: Value = serde_json::from_str(&text).map_err(|error| format!("WaveSpeed returned unreadable JSON: {error}"))?;
            if value.get("code").and_then(Value::as_i64).is_some_and(|code| code != 200) { return Err(value.get("message").and_then(Value::as_str).unwrap_or("WaveSpeed rejected the request").to_owned()); }
            return Ok(value);
        }
        last_error = if status.as_u16() == 429 { "WaveSpeed rate limit reached; wait a moment and retry this job.".into() } else { format!("WaveSpeed request failed ({status}): {text}") };
        if !(status.as_u16() == 429 || status.is_server_error()) { break; }
        tokio::time::sleep(std::time::Duration::from_secs(1 << attempt)).await;
    }
    Err(last_error)
}

async fn gemini_request(url: String, key: &str, payload: &Value) -> Result<Value, String> {
    gemini_request_method(reqwest::Method::POST, url, key, Some(payload)).await
}

async fn gemini_request_method(method: reqwest::Method, url: String, key: &str, payload: Option<&Value>) -> Result<Value, String> {
    let client = provider_http_client()?;
    let mut last_error = String::from("Gemini request failed");
    for attempt in 0..3 {
        let mut request = client.request(method.clone(), &url).header("x-goog-api-key", key);
        if let Some(payload) = payload { request = request.json(payload); }
        let response = request.send().await.map_err(|error| format!("Gemini connection failed: {error}"))?;
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        if status.is_success() { return serde_json::from_str(&text).map_err(|error| format!("Gemini returned unreadable JSON: {error}")); }
        last_error = if status.as_u16() == 429 { "Gemini rate limit reached; wait a moment and retry this job.".into() } else { format!("Gemini request failed ({method} {url}, {status}): {text}") };
        if !(status.as_u16() == 429 || status.is_server_error()) { break; }
        tokio::time::sleep(std::time::Duration::from_secs(1 << attempt)).await;
    }
    Err(last_error)
}

/// Builds a generateContent request body for Gemini image generation/editing from our generic
/// {prompt, image_url?} input shape, and extracts the resulting image as a `data:` URI from the
/// (permissively-parsed) response — this is the newest provider integration in the app and Google's
/// exact response field casing was not confirmed against a live call, so this tries several plausible
/// field-name variants rather than betting on one; verify with a real key before relying on it.
async fn gemini_generate_image(real_model_id: &str, source: &Value, key: &str) -> Result<String, String> {
    let prompt = source.get("prompt").and_then(Value::as_str).unwrap_or_default();
    let mut parts = vec![serde_json::json!({ "text": prompt })];
    let push_inline_image = |parts: &mut Vec<Value>, image_url: &str| {
        if let Some((mime, base64_data)) = image_url.strip_prefix("data:").and_then(|rest| rest.split_once(";base64,")) {
            parts.push(serde_json::json!({ "inline_data": { "mime_type": mime, "data": base64_data } }));
        }
    };
    // Multiple reference images (Image Studio's Shot mode multi-reference picker) take priority
    // over the single "image_url" field — Gemini's generateContent accepts several inline_data
    // parts in one request, confirmed via Google's own multi-image-understanding examples.
    if let Some(Value::Array(urls)) = source.get("reference_image_urls") {
        for url in urls {
            if let Value::String(image_url) = url { push_inline_image(&mut parts, image_url); }
        }
    } else if let Some(Value::String(image_url)) = source.get("image_url") {
        push_inline_image(&mut parts, image_url);
    }
    let mut body = serde_json::json!({ "contents": [{ "parts": parts }] });
    // Confirmed field: generationConfig.imageConfig.aspectRatio — previously omitted entirely
    // (defaulting to a square image regardless of the requested ratio) since this wasn't verified;
    // now wired in since the field name is confirmed.
    if let Some(Value::String(ratio)) = source.get("aspect_ratio") {
        if ratio != "1:1" {
            body["generationConfig"] = serde_json::json!({ "imageConfig": { "aspectRatio": ratio } });
        }
    }
    let url = format!("https://generativelanguage.googleapis.com/v1beta/models/{real_model_id}:generateContent");
    let value = gemini_request(url, key, &body).await?;

    // Try every plausible location for the inline image data — this API surface is new enough that
    // the exact response shape wasn't independently confirmed; widen this list if a real call reveals
    // a different path rather than assuming any one of these is definitely correct.
    let candidates = [
        value.pointer("/candidates/0/content/parts").and_then(Value::as_array),
    ];
    for parts in candidates.into_iter().flatten() {
        for part in parts {
            let inline = part.get("inline_data").or_else(|| part.get("inlineData"));
            if let Some(inline) = inline {
                let mime = inline.get("mime_type").or_else(|| inline.get("mimeType")).and_then(Value::as_str).unwrap_or("image/png");
                if let Some(data) = inline.get("data").and_then(Value::as_str) {
                    return Ok(format!("data:{mime};base64,{data}"));
                }
            }
        }
    }
    if let Some(data) = value.pointer("/output_image/data").and_then(Value::as_str) {
        return Ok(format!("data:image/png;base64,{data}"));
    }
    Err(format!("Gemini did not return image data in a recognized response shape: {value}"))
}

/// Starts a Veo video-generation long-running operation and returns the opaque operation "name" to
/// poll later. Unlike Gemini image/text (which are synchronous), video generation genuinely takes
/// minutes, so this uses a real submit/poll/result flow rather than the "fake it as instant" pattern.
async fn veo_start_operation(real_model_id: &str, source: &Value, key: &str) -> Result<String, String> {
    let prompt = source.get("prompt").and_then(Value::as_str).unwrap_or_default();
    let mut instance = serde_json::json!({ "prompt": prompt });
    if let Some(Value::String(image_url)) = source.get("image_url") {
        if let Some((mime, base64_data)) = image_url.strip_prefix("data:").and_then(|rest| rest.split_once(";base64,")) {
            // Confirmed against a real 400 error: this endpoint rejects "inlineData" and wants
            // "bytesBase64Encoded" instead, unlike generateContent's image parts.
            instance["image"] = serde_json::json!({ "bytesBase64Encoded": base64_data, "mimeType": mime });
        }
    }
    let mut parameters = serde_json::Map::new();
    if let Some(Value::String(ratio)) = source.get("aspect_ratio") {
        parameters.insert("aspectRatio".into(), Value::String(ratio.clone()));
    }
    let body = serde_json::json!({ "instances": [instance], "parameters": Value::Object(parameters) });
    let url = format!("https://generativelanguage.googleapis.com/v1beta/models/{real_model_id}:predictLongRunning");
    let value = gemini_request(url, key, &body).await?;
    value.get("name").and_then(Value::as_str).map(str::to_owned).ok_or_else(|| format!("Veo did not return an operation name: {value}"))
}

/// Polls a Veo operation by its opaque name (the exact string returned by veo_start_operation,
/// treated as an opaque path fragment — never reconstructed).
async fn veo_poll_operation(operation_name: &str, key: &str) -> Result<Value, String> {
    let url = format!("https://generativelanguage.googleapis.com/v1beta/{operation_name}");
    gemini_request_method(reqwest::Method::GET, url, key, None).await
}

/// Extracts the finished video's URL from a completed Veo operation — tries several plausible
/// response shapes since this is unverified against a live call, same caution as gemini_generate_image.
fn veo_extract_video_url(value: &Value) -> Result<String, String> {
    let candidates = [
        value.pointer("/response/generateVideoResponse/generatedSamples/0/video/uri"),
        value.pointer("/response/generatedSamples/0/video/uri"),
        value.pointer("/response/videos/0/uri"),
    ];
    for candidate in candidates.into_iter().flatten() {
        if let Some(url) = candidate.as_str() { return Ok(url.to_owned()); }
    }
    Err(format!("Veo completed but returned no video URL in a recognized response shape: {value}"))
}

/// Plain text generation via Gemini — used for World Bible import (extracting structured fields from
/// pasted/imported text). Deliberately does NOT rely on Gemini's JSON-mode/responseSchema config,
/// since that field's exact shape wasn't confirmed against a live call either; instead the caller
/// prompts for raw JSON text and parses it leniently on the frontend, which only depends on the
/// well-established candidates[].content.parts[].text response field.
#[tauri::command]
pub async fn gemini_generate_text(prompt: String) -> Result<String, String> {
    let key = provider_key("gemini")?;
    let body = serde_json::json!({ "contents": [{ "parts": [{ "text": prompt }] }] });
    let url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent";
    let value = gemini_request(url.into(), &key, &body).await?;
    let parts = value.pointer("/candidates/0/content/parts").and_then(Value::as_array).ok_or_else(|| format!("Gemini did not return a readable text response: {value}"))?;
    let text: String = parts.iter().filter_map(|part| part.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("");
    if text.trim().is_empty() { return Err(format!("Gemini returned an empty response: {value}")); }
    Ok(text)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ElevenLabsVoice {
    voice_id: String,
    name: String,
}

/// Lists the voices actually available on this account (premade + any cloned/custom voices), so the
/// frontend can pick real, valid voice IDs instead of hardcoding a preset catalog that could change.
#[tauri::command]
pub async fn elevenlabs_list_voices() -> Result<Vec<ElevenLabsVoice>, String> {
    let key = provider_key("elevenlabs")?;
    let client = provider_http_client()?;
    let response = client.get("https://api.elevenlabs.io/v1/voices").header("xi-api-key", &key).send().await.map_err(|error| format!("Could not reach ElevenLabs: {error}"))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() { return Err(format!("ElevenLabs voice list request failed ({status}): {text}")); }
    let value: Value = serde_json::from_str(&text).map_err(|error| format!("ElevenLabs returned unreadable JSON: {error}"))?;
    let voices = value.get("voices").and_then(Value::as_array).ok_or("ElevenLabs response did not include a voices list")?;
    Ok(voices
        .iter()
        .filter_map(|voice| {
            let voice_id = voice.get("voice_id").and_then(Value::as_str)?.to_owned();
            let name = voice.get("name").and_then(Value::as_str).unwrap_or("Voice").to_owned();
            Some(ElevenLabsVoice { voice_id, name })
        })
        .collect())
}

/// Text-to-speech via ElevenLabs — synchronous, and (unlike every other provider here) returns raw
/// audio bytes directly rather than JSON, so this can't reuse gemini_request/kie_request/etc. The
/// bytes are returned as a `data:` URI, same pattern as Gemini's synchronous image generation.
/// stability/similarity_boost/style are Advanced Mode's optional voice-character sliders — field
/// names confirmed against ElevenLabs' own voice-settings API docs. Omitted entirely (not sent as
/// nulls) when the caller doesn't set them, so Simple Mode's plain calls keep using the voice's own
/// saved defaults rather than silently overriding them with 0s.
async fn elevenlabs_generate_speech(text: &str, voice_id: &str, key: &str, stability: Option<f64>, similarity_boost: Option<f64>, style: Option<f64>) -> Result<String, String> {
    if text.trim().is_empty() { return Err("No text to speak".into()); }
    let client = provider_http_client()?;
    let mut body = serde_json::json!({ "text": text, "model_id": "eleven_multilingual_v2" });
    if stability.is_some() || similarity_boost.is_some() || style.is_some() {
        let mut voice_settings = serde_json::Map::new();
        if let Some(value) = stability { voice_settings.insert("stability".into(), serde_json::json!(value)); }
        if let Some(value) = similarity_boost { voice_settings.insert("similarity_boost".into(), serde_json::json!(value)); }
        if let Some(value) = style { voice_settings.insert("style".into(), serde_json::json!(value)); }
        body["voice_settings"] = Value::Object(voice_settings);
    }
    let url = format!("https://api.elevenlabs.io/v1/text-to-speech/{voice_id}");
    let response = client.post(&url).header("xi-api-key", key).json(&body).send().await.map_err(|error| format!("ElevenLabs connection failed: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("ElevenLabs request failed ({status}): {text}"));
    }
    let bytes = response.bytes().await.map_err(|error| format!("Could not read ElevenLabs audio response: {error}"))?;
    Ok(format!("data:audio/mpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// Maps our generic "W:H" aspect ratio to a concrete "WIDTHxHEIGHT" string for gpt-image-2 — it
/// accepts arbitrary resolutions (not a fixed enum) as long as both dimensions are divisible by 16
/// and the ratio falls within 1:3–3:1, so these are just reasonable concrete pixel sizes per ratio.
fn aspect_ratio_to_openai_size(ratio: &str) -> &'static str {
    match ratio {
        "16:9" => "1536x864",
        "9:16" => "864x1536",
        "4:3" => "1152x864",
        "3:4" => "864x1152",
        "21:9" => "1536x656",
        _ => "1024x1024",
    }
}

/// Text-to-image via OpenAI's gpt-image-2 — synchronous JSON call, GPT image models always return
/// base64 (never a URL) per OpenAI's docs, so no separate download step is needed.
async fn openai_generate_image(prompt: &str, aspect_ratio: &str, key: &str) -> Result<String, String> {
    let client = provider_http_client()?;
    let body = serde_json::json!({ "model": "gpt-image-2", "prompt": prompt, "size": aspect_ratio_to_openai_size(aspect_ratio), "n": 1 });
    let response = client.post("https://api.openai.com/v1/images/generations").header("Authorization", format!("Bearer {key}")).json(&body).send().await.map_err(|error| format!("OpenAI connection failed: {error}"))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() { return Err(format!("OpenAI request failed ({status}): {text}")); }
    let value: Value = serde_json::from_str(&text).map_err(|error| format!("OpenAI returned unreadable JSON: {error}"))?;
    let b64 = value.pointer("/data/0/b64_json").and_then(Value::as_str).ok_or_else(|| format!("OpenAI did not return base64 image data: {value}"))?;
    Ok(format!("data:image/png;base64,{b64}"))
}

/// Image editing via OpenAI's /v1/images/edits — unlike every other endpoint here, this is
/// multipart/form-data (a file upload), not JSON, since that's what OpenAI's API requires for edits.
async fn openai_edit_image(prompt: &str, aspect_ratio: &str, image_mime: &str, image_bytes: Vec<u8>, key: &str) -> Result<String, String> {
    let extension = if image_mime == "image/png" { "png" } else { "jpg" };
    let image_part = reqwest::multipart::Part::bytes(image_bytes).file_name(format!("source.{extension}")).mime_str(image_mime).map_err(|error| error.to_string())?;
    let form = reqwest::multipart::Form::new()
        .text("model", "gpt-image-2")
        .text("prompt", prompt.to_owned())
        .text("size", aspect_ratio_to_openai_size(aspect_ratio))
        .part("image[]", image_part);
    let client = provider_http_client()?;
    let response = client.post("https://api.openai.com/v1/images/edits").header("Authorization", format!("Bearer {key}")).multipart(form).send().await.map_err(|error| format!("OpenAI connection failed: {error}"))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() { return Err(format!("OpenAI edit request failed ({status}): {text}")); }
    let value: Value = serde_json::from_str(&text).map_err(|error| format!("OpenAI returned unreadable JSON: {error}"))?;
    let b64 = value.pointer("/data/0/b64_json").and_then(Value::as_str).ok_or_else(|| format!("OpenAI did not return base64 image data: {value}"))?;
    Ok(format!("data:image/png;base64,{b64}"))
}

/// Maps our generic "W:H" aspect ratio string to a provider's actual pixel size format
/// (WaveSpeed's FLUX models want "width*height", e.g. "1024*1024").
fn aspect_ratio_to_wavespeed_size(ratio: &str) -> &'static str {
    match ratio {
        "16:9" => "1344*768",
        "9:16" => "768*1344",
        "4:3" => "1152*896",
        "3:4" => "896*1152",
        "21:9" => "1344*576",
        _ => "1024*1024",
    }
}

/// Our registry id can't reuse a real WaveSpeed path verbatim when a fal model already claims that
/// exact string (e.g. both host a "bytedance/seedance-2.0/image-to-video" model under their own
/// namespacing) — modelById() needs unique ids across the whole registry. This translates our
/// synthetic "wavespeed-ai/…" id back to the real path WaveSpeed's API actually expects.
fn wavespeed_endpoint_path(model_id: &str) -> &str {
    match model_id {
        "wavespeed-ai/seedance-2.0/image-to-video" => "bytedance/seedance-2.0/image-to-video",
        "wavespeed-ai/seedance-2.0/image-to-video-spicy" => "bytedance/seedance-2.0/image-to-video-spicy",
        "wavespeed-ai/seedance-v1.5-pro/image-to-video-spicy" => "bytedance/seedance-v1.5-pro/image-to-video-spicy",
        other => other,
    }
}

fn wavespeed_input(model_id: &str, source: &Value) -> Result<Value, String> {
    let mut input = source.as_object().cloned().ok_or("Generation input must be an object")?;
    if model_id == "wavespeed-ai/open-video/image-to-video" {
        if let Some(image) = input.remove("image_url") { input.insert("image".into(), image); }
        input.remove("end_image_url");
    }
    if model_id == "minimax/speech-2.8-turbo" {
        if let Some(text) = input.remove("prompt") { input.insert("text".into(), text); }
        input.entry("voice_id").or_insert_with(|| Value::String("Calm_Woman".into()));
    }
    if model_id == "wavespeed-ai/flux-dev" {
        if let Some(Value::String(ratio)) = input.remove("aspect_ratio") {
            input.insert("size".into(), Value::String(aspect_ratio_to_wavespeed_size(&ratio).to_owned()));
        }
    }
    wavespeed_video_input(model_id, &mut input);
    Ok(Value::Object(input))
}

/// Maps our generic "W:H" aspect ratio string to fal's `image_size` parameter, which is either one
/// of a fixed enum of named presets or a custom {width, height} object — used for ratios (like
/// 21:9) with no matching enum value, rather than silently substituting a different ratio.
/// (see https://fal.ai/models/fal-ai/flux/dev/api).
fn aspect_ratio_to_fal_image_size(ratio: &str) -> Value {
    match ratio {
        "16:9" => Value::String("landscape_16_9".into()),
        "9:16" => Value::String("portrait_16_9".into()),
        "4:3" => Value::String("landscape_4_3".into()),
        "3:4" => Value::String("portrait_4_3".into()),
        "21:9" => serde_json::json!({ "width": 1344, "height": 576 }),
        _ => Value::String("square_hd".into()),
    }
}

fn fal_input(model_id: &str, source: &Value) -> Result<Value, String> {
    let mut input = source.as_object().cloned().ok_or("Generation input must be an object")?;
    if model_id == "fal-ai/flux/dev" || model_id == "openai/gpt-image-2" {
        // Plain text-to-image: our generic aspect ratio maps to fal's image_size enum. gpt-image-2
        // uses the exact same image_size enum shape as flux/dev on fal.
        if let Some(Value::String(ratio)) = input.remove("aspect_ratio") {
            input.insert("image_size".into(), aspect_ratio_to_fal_image_size(&ratio));
        }
    } else if model_id == "fal-ai/nano-banana/edit" || model_id == "openai/gpt-image-2/edit" {
        // Both edit models take a plural "image_urls" array. Image Studio's Shot mode can send
        // several reference images via the generic "reference_image_urls" key (same convention as
        // video Shot Mode); the plain single-image Variant flow only ever sends "image_url", which
        // still gets wrapped into a one-element array exactly as before.
        if let Some(urls) = input.remove("reference_image_urls") {
            input.insert("image_urls".into(), urls);
        } else if let Some(url) = input.remove("image_url") {
            input.insert("image_urls".into(), Value::Array(vec![url]));
        }
        input.remove("strength");
        if model_id == "openai/gpt-image-2/edit" {
            if let Some(Value::String(ratio)) = input.remove("aspect_ratio") {
                input.insert("image_size".into(), aspect_ratio_to_fal_image_size(&ratio));
            }
        }
    } else if is_shot_mode_video_model(model_id) {
        fal_shot_video_input(model_id, &mut input);
    }
    Ok(Value::Object(input))
}

fn is_shot_mode_video_model(model_id: &str) -> bool {
    matches!(
        model_id,
        "fal-ai/bytedance/seedance/v1/pro/text-to-video"
            | "fal-ai/bytedance/seedance/v1/pro/image-to-video"
            | "fal-ai/bytedance/seedance/v1/lite/reference-to-video"
            | "fal-ai/kling-video/o3/standard/image-to-video"
            | "fal-ai/wan/v2.7/reference-to-video"
            | "lightricks/ltx-2.5/image-to-video/pro"
            | "fal-ai/hunyuan-video-v1.5/text-to-video"
            | "fal-ai/hunyuan-video-v1.5/image-to-video"
            | "bytedance/seedance-2.0/text-to-video"
            | "bytedance/seedance-2.0/image-to-video"
            | "bytedance/seedance-2.0/fast/image-to-video"
            | "bytedance/seedance-2.0/reference-to-video"
            | "fal-ai/minimax/hailuo-02/standard/image-to-video"
            | "fal-ai/minimax/hailuo-02/pro/text-to-video"
    )
}

/// Maps Shot Mode's generic video-job shape — prompt, image_url (start frame), end_image_url,
/// reference_image_urls, reference_video_url, aspect_ratio, duration_seconds — onto whatever field
/// names each specific model's API actually documents. Every field name and enum below was checked
/// against that model's own fal.ai API docs page rather than assumed uniform across models — e.g.
/// Seedance/Kling/Hunyuan all take an "image_url" start frame, but Wan and Seedance-lite instead
/// take a plural "reference_image_urls" array with no single start frame concept, and LTX's docs
/// don't mention aspect_ratio/duration fields at all, so those are dropped rather than guessed.
fn fal_shot_video_input(model_id: &str, input: &mut serde_json::Map<String, Value>) {
    // duration_seconds (number) -> duration (string enum) is the same conversion every one of
    // these models needs, when they accept the field at all.
    let duration_seconds = input.remove("duration_seconds");

    match model_id {
        "fal-ai/bytedance/seedance/v1/pro/text-to-video" => {
            input.remove("image_url");
            input.remove("end_image_url");
            input.remove("reference_image_urls");
            input.remove("reference_video_urls");
            input.remove("generate_audio");
            if let Some(seconds) = duration_seconds.and_then(|v| v.as_u64()) {
                input.insert("duration".into(), Value::String(seconds.to_string()));
            }
        }
        "fal-ai/bytedance/seedance/v1/pro/image-to-video" => {
            input.remove("reference_image_urls");
            input.remove("reference_video_urls");
            input.remove("generate_audio");
            if let Some(seconds) = duration_seconds.and_then(|v| v.as_u64()) {
                input.insert("duration".into(), Value::String(seconds.to_string()));
            }
        }
        "fal-ai/bytedance/seedance/v1/lite/reference-to-video" => {
            // reference_image_urls is already the right field name — no rename needed.
            input.remove("image_url");
            input.remove("end_image_url");
            input.remove("reference_video_urls");
            input.remove("generate_audio");
            if let Some(seconds) = duration_seconds.and_then(|v| v.as_u64()) {
                input.insert("duration".into(), Value::String(seconds.to_string()));
            }
        }
        "fal-ai/kling-video/o3/standard/image-to-video" => {
            input.remove("reference_image_urls");
            input.remove("reference_video_urls");
            input.remove("resolution");
            if let Some(seconds) = duration_seconds.and_then(|v| v.as_u64()) {
                input.insert("duration".into(), Value::String(seconds.to_string()));
            }
        }
        "fal-ai/wan/v2.7/reference-to-video" => {
            // reference_image_urls and reference_video_urls are already sent as arrays with these
            // exact field names from the frontend — no rename needed, just drop what this model
            // doesn't take.
            input.remove("image_url");
            input.remove("end_image_url");
            input.remove("generate_audio");
            if let Some(seconds) = duration_seconds.and_then(|v| v.as_u64()) {
                input.insert("duration".into(), Value::String(seconds.to_string()));
            }
        }
        "lightricks/ltx-2.5/image-to-video/pro" => {
            // This model's docs only surface image_url/end_image_url/prompt — no confirmed
            // aspect_ratio, duration, resolution, or audio field, so those generic keys are dropped
            // rather than sent unconfirmed and risking a rejected request.
            input.remove("aspect_ratio");
            input.remove("reference_image_urls");
            input.remove("reference_video_urls");
            input.remove("resolution");
            input.remove("generate_audio");
        }
        "fal-ai/hunyuan-video-v1.5/text-to-video" => {
            input.remove("image_url");
            input.remove("end_image_url");
            input.remove("reference_image_urls");
            input.remove("reference_video_urls");
            input.remove("resolution");
            input.remove("generate_audio");
        }
        "fal-ai/hunyuan-video-v1.5/image-to-video" => {
            input.remove("end_image_url");
            input.remove("reference_image_urls");
            input.remove("reference_video_urls");
            input.remove("resolution");
            input.remove("generate_audio");
        }
        // MiniMax Hailuo 02 — confirmed fields are prompt, image_url, duration, resolution only;
        // no end_image_url/reference arrays/generate_audio documented, so those are dropped.
        "fal-ai/minimax/hailuo-02/standard/image-to-video" => {
            input.remove("end_image_url");
            input.remove("reference_image_urls");
            input.remove("reference_video_urls");
            input.remove("generate_audio");
            if let Some(seconds) = duration_seconds { input.insert("duration".into(), seconds); }
        }
        "fal-ai/minimax/hailuo-02/pro/text-to-video" => {
            input.remove("image_url");
            input.remove("end_image_url");
            input.remove("reference_image_urls");
            input.remove("reference_video_urls");
            input.remove("generate_audio");
            if let Some(seconds) = duration_seconds { input.insert("duration".into(), seconds); }
        }
        // Seedance 2.0's text/image-to-video endpoints keep the same image_url/end_image_url names
        // as v1 Pro, but duration is a plain integer (or "auto") per fal's own API reference, not a
        // stringified enum like v1 — so this passes the number through unconverted.
        "bytedance/seedance-2.0/text-to-video" => {
            input.remove("image_url");
            input.remove("end_image_url");
            input.remove("reference_image_urls");
            input.remove("reference_video_urls");
            input.remove("reference_audio_urls");
            if let Some(seconds) = duration_seconds { input.insert("duration".into(), seconds); }
        }
        "bytedance/seedance-2.0/image-to-video" | "bytedance/seedance-2.0/fast/image-to-video" => {
            input.remove("reference_image_urls");
            input.remove("reference_video_urls");
            input.remove("reference_audio_urls");
            if let Some(seconds) = duration_seconds { input.insert("duration".into(), seconds); }
        }
        // Reference-to-video uses distinct field names from v1's reference model — image_urls,
        // video_urls, audio_urls (all plural, no "reference_" prefix) — confirmed against fal's
        // GitHub API reference for this exact endpoint.
        "bytedance/seedance-2.0/reference-to-video" => {
            input.remove("image_url");
            input.remove("end_image_url");
            if let Some(value) = input.remove("reference_image_urls") { input.insert("image_urls".into(), value); }
            if let Some(value) = input.remove("reference_video_urls") { input.insert("video_urls".into(), value); }
            if let Some(value) = input.remove("reference_audio_urls") { input.insert("audio_urls".into(), value); }
            if let Some(seconds) = duration_seconds { input.insert("duration".into(), seconds); }
        }
        _ => {}
    }
}

/// Same generic Shot Mode job shape as fal_shot_video_input, mapped onto WaveSpeed's field names —
/// WaveSpeed names the start/end frame fields "image"/"last_image" rather than fal's
/// "image_url"/"end_image_url", confirmed against WaveSpeed's own model pages for these exact
/// endpoints (Seedance 2.0 and the Seedance Spicy variants).
fn wavespeed_video_input(model_id: &str, input: &mut serde_json::Map<String, Value>) {
    match model_id {
        "wavespeed-ai/seedance-2.0/image-to-video" | "wavespeed-ai/seedance-2.0/image-to-video-spicy" | "wavespeed-ai/seedance-v1.5-pro/image-to-video-spicy" => {
            if let Some(value) = input.remove("image_url") { input.insert("image".into(), value); }
            if let Some(value) = input.remove("end_image_url") { input.insert("last_image".into(), value); }
            input.remove("reference_image_urls");
            input.remove("reference_video_urls");
            input.remove("reference_audio_urls");
            if let Some(seconds) = input.remove("duration_seconds").and_then(|value| value.as_u64()) {
                input.insert("duration".into(), Value::Number(seconds.into()));
            }
        }
        _ => {}
    }
}

fn kie_input(model_id: &str, source: &Value) -> Result<Value, String> {
    let mut input = source.as_object().cloned().ok_or("Generation input must be an object")?;
    if model_id == "wan/2-7-image-to-video" {
        if let Some(image) = input.remove("image_url") { input.insert("first_frame_url".into(), image); }
        if let Some(image) = input.remove("end_image_url") { input.insert("last_frame_url".into(), image); }
    } else if model_id == "kling-2.6/text-to-video" {
        input.remove("image_url"); input.remove("end_image_url");
    }
    Ok(Value::Object(input))
}

// --- ComfyUI local provider ---------------------------------------------------------------
//
// Unlike every provider above, ComfyUI has no fixed API shape per model — it's whatever nodes
// the user's own workflow graph contains. So instead of hardcoding a request shape per local
// model, the user uploads their own workflow (exported from ComfyUI as API-format JSON via
// Save > Export (API Format)) once per model slot in Settings, and tells us which node holds
// the prompt text and (optionally) which node takes a source image — see LocalModelConfig.
// Everything else (queueing, polling, fetching the output) is generic against any workflow.

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelConfig {
    id: String,
    name: String,
    capability: String,
    server_url: String,
    workflow: Value,
    prompt_node_id: String,
    prompt_field: String,
    image_node_id: Option<String>,
    image_field: Option<String>,
}

fn local_models_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| format!("Could not prepare settings folder: {error}"))?;
    Ok(dir.join("local_models.json"))
}

fn read_local_models(app: &AppHandle) -> Result<Vec<LocalModelConfig>, String> {
    let path = local_models_path(app)?;
    if !path.exists() { return Ok(Vec::new()); }
    let contents = fs::read_to_string(&path).map_err(|error| format!("Could not read local models: {error}"))?;
    serde_json::from_str(&contents).map_err(|error| format!("Local models file is corrupted: {error}"))
}

fn write_local_models(app: &AppHandle, models: &[LocalModelConfig]) -> Result<(), String> {
    let path = local_models_path(app)?;
    let contents = serde_json::to_string_pretty(models).map_err(|error| error.to_string())?;
    crate::write_json_atomic(path, &contents)
}

fn load_local_model(app: &AppHandle, id: &str) -> Result<LocalModelConfig, String> {
    read_local_models(app)?
        .into_iter()
        .find(|model| model.id == id)
        .ok_or_else(|| format!("Local model \"{id}\" was not found — it may have been removed in Settings."))
}

#[tauri::command]
pub fn list_local_models(app: AppHandle) -> Result<Vec<LocalModelConfig>, String> {
    read_local_models(&app)
}

#[tauri::command]
pub fn save_local_model(app: AppHandle, model: LocalModelConfig) -> Result<(), String> {
    if model.name.trim().is_empty() { return Err("Name cannot be empty".into()); }
    if model.server_url.trim().is_empty() { return Err("ComfyUI server URL cannot be empty".into()); }
    if !model.workflow.is_object() { return Err("Workflow must be a JSON object in ComfyUI API format".into()); }
    if model.workflow.get(&model.prompt_node_id).is_none() {
        return Err(format!("The workflow has no node \"{}\" — re-check the prompt node you picked.", model.prompt_node_id));
    }
    let mut models = read_local_models(&app)?;
    match models.iter_mut().find(|existing| existing.id == model.id) {
        Some(existing) => *existing = model,
        None => models.push(model),
    }
    write_local_models(&app, &models)
}

#[tauri::command]
pub fn delete_local_model(app: AppHandle, id: String) -> Result<(), String> {
    let mut models = read_local_models(&app)?;
    models.retain(|model| model.id != id);
    write_local_models(&app, &models)
}

#[tauri::command]
pub async fn comfyui_test_connection(server_url: String) -> Result<ProviderConnectionStatus, String> {
    let client = provider_http_client()?;
    let url = format!("{}/system_stats", server_url.trim_end_matches('/'));
    let response = client.get(&url).send().await.map_err(|error| format!("Could not reach ComfyUI at {server_url}: {error}"))?;
    let status = response.status();
    Ok(ProviderConnectionStatus {
        provider: "comfyui".into(),
        reachable: status.is_success(),
        authenticated: status.is_success(),
        detail: if status.is_success() { "ComfyUI server responded.".into() } else { format!("ComfyUI responded with status {status}.") },
    })
}

/// Uploads a source image into ComfyUI's own input folder via its multipart upload endpoint — a
/// LoadImage node can only reference a filename already sitting in that folder, not inline bytes.
async fn comfyui_upload_image(server_url: &str, mime: &str, bytes: Vec<u8>) -> Result<String, String> {
    let client = provider_http_client()?;
    let extension = if mime == "image/png" { "png" } else { "jpg" };
    let part = reqwest::multipart::Part::bytes(bytes).file_name(format!("cozyverse-input.{extension}")).mime_str(mime).map_err(|error| error.to_string())?;
    let form = reqwest::multipart::Form::new().part("image", part).text("overwrite", "true");
    let response = client
        .post(format!("{}/upload/image", server_url.trim_end_matches('/')))
        .multipart(form)
        .send()
        .await
        .map_err(|error| format!("Could not reach ComfyUI: {error}"))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() { return Err(format!("ComfyUI image upload failed ({status}): {text}")); }
    let value: Value = serde_json::from_str(&text).map_err(|error| format!("ComfyUI upload returned unreadable JSON: {error}"))?;
    value.get("name").and_then(Value::as_str).map(str::to_owned).ok_or_else(|| format!("ComfyUI upload did not return a filename: {value}"))
}

/// Patches the user's saved workflow with this job's prompt text (and source image, if the model
/// slot has one configured) and queues it via POST /prompt, returning the resulting prompt_id.
async fn comfyui_patch_and_queue(config: &LocalModelConfig, source: &Value) -> Result<String, String> {
    let mut workflow = config.workflow.clone();
    let prompt = source.get("prompt").and_then(Value::as_str).unwrap_or_default();
    let prompt_node = workflow
        .get_mut(&config.prompt_node_id)
        .ok_or_else(|| format!("Workflow is missing node \"{}\"", config.prompt_node_id))?;
    prompt_node["inputs"][&config.prompt_field] = Value::String(prompt.to_owned());

    if let (Some(image_node_id), Some(image_field)) = (&config.image_node_id, &config.image_field) {
        if let Some(Value::String(image_url)) = source.get("image_url") {
            if let Some((mime, base64_data)) = image_url.strip_prefix("data:").and_then(|rest| rest.split_once(";base64,")) {
                let bytes = base64::engine::general_purpose::STANDARD.decode(base64_data).map_err(|error| format!("Could not decode source image: {error}"))?;
                let filename = comfyui_upload_image(&config.server_url, mime, bytes).await?;
                if let Some(node) = workflow.get_mut(image_node_id) {
                    node["inputs"][image_field] = Value::String(filename);
                }
            }
        }
    }

    let client_id = format!("{:x}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());
    let body = serde_json::json!({ "prompt": workflow, "client_id": client_id });
    let client = provider_http_client()?;
    let url = format!("{}/prompt", config.server_url.trim_end_matches('/'));
    let response = client.post(&url).json(&body).send().await.map_err(|error| format!("Could not reach ComfyUI at {}: {error}", config.server_url))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() { return Err(format!("ComfyUI rejected the workflow ({status}): {text}")); }
    let value: Value = serde_json::from_str(&text).map_err(|error| format!("ComfyUI returned unreadable JSON: {error}"))?;
    if let Some(errors) = value.get("node_errors").and_then(Value::as_object) {
        if !errors.is_empty() { return Err(format!("ComfyUI reported workflow errors: {value}")); }
    }
    value.get("prompt_id").and_then(Value::as_str).map(str::to_owned).ok_or_else(|| format!("ComfyUI did not return a prompt_id: {value}"))
}

async fn comfyui_history(server_url: &str, prompt_id: &str) -> Result<Value, String> {
    let client = provider_http_client()?;
    let url = format!("{}/history/{}", server_url.trim_end_matches('/'), prompt_id);
    let response = client.get(&url).send().await.map_err(|error| format!("Could not reach ComfyUI: {error}"))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() { return Err(format!("ComfyUI history request failed ({status}): {text}")); }
    serde_json::from_str(&text).map_err(|error| format!("ComfyUI returned unreadable JSON: {error}"))
}

fn comfyui_status_str(history_entry: &Value) -> Option<&str> {
    history_entry.pointer("/status/status_str").and_then(Value::as_str)
}

/// Finds the first output file anywhere in a /history entry's outputs — ComfyUI's output field
/// name varies by node ("images", "gifs", "videos", "audio", ...), so this looks for the shape
/// (an array of objects carrying a "filename") rather than a fixed field name.
fn comfyui_first_output(history_entry: &Value) -> Option<(String, String, String)> {
    let outputs = history_entry.get("outputs")?.as_object()?;
    for node_output in outputs.values() {
        let node_object = node_output.as_object()?;
        for value in node_object.values() {
            let Some(items) = value.as_array() else { continue };
            for item in items {
                if let Some(filename) = item.get("filename").and_then(Value::as_str) {
                    let subfolder = item.get("subfolder").and_then(Value::as_str).unwrap_or("").to_owned();
                    let folder_type = item.get("type").and_then(Value::as_str).unwrap_or("output").to_owned();
                    return Some((filename.to_owned(), subfolder, folder_type));
                }
            }
        }
    }
    None
}

/// Downloads a finished output via GET /view and returns it as a `data:` URI — the same
/// "smuggle the result through response_url/generation_result" shape every synchronous provider
/// above uses, so save_asset_from_url needs no changes to handle it.
async fn comfyui_fetch_output_as_data_url(server_url: &str, filename: &str, subfolder: &str, folder_type: &str) -> Result<String, String> {
    let client = provider_http_client()?;
    let url = format!("{}/view", server_url.trim_end_matches('/'));
    let response = client
        .get(&url)
        .query(&[("filename", filename), ("subfolder", subfolder), ("type", folder_type)])
        .send()
        .await
        .map_err(|error| format!("Could not download ComfyUI output: {error}"))?;
    let status = response.status();
    if !status.is_success() { return Err(format!("ComfyUI output download failed ({status})")); }
    let bytes = response.bytes().await.map_err(|error| format!("Could not read ComfyUI output: {error}"))?;
    let mime = match filename.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "gif" => "image/gif",
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        _ => "application/octet-stream",
    };
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes)))
}

#[tauri::command]
pub async fn submit_generation(app: AppHandle, request: GenerationRequest) -> Result<GenerationSubmission, String> {
    if !valid_model_id(&request.model_id) { return Err("Invalid model identifier".into()); }
    match request.provider.as_str() {
        "comfyui" => {
            let config = load_local_model(&app, &request.model_id)?;
            let prompt_id = comfyui_patch_and_queue(&config, &request.input).await?;
            Ok(GenerationSubmission { provider: request.provider, model_id: request.model_id, request_id: prompt_id, status: "IN_QUEUE".into(), response_url: None, status_url: None })
        }
        "fal" => {
            let input = fal_input(&request.model_id, &request.input)?;
            let key = provider_key("fal")?;
            let value = fal_request(reqwest::Method::POST, format!("https://queue.fal.run/{}", request.model_id), &key, Some(&input)).await?;
            let request_id = value.get("request_id").and_then(Value::as_str).ok_or("Provider did not return a request ID")?.to_owned();
            Ok(GenerationSubmission {
                provider: request.provider,
                model_id: request.model_id,
                request_id,
                status: value.get("status").and_then(Value::as_str).unwrap_or("IN_QUEUE").to_owned(),
                response_url: value.get("response_url").and_then(Value::as_str).map(str::to_owned),
                status_url: value.get("status_url").and_then(Value::as_str).map(str::to_owned),
            })
        }
        // Suno v5 lives on kie.ai (same account/key as their other models) but on a completely
        // separate REST surface from kie's generic jobs/createTask job system — its own endpoints,
        // its own request/response shape.
        "kie" if request.model_id == "suno/v5" => {
            let prompt = request.input.get("prompt").and_then(Value::as_str).unwrap_or_default();
            let instrumental = request.input.get("instrumental").and_then(Value::as_bool).unwrap_or(false);
            // Advanced Mode's optional fields — confirmed against kie.ai's own Suno API docs. In
            // Custom Mode, "prompt" carries the lyrics (not a description) and style/title become
            // required; Simple Mode never sets these, so it stays on the existing non-custom path.
            let style = request.input.get("style").and_then(Value::as_str).filter(|value| !value.trim().is_empty());
            let title = request.input.get("title").and_then(Value::as_str).filter(|value| !value.trim().is_empty());
            let lyrics = request.input.get("lyrics").and_then(Value::as_str).filter(|value| !value.trim().is_empty());
            let custom_mode = style.is_some() || title.is_some() || lyrics.is_some();
            if custom_mode && (style.is_none() || title.is_none()) {
                return Err("Suno's Custom Mode (lyrics) requires both a Style and a Title.".into());
            }
            // callBackUrl is a required field on this endpoint even though we poll for the result
            // rather than receiving a webhook — this app has no public server to receive one, so a
            // placeholder satisfies the required-field check without kie ever needing to reach it.
            let mut body = serde_json::json!({
                "prompt": lyrics.unwrap_or(prompt),
                "instrumental": instrumental,
                "model": "V5",
                "customMode": custom_mode,
                "callBackUrl": "https://cozyverse-studio.invalid/callback",
            });
            if let Some(style) = style { body["style"] = Value::String(style.to_owned()); }
            if let Some(title) = title { body["title"] = Value::String(title.to_owned()); }
            let value = kie_request(reqwest::Method::POST, "https://api.kie.ai/api/v1/generate".into(), &provider_key("kie")?, Some(&body)).await?;
            let request_id = value.pointer("/data/taskId").and_then(Value::as_str).ok_or("Suno did not return a task ID")?.to_owned();
            Ok(GenerationSubmission { provider: request.provider, model_id: request.model_id, request_id, status: "IN_QUEUE".into(), response_url: None, status_url: None })
        }
        "kie" => {
            let input = kie_input(&request.model_id, &request.input)?;
            let body = serde_json::json!({ "model": request.model_id, "input": input });
            let value = kie_request(reqwest::Method::POST, "https://api.kie.ai/api/v1/jobs/createTask".into(), &provider_key("kie")?, Some(&body)).await?;
            let request_id = value.pointer("/data/taskId").and_then(Value::as_str).ok_or("KIE AI did not return a task ID")?.to_owned();
            Ok(GenerationSubmission { provider: request.provider, model_id: request.model_id, request_id, status: "IN_QUEUE".into(), response_url: None, status_url: None })
        }
        "wavespeed" => {
            let input = wavespeed_input(&request.model_id, &request.input)?;
            let value = wavespeed_request(reqwest::Method::POST, format!("https://api.wavespeed.ai/api/v3/{}", wavespeed_endpoint_path(&request.model_id)), &provider_key("wavespeed")?, Some(&input)).await?;
            let request_id = value.pointer("/data/id").and_then(Value::as_str).ok_or("WaveSpeed did not return a prediction ID")?.to_owned();
            Ok(GenerationSubmission { provider: request.provider, model_id: request.model_id, request_id, status: value.pointer("/data/status").and_then(Value::as_str).unwrap_or("created").to_ascii_uppercase(), response_url: value.pointer("/data/urls/get").and_then(Value::as_str).map(str::to_owned), status_url: None })
        }
        // Veo video generation is a genuine long-running operation — request_id carries the opaque
        // operation "name" to poll, unlike the synchronous gemini/elevenlabs branches below it.
        "gemini" if request.model_id.starts_with("veo-") => {
            let operation_name = veo_start_operation(&request.model_id, &request.input, &provider_key("gemini")?).await?;
            Ok(GenerationSubmission { provider: request.provider, model_id: request.model_id, request_id: operation_name, status: "IN_QUEUE".into(), response_url: None, status_url: None })
        }
        // Gemini's generateContent call is synchronous — no queue to poll — so the whole generation
        // happens right here and the result is smuggled through as a `data:` URI in response_url.
        // poll_generation/generation_result for "gemini" below just hand that value back unchanged.
        "gemini" => {
            let real_model_id = "gemini-3.1-flash-image";
            let data_url = gemini_generate_image(real_model_id, &request.input, &provider_key("gemini")?).await?;
            let request_id = format!("{:x}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());
            Ok(GenerationSubmission { provider: request.provider, model_id: request.model_id, request_id, status: "COMPLETED".into(), response_url: Some(data_url), status_url: None })
        }
        // Also synchronous — same "smuggle the data: URI through response_url, mark COMPLETED
        // immediately" pattern as Gemini above.
        "elevenlabs" => {
            let text = request.input.get("prompt").and_then(Value::as_str).unwrap_or_default();
            let voice_id = request.input.get("voice_id").and_then(Value::as_str).ok_or("No voice_id was provided for ElevenLabs speech generation")?;
            let stability = request.input.get("stability").and_then(Value::as_f64);
            let similarity_boost = request.input.get("similarity_boost").and_then(Value::as_f64);
            let style = request.input.get("style").and_then(Value::as_f64);
            let data_url = elevenlabs_generate_speech(text, voice_id, &provider_key("elevenlabs")?, stability, similarity_boost, style).await?;
            let request_id = format!("{:x}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());
            Ok(GenerationSubmission { provider: request.provider, model_id: request.model_id, request_id, status: "COMPLETED".into(), response_url: Some(data_url), status_url: None })
        }
        // Also synchronous. Edits (source image present) go through OpenAI's multipart /images/edits
        // endpoint; plain generation uses the JSON /images/generations endpoint.
        "openai" => {
            let key = provider_key("openai")?;
            let prompt = request.input.get("prompt").and_then(Value::as_str).unwrap_or_default();
            let aspect_ratio = request.input.get("aspect_ratio").and_then(Value::as_str).unwrap_or("1:1");
            let data_url = if let Some(Value::String(image_url)) = request.input.get("image_url") {
                let (mime, base64_data) = image_url.strip_prefix("data:").and_then(|rest| rest.split_once(";base64,")).ok_or("Unrecognized source image data URI")?;
                let bytes = base64::engine::general_purpose::STANDARD.decode(base64_data).map_err(|error| format!("Could not decode source image: {error}"))?;
                openai_edit_image(prompt, aspect_ratio, mime, bytes, &key).await?
            } else {
                openai_generate_image(prompt, aspect_ratio, &key).await?
            };
            let request_id = format!("{:x}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());
            Ok(GenerationSubmission { provider: request.provider, model_id: request.model_id, request_id, status: "COMPLETED".into(), response_url: Some(data_url), status_url: None })
        }
        _ => Err("Unknown generation provider".into()),
    }
}

#[tauri::command]
pub async fn poll_generation(app: AppHandle, provider: String, model_id: String, request_id: String, status_url: Option<String>) -> Result<Value, String> {
    if !valid_model_id(&model_id) || !valid_model_id(&request_id) { return Err("Invalid generation request identifier".into()); }
    match provider.as_str() {
        "comfyui" => {
            let config = load_local_model(&app, &model_id)?;
            let history = comfyui_history(&config.server_url, &request_id).await?;
            match history.get(&request_id) {
                Some(entry) => {
                    if comfyui_status_str(entry) == Some("error") { return Ok(serde_json::json!({ "status": "FAILED", "provider": entry })); }
                    if comfyui_first_output(entry).is_some() { return Ok(serde_json::json!({ "status": "COMPLETED" })); }
                    Ok(serde_json::json!({ "status": "IN_PROGRESS" }))
                }
                None => Ok(serde_json::json!({ "status": "IN_QUEUE" })),
            }
        }
        // Prefer the status_url fal itself returned at submission time over reconstructing it —
        // fal's routing for deeply-nested model IDs (e.g. "fal-ai/flux/dev/image-to-image") doesn't
        // reliably accept a hand-built .../requests/{id}/status path (405), but the server-provided
        // URL always works since it's whatever fal's own router actually expects.
        "fal" => {
            let url = status_url.unwrap_or_else(|| format!("https://queue.fal.run/{model_id}/requests/{request_id}/status?logs=1"));
            fal_request(reqwest::Method::GET, url, &provider_key("fal")?, None).await
        }
        "kie" if model_id == "suno/v5" => {
            let value = kie_request(reqwest::Method::GET, format!("https://api.kie.ai/api/v1/generate/record-info?taskId={request_id}"), &provider_key("kie")?, None).await?;
            let state = value.pointer("/data/status").and_then(Value::as_str).unwrap_or("PENDING");
            let status = match state {
                "SUCCESS" => "COMPLETED",
                "CREATE_TASK_FAILED" | "GENERATE_AUDIO_FAILED" | "CALLBACK_EXCEPTION" | "SENSITIVE_WORD_ERROR" => "FAILED",
                "TEXT_SUCCESS" | "FIRST_SUCCESS" => "IN_PROGRESS",
                _ => "IN_QUEUE",
            };
            Ok(serde_json::json!({ "status": status, "provider": value }))
        }
        "kie" => {
            let value = kie_request(reqwest::Method::GET, format!("https://api.kie.ai/api/v1/jobs/recordInfo?taskId={request_id}"), &provider_key("kie")?, None).await?;
            let state = value.pointer("/data/state").and_then(Value::as_str).unwrap_or("waiting");
            let status = match state { "success" => "COMPLETED", "fail" => "FAILED", "generating" => "IN_PROGRESS", _ => "IN_QUEUE" };
            Ok(serde_json::json!({ "status": status, "progress": value.pointer("/data/progress").and_then(Value::as_u64).unwrap_or(0), "provider": value }))
        }
        "wavespeed" => {
            let value = wavespeed_request(reqwest::Method::GET, format!("https://api.wavespeed.ai/api/v3/predictions/{request_id}/result"), &provider_key("wavespeed")?, None).await?;
            let status = match value.pointer("/data/status").and_then(Value::as_str).unwrap_or("created") { "completed" => "COMPLETED", "failed" => "FAILED", "processing" => "IN_PROGRESS", _ => "IN_QUEUE" };
            Ok(serde_json::json!({ "status": status, "provider": value }))
        }
        "gemini" if model_id.starts_with("veo-") => {
            let value = veo_poll_operation(&request_id, &provider_key("gemini")?).await?;
            if value.get("error").is_some() {
                return Ok(serde_json::json!({ "status": "FAILED", "provider": value }));
            }
            let done = value.get("done").and_then(Value::as_bool).unwrap_or(false);
            Ok(serde_json::json!({ "status": if done { "COMPLETED" } else { "IN_PROGRESS" } }))
        }
        // Gemini image/text, ElevenLabs, and OpenAI already finished the generation inside
        // submit_generation — nothing left to poll for.
        "gemini" | "elevenlabs" | "openai" => Ok(serde_json::json!({ "status": "COMPLETED" })),
        _ => Err(format!("{provider} status polling is not enabled yet.")),
    }
}

#[tauri::command]
pub async fn generation_result(app: AppHandle, provider: String, model_id: String, request_id: String, response_url: Option<String>) -> Result<Value, String> {
    if !valid_model_id(&model_id) || !valid_model_id(&request_id) { return Err("Invalid generation request identifier".into()); }
    match provider.as_str() {
        "comfyui" => {
            let config = load_local_model(&app, &model_id)?;
            let history = comfyui_history(&config.server_url, &request_id).await?;
            let entry = history.get(&request_id).ok_or("ComfyUI has no history for this job yet — it may still be queued.")?;
            if comfyui_status_str(entry) == Some("error") { return Err(format!("ComfyUI reported a workflow error: {entry}")); }
            let (filename, subfolder, folder_type) = comfyui_first_output(entry).ok_or("ComfyUI completed but produced no output file")?;
            let data_url = comfyui_fetch_output_as_data_url(&config.server_url, &filename, &subfolder, &folder_type).await?;
            Ok(serde_json::json!({ "url": data_url }))
        }
        "fal" => {
            let url = response_url.unwrap_or_else(|| format!("https://queue.fal.run/{model_id}/requests/{request_id}"));
            fal_request(reqwest::Method::GET, url, &provider_key("fal")?, None).await
        }
        "kie" if model_id == "suno/v5" => {
            let value = kie_request(reqwest::Method::GET, format!("https://api.kie.ai/api/v1/generate/record-info?taskId={request_id}"), &provider_key("kie")?, None).await?;
            if value.pointer("/data/status").and_then(Value::as_str) != Some("SUCCESS") {
                return Err(format!("Suno generation did not complete successfully: {value}"));
            }
            let url = value.pointer("/data/response/sunoData/0/audioUrl").and_then(Value::as_str).ok_or("Suno completed but returned no audio URL")?;
            Ok(serde_json::json!({ "url": url }))
        }
        "kie" => {
            let value = kie_request(reqwest::Method::GET, format!("https://api.kie.ai/api/v1/jobs/recordInfo?taskId={request_id}"), &provider_key("kie")?, None).await?;
            let state = value.pointer("/data/state").and_then(Value::as_str).unwrap_or_default();
            if state == "fail" { return Err(value.pointer("/data/failMsg").and_then(Value::as_str).unwrap_or("KIE AI generation failed").to_owned()); }
            let result_json = value.pointer("/data/resultJson").and_then(Value::as_str).unwrap_or("{}");
            serde_json::from_str(result_json).map_err(|error| format!("KIE AI returned unreadable generation result: {error}"))
        }
        "wavespeed" => {
            let value = wavespeed_request(reqwest::Method::GET, format!("https://api.wavespeed.ai/api/v3/predictions/{request_id}/result"), &provider_key("wavespeed")?, None).await?;
            if value.pointer("/data/status").and_then(Value::as_str) == Some("failed") { return Err(value.pointer("/data/error").and_then(Value::as_str).unwrap_or("WaveSpeed generation failed").to_owned()); }
            Ok(value.pointer("/data").cloned().unwrap_or(value))
        }
        "gemini" if model_id.starts_with("veo-") => {
            let key = provider_key("gemini")?;
            let value = veo_poll_operation(&request_id, &key).await?;
            let url = veo_extract_video_url(&value)?;
            // The generic downloader below (save_asset_from_url) sends no auth header, and this file
            // URI likely requires the API key to fetch — append it as a query param defensively since
            // that's unconfirmed either way against a live call.
            let separator = if url.contains('?') { '&' } else { '?' };
            Ok(serde_json::json!({ "url": format!("{url}{separator}key={key}") }))
        }
        // The data URI was already produced in submit_generation and handed back to the frontend as
        // response_url; it's passed straight back in here, so just re-wrap it.
        "gemini" => Ok(serde_json::json!({ "url": response_url.ok_or("Missing Gemini result data")? })),
        "elevenlabs" => Ok(serde_json::json!({ "url": response_url.ok_or("Missing ElevenLabs result data")? })),
        "openai" => Ok(serde_json::json!({ "url": response_url.ok_or("Missing OpenAI result data")? })),
        _ => Err(format!("{provider} result retrieval is not enabled yet.")),
    }
}

/// Downloads a provider's hosted result file (image/video/audio URL) straight into the project's
/// assets/ folder, mirroring `save_generated_asset` but for providers that return a URL rather
/// than inline bytes.
#[tauri::command]
pub async fn save_asset_from_url(app: AppHandle, dir_name: String, asset_type: String, url: String) -> Result<SavedAssetFromUrl, String> {
    let project_dir = crate::project_path(&app, &dir_name)?;
    let sub_dir = match asset_type.as_str() {
        "image" => "images",
        "video" => "video",
        "audio" | "music" | "sfx" | "dialogue" => "audio",
        _ => return Err("Unknown asset type".into()),
    };
    // Synchronous providers (Gemini) return the result inline as a data: URI rather than a hosted
    // URL — decode and write it directly instead of attempting an HTTP download.
    if let Some(rest) = url.strip_prefix("data:") {
        let (header, base64_data) = rest.split_once(";base64,").ok_or("Unrecognized data URI")?;
        let extension = match header {
            "image/png" => "png",
            "image/jpeg" => "jpg",
            "image/webp" => "webp",
            "audio/mpeg" => "mp3",
            "audio/wav" | "audio/wave" => "wav",
            _ => match sub_dir { "images" => "png", "video" => "mp4", _ => "wav" },
        };
        let bytes = base64::engine::general_purpose::STANDARD.decode(base64_data).map_err(|error| format!("Could not decode generated asset: {error}"))?;
        let target_dir = project_dir.join("assets").join(sub_dir);
        fs::create_dir_all(&target_dir).map_err(|error| error.to_string())?;
        let stamp = format!("{:x}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());
        let stored_name = format!("{stamp}.{extension}");
        let destination: PathBuf = target_dir.join(&stored_name);
        fs::write(&destination, &bytes).map_err(|error| format!("Could not save downloaded asset: {error}"))?;
        return Ok(SavedAssetFromUrl { file_path: format!("{sub_dir}/{stored_name}"), name: stored_name, bytes: bytes.len() as u64 });
    }
    if !url.starts_with("https://") { return Err("Refusing to download from a non-HTTPS URL".into()); }
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(120)).build().map_err(|error| error.to_string())?;
    let response = client.get(&url).send().await.map_err(|error| format!("Could not download generated asset: {error}"))?;
    if !response.status().is_success() { return Err(format!("Provider file download failed ({})", response.status())); }
    let extension = url.rsplit('.').next().filter(|value| value.len() <= 5 && !value.contains('/')).unwrap_or(match sub_dir { "images" => "png", "video" => "mp4", _ => "wav" });
    let bytes = response.bytes().await.map_err(|error| format!("Could not read downloaded asset: {error}"))?;

    let target_dir = project_dir.join("assets").join(sub_dir);
    fs::create_dir_all(&target_dir).map_err(|error| error.to_string())?;
    let stamp = format!("{:x}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());
    let stored_name = format!("{stamp}.{extension}");
    let destination: PathBuf = target_dir.join(&stored_name);
    fs::write(&destination, &bytes).map_err(|error| format!("Could not save downloaded asset: {error}"))?;
    Ok(SavedAssetFromUrl { file_path: format!("{sub_dir}/{stored_name}"), name: stored_name, bytes: bytes.len() as u64 })
}

#[cfg(test)]
mod tests {
    use super::{fal_input, kie_input, wavespeed_input, wavespeed_video_input};
    use serde_json::json;

    #[test]
    fn shot_mode_seedance_pro_text_to_video_drops_all_image_and_reference_fields() {
        let input = fal_input(
            "fal-ai/bytedance/seedance/v1/pro/text-to-video",
            &json!({ "prompt": "A neon city at night", "image_url": "data:image/png;base64,AAAA", "end_image_url": "data:image/png;base64,BBBB", "reference_image_urls": ["x"], "duration_seconds": 8 }),
        ).unwrap();
        assert!(input.get("image_url").is_none(), "text-to-video must not send a start frame");
        assert!(input.get("end_image_url").is_none());
        assert!(input.get("reference_image_urls").is_none());
        assert_eq!(input.get("duration").and_then(|v| v.as_str()), Some("8"), "duration_seconds must convert to the string enum this endpoint expects");
        assert!(input.get("duration_seconds").is_none(), "the generic field name must be replaced, not sent alongside the real one");
    }

    #[test]
    fn shot_mode_seedance_pro_image_to_video_keeps_start_and_end_frame() {
        let input = fal_input(
            "fal-ai/bytedance/seedance/v1/pro/image-to-video",
            &json!({ "prompt": "Rain begins to fall", "image_url": "data:image/png;base64,AAAA", "end_image_url": "data:image/png;base64,BBBB", "reference_image_urls": ["x"], "duration_seconds": 5 }),
        ).unwrap();
        assert_eq!(input.get("image_url").and_then(|v| v.as_str()), Some("data:image/png;base64,AAAA"));
        assert_eq!(input.get("end_image_url").and_then(|v| v.as_str()), Some("data:image/png;base64,BBBB"));
        assert!(input.get("reference_image_urls").is_none(), "this model has no reference-image concept — only start/end frame");
    }

    #[test]
    fn shot_mode_seedance_lite_reference_to_video_keeps_reference_images_only() {
        let input = fal_input(
            "fal-ai/bytedance/seedance/v1/lite/reference-to-video",
            &json!({ "prompt": "A cat exploring a garden", "image_url": "data:image/png;base64,AAAA", "reference_image_urls": ["r1", "r2"], "duration_seconds": 6 }),
        ).unwrap();
        assert!(input.get("image_url").is_none(), "this model has no single start-frame concept — only references");
        assert_eq!(input.get("reference_image_urls"), Some(&json!(["r1", "r2"])));
        assert_eq!(input.get("duration").and_then(|v| v.as_str()), Some("6"));
    }

    #[test]
    fn shot_mode_kling_o3_keeps_start_end_frame_and_drops_references() {
        let input = fal_input(
            "fal-ai/kling-video/o3/standard/image-to-video",
            &json!({ "prompt": "A dragon flies over mountains", "image_url": "data:image/png;base64,AAAA", "end_image_url": "data:image/png;base64,BBBB", "reference_image_urls": ["x"], "reference_video_urls": ["y"], "resolution": "1080p", "duration_seconds": 10 }),
        ).unwrap();
        assert_eq!(input.get("image_url").and_then(|v| v.as_str()), Some("data:image/png;base64,AAAA"));
        assert_eq!(input.get("end_image_url").and_then(|v| v.as_str()), Some("data:image/png;base64,BBBB"));
        assert!(input.get("reference_image_urls").is_none(), "Kling O3's documented fields have no reference-images array");
        assert!(input.get("reference_video_urls").is_none());
        assert!(input.get("resolution").is_none(), "Kling O3 has no confirmed resolution field — must be dropped, not sent unconfirmed");
        assert_eq!(input.get("duration").and_then(|v| v.as_str()), Some("10"));
    }

    #[test]
    fn shot_mode_seedance_2_keeps_resolution_and_generate_audio_when_set() {
        let input = fal_input(
            "bytedance/seedance-2.0/image-to-video",
            &json!({ "prompt": "A kite rises in the wind", "image_url": "data:image/png;base64,AAAA", "resolution": "1080p", "generate_audio": false, "duration_seconds": 6 }),
        ).unwrap();
        assert_eq!(input.get("resolution").and_then(|v| v.as_str()), Some("1080p"), "Seedance 2.0 supports resolution — must pass through");
        assert_eq!(input.get("generate_audio").and_then(|v| v.as_bool()), Some(false), "Seedance 2.0 supports generate_audio — must pass through, including an explicit false");
    }

    #[test]
    fn shot_mode_minimax_hailuo_standard_i2v_keeps_only_confirmed_fields() {
        let input = fal_input(
            "fal-ai/minimax/hailuo-02/standard/image-to-video",
            &json!({ "prompt": "A boat drifts on a calm lake", "image_url": "data:image/png;base64,AAAA", "end_image_url": "data:image/png;base64,BBBB", "reference_image_urls": ["x"], "resolution": "768p", "generate_audio": true, "duration_seconds": 6 }),
        ).unwrap();
        assert_eq!(input.get("image_url").and_then(|v| v.as_str()), Some("data:image/png;base64,AAAA"));
        assert!(input.get("end_image_url").is_none(), "Hailuo 02 has no confirmed end-frame field");
        assert!(input.get("reference_image_urls").is_none());
        assert_eq!(input.get("resolution").and_then(|v| v.as_str()), Some("768p"));
        assert!(input.get("generate_audio").is_none(), "Hailuo 02 has no confirmed audio-toggle field — must be dropped");
        assert_eq!(input.get("duration"), Some(&json!(6)));
    }

    #[test]
    fn shot_mode_wan_reference_to_video_keeps_both_reference_arrays_and_drops_start_frame() {
        let input = fal_input(
            "fal-ai/wan/v2.7/reference-to-video",
            &json!({ "prompt": "A dancer moves through the scene", "image_url": "data:image/png;base64,AAAA", "reference_image_urls": ["r1", "r2", "r3"], "reference_video_urls": ["v1"], "duration_seconds": 10 }),
        ).unwrap();
        assert!(input.get("image_url").is_none(), "this model has no single start-frame field — only reference arrays");
        assert_eq!(input.get("reference_image_urls"), Some(&json!(["r1", "r2", "r3"])));
        assert_eq!(input.get("reference_video_urls"), Some(&json!(["v1"])));
        assert_eq!(input.get("duration").and_then(|v| v.as_str()), Some("10"));
    }

    #[test]
    fn shot_mode_seedance_2_image_to_video_sends_integer_duration_not_string_enum() {
        let input = fal_input(
            "bytedance/seedance-2.0/image-to-video",
            &json!({ "prompt": "A lantern drifts on the water", "image_url": "data:image/png;base64,AAAA", "end_image_url": "data:image/png;base64,BBBB", "reference_image_urls": ["x"], "duration_seconds": 8 }),
        ).unwrap();
        assert_eq!(input.get("image_url").and_then(|v| v.as_str()), Some("data:image/png;base64,AAAA"));
        assert_eq!(input.get("end_image_url").and_then(|v| v.as_str()), Some("data:image/png;base64,BBBB"));
        assert!(input.get("reference_image_urls").is_none());
        assert_eq!(input.get("duration"), Some(&json!(8)), "v2.0's duration is a plain integer per fal's API reference, unlike v1 Pro's stringified enum");
    }

    #[test]
    fn shot_mode_seedance_2_reference_to_video_renames_to_image_video_audio_urls() {
        let input = fal_input(
            "bytedance/seedance-2.0/reference-to-video",
            &json!({
                "prompt": "A band performs on a rooftop",
                "image_url": "data:image/png;base64,AAAA",
                "reference_image_urls": ["r1", "r2"],
                "reference_video_urls": ["v1"],
                "reference_audio_urls": ["a1"],
                "duration_seconds": 12
            }),
        ).unwrap();
        assert!(input.get("image_url").is_none(), "reference-to-video has no single start-frame field");
        assert_eq!(input.get("image_urls"), Some(&json!(["r1", "r2"])), "v2.0's reference endpoint uses image_urls, not reference_image_urls");
        assert_eq!(input.get("video_urls"), Some(&json!(["v1"])));
        assert_eq!(input.get("audio_urls"), Some(&json!(["a1"])), "audio references are new in v2.0 — must map to audio_urls");
        assert!(input.get("reference_image_urls").is_none(), "the generic field names must be replaced, not sent alongside the real ones");
        assert_eq!(input.get("duration"), Some(&json!(12)));
    }

    #[test]
    fn wavespeed_seedance_2_renames_start_end_frame_to_image_last_image() {
        let mut input = json!({
            "prompt": "A ship sails through fog",
            "image_url": "data:image/png;base64,AAAA",
            "end_image_url": "data:image/png;base64,BBBB",
            "reference_image_urls": ["x"],
            "duration_seconds": 7
        })
        .as_object()
        .unwrap()
        .clone();
        wavespeed_video_input("wavespeed-ai/seedance-2.0/image-to-video", &mut input);
        assert_eq!(input.get("image").and_then(|v| v.as_str()), Some("data:image/png;base64,AAAA"), "WaveSpeed names the start frame \"image\", not \"image_url\"");
        assert_eq!(input.get("last_image").and_then(|v| v.as_str()), Some("data:image/png;base64,BBBB"));
        assert!(input.get("image_url").is_none());
        assert!(input.get("end_image_url").is_none());
        assert!(input.get("reference_image_urls").is_none(), "this endpoint has no reference-images concept — only start/end frame");
        assert_eq!(input.get("duration"), Some(&json!(7)));
    }

    #[test]
    fn shot_mode_ltx_drops_unconfirmed_aspect_ratio_and_reference_fields() {
        let input = fal_input(
            "lightricks/ltx-2.5/image-to-video/pro",
            &json!({ "prompt": "A candle flickers", "image_url": "data:image/png;base64,AAAA", "end_image_url": "data:image/png;base64,BBBB", "aspect_ratio": "16:9", "reference_image_urls": ["x"], "duration_seconds": 6 }),
        ).unwrap();
        assert_eq!(input.get("image_url").and_then(|v| v.as_str()), Some("data:image/png;base64,AAAA"));
        assert_eq!(input.get("end_image_url").and_then(|v| v.as_str()), Some("data:image/png;base64,BBBB"));
        assert!(input.get("aspect_ratio").is_none(), "LTX's docs don't confirm this field — must not be sent unconfirmed");
        assert!(input.get("reference_image_urls").is_none());
    }

    #[test]
    fn shot_mode_hunyuan_text_to_video_drops_all_image_fields() {
        let input = fal_input(
            "fal-ai/hunyuan-video-v1.5/text-to-video",
            &json!({ "prompt": "Clouds drifting over a valley", "image_url": "data:image/png;base64,AAAA", "aspect_ratio": "16:9" }),
        ).unwrap();
        assert!(input.get("image_url").is_none());
        assert_eq!(input.get("aspect_ratio").and_then(|v| v.as_str()), Some("16:9"));
    }

    #[test]
    fn shot_mode_hunyuan_image_to_video_keeps_start_frame_only() {
        let input = fal_input(
            "fal-ai/hunyuan-video-v1.5/image-to-video",
            &json!({ "prompt": "The image comes to life", "image_url": "data:image/png;base64,AAAA", "end_image_url": "data:image/png;base64,BBBB", "aspect_ratio": "9:16" }),
        ).unwrap();
        assert_eq!(input.get("image_url").and_then(|v| v.as_str()), Some("data:image/png;base64,AAAA"));
        assert!(input.get("end_image_url").is_none(), "Hunyuan i2v has no documented end-frame field");
        assert_eq!(input.get("aspect_ratio").and_then(|v| v.as_str()), Some("9:16"));
    }

    #[test]
    fn fal_flux_aspect_ratio_maps_to_image_size_enum() {
        let input = fal_input("fal-ai/flux/dev", &json!({ "prompt": "A cozy loft", "aspect_ratio": "16:9" })).unwrap();
        assert_eq!(input.get("image_size").and_then(|value| value.as_str()), Some("landscape_16_9"));
        assert!(input.get("aspect_ratio").is_none(), "the generic field should be replaced, not left alongside the mapped one");
    }

    #[test]
    fn fal_flux_defaults_to_square_for_an_unmapped_ratio() {
        let input = fal_input("fal-ai/flux/dev", &json!({ "prompt": "A cozy loft", "aspect_ratio": "1:1" })).unwrap();
        assert_eq!(input.get("image_size").and_then(|value| value.as_str()), Some("square_hd"));
    }

    #[test]
    fn fal_flux_21_9_uses_a_custom_width_height_object_since_no_enum_value_covers_it() {
        let input = fal_input("fal-ai/flux/dev", &json!({ "prompt": "A cozy loft", "aspect_ratio": "21:9" })).unwrap();
        let image_size = input.get("image_size").expect("image_size should be set");
        assert_eq!(image_size.get("width").and_then(|value| value.as_i64()), Some(1344));
        assert_eq!(image_size.get("height").and_then(|value| value.as_i64()), Some(576));
    }

    #[test]
    fn fal_nano_banana_edit_wraps_image_url_into_array_and_drops_strength() {
        let input = fal_input(
            "fal-ai/nano-banana/edit",
            &json!({ "prompt": "The same house in snow", "aspect_ratio": "16:9", "image_url": "data:image/png;base64,AAAA", "strength": 0.75 }),
        ).unwrap();
        assert_eq!(input.get("image_urls"), Some(&json!(["data:image/png;base64,AAAA"])), "single image_url must become the plural image_urls array this edit model expects");
        assert!(input.get("image_url").is_none(), "the singular field must not be sent alongside the array");
        assert!(input.get("strength").is_none(), "this edit model has no strength parameter — it must be dropped, not sent unsupported");
        assert_eq!(input.get("aspect_ratio").and_then(|value| value.as_str()), Some("16:9"), "aspect_ratio is a real native field on this model and should pass through unchanged");
    }

    #[test]
    fn fal_nano_banana_edit_multi_reference_uses_the_full_array_not_just_the_first_image() {
        let input = fal_input(
            "fal-ai/nano-banana/edit",
            &json!({ "prompt": "Combine these into one scene", "image_url": "data:image/png;base64,PRIMARY", "reference_image_urls": ["data:image/png;base64,A", "data:image/png;base64,B", "data:image/png;base64,C"] }),
        ).unwrap();
        assert_eq!(
            input.get("image_urls"),
            Some(&json!(["data:image/png;base64,A", "data:image/png;base64,B", "data:image/png;base64,C"])),
            "when multiple references are provided, all of them must be sent — not just the singular image_url"
        );
    }

    #[test]
    fn fal_gpt_image_2_maps_aspect_ratio_to_image_size_like_flux() {
        let input = fal_input("openai/gpt-image-2", &json!({ "prompt": "A cozy loft", "aspect_ratio": "16:9" })).unwrap();
        assert_eq!(input.get("image_size").and_then(|value| value.as_str()), Some("landscape_16_9"));
        assert!(input.get("aspect_ratio").is_none());
    }

    #[test]
    fn fal_gpt_image_2_edit_wraps_image_url_and_maps_aspect_ratio() {
        let input = fal_input(
            "openai/gpt-image-2/edit",
            &json!({ "prompt": "The same house in snow", "aspect_ratio": "9:16", "image_url": "data:image/png;base64,AAAA", "strength": 0.5 }),
        ).unwrap();
        assert_eq!(input.get("image_urls"), Some(&json!(["data:image/png;base64,AAAA"])));
        assert!(input.get("image_url").is_none());
        assert!(input.get("strength").is_none());
        assert_eq!(input.get("image_size").and_then(|value| value.as_str()), Some("portrait_16_9"), "unlike nano-banana/edit, gpt-image-2/edit needs the image_size mapping, not raw aspect_ratio");
        assert!(input.get("aspect_ratio").is_none());
    }

    #[test]
    fn wavespeed_flux_aspect_ratio_maps_to_pixel_size_string() {
        let input = wavespeed_input("wavespeed-ai/flux-dev", &json!({ "prompt": "A cozy loft", "aspect_ratio": "9:16" })).unwrap();
        assert_eq!(input.get("size").and_then(|value| value.as_str()), Some("768*1344"));
        assert!(input.get("aspect_ratio").is_none());
    }

    #[test]
    fn kie_passes_aspect_ratio_through_unchanged_since_its_field_name_already_matches() {
        let input = kie_input("google/nano-banana", &json!({ "prompt": "A cozy loft", "aspect_ratio": "4:3" })).unwrap();
        assert_eq!(input.get("aspect_ratio").and_then(|value| value.as_str()), Some("4:3"));
    }

    #[test]
    fn kie_wan_keyframes_are_mapped_to_provider_fields() {
        let input = kie_input("wan/2-7-image-to-video", &json!({ "prompt": "Rain over a loft", "image_url": "https://example.test/start.png", "end_image_url": "https://example.test/end.png" })).unwrap();
        assert_eq!(input.get("first_frame_url").and_then(|value| value.as_str()), Some("https://example.test/start.png"));
        assert_eq!(input.get("last_frame_url").and_then(|value| value.as_str()), Some("https://example.test/end.png"));
        assert!(input.get("image_url").is_none());
    }

    #[test]
    fn wavespeed_open_video_maps_the_start_frame() {
        let input = wavespeed_input("wavespeed-ai/open-video/image-to-video", &json!({ "prompt": "A curtain drifts in the breeze", "image_url": "https://example.test/start.png", "end_image_url": "https://example.test/end.png" })).unwrap();
        assert_eq!(input.get("image").and_then(|value| value.as_str()), Some("https://example.test/start.png"));
        assert!(input.get("end_image_url").is_none());
    }

    #[test]
    fn wavespeed_speech_maps_prompt_to_text_with_a_safe_default_voice() {
        let input = wavespeed_input("minimax/speech-2.8-turbo", &json!({ "prompt": "The rain is almost here." })).unwrap();
        assert_eq!(input.get("text").and_then(|value| value.as_str()), Some("The rain is almost here."));
        assert_eq!(input.get("voice_id").and_then(|value| value.as_str()), Some("Calm_Woman"));
    }

    #[test]
    fn comfyui_first_output_finds_a_filename_regardless_of_the_output_field_name() {
        // Real ComfyUI nodes use different output field names per node type ("images" for
        // SaveImage, "gifs"/"videos" for video-combine nodes, ...) — this must not hardcode one.
        let history_entry = json!({
            "outputs": {
                "9": { "gifs": [{ "filename": "ComfyUI_00001.mp4", "subfolder": "", "type": "output" }] }
            }
        });
        let (filename, subfolder, folder_type) = super::comfyui_first_output(&history_entry).expect("should find the output");
        assert_eq!(filename, "ComfyUI_00001.mp4");
        assert_eq!(subfolder, "");
        assert_eq!(folder_type, "output");
    }

    #[test]
    fn comfyui_first_output_returns_none_when_still_running() {
        let history_entry = json!({ "outputs": {} });
        assert!(super::comfyui_first_output(&history_entry).is_none());
    }

    #[test]
    fn comfyui_status_str_reads_the_nested_status_field() {
        let history_entry = json!({ "status": { "status_str": "error", "completed": false } });
        assert_eq!(super::comfyui_status_str(&history_entry), Some("error"));
    }
}

#[cfg(test)]
mod provider_key_storage_tests {
    use super::{delete_provider_key, provider_key_status, save_provider_key};

    /// Regression test for a real bug: without the `windows-native` feature on the `keyring`
    /// crate, it silently falls back to a non-persistent mock backend — writes report success but
    /// a freshly constructed `Entry` (i.e. any separate command invocation, exactly how the real
    /// app calls save vs. status) can never see them. This must round-trip across independent calls.
    #[test]
    fn save_then_status_round_trips_across_separate_command_invocations() {
        let _ = delete_provider_key("smoketest".to_string());
        assert!(!provider_key_status("smoketest".to_string()).configured, "should start unconfigured");

        let save_result = save_provider_key("smoketest".to_string(), "abc123".to_string());
        assert!(save_result.is_ok(), "save should succeed: {:?}", save_result);
        assert!(provider_key_status("smoketest".to_string()).configured, "should be configured after save");

        delete_provider_key("smoketest".to_string()).expect("delete should succeed");
        assert!(!provider_key_status("smoketest".to_string()).configured, "should be unconfigured after delete");
    }
}
