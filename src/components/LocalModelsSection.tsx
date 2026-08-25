import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Plus, Trash2, UploadCloud, XCircle } from "lucide-react";
import * as api from "../lib/api";
import type { LocalModelConfig } from "../lib/api";

type WorkflowNode = { class_type?: string; _meta?: { title?: string }; inputs?: Record<string, unknown> };
type Workflow = Record<string, WorkflowNode>;

function nodeLabel(id: string, node: WorkflowNode): string {
  const title = node._meta?.title || node.class_type || "Node";
  return `${title} (#${id})`;
}

const emptyDraft = {
  name: "",
  capability: "image" as LocalModelConfig["capability"],
  serverUrl: "http://127.0.0.1:8188",
  promptNodeId: "",
  promptField: "",
  imageNodeId: "",
  imageField: "",
};

export function LocalModelsSection() {
  const [models, setModels] = useState<LocalModelConfig[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [workflowFileName, setWorkflowFileName] = useState("");
  const [connection, setConnection] = useState<{ checking: boolean; result?: { reachable: boolean; authenticated: boolean; detail: string } }>({ checking: false });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = () => void api.listLocalModels().then(setModels).catch(() => setModels([]));
  useEffect(refresh, []);

  const resetDraft = () => {
    setDraft(emptyDraft);
    setWorkflow(null);
    setWorkflowFileName("");
    setConnection({ checking: false });
    setError(null);
  };

  const testConnection = async () => {
    setConnection({ checking: true });
    try {
      const result = await api.comfyuiTestConnection(draft.serverUrl.trim());
      setConnection({ checking: false, result });
    } catch (err) {
      setConnection({ checking: false, result: { reachable: false, authenticated: false, detail: err instanceof Error ? err.message : String(err) } });
    }
  };

  const handleWorkflowFile = async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Workflow;
      const nodeCount = Object.keys(parsed).length;
      if (nodeCount === 0) throw new Error("This workflow has no nodes.");
      setWorkflow(parsed);
      setWorkflowFileName(file.name);
      setDraft((current) => ({ ...current, promptNodeId: "", promptField: "", imageNodeId: "", imageField: "" }));
    } catch (err) {
      setWorkflow(null);
      setError(
        `Could not read this file as a ComfyUI API-format workflow: ${err instanceof Error ? err.message : String(err)}. ` +
          `In ComfyUI, use the menu's "Export (API)" option — not a plain workflow save — to get this format.`,
      );
    }
  };

  const promptNode = workflow && draft.promptNodeId ? workflow[draft.promptNodeId] : undefined;
  const imageNode = workflow && draft.imageNodeId ? workflow[draft.imageNodeId] : undefined;

  const save = async () => {
    if (!workflow) return;
    setSaving(true);
    setError(null);
    try {
      await api.saveLocalModel({
        id: crypto.randomUUID(),
        name: draft.name.trim() || "Local Model",
        capability: draft.capability,
        serverUrl: draft.serverUrl.trim(),
        workflow,
        promptNodeId: draft.promptNodeId,
        promptField: draft.promptField,
        imageNodeId: draft.imageNodeId || undefined,
        imageField: draft.imageNodeId ? draft.imageField : undefined,
      });
      resetDraft();
      setAdding(false);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    await api.deleteLocalModel(id);
    refresh();
  };

  const canSave = draft.name.trim() && workflow && draft.promptNodeId && draft.promptField && (!draft.imageNodeId || draft.imageField);

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-sm font-medium text-white">Local Models (ComfyUI)</h2>
          <p className="text-xs text-slate-500">
            Use your own ComfyUI setup — LTX, Wan, HunyuanVideo, or anything else you've got running — as a generation option. No API key, no cost, runs on
            your machine.
          </p>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent-500 hover:bg-accent-400 text-accentText">
            <Plus size={13} /> Add Local Model
          </button>
        )}
      </div>

      {models.length > 0 && (
        <div className="space-y-2 mb-4">
          {models.map((model) => (
            <div key={model.id} className="flex items-center justify-between rounded-lg border border-base-700 bg-base-900 px-4 py-2.5">
              <div>
                <p className="text-sm text-white">{model.name}</p>
                <p className="text-xs text-slate-500">
                  {model.capability} · {model.serverUrl}
                </p>
              </div>
              <button onClick={() => void remove(model.id)} className="text-slate-500 hover:text-red-400">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="rounded-xl border border-base-700 bg-base-900 p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Name</label>
              <input
                value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="e.g. Wan 2.2 Video"
                className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-1.5 text-sm text-white outline-none focus:border-accent-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Capability</label>
              <select
                value={draft.capability}
                onChange={(event) => setDraft((current) => ({ ...current, capability: event.target.value as LocalModelConfig["capability"] }))}
                className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-1.5 text-sm text-white outline-none focus:border-accent-500"
              >
                <option value="image">Image</option>
                <option value="video">Video</option>
                <option value="audio">Audio</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">ComfyUI Server URL</label>
            <div className="flex items-center gap-2">
              <input
                value={draft.serverUrl}
                onChange={(event) => setDraft((current) => ({ ...current, serverUrl: event.target.value }))}
                className="flex-1 bg-base-800 border border-base-600 rounded-md px-3 py-1.5 text-sm text-white outline-none focus:border-accent-500"
              />
              <button
                onClick={() => void testConnection()}
                disabled={connection.checking}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-base-600 text-slate-300 hover:text-white hover:border-accent-500 disabled:opacity-50 shrink-0"
              >
                {connection.checking ? <Loader2 size={13} className="animate-spin" /> : null} Test Connection
              </button>
            </div>
            {connection.result && (
              <span className={`flex items-center gap-1 text-xs mt-1.5 ${connection.result.reachable ? "text-green-400" : "text-yellow-400"}`}>
                {connection.result.reachable ? <CheckCircle2 size={13} /> : <XCircle size={13} />} {connection.result.detail}
              </span>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Workflow (API format)</label>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 rounded-md border border-dashed border-base-600 hover:border-accent-500 px-3 py-3 text-sm text-slate-400 hover:text-white"
            >
              <UploadCloud size={16} /> {workflowFileName || "Upload workflow.json…"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleWorkflowFile(file);
              }}
            />
            <p className="text-[11px] text-slate-500 mt-1.5">
              In ComfyUI: menu → Workflow → Export (API) — not a regular workflow save. That format has a plain node-id → node-config JSON shape this needs.
            </p>
          </div>

          {workflow && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Prompt Node</label>
                  <select
                    value={draft.promptNodeId}
                    onChange={(event) => setDraft((current) => ({ ...current, promptNodeId: event.target.value, promptField: "" }))}
                    className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-1.5 text-sm text-white outline-none focus:border-accent-500"
                  >
                    <option value="">Select the node holding your prompt text…</option>
                    {Object.entries(workflow).map(([id, node]) => (
                      <option key={id} value={id}>
                        {nodeLabel(id, node)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Prompt Field</label>
                  <select
                    value={draft.promptField}
                    onChange={(event) => setDraft((current) => ({ ...current, promptField: event.target.value }))}
                    disabled={!promptNode}
                    className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-1.5 text-sm text-white outline-none focus:border-accent-500 disabled:opacity-50"
                  >
                    <option value="">Select the input field…</option>
                    {promptNode?.inputs &&
                      Object.keys(promptNode.inputs).map((field) => (
                        <option key={field} value={field}>
                          {field}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Source Image Node (optional)</label>
                  <select
                    value={draft.imageNodeId}
                    onChange={(event) => setDraft((current) => ({ ...current, imageNodeId: event.target.value, imageField: "" }))}
                    className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-1.5 text-sm text-white outline-none focus:border-accent-500"
                  >
                    <option value="">None — text-to-{draft.capability} only</option>
                    {Object.entries(workflow).map(([id, node]) => (
                      <option key={id} value={id}>
                        {nodeLabel(id, node)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Image Field</label>
                  <select
                    value={draft.imageField}
                    onChange={(event) => setDraft((current) => ({ ...current, imageField: event.target.value }))}
                    disabled={!imageNode}
                    className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-1.5 text-sm text-white outline-none focus:border-accent-500 disabled:opacity-50"
                  >
                    <option value="">Select the input field…</option>
                    {imageNode?.inputs &&
                      Object.keys(imageNode.inputs).map((field) => (
                        <option key={field} value={field}>
                          {field}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                Pick the node whose input is a plain LoadImage filename (e.g. a LoadImage node's "image" field) — Cozyverse uploads your source frame into
                ComfyUI and fills this field in automatically. Leave "None" for text-only generation.
              </p>
            </>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex items-center gap-2">
            <button
              onClick={() => void save()}
              disabled={!canSave || saving}
              className="text-xs px-3 py-1.5 rounded-md bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-accentText"
            >
              {saving ? "Saving…" : "Save Local Model"}
            </button>
            <button
              onClick={() => {
                resetDraft();
                setAdding(false);
              }}
              className="text-xs px-3 py-1.5 rounded-md border border-base-600 text-slate-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
