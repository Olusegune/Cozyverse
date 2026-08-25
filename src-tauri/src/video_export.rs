//! Video export: Tier 1 renders a single Scene Composer scene into a standalone .mp4 — motion
//! clip (looped/trimmed to a set duration) or a Ken Burns pan over the background image if no
//! motion clip exists, with ambience + music mixed down to one audio track at the scene's own
//! volume levels. Tier 2 (cut-only) renders an ordered Timeline of shots the same way, one clip
//! per shot (render_timeline_shot, called once per shot from the frontend so it can report real
//! "shot 2 of 4" progress between calls), then stitches them with ffmpeg's concat demuxer
//! (finish_timeline_render). Shells out to a system `ffmpeg` (via std/tokio Command) rather than
//! bundling a static binary — intentionally the smaller scope; bundling can follow if this proves out.

use std::path::{Path, PathBuf};
use tauri::AppHandle;

// ffmpeg (and explorer) are console/GUI subprocesses launched from this GUI app — without this
// flag Windows briefly flashes their console window on screen for every single invocation, which
// on a multi-shot Storyboard render means a black box popping in and out repeatedly. This is the
// standard fix: https://learn.microsoft.com/windows/win32/procthread/process-creation-flags
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Lets the user Save As a copy of an already-rendered file (a Scene Composer or Storyboard
/// video) to wherever they choose — the native save dialog, same pattern as export_asset_file.
#[tauri::command]
pub fn save_video_copy(source_path: String, suggested_name: String) -> Result<Option<String>, String> {
    let source = std::path::Path::new(&source_path);
    if !source.is_file() {
        return Err("That rendered file no longer exists.".into());
    }
    let destination = rfd::FileDialog::new().set_file_name(&suggested_name).add_filter("mp4", &["mp4"]).save_file();
    destination
        .map(|path| {
            std::fs::copy(source, &path).map_err(|error| format!("Could not save a copy: {error}"))?;
            Ok(path.to_string_lossy().into_owned())
        })
        .transpose()
}

/// Opens Windows Explorer with the rendered file pre-selected — the counterpart to just handing
/// the user a raw path string, which is not a usable way to see a video you just rendered.
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    let mut command = std::process::Command::new("explorer");
    command.arg(format!("/select,{path}"));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command.spawn().map(|_| ()).map_err(|error| format!("Could not open Explorer: {error}"))
}

fn ffmpeg_command(program: &str) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(program);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[tauri::command]
pub async fn ffmpeg_available() -> bool {
    ffmpeg_command("ffmpeg")
        .arg("-version")
        .output()
        .await
        .map(|output| output.status.success())
        .unwrap_or(false)
}

async fn run_ffmpeg(args: &[String]) -> Result<(), String> {
    let output = ffmpeg_command("ffmpeg")
        .args(args)
        .output()
        .await
        .map_err(|error| format!("Could not run ffmpeg — is it installed and on your PATH? ({error})"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // ffmpeg's own logs are long and mostly boilerplate — the actual error is almost always
        // in the last few lines, so trim to keep the toast readable.
        let tail: String = stderr.lines().rev().take(8).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
        return Err(format!("ffmpeg failed:\n{tail}"));
    }
    Ok(())
}

/// Pure ffmpeg argument builder — no filesystem or process I/O, so this is directly unit
/// testable. Input 0 is always the video source (motion clip, or a single looped still image
/// that the zoompan filter turns into a slow Ken Burns pan); any combination of ambience/music
/// audio inputs follows and gets mixed down to one output track. Every rendered clip always
/// carries an audio stream — silence via `anullsrc` when no ambience/music is set — so Tier 2's
/// concat demuxer can stitch shots with `-c copy` without hitting a stream-layout mismatch
/// between a silent (no audio track) clip and an audible one.
fn build_ffmpeg_args(
    motion_path: Option<&Path>,
    background_path: Option<&Path>,
    ambience_path: Option<&Path>,
    ambience_volume: f64,
    music_path: Option<&Path>,
    music_volume: f64,
    duration: u32,
    output_path: &Path,
) -> Result<Vec<String>, String> {
    if motion_path.is_none() && background_path.is_none() {
        return Err("This scene has no background image or motion clip to render.".into());
    }

    let mut args: Vec<String> = vec!["-y".into()];

    let is_motion = motion_path.is_some();
    if let Some(path) = motion_path {
        args.extend(["-stream_loop".into(), "-1".into(), "-i".into(), path.to_string_lossy().into_owned()]);
    } else if let Some(path) = background_path {
        args.extend(["-loop".into(), "1".into(), "-i".into(), path.to_string_lossy().into_owned()]);
    }

    let mut audio_labels: Vec<String> = Vec::new();
    let mut next_input_index = 1;
    let mut filter_parts: Vec<String> = Vec::new();

    let video_filter = if is_motion {
        "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black".to_string()
    } else {
        // zoompan builds the video entirely from the single looped input frame, so no separate
        // loop count is needed beyond the -loop 1 above — d= is the total output frame count.
        format!(
            "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=z='min(zoom+0.0008,1.15)':d={}:s=1920x1080:fps=25",
            duration * 25
        )
    };
    filter_parts.push(format!("[0:v]{video_filter}[vout]"));

    if let Some(path) = ambience_path {
        args.extend(["-stream_loop".into(), "-1".into(), "-i".into(), path.to_string_lossy().into_owned()]);
        let label = format!("a{next_input_index}");
        filter_parts.push(format!("[{next_input_index}:a]volume={ambience_volume}[{label}]"));
        audio_labels.push(label);
        next_input_index += 1;
    }
    if let Some(path) = music_path {
        args.extend(["-stream_loop".into(), "-1".into(), "-i".into(), path.to_string_lossy().into_owned()]);
        let label = format!("a{next_input_index}");
        filter_parts.push(format!("[{next_input_index}:a]volume={music_volume}[{label}]"));
        audio_labels.push(label);
        next_input_index += 1;
    }
    if audio_labels.is_empty() {
        args.extend(["-f".into(), "lavfi".into(), "-i".into(), "anullsrc=channel_layout=stereo:sample_rate=44100".into()]);
        let label = format!("a{next_input_index}");
        filter_parts.push(format!("[{next_input_index}:a]anull[{label}]"));
        audio_labels.push(label);
    }

    let audio_out = match audio_labels.as_slice() {
        [only] => only.clone(),
        [first, second] => {
            filter_parts.push(format!("[{first}][{second}]amix=inputs=2:duration=longest:dropout_transition=0[aout]"));
            "aout".to_string()
        }
        // audio_labels always holds at least the anullsrc fallback, and never more than ambience + music.
        [] | [_, _, ..] => unreachable!(),
    };

    args.extend(["-filter_complex".into(), filter_parts.join(";")]);
    args.extend(["-map".into(), "[vout]".into()]);
    args.extend(["-map".into(), format!("[{audio_out}]")]);
    args.extend(["-t".into(), duration.to_string()]);
    args.extend(["-c:v".into(), "libx264".into(), "-pix_fmt".into(), "yuv420p".into()]);
    args.extend(["-c:a".into(), "aac".into(), "-b:a".into(), "192k".into()]);
    args.push(output_path.to_string_lossy().into_owned());

    Ok(args)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn render_scene_video(
    app: AppHandle,
    dir_name: String,
    scene_name: String,
    background_rel_path: Option<String>,
    motion_rel_path: Option<String>,
    ambience_rel_path: Option<String>,
    ambience_volume: f64,
    music_rel_path: Option<String>,
    music_volume: f64,
    duration_seconds: u32,
) -> Result<String, String> {
    let project_dir = crate::project_path(&app, &dir_name)?;
    let assets_dir = project_dir.join("assets");
    let resolve = |relative: &Option<String>| -> Option<PathBuf> { relative.as_ref().map(|value| assets_dir.join(value)) };

    let duration = duration_seconds.clamp(2, 120);
    let exports_dir = project_dir.join("exports");
    std::fs::create_dir_all(&exports_dir).map_err(|error| format!("Could not prepare the exports folder: {error}"))?;
    let stamp = format!("{:x}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs());
    let output_path = exports_dir.join(format!("{}-{stamp}.mp4", crate::slugify(&scene_name)));

    let args = build_ffmpeg_args(
        resolve(&motion_rel_path).as_deref(),
        resolve(&background_rel_path).as_deref(),
        resolve(&ambience_rel_path).as_deref(),
        ambience_volume,
        resolve(&music_rel_path).as_deref(),
        music_volume,
        duration,
        &output_path,
    )?;
    run_ffmpeg(&args).await?;

    Ok(output_path.to_string_lossy().into_owned())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineShotInput {
    background_rel_path: Option<String>,
    motion_rel_path: Option<String>,
    ambience_rel_path: Option<String>,
    ambience_volume: f64,
    music_rel_path: Option<String>,
    music_volume: f64,
    duration_seconds: u32,
}

/// Tier 2, cut-only, split into per-shot calls (render_timeline_shot × N, then
/// finish_timeline_render) instead of one blocking command — this is what lets the frontend
/// report real "rendering shot 2 of 4" progress between shots rather than one opaque wait for the
/// whole reel. `session` is a caller-generated id (e.g. a UUID) shared across every call in one
/// render, used only to namespace this render's temp folder from any other.
fn timeline_temp_dir(exports_dir: &Path, session: &str) -> PathBuf {
    exports_dir.join(format!(".timeline-{session}"))
}

#[tauri::command]
pub async fn render_timeline_shot(app: AppHandle, dir_name: String, session: String, index: u32, shot: TimelineShotInput) -> Result<(), String> {
    let project_dir = crate::project_path(&app, &dir_name)?;
    let assets_dir = project_dir.join("assets");
    let resolve = |relative: &Option<String>| -> Option<PathBuf> { relative.as_ref().map(|value| assets_dir.join(value)) };

    let exports_dir = project_dir.join("exports");
    let temp_dir = timeline_temp_dir(&exports_dir, &session);
    std::fs::create_dir_all(&temp_dir).map_err(|error| format!("Could not prepare a temp render folder: {error}"))?;

    let clip_path = temp_dir.join(format!("shot-{index:03}.mp4"));
    let args = build_ffmpeg_args(
        resolve(&shot.motion_rel_path).as_deref(),
        resolve(&shot.background_rel_path).as_deref(),
        resolve(&shot.ambience_rel_path).as_deref(),
        shot.ambience_volume,
        resolve(&shot.music_rel_path).as_deref(),
        shot.music_volume,
        shot.duration_seconds.clamp(2, 120),
        &clip_path,
    )?;
    run_ffmpeg(&args).await
}

/// Concatenates the shots already rendered by render_timeline_shot (found deterministically by
/// their shot-NNN.mp4 naming — no need to pass paths back) with ffmpeg's concat demuxer using
/// `-c copy` (no re-encode), safe because every shot clip shares the same 1920x1080 h264/aac
/// layout. Cleans up the temp folder whether this succeeds or fails.
#[tauri::command]
pub async fn finish_timeline_render(app: AppHandle, dir_name: String, session: String, shot_count: u32) -> Result<String, String> {
    let project_dir = crate::project_path(&app, &dir_name)?;
    let exports_dir = project_dir.join("exports");
    let temp_dir = timeline_temp_dir(&exports_dir, &session);

    let result = finish_timeline_render_impl(&exports_dir, &temp_dir, &session, shot_count).await;
    let _ = std::fs::remove_dir_all(&temp_dir);
    result
}

async fn finish_timeline_render_impl(exports_dir: &Path, temp_dir: &Path, session: &str, shot_count: u32) -> Result<String, String> {
    let clip_paths: Vec<PathBuf> = (0..shot_count).map(|index| temp_dir.join(format!("shot-{index:03}.mp4"))).collect();
    for path in &clip_paths {
        if !path.is_file() {
            return Err(format!("Shot render {} is missing — it may have failed earlier in the queue.", path.display()));
        }
    }

    let list_path = temp_dir.join("concat-list.txt");
    // ffmpeg's concat demuxer format: each line is `file '<path>'`, with embedded single quotes
    // escaped as '\''  — the standard shell-quoting trick, since this file is parsed by ffmpeg's
    // own quoted-string reader, not a real shell.
    let list_contents = clip_paths
        .iter()
        .map(|path| format!("file '{}'", path.to_string_lossy().replace('\'', "'\\''")))
        .collect::<Vec<_>>()
        .join("\n");
    std::fs::write(&list_path, list_contents).map_err(|error| format!("Could not write the concat list: {error}"))?;

    let final_output = exports_dir.join(format!("story-reel-{session}.mp4"));
    let concat_args: Vec<String> = vec![
        "-y".into(),
        "-f".into(),
        "concat".into(),
        "-safe".into(),
        "0".into(),
        "-i".into(),
        list_path.to_string_lossy().into_owned(),
        "-c".into(),
        "copy".into(),
        final_output.to_string_lossy().into_owned(),
    ];
    run_ffmpeg(&concat_args).await?;

    Ok(final_output.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::{build_ffmpeg_args, finish_timeline_render_impl};
    use std::path::Path;

    #[tokio::test]
    async fn finish_timeline_render_reports_a_clear_error_when_a_shot_clip_is_missing() {
        let temp_dir = std::env::temp_dir().join(format!("cozyverse-timeline-test-{}", std::process::id()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::write(temp_dir.join("shot-000.mp4"), b"fake clip 1").unwrap();
        // shot-001.mp4 deliberately not written, simulating an earlier shot render that failed.

        let result = finish_timeline_render_impl(&temp_dir, &temp_dir, "test-session", 2).await;
        std::fs::remove_dir_all(&temp_dir).ok();

        assert!(result.is_err(), "concat must not silently proceed when a shot render is missing");
        let message = result.unwrap_err();
        assert!(message.contains("shot-001.mp4"), "the error should name the specific missing clip: {message}");
    }

    #[test]
    fn errors_when_scene_has_neither_motion_nor_background() {
        let result = build_ffmpeg_args(None, None, None, 0.7, None, 0.5, 8, Path::new("out.mp4"));
        assert!(result.is_err(), "a scene with no video source at all should be rejected before touching ffmpeg");
    }

    #[test]
    fn motion_clip_uses_scale_pad_not_zoompan() {
        let args = build_ffmpeg_args(Some(Path::new("clip.mp4")), None, None, 0.7, None, 0.5, 8, Path::new("out.mp4")).unwrap();
        let filter = args.iter().find(|arg| arg.contains("[0:v]")).expect("filter_complex should be present");
        assert!(filter.contains("pad=1920:1080"), "a real motion clip should be letterboxed, not Ken-Burns panned");
        assert!(!filter.contains("zoompan"), "zoompan is only for the still-image fallback");
    }

    #[test]
    fn still_image_only_uses_zoompan_ken_burns() {
        let args = build_ffmpeg_args(None, Some(Path::new("bg.png")), None, 0.7, None, 0.5, 10, Path::new("out.mp4")).unwrap();
        assert!(args.contains(&"-loop".to_string()), "a still image needs -loop 1 to give zoompan a source frame");
        let filter = args.iter().find(|arg| arg.contains("[0:v]")).expect("filter_complex should be present");
        assert!(filter.contains("zoompan"));
        assert!(filter.contains("d=250"), "duration_seconds * 25fps must set the zoompan frame count (10 * 25 = 250)");
    }

    #[test]
    fn no_audio_layers_falls_back_to_silence_for_concat_compatibility() {
        let args = build_ffmpeg_args(Some(Path::new("clip.mp4")), None, None, 0.7, None, 0.5, 8, Path::new("out.mp4")).unwrap();
        assert!(!args.contains(&"-an".to_string()), "every clip must carry an audio stream (even silent) so Tier 2's -c copy concat has a uniform layout");
        assert!(args.iter().any(|arg| arg.contains("anullsrc")), "silence must come from anullsrc, not just omitting audio");
        assert_eq!(args.iter().filter(|arg| *arg == "-map").count(), 2, "both the video and the silent audio stream must be mapped");
    }

    #[test]
    fn single_audio_layer_is_mapped_directly_without_amix() {
        let args = build_ffmpeg_args(Some(Path::new("clip.mp4")), None, Some(Path::new("ambience.mp3")), 0.6, None, 0.5, 8, Path::new("out.mp4")).unwrap();
        let filter_complex = args.iter().find(|arg| arg.contains("volume=0.6")).expect("ambience volume filter should be present");
        assert!(!filter_complex.contains("amix"), "a single audio layer needs no amix — that's only for combining two");
        assert!(!args.iter().any(|arg| arg.contains("anullsrc")), "a real audio layer means no silence fallback is needed");
        assert!(args.iter().any(|arg| arg == "[a1]"), "the single audio label should be mapped directly");
    }

    #[test]
    fn two_audio_layers_get_mixed_with_amix() {
        let args = build_ffmpeg_args(
            Some(Path::new("clip.mp4")),
            None,
            Some(Path::new("ambience.mp3")),
            0.6,
            Some(Path::new("music.mp3")),
            0.4,
            8,
            Path::new("out.mp4"),
        )
        .unwrap();
        let filter_complex = args.iter().find(|arg| arg.contains("amix")).expect("two audio layers must be combined with amix");
        assert!(filter_complex.contains("volume=0.6") && filter_complex.contains("volume=0.4"), "both volumes should be applied before mixing");
        assert!(args.iter().any(|arg| arg == "[aout]"), "the mixed output should be mapped as [aout]");
    }
}
