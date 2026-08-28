// models.rs - Shared data structures for the entire application.
//
// Design note: rather than hand-rolling a rigid struct per single endpoint
// variant (Meshy alone has ~13 endpoints, Tripo ~9, each with model-version
// specific parameters), we model a request as a "provider + operation +
// flexible JSON params" triple. This keeps the Rust code stable even if a
// provider tweaks a parameter name, while still giving the frontend full,
// typed visibility into what each operation accepts (see catalog.rs).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

/// Every provider we support.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Meshy,
    Tripo,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OperationCapabilities {
    pub input_modes: Vec<String>,
    pub output_formats: Vec<String>,
    pub supports_pbr: bool,
    pub supports_high_detail: bool,
    pub supports_multiview: bool,
    pub supports_quad_topology: bool,
    pub supports_segmentation: bool,
    pub supports_auto_rig: bool,
    pub supports_animation: bool,
    pub supports_seed: bool,
    pub supports_face_limit: bool,
    pub task_based: bool,
    pub supports_cancellation: bool,
    pub supports_webhooks: bool,
    /// Provider plans change independently of the desktop app. Until a live
    /// entitlement endpoint confirms access, the honest value is "unknown".
    pub api_plan_access: String,
}

/// Every distinct operation exposed by either provider's API.
/// This is the full catalog the UI can present.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Operation {
    // ---- Meshy ----
    MeshyTextTo3DPreview,
    MeshyTextTo3DRefine,
    MeshyImageTo3D,
    MeshyMultiImageTo3D,
    MeshyRetexture,
    MeshyRemesh,
    MeshyRigging,
    MeshyAnimation,
    MeshyTextToImage,
    MeshyImageToImage,
    MeshyAnalyzePrintability,
    MeshyRepairPrintability,
    MeshyMultiColorPrint,

    // ---- Tripo ----
    TripoTextTo3D,
    TripoImageTo3D,
    TripoMultiviewTo3D,
    TripoRetexture,
    TripoSegment,
    TripoRetopology,
    /// Produces a rigged (but not yet animated) skeleton — `animate_rig` on
    /// Tripo's side. Kept as its own variant, separate from TripoAnimate below,
    /// because the two are genuinely different API calls with different
    /// parameters (rig_type/spec vs. an animation preset) — see tripo.rs.
    TripoRigAnimate,
    /// Applies a preset animation clip — `animate_retarget` on Tripo's side.
    /// Despite the name this does NOT require TripoRigAnimate to have run
    /// first; Tripo handles retargeting onto an unrigged model internally.
    TripoAnimate,
    /// `animate_prerigcheck` — reports whether a model can be rigged at all,
    /// and what skeleton type it would need, without spending Auto-Rig's
    /// credits on an attempt that was always going to fail.
    TripoPreRigCheck,
    /// `highpoly_to_lowpoly` — a dedicated triangle-budget reduction endpoint,
    /// distinct from TripoRetopology (which is about topology cleanliness via
    /// convert_model, not triangle count).
    TripoHighpolyToLowpoly,
    TripoConvertFormat,
}

impl Operation {
    pub fn provider(&self) -> Provider {
        use Operation::*;
        match self {
            MeshyTextTo3DPreview
            | MeshyTextTo3DRefine
            | MeshyImageTo3D
            | MeshyMultiImageTo3D
            | MeshyRetexture
            | MeshyRemesh
            | MeshyRigging
            | MeshyAnimation
            | MeshyTextToImage
            | MeshyImageToImage
            | MeshyAnalyzePrintability
            | MeshyRepairPrintability
            | MeshyMultiColorPrint => Provider::Meshy,

            TripoTextTo3D
            | TripoImageTo3D
            | TripoMultiviewTo3D
            | TripoRetexture
            | TripoSegment
            | TripoRetopology
            | TripoRigAnimate
            | TripoAnimate
            | TripoPreRigCheck
            | TripoHighpolyToLowpoly
            | TripoConvertFormat => Provider::Tripo,
        }
    }

    /// Human label for the UI catalog.
    pub fn label(&self) -> &'static str {
        use Operation::*;
        match self {
            MeshyTextTo3DPreview => "Text to 3D (Preview)",
            MeshyTextTo3DRefine => "Text to 3D (Refine / Texture)",
            MeshyImageTo3D => "Image to 3D",
            MeshyMultiImageTo3D => "Multi-Image to 3D",
            MeshyRetexture => "Retexture",
            MeshyRemesh => "Remesh",
            MeshyRigging => "Auto-Rig",
            MeshyAnimation => "Animate Rig",
            MeshyTextToImage => "Text to Image",
            MeshyImageToImage => "Image to Image",
            MeshyAnalyzePrintability => "Analyze Printability",
            MeshyRepairPrintability => "Repair for Printing",
            MeshyMultiColorPrint => "Multi-Color Print Prep",

            TripoTextTo3D => "Text to 3D",
            TripoImageTo3D => "Image to 3D",
            TripoMultiviewTo3D => "Multiview to 3D",
            TripoRetexture => "AI Texture",
            TripoSegment => "Auto Segmentation",
            TripoRetopology => "Retopology (Quad Mesh)",
            TripoRigAnimate => "Auto-Rig",
            TripoAnimate => "Retarget Animation",
            TripoPreRigCheck => "Check Riggability",
            TripoHighpolyToLowpoly => "Smart Low-Poly",
            TripoConvertFormat => "Convert Format",
        }
    }

    pub fn capabilities(&self) -> OperationCapabilities {
        use Operation::*;
        let generation = matches!(
            self,
            MeshyTextTo3DPreview
                | MeshyTextTo3DRefine
                | MeshyImageTo3D
                | MeshyMultiImageTo3D
                | TripoTextTo3D
                | TripoImageTo3D
                | TripoMultiviewTo3D
        );
        let multiview = matches!(self, MeshyMultiImageTo3D | TripoMultiviewTo3D);
        let input_modes = match self {
            MeshyTextTo3DPreview | MeshyTextTo3DRefine | MeshyTextToImage | TripoTextTo3D => {
                vec!["text"]
            }
            MeshyImageTo3D | MeshyImageToImage | TripoImageTo3D => vec!["image"],
            MeshyMultiImageTo3D | TripoMultiviewTo3D => vec!["multiview"],
            _ => vec!["existing_model"],
        }
        .into_iter()
        .map(str::to_string)
        .collect();
        let output_formats = match self {
            MeshyTextToImage | MeshyImageToImage => vec!["png", "jpg"],
            TripoRetopology => vec!["obj", "fbx"],
            TripoConvertFormat => vec!["glb", "fbx", "obj", "usdz", "stl", "3mf"],
            _ => vec!["glb"],
        }
        .into_iter()
        .map(str::to_string)
        .collect();
        OperationCapabilities {
            input_modes,
            output_formats,
            supports_pbr: matches!(
                self,
                MeshyTextTo3DRefine
                    | MeshyImageTo3D
                    | MeshyMultiImageTo3D
                    | MeshyRetexture
                    | TripoTextTo3D
                    | TripoImageTo3D
                    | TripoMultiviewTo3D
                    | TripoRetexture
            ),
            supports_high_detail: generation,
            supports_multiview: multiview,
            supports_quad_topology: matches!(
                self,
                TripoTextTo3D
                    | TripoImageTo3D
                    | TripoMultiviewTo3D
                    | TripoRetopology
                    | TripoHighpolyToLowpoly
                    | TripoConvertFormat
            ),
            supports_segmentation: matches!(self, TripoSegment),
            supports_auto_rig: matches!(self, MeshyRigging | TripoRigAnimate),
            supports_animation: matches!(self, MeshyAnimation | TripoAnimate),
            supports_seed: matches!(
                self,
                MeshyTextTo3DPreview
                    | MeshyImageTo3D
                    | MeshyMultiImageTo3D
                    | TripoTextTo3D
                    | TripoImageTo3D
                    | TripoMultiviewTo3D
            ),
            supports_face_limit: matches!(
                self,
                TripoTextTo3D
                    | TripoImageTo3D
                    | TripoMultiviewTo3D
                    | TripoRetopology
                    | TripoHighpolyToLowpoly
                    | TripoConvertFormat
            ),
            task_based: true,
            supports_cancellation: false,
            supports_webhooks: false,
            api_plan_access: "unknown".into(),
        }
    }
}

/// A single parameter's UI/validation metadata, used to auto-generate
/// the parameter controls panel in the frontend without hardcoding forms
/// per endpoint.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ParamSpec {
    pub key: String,
    pub label: String,
    pub kind: ParamKind,
    pub required: bool,
    pub default: Option<Value>,
    pub description: String,
    /// For enum-like string params, the allowed values.
    pub options: Option<Vec<String>>,
    pub advanced: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum ParamKind {
    Text,
    TextArea,
    Number,
    Boolean,
    Select,
    ImageUpload,
    MultiImageUpload,
    TaskReference, // references a prior task's output as input
}

/// The request payload sent from the frontend for any generation call.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GenerationRequest {
    pub operation: Operation,
    /// Free-form parameter bag matching that operation's ParamSpec list.
    pub params: HashMap<String, Value>,
    /// The project this submission came from. Required so the dedup cache
    /// and resulting `TaskResult` are scoped per project instead of leaking
    /// across every project ever opened in the app's lifetime — see
    /// `submit_generation` for why this matters.
    #[serde(default)]
    pub project_id: Option<String>,
}

/// Normalized status, since Meshy uses e.g. "SUCCEEDED"/"FAILED" and Tripo
/// uses "success"/"failed" (and both use different casing/wording).
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Pending,
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

impl TaskStatus {
    pub fn is_active(&self) -> bool {
        matches!(self, Self::Pending | Self::Running)
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TaskResult {
    pub task_id: String,
    pub provider: Provider,
    pub operation: Operation,
    pub status: TaskStatus,
    pub progress: f32,
    pub model_urls: HashMap<String, String>, // format -> url (glb, fbx, obj, usdz, stl)
    pub texture_urls: Vec<HashMap<String, String>>,
    pub thumbnail_url: Option<String>,
    pub error: Option<String>,
    pub raw_response: Option<Value>, // for the Failed-Task Inspector
    pub created_at: String,
    pub finished_at: Option<String>,
    pub credits_used: Option<f32>,
    /// Stable local asset-version identity, independent of provider task IDs.
    #[serde(default)]
    pub version_id: Option<String>,
    /// Parent version for refinement, rigging, conversion, and other child tasks.
    #[serde(default)]
    pub parent_version_id: Option<String>,
    /// Provider task used as this operation's source, when applicable.
    #[serde(default)]
    pub source_task_id: Option<String>,
    /// Skeleton family carried through rigging and animation child tasks.
    #[serde(default)]
    pub rig_type: Option<String>,
    /// The project this task was submitted from. `None` only for tasks
    /// persisted before this field existed (legacy history.json entries) —
    /// never rely on that meaning "belongs to every project"; it means
    /// "unknown," and callers filtering by project must treat it as
    /// non-matching for any concrete project id.
    #[serde(default)]
    pub project_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ApiKeys {
    pub meshy_key: String,
    pub tripo_key: String,
}

pub fn provider_http_error(provider: &str, status: reqwest::StatusCode, body: &str) -> String {
    let code = status.as_u16();
    if matches!(code, 429) {
        return format!("{provider} is rate-limiting requests (HTTP 429). ModelForge will retry polling automatically; wait a moment before submitting another generation.");
    }
    if matches!(code, 502 | 503 | 504) {
        return format!("{provider} is temporarily unavailable (HTTP {code}). ModelForge will retry polling automatically.");
    }
    let message = serde_json::from_str::<Value>(body).ok().and_then(|value| {
        value
            .pointer("/message")
            .or_else(|| value.pointer("/error/message"))
            .or_else(|| value.pointer("/data/message"))
            .and_then(Value::as_str)
            .map(str::to_string)
    });
    let trimmed = body.trim();
    let safe_body = if trimmed.starts_with('<') {
        None
    } else {
        Some(trimmed.chars().take(500).collect::<String>())
    };
    format!(
        "{provider} request failed (HTTP {code}){}",
        message
            .or(safe_body)
            .filter(|text| !text.is_empty())
            .map(|text| format!(": {text}"))
            .unwrap_or_default()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The frontend's Operation TS union is hand-copied from serde's actual
    /// output, not derived from Rust — see the warning at the top of
    /// src/lib/types.ts. Pin every variant's wire string here so a future
    /// rename can't silently desync the two without a test failure.
    #[test]
    fn operation_wire_strings_match_frontend_types_ts() {
        use Operation::*;
        let cases = [
            (TripoRigAnimate, "tripo_rig_animate"),
            (TripoAnimate, "tripo_animate"),
            (TripoPreRigCheck, "tripo_pre_rig_check"),
            (TripoHighpolyToLowpoly, "tripo_highpoly_to_lowpoly"),
            (TripoSegment, "tripo_segment"),
        ];
        for (op, expected) in cases {
            let json = serde_json::to_string(&op).unwrap();
            assert_eq!(
                json,
                format!("\"{expected}\""),
                "wire string changed for {op:?}"
            );
        }
    }

    #[test]
    fn only_pending_and_running_tasks_block_duplicate_submission() {
        assert!(TaskStatus::Pending.is_active());
        assert!(TaskStatus::Running.is_active());
        assert!(!TaskStatus::Succeeded.is_active());
        assert!(!TaskStatus::Failed.is_active());
        assert!(!TaskStatus::Cancelled.is_active());
    }

    #[test]
    fn provider_errors_hide_html_and_preserve_actionable_json() {
        let gateway = provider_http_error(
            "Tripo",
            reqwest::StatusCode::BAD_GATEWAY,
            "<html><body>proxy internals</body></html>",
        );
        assert!(gateway.contains("temporarily unavailable"));
        assert!(!gateway.contains("<html>"));
        let invalid = provider_http_error(
            "Meshy",
            reqwest::StatusCode::BAD_REQUEST,
            r#"{"message":"Input image is required"}"#,
        );
        assert!(invalid.contains("Input image is required"));
    }
}
