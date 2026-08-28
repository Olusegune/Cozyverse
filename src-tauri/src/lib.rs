mod decompose;
mod decompose_setup;
mod providers;
mod video_export;

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, io::Write, path::{Path, PathBuf}};
use tauri::{AppHandle, Manager};

const CURRENT_PROJECT_VERSION: u32 = 1;

/// Own registered command rather than the Tauri core `app.getVersion()` API — that core API needs a
/// capability grant this project's tauri.conf.json doesn't explicitly configure, while a plain
/// custom command like this always works regardless of the capability system.
#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CozyverseSummary {
    id: String,
    name: String,
    short_concept: String,
    dir_name: String,
    updated_at: String,
    hero_image_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenedCozyverse {
    dir_name: String,
    cozyverse_json: String,
    world_json: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportedAsset {
    file_path: String,
    name: String,
    bytes: u64,
}

fn cozyverses_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .document_dir()
        .map_err(|error| error.to_string())?
        .join("Cozyverses");
    fs::create_dir_all(&root).map_err(|error| format!("Could not prepare Cozyverses folder: {error}"))?;
    Ok(root)
}

pub(crate) fn slugify(name: &str) -> String {
    let slug: String = name
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|character| if character.is_ascii_alphanumeric() { character } else { '-' })
        .collect();
    let collapsed = slug.split('-').filter(|part| !part.is_empty()).collect::<Vec<_>>().join("-");
    if collapsed.is_empty() { "untitled-cozyverse".into() } else { collapsed }
}

fn unique_dir_name(root: &Path, base: &str) -> String {
    if !root.join(base).exists() { return base.to_owned(); }
    for attempt in 2..1000 {
        let candidate = format!("{base}-{attempt}");
        if !root.join(&candidate).exists() { return candidate; }
    }
    format!("{base}-{}", crate_random_suffix())
}

fn crate_random_suffix() -> String {
    format!("{:x}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos())
}

fn scaffold_project_dirs(project_dir: &Path) -> Result<(), String> {
    for sub in ["assets/images", "assets/video", "assets/audio", "thumbnails", "exports"] {
        fs::create_dir_all(project_dir.join(sub)).map_err(|error| format!("Could not create {sub}: {error}"))?;
    }
    Ok(())
}

fn validate_cozyverse_json(contents: &str) -> Result<Value, String> {
    let value: Value = serde_json::from_str(contents).map_err(|error| format!("cozyverse.json is not valid JSON: {error}"))?;
    let metadata = value.get("metadata").ok_or("cozyverse.json is missing \"metadata\"")?;
    if metadata.get("id").and_then(Value::as_str).is_none() { return Err("cozyverse.json metadata is missing \"id\"".into()); }
    if metadata.get("name").and_then(Value::as_str).is_none() { return Err("cozyverse.json metadata is missing \"name\"".into()); }
    Ok(value)
}

fn read_summary(project_dir: &Path) -> Option<CozyverseSummary> {
    let dir_name = project_dir.file_name()?.to_string_lossy().into_owned();
    let cozyverse_contents = fs::read_to_string(project_dir.join("cozyverse.json")).ok()?;
    let value = validate_cozyverse_json(&cozyverse_contents).ok()?;
    let metadata = value.get("metadata")?;
    let hero_asset_id = metadata.get("heroImageAssetId").and_then(Value::as_str);
    let hero_image_path = hero_asset_id.and_then(|asset_id| {
        value.get("assets")?.as_array()?.iter().find(|asset| asset.get("id").and_then(Value::as_str) == Some(asset_id))
            .and_then(|asset| asset.get("filePath")).and_then(Value::as_str)
            .map(|relative| project_dir.join("assets").join(relative).to_string_lossy().into_owned())
    });
    Some(CozyverseSummary {
        id: metadata.get("id")?.as_str()?.to_owned(),
        name: metadata.get("name")?.as_str()?.to_owned(),
        short_concept: metadata.get("shortConcept").and_then(Value::as_str).unwrap_or("").to_owned(),
        dir_name,
        updated_at: metadata.get("updatedAt").and_then(Value::as_str).unwrap_or("").to_owned(),
        hero_image_path,
    })
}

#[tauri::command]
fn list_cozyverses(app: AppHandle) -> Result<Vec<CozyverseSummary>, String> {
    list_cozyverses_impl(&cozyverses_root(&app)?)
}

fn list_cozyverses_impl(root: &Path) -> Result<Vec<CozyverseSummary>, String> {
    let mut summaries = fs::read_dir(root)
        .map_err(|error| format!("Could not read Cozyverses folder: {error}"))?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir() && entry.file_name() != "_trash")
        .filter_map(|entry| read_summary(&entry.path()))
        .collect::<Vec<_>>();
    summaries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(summaries)
}

#[tauri::command]
fn create_cozyverse(app: AppHandle, name: String) -> Result<CozyverseSummary, String> {
    create_cozyverse_impl(&cozyverses_root(&app)?, &name)
}

fn create_cozyverse_impl(root: &Path, name: &str) -> Result<CozyverseSummary, String> {
    let trimmed = name.trim();
    let name = if trimmed.is_empty() { "Untitled Cozyverse" } else { trimmed };
    let dir_name = unique_dir_name(root, &slugify(name));
    let project_dir = root.join(&dir_name);
    fs::create_dir_all(&project_dir).map_err(|error| format!("Could not create Cozyverse folder: {error}"))?;
    scaffold_project_dirs(&project_dir)?;
    let now = chrono_now();
    let id = crate_random_suffix();
    let cozyverse_json = serde_json::json!({
        "format": "cozyverse-project",
        "version": CURRENT_PROJECT_VERSION,
        "metadata": { "id": id, "name": name, "shortConcept": "", "heroImageAssetId": Value::Null, "createdAt": now, "updatedAt": now },
        "assets": [],
        "generations": [],
        "scenes": [],
    });
    let world_json = serde_json::json!({
        "name": name, "shortConcept": "", "description": "", "mood": "", "artStyle": "",
        "colorPalette": [], "locationEnvironment": "", "architecture": "", "importantObjects": "",
        "characters": "", "cameraComposition": "", "lighting": "", "weather": "", "timeOfDay": "",
        "thingsToAvoid": "", "additionalNotes": "",
    });
    fs::write(project_dir.join("cozyverse.json"), serde_json::to_string_pretty(&cozyverse_json).unwrap())
        .map_err(|error| format!("Could not write cozyverse.json: {error}"))?;
    fs::write(project_dir.join("world.json"), serde_json::to_string_pretty(&world_json).unwrap())
        .map_err(|error| format!("Could not write world.json: {error}"))?;
    Ok(CozyverseSummary { id, name: name.to_owned(), short_concept: String::new(), dir_name, updated_at: now, hero_image_path: None })
}

#[tauri::command]
fn open_cozyverse(app: AppHandle, dir_name: String) -> Result<OpenedCozyverse, String> {
    open_cozyverse_impl(&cozyverses_root(&app)?, dir_name)
}

fn open_cozyverse_impl(root: &Path, dir_name: String) -> Result<OpenedCozyverse, String> {
    let project_dir = project_path_impl(root, &dir_name)?;
    let cozyverse_json = fs::read_to_string(project_dir.join("cozyverse.json")).map_err(|error| format!("Could not read cozyverse.json: {error}"))?;
    validate_cozyverse_json(&cozyverse_json)?;
    let world_json = fs::read_to_string(project_dir.join("world.json")).map_err(|error| format!("Could not read world.json: {error}"))?;
    serde_json::from_str::<Value>(&world_json).map_err(|error| format!("world.json is not valid JSON: {error}"))?;
    Ok(OpenedCozyverse { dir_name, cozyverse_json, world_json })
}

fn project_path_impl(root: &Path, dir_name: &str) -> Result<PathBuf, String> {
    if dir_name.is_empty() || dir_name.contains("..") || dir_name.contains('/') || dir_name.contains('\\') {
        return Err("Invalid Cozyverse folder name".into());
    }
    let path = root.join(dir_name);
    if !path.is_dir() { return Err("Cozyverse project was not found".into()); }
    Ok(path)
}

pub(crate) fn project_path(app: &AppHandle, dir_name: &str) -> Result<PathBuf, String> {
    project_path_impl(&cozyverses_root(app)?, dir_name)
}

pub(crate) fn write_json_atomic(path: PathBuf, contents: &str) -> Result<(), String> {
    serde_json::from_str::<Value>(contents).map_err(|error| format!("Refusing to save invalid JSON: {error}"))?;
    // Unique per-call temp filename (not a shared "<name>.tmp") so two overlapping saves to the
    // same target — e.g. an in-flight autosave and a manual File > Save — can never race on the
    // same temp file and have one writer's fs::rename fail because the other already moved it.
    let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let file_name = path.file_name().and_then(|name| name.to_str()).unwrap_or("file");
    let temporary = path.with_file_name(format!("{file_name}.{unique}.tmp"));
    fs::write(&temporary, contents).map_err(|error| format!("Could not write file: {error}"))?;
    fs::rename(&temporary, &path).map_err(|error| format!("Could not finish saving file: {error}"))?;
    Ok(())
}

#[tauri::command]
fn save_cozyverse_json(app: AppHandle, dir_name: String, contents: String) -> Result<(), String> {
    validate_cozyverse_json(&contents)?;
    let project_dir = project_path(&app, &dir_name)?;
    write_json_atomic(project_dir.join("cozyverse.json"), &contents)
}

#[tauri::command]
fn save_world_json(app: AppHandle, dir_name: String, contents: String) -> Result<(), String> {
    let project_dir = project_path(&app, &dir_name)?;
    write_json_atomic(project_dir.join("world.json"), &contents)
}

#[tauri::command]
fn rename_cozyverse(app: AppHandle, dir_name: String, new_name: String) -> Result<CozyverseSummary, String> {
    rename_cozyverse_impl(&cozyverses_root(&app)?, &dir_name, &new_name)
}

fn rename_cozyverse_impl(root: &Path, dir_name: &str, new_name: &str) -> Result<CozyverseSummary, String> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() { return Err("Name cannot be empty".into()); }
    let project_dir = project_path_impl(root, dir_name)?;

    let mut cozyverse_value: Value = serde_json::from_str(&fs::read_to_string(project_dir.join("cozyverse.json")).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
    cozyverse_value["metadata"]["name"] = Value::String(trimmed.to_owned());
    cozyverse_value["metadata"]["updatedAt"] = Value::String(chrono_now());
    fs::write(project_dir.join("cozyverse.json"), serde_json::to_string_pretty(&cozyverse_value).unwrap()).map_err(|error| error.to_string())?;

    let mut world_value: Value = serde_json::from_str(&fs::read_to_string(project_dir.join("world.json")).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
    world_value["name"] = Value::String(trimmed.to_owned());
    fs::write(project_dir.join("world.json"), serde_json::to_string_pretty(&world_value).unwrap()).map_err(|error| error.to_string())?;

    let new_dir_name = unique_dir_name(root, &slugify(trimmed));
    let new_path = root.join(&new_dir_name);
    fs::rename(&project_dir, &new_path).map_err(|error| format!("Could not rename Cozyverse folder: {error}"))?;
    read_summary(&new_path).ok_or_else(|| "Renamed, but could not reload the Cozyverse summary".to_owned())
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())?.filter_map(Result::ok) {
        let entry_path = entry.path();
        let target = destination.join(entry.file_name());
        if entry_path.is_dir() {
            copy_dir_recursive(&entry_path, &target)?;
        } else {
            fs::copy(&entry_path, &target).map_err(|error| format!("Could not copy {}: {error}", entry_path.display()))?;
        }
    }
    Ok(())
}

#[tauri::command]
fn duplicate_cozyverse(app: AppHandle, dir_name: String) -> Result<CozyverseSummary, String> {
    duplicate_cozyverse_impl(&cozyverses_root(&app)?, &dir_name)
}

fn duplicate_cozyverse_impl(root: &Path, dir_name: &str) -> Result<CozyverseSummary, String> {
    let project_dir = project_path_impl(root, dir_name)?;
    let cozyverse_value: Value = serde_json::from_str(&fs::read_to_string(project_dir.join("cozyverse.json")).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
    let base_name = cozyverse_value["metadata"]["name"].as_str().unwrap_or("Cozyverse").to_owned();
    let new_dir_name = unique_dir_name(root, &format!("{}-copy", slugify(&base_name)));
    let new_path = root.join(&new_dir_name);
    copy_dir_recursive(&project_dir, &new_path)?;

    let now = chrono_now();
    let new_id = crate_random_suffix();
    let mut new_value = cozyverse_value.clone();
    new_value["metadata"]["id"] = Value::String(new_id.clone());
    new_value["metadata"]["name"] = Value::String(format!("{base_name} (Copy)"));
    new_value["metadata"]["createdAt"] = Value::String(now.clone());
    new_value["metadata"]["updatedAt"] = Value::String(now.clone());
    fs::write(new_path.join("cozyverse.json"), serde_json::to_string_pretty(&new_value).unwrap()).map_err(|error| error.to_string())?;

    if let Ok(mut world_value) = fs::read_to_string(new_path.join("world.json")).map_err(|error| error.to_string()).and_then(|contents| serde_json::from_str::<Value>(&contents).map_err(|error| error.to_string())) {
        world_value["name"] = Value::String(format!("{base_name} (Copy)"));
        fs::write(new_path.join("world.json"), serde_json::to_string_pretty(&world_value).unwrap()).map_err(|error| error.to_string())?;
    }
    read_summary(&new_path).ok_or_else(|| "Duplicated, but could not reload the Cozyverse summary".to_owned())
}

#[tauri::command]
fn delete_cozyverse(app: AppHandle, dir_name: String) -> Result<(), String> {
    delete_cozyverse_impl(&cozyverses_root(&app)?, &dir_name)
}

fn delete_cozyverse_impl(root: &Path, dir_name: &str) -> Result<(), String> {
    let project_dir = project_path_impl(root, dir_name)?;
    let trash = root.join("_trash");
    fs::create_dir_all(&trash).map_err(|error| format!("Could not prepare trash folder: {error}"))?;
    let destination = trash.join(format!("{dir_name}-{}", crate_random_suffix()));
    fs::rename(&project_dir, &destination).map_err(|error| format!("Could not move Cozyverse to trash: {error}"))
}

#[tauri::command]
fn import_asset(app: AppHandle, dir_name: String, asset_type: String) -> Result<Option<ImportedAsset>, String> {
    let project_dir = project_path(&app, &dir_name)?;
    let sub_dir = match asset_type.as_str() {
        "image" => "images",
        "video" => "video",
        "audio" | "music" | "sfx" | "dialogue" => "audio",
        _ => return Err("Unknown asset type".into()),
    };
    let filters: &[&str] = match sub_dir {
        "images" => &["png", "jpg", "jpeg", "webp", "gif"],
        "video" => &["mp4", "mov", "webm", "mkv"],
        _ => &["wav", "mp3", "m4a", "aac", "flac"],
    };
    let picked = rfd::FileDialog::new().add_filter("Media", filters).pick_file();
    picked.map(|source| {
        let metadata = fs::metadata(&source).map_err(|error| format!("Could not inspect asset: {error}"))?;
        let target_dir = project_dir.join("assets").join(sub_dir);
        fs::create_dir_all(&target_dir).map_err(|error| error.to_string())?;
        let name = source.file_name().and_then(|value| value.to_str()).unwrap_or("asset").to_owned();
        let stamp = crate_random_suffix();
        let stored_name = format!("{stamp}-{name}");
        let destination = target_dir.join(&stored_name);
        fs::copy(&source, &destination).map_err(|error| format!("Could not copy asset into the Cozyverse: {error}"))?;
        Ok(ImportedAsset { file_path: format!("{sub_dir}/{stored_name}"), name, bytes: metadata.len() })
    }).transpose()
}

#[tauri::command]
fn save_generated_asset(app: AppHandle, dir_name: String, asset_type: String, base64_data: String, extension: String) -> Result<ImportedAsset, String> {
    save_generated_asset_impl(&project_path(&app, &dir_name)?, &asset_type, &base64_data, &extension)
}

fn save_generated_asset_impl(project_dir: &Path, asset_type: &str, base64_data: &str, extension: &str) -> Result<ImportedAsset, String> {
    let sub_dir = match asset_type {
        "image" => "images",
        "video" => "video",
        "audio" | "music" | "sfx" | "dialogue" => "audio",
        _ => return Err("Unknown asset type".into()),
    };
    if !extension.chars().all(|character| character.is_ascii_alphanumeric()) || extension.is_empty() || extension.len() > 8 {
        return Err("Invalid file extension".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data.split(',').last().unwrap_or(base64_data))
        .map_err(|error| format!("Could not decode generated asset: {error}"))?;
    let target_dir = project_dir.join("assets").join(sub_dir);
    fs::create_dir_all(&target_dir).map_err(|error| error.to_string())?;
    let stamp = crate_random_suffix();
    let stored_name = format!("{stamp}.{extension}");
    let destination = target_dir.join(&stored_name);
    fs::write(&destination, &bytes).map_err(|error| format!("Could not save generated asset: {error}"))?;
    Ok(ImportedAsset { file_path: format!("{sub_dir}/{stored_name}"), name: stored_name, bytes: bytes.len() as u64 })
}

#[tauri::command]
fn asset_file_url(app: AppHandle, dir_name: String, relative_path: String) -> Result<String, String> {
    let project_dir = project_path(&app, &dir_name)?;
    let path = project_dir.join("assets").join(&relative_path);
    if !path.is_file() { return Err("Asset file was not found".into()); }
    Ok(path.to_string_lossy().into_owned())
}

/// Reads a local asset and returns it as a `data:` URI, for providers (like fal) whose models
/// accept the source image inline rather than requiring it to be hosted at a public URL first.
#[tauri::command]
fn asset_as_data_url(app: AppHandle, dir_name: String, relative_path: String) -> Result<String, String> {
    let project_dir = project_path(&app, &dir_name)?;
    let path = project_dir.join("assets").join(&relative_path);
    if !path.is_file() { return Err("Asset file was not found".into()); }
    let mime = match path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "application/octet-stream",
    };
    let bytes = fs::read(&path).map_err(|error| format!("Could not read asset: {error}"))?;
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// Copies an asset file to a user-chosen location outside the project, via the native save dialog —
/// the "download" affordance for images/video/audio the user wants to keep or share separately from
/// the Cozyverse project folder. Returns None if the user cancels the dialog.
#[tauri::command]
fn export_asset_file(app: AppHandle, dir_name: String, relative_path: String, suggested_name: String) -> Result<Option<String>, String> {
    let project_dir = project_path(&app, &dir_name)?;
    let source = project_dir.join("assets").join(&relative_path);
    if !source.is_file() {
        return Err("Asset file was not found".into());
    }
    let extension = source.extension().and_then(|value| value.to_str()).unwrap_or("");
    let mut dialog = rfd::FileDialog::new().set_file_name(&suggested_name);
    if !extension.is_empty() {
        dialog = dialog.add_filter(extension, &[extension]);
    }
    let destination = dialog.save_file();
    destination
        .map(|path| {
            fs::copy(&source, &path).map_err(|error| format!("Could not save file: {error}"))?;
            Ok(path.to_string_lossy().into_owned())
        })
        .transpose()
}

#[tauri::command]
fn delete_asset_file(app: AppHandle, dir_name: String, relative_path: String) -> Result<(), String> {
    delete_asset_file_impl(&project_path(&app, &dir_name)?, &relative_path)
}

/// Moves the asset's file into assets/_trash rather than deleting it outright, so a mistaken
/// removal from the library is still recoverable from disk.
fn delete_asset_file_impl(project_dir: &Path, relative_path: &str) -> Result<(), String> {
    if relative_path.is_empty() || relative_path.contains("..") {
        return Err("Invalid asset path".into());
    }
    let source = project_dir.join("assets").join(relative_path);
    if !source.is_file() { return Ok(()); }
    let trash_dir = project_dir.join("assets").join("_trash");
    fs::create_dir_all(&trash_dir).map_err(|error| format!("Could not prepare asset trash folder: {error}"))?;
    let flat_name = relative_path.replace(['/', '\\'], "__");
    let destination = trash_dir.join(format!("{}-{flat_name}", crate_random_suffix()));
    fs::rename(&source, &destination).map_err(|error| format!("Could not move asset to trash: {error}"))
}

fn validate_manifest_json(manifest_json: &str) -> Result<(), String> {
    serde_json::from_str::<Value>(manifest_json).map_err(|error| format!("Refusing to export invalid manifest JSON: {error}"))?;
    Ok(())
}

#[tauri::command]
fn export_cozyverse(app: AppHandle, dir_name: String, manifest_json: String, thumbnail_relative_path: Option<String>, suggested_name: String) -> Result<Option<String>, String> {
    let project_dir = project_path(&app, &dir_name)?;
    validate_manifest_json(&manifest_json)?;
    let default_name = if suggested_name.ends_with(".zip") { suggested_name } else { format!("{suggested_name}.zip") };
    let path = rfd::FileDialog::new().add_filter("Cozyverse Package", &["zip"]).set_file_name(&default_name).save_file();
    path.map(|destination| {
        write_export_zip(&project_dir, &manifest_json, thumbnail_relative_path.as_deref(), &destination)?;
        Ok(destination.to_string_lossy().into_owned())
    }).transpose()
}

/// Bundles `cozyverse.json` + every asset file (excluding anything under an `_trash` folder) +
/// an optional thumbnail into a single portable zip, as described in the project brief's
/// `cozyverse.json` / `assets/` / `thumbnail` package layout.
fn write_export_zip(project_dir: &Path, manifest_json: &str, thumbnail_relative_path: Option<&str>, destination: &Path) -> Result<(), String> {
    let file = fs::File::create(destination).map_err(|error| format!("Could not create export package: {error}"))?;
    let mut archive = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    archive.start_file("cozyverse.json", options).map_err(|error| format!("Could not write cozyverse.json: {error}"))?;
    archive.write_all(manifest_json.as_bytes()).map_err(|error| format!("Could not write cozyverse.json: {error}"))?;

    let assets_dir = project_dir.join("assets");
    if assets_dir.is_dir() {
        for entry in walkdir::WalkDir::new(&assets_dir).into_iter().filter_map(Result::ok) {
            let path = entry.path();
            if !path.is_file() { continue; }
            if path.components().any(|component| component.as_os_str() == "_trash") { continue; }
            let relative = path.strip_prefix(&assets_dir).map_err(|error| error.to_string())?;
            let zip_path = format!("assets/{}", relative.to_string_lossy().replace('\\', "/"));
            archive.start_file(&zip_path, options).map_err(|error| format!("Could not package {zip_path}: {error}"))?;
            let bytes = fs::read(path).map_err(|error| format!("Could not read {}: {error}", path.display()))?;
            archive.write_all(&bytes).map_err(|error| format!("Could not package {zip_path}: {error}"))?;
        }
    }

    if let Some(relative) = thumbnail_relative_path {
        let source = assets_dir.join(relative);
        if source.is_file() {
            let extension = source.extension().and_then(|value| value.to_str()).unwrap_or("png");
            let bytes = fs::read(&source).map_err(|error| format!("Could not read thumbnail: {error}"))?;
            archive.start_file(format!("thumbnail.{extension}"), options).map_err(|error| format!("Could not package thumbnail: {error}"))?;
            archive.write_all(&bytes).map_err(|error| format!("Could not package thumbnail: {error}"))?;
        }
    }

    archive.finish().map_err(|error| format!("Could not finalize export package: {error}"))?;
    Ok(())
}

fn chrono_now() -> String {
    // RFC3339-ish timestamp without pulling in the chrono crate.
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    let secs = now.as_secs();
    let millis = now.subsec_millis();
    let days_since_epoch = secs / 86400;
    let (year, month, day) = civil_from_days(days_since_epoch as i64);
    let time_of_day = secs % 86400;
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z", time_of_day / 3600, (time_of_day % 3600) / 60, time_of_day % 60)
}

/// Howard Hinnant's civil_from_days algorithm (public domain), used to avoid a chrono dependency.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Builds the native Windows menu bar (File / Help) and wires each item to an event the frontend
/// listens for — the menu itself has no app logic, it just tells the frontend what was clicked.
fn build_menu(app: &tauri::App) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

    let new_item = MenuItemBuilder::with_id("file-new", "New Cozyverse…").accelerator("CmdOrCtrl+N").build(app)?;
    let open_item = MenuItemBuilder::with_id("file-open", "Open Cozyverse…").accelerator("CmdOrCtrl+O").build(app)?;
    let save_item = MenuItemBuilder::with_id("file-save", "Save").accelerator("CmdOrCtrl+S").build(app)?;
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&new_item)
        .item(&open_item)
        .separator()
        .item(&save_item)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("Exit"))?)
        .build()?;

    let docs_item = MenuItemBuilder::with_id("help-docs", "Documentation").build(app)?;
    let about_item = MenuItemBuilder::with_id("help-about", "About Cozyverse Studio").build(app)?;
    let help_menu = SubmenuBuilder::new(app, "Help").item(&docs_item).item(&about_item).build()?;

    MenuBuilder::new(app).item(&file_menu).item(&help_menu).build()
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let menu = build_menu(app)?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            use tauri::Emitter;
            let frontend_event = match event.id().as_ref() {
                "file-new" => Some("menu-new"),
                "file-open" => Some("menu-open"),
                "file-save" => Some("menu-save"),
                "help-docs" => Some("menu-docs"),
                "help-about" => Some("menu-about"),
                _ => None,
            };
            if let Some(name) = frontend_event {
                let _ = app.emit(name, ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_cozyverses,
            create_cozyverse,
            open_cozyverse,
            save_cozyverse_json,
            save_world_json,
            rename_cozyverse,
            duplicate_cozyverse,
            delete_cozyverse,
            import_asset,
            save_generated_asset,
            asset_file_url,
            asset_as_data_url,
            export_asset_file,
            delete_asset_file,
            export_cozyverse,
            providers::save_provider_key,
            providers::provider_key_status,
            providers::delete_provider_key,
            providers::check_provider_connection,
            providers::submit_generation,
            providers::poll_generation,
            providers::generation_result,
            providers::save_asset_from_url,
            providers::gemini_generate_text,
            providers::elevenlabs_list_voices,
            providers::list_local_models,
            providers::save_local_model,
            providers::delete_local_model,
            providers::comfyui_test_connection,
            video_export::ffmpeg_available,
            video_export::reveal_in_explorer,
            video_export::save_video_copy,
            video_export::render_scene_video,
            video_export::render_timeline_shot,
            video_export::finish_timeline_render,
            decompose::decompose_image,
            decompose::submit_decomposition,
            decompose::get_decomposition,
            decompose::list_decompositions,
            decompose::decompose_forget_job,
            decompose::decompose_cancel_job,
            decompose::decompose_provider_keys,
            decompose::reveal_decompose_output,
            decompose::decompose_scene_path,
            decompose::decompose_export_pack,
            decompose_setup::decompose_runtime_status,
            decompose_setup::setup_decompose_runtime,
            app_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Cozyverse Studio");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn epoch_maps_to_1970_01_01() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
    }

    #[test]
    fn known_date_round_trips() {
        // 2024-01-01 is 19723 days after the epoch.
        assert_eq!(civil_from_days(19723), (2024, 1, 1));
    }

    fn temp_root(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cozyverse-{label}-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Golden path: create -> define world -> save -> close (drop in-memory state) -> reopen -> everything restored.
    #[test]
    fn golden_path_create_edit_reopen_survives_restart() {
        let root = temp_root("golden-path");

        let created = create_cozyverse_impl(&root, "Rainy Tokyo Loft").expect("create should succeed");
        assert_eq!(created.name, "Rainy Tokyo Loft");
        assert!(root.join(&created.dir_name).join("assets/images").is_dir());
        assert!(root.join(&created.dir_name).join("assets/video").is_dir());
        assert!(root.join(&created.dir_name).join("assets/audio").is_dir());
        assert!(root.join(&created.dir_name).join("thumbnails").is_dir());
        assert!(root.join(&created.dir_name).join("exports").is_dir());

        // Simulate the World Bible editor writing a filled-in world.json, as the frontend does on autosave.
        let filled_world = serde_json::json!({
            "name": "Rainy Tokyo Loft", "shortConcept": "A warm reading loft above the rainy city.",
            "description": "Floor-to-ceiling windows, warm lamps, books.", "mood": "Cozy, calm, dreamy",
            "artStyle": "Cinematic illustration", "colorPalette": ["#8b7bf6", "#2a2a3d"],
            "locationEnvironment": "Tokyo, high-rise loft", "architecture": "Modern Japanese, wood, warm interior",
            "importantObjects": "Bookshelves, tea set", "characters": "", "cameraComposition": "Wide, from corner",
            "lighting": "Warm lamps", "weather": "Rain", "timeOfDay": "Night", "thingsToAvoid": "", "additionalNotes": "",
        });
        let project_dir = project_path_impl(&root, &created.dir_name).unwrap();
        write_json_atomic(project_dir.join("world.json"), &serde_json::to_string_pretty(&filled_world).unwrap()).expect("world.json should save");

        // "Close" the app (nothing persists in memory) and "reopen" by reading straight from disk again.
        let reopened = open_cozyverse_impl(&root, created.dir_name.clone()).expect("reopen should succeed");
        let world: Value = serde_json::from_str(&reopened.world_json).unwrap();
        assert_eq!(world["shortConcept"], "A warm reading loft above the rainy city.");
        assert_eq!(world["weather"], "Rain");
        assert_eq!(world["colorPalette"][0], "#8b7bf6");

        let cozyverse: Value = serde_json::from_str(&reopened.cozyverse_json).unwrap();
        assert_eq!(cozyverse["metadata"]["name"], "Rainy Tokyo Loft");

        // The project must also show up in the dashboard listing after restart.
        let listed = list_cozyverses_impl(&root).expect("list should succeed");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "Rainy Tokyo Loft");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn rename_updates_folder_and_both_json_files() {
        let root = temp_root("rename");
        let created = create_cozyverse_impl(&root, "Mountain Cabin").unwrap();
        let renamed = rename_cozyverse_impl(&root, &created.dir_name, "Snowy Mountain Cabin").expect("rename should succeed");
        assert_eq!(renamed.name, "Snowy Mountain Cabin");
        assert!(!root.join(&created.dir_name).exists());
        let reopened = open_cozyverse_impl(&root, renamed.dir_name).unwrap();
        let world: Value = serde_json::from_str(&reopened.world_json).unwrap();
        assert_eq!(world["name"], "Snowy Mountain Cabin");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn duplicate_creates_an_independent_copy() {
        let root = temp_root("duplicate");
        let created = create_cozyverse_impl(&root, "Ocean House").unwrap();
        let duplicated = duplicate_cozyverse_impl(&root, &created.dir_name).expect("duplicate should succeed");
        assert_ne!(duplicated.dir_name, created.dir_name);
        assert_ne!(duplicated.id, created.id);
        assert!(root.join(&created.dir_name).exists(), "original must survive duplication");
        assert!(root.join(&duplicated.dir_name).exists());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn delete_moves_project_to_trash_not_permanent_removal() {
        let root = temp_root("delete");
        let created = create_cozyverse_impl(&root, "Forest Treehouse").unwrap();
        delete_cozyverse_impl(&root, &created.dir_name).expect("delete should succeed");
        assert!(!root.join(&created.dir_name).exists());
        let trash_entries = fs::read_dir(root.join("_trash")).unwrap().filter_map(Result::ok).count();
        assert_eq!(trash_entries, 1, "deleted project should be recoverable from _trash");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn saved_generated_image_asset_decodes_and_lands_in_assets_images() {
        let root = temp_root("generated-asset");
        let created = create_cozyverse_impl(&root, "Generated Asset Test").unwrap();
        let project_dir = project_path_impl(&root, &created.dir_name).unwrap();
        // A 1x1 transparent PNG, as the mock provider's canvas.toDataURL would produce.
        let data_url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
        let saved = save_generated_asset_impl(&project_dir, "image", data_url, "png").expect("save should succeed");
        assert!(saved.file_path.starts_with("images/"));
        assert!(saved.bytes > 0);
        assert!(project_dir.join("assets").join(&saved.file_path).is_file());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn save_generated_asset_rejects_unknown_asset_type() {
        let root = temp_root("bad-asset-type");
        let created = create_cozyverse_impl(&root, "Bad Type Test").unwrap();
        let project_dir = project_path_impl(&root, &created.dir_name).unwrap();
        let result = save_generated_asset_impl(&project_dir, "sculpture", "data:image/png;base64,AAAA", "png");
        assert!(result.is_err());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn deleting_an_asset_file_moves_it_to_assets_trash_not_permanent_removal() {
        let root = temp_root("delete-asset");
        let created = create_cozyverse_impl(&root, "Delete Asset Test").unwrap();
        let project_dir = project_path_impl(&root, &created.dir_name).unwrap();
        let data_url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
        let saved = save_generated_asset_impl(&project_dir, "image", data_url, "png").unwrap();

        delete_asset_file_impl(&project_dir, &saved.file_path).expect("delete should succeed");
        assert!(!project_dir.join("assets").join(&saved.file_path).exists());
        let trash_entries = fs::read_dir(project_dir.join("assets").join("_trash")).unwrap().filter_map(Result::ok).count();
        assert_eq!(trash_entries, 1, "deleted asset should be recoverable from assets/_trash");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn deleting_a_missing_asset_file_is_not_an_error() {
        let root = temp_root("delete-missing-asset");
        let created = create_cozyverse_impl(&root, "Missing Asset Test").unwrap();
        let project_dir = project_path_impl(&root, &created.dir_name).unwrap();
        assert!(delete_asset_file_impl(&project_dir, "images/does-not-exist.png").is_ok());
        fs::remove_dir_all(&root).ok();
    }

    fn read_zip_entry_names(zip_path: &Path) -> Vec<String> {
        let file = fs::File::open(zip_path).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        (0..archive.len()).map(|index| archive.by_index(index).unwrap().name().to_owned()).collect()
    }

    fn read_zip_entry_contents(zip_path: &Path, entry_name: &str) -> String {
        let file = fs::File::open(zip_path).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let mut entry = archive.by_name(entry_name).unwrap();
        let mut contents = String::new();
        std::io::Read::read_to_string(&mut entry, &mut contents).unwrap();
        contents
    }

    #[test]
    fn export_zip_contains_manifest_and_assets_but_excludes_trash() {
        let root = temp_root("export");
        let created = create_cozyverse_impl(&root, "Export Test").unwrap();
        let project_dir = project_path_impl(&root, &created.dir_name).unwrap();
        let data_url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
        let saved = save_generated_asset_impl(&project_dir, "image", data_url, "png").unwrap();

        // Simulate a soft-deleted asset that must NOT end up in the portable export.
        let trash_dir = project_dir.join("assets").join("_trash");
        fs::create_dir_all(&trash_dir).unwrap();
        fs::write(trash_dir.join("deleted.png"), b"should not be exported").unwrap();

        let manifest = r#"{"format":"cozyverse-package","version":1,"name":"Export Test"}"#;
        let destination = root.join("export-test.zip");
        write_export_zip(&project_dir, manifest, Some(&saved.file_path), &destination).expect("export should succeed");

        let entries = read_zip_entry_names(&destination);
        assert!(entries.contains(&"cozyverse.json".to_string()));
        assert!(entries.iter().any(|name| name == &format!("assets/{}", saved.file_path)));
        assert!(entries.iter().any(|name| name.starts_with("thumbnail.")));
        assert!(!entries.iter().any(|name| name.contains("_trash")), "trashed assets must not appear in the export: {entries:?}");

        assert_eq!(read_zip_entry_contents(&destination, "cozyverse.json"), manifest);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn export_rejects_invalid_manifest_json_before_touching_disk() {
        assert!(validate_manifest_json("{ not valid json").is_err());
        assert!(validate_manifest_json(r#"{"format":"cozyverse-package"}"#).is_ok());
    }

    #[test]
    fn opening_a_corrupt_cozyverse_json_is_rejected_not_loaded() {
        let root = temp_root("corrupt");
        let created = create_cozyverse_impl(&root, "Corrupt Test").unwrap();
        let project_dir = project_path_impl(&root, &created.dir_name).unwrap();
        fs::write(project_dir.join("cozyverse.json"), "{ not valid json").unwrap();
        let result = open_cozyverse_impl(&root, created.dir_name);
        assert!(result.is_err(), "corrupt project files must fail validation instead of silently loading");
        fs::remove_dir_all(&root).ok();
    }
}
