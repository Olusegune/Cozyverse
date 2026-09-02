import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import * as api from "../lib/api";

/** Settings for the local Prompt Assistant — a plain Ollama server URL + model picker, refreshed
 * from Ollama's own /api/tags so users pick a model they've actually pulled rather than typing a
 * name that might not exist. No API key: this is local, optional infra, so failures here should
 * read as "not set up yet", never as a hard error blocking the rest of Settings. */
export function OllamaSection() {
  const [serverUrl, setServerUrl] = useState("http://127.0.0.1:11434");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [connection, setConnection] = useState<{ checking: boolean; result?: { reachable: boolean; detail: string } }>({ checking: false });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void api.ollamaGetSettings().then((settings) => {
      setServerUrl(settings.serverUrl || "http://127.0.0.1:11434");
      setModel(settings.model || "");
    });
  }, []);

  const refreshModels = async (url: string) => {
    setLoadingModels(true);
    try {
      const list = await api.ollamaListModels(url);
      setModels(list);
    } catch {
      setModels([]);
    } finally {
      setLoadingModels(false);
    }
  };

  const testConnection = async () => {
    setConnection({ checking: true });
    try {
      const result = await api.ollamaTestConnection(serverUrl.trim());
      setConnection({ checking: false, result });
      if (result.reachable) void refreshModels(serverUrl.trim());
    } catch (err) {
      setConnection({ checking: false, result: { reachable: false, detail: err instanceof Error ? err.message : String(err) } });
    }
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await api.ollamaSaveSettings({ serverUrl: serverUrl.trim(), model });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-8">
      <div className="mb-2">
        <h2 className="text-sm font-medium text-white">Prompt Assistant (Ollama)</h2>
        <p className="text-xs text-slate-500">
          Turn a loose idea into image/video/audio/SFX prompt drafts, using a local model via Ollama — free, private, no API key. Install Ollama and pull a
          model (e.g. <code className="text-slate-400">ollama pull llama3.1</code>) first.
        </p>
      </div>

      <div className="rounded-xl border border-base-700 bg-base-900 p-4 space-y-3">
        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Ollama Server URL</label>
          <div className="flex items-center gap-2">
            <input
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
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
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">Model</label>
            <button
              onClick={() => void refreshModels(serverUrl.trim())}
              disabled={loadingModels}
              className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-white disabled:opacity-50"
            >
              {loadingModels ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Refresh
            </button>
          </div>
          {models.length > 0 ? (
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
              className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-1.5 text-sm text-white outline-none focus:border-accent-500"
            >
              <option value="">Select a model…</option>
              {models.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="e.g. llama3.1 — or click Test Connection to list what you've pulled"
              className="w-full bg-base-800 border border-base-600 rounded-md px-3 py-1.5 text-sm text-white outline-none focus:border-accent-500"
            />
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void save()}
            disabled={saving || !model.trim()}
            className="text-xs px-3 py-1.5 rounded-md bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-accentText"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && <span className="text-xs text-green-400 flex items-center gap-1"><CheckCircle2 size={12} /> Saved</span>}
        </div>
      </div>
    </div>
  );
}
