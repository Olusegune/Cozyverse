import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, SlidersHorizontal, Trash2, Wand2, XCircle } from "lucide-react";
import * as api from "../lib/api";
import { useAppStore } from "../store/useAppStore";
import { LocalModelsSection } from "../components/LocalModelsSection";
import { providerBalance } from "../lib/decompose";
import { getDefaultRenderMode, setDefaultRenderMode } from "../lib/preferences";
import { OllamaSection } from "../components/OllamaSection";
import { UsageSummary } from "../components/UsageSummary";

type ProviderId = "fal" | "kie" | "wavespeed" | "gemini" | "elevenlabs" | "openai" | "tripo" | "meshy";

const PROVIDERS: Array<{ id: ProviderId; label: string; description: string; keyUrl: string }> = [
  { id: "fal", label: "fal.ai", description: "Nano Banana 2 for images.", keyUrl: "fal.ai/dashboard/keys" },
  { id: "kie", label: "KIE AI", description: "Nano Banana + GPT Image for images, Kling for video, Suno for music.", keyUrl: "kie.ai" },
  { id: "wavespeed", label: "WaveSpeed", description: "FLUX for images, MiniMax Speech for dialogue.", keyUrl: "wavespeed.ai" },
  { id: "gemini", label: "Google Gemini", description: "Native Nano Banana image generation and editing.", keyUrl: "aistudio.google.com/apikey" },
  { id: "elevenlabs", label: "ElevenLabs", description: "Real voice design for dialogue — uses every voice on your account.", keyUrl: "elevenlabs.io/app/settings/api-keys" },
  { id: "openai", label: "OpenAI", description: "GPT Image 2 for images and edits.", keyUrl: "platform.openai.com/api-keys" },
  { id: "tripo", label: "Tripo", description: "Image-to-3D and multi-view-to-3D for Decompose & Send to 3D.", keyUrl: "platform.tripo3d.ai/api-keys" },
  { id: "meshy", label: "Meshy", description: "Image-to-3D and multi-image-to-3D for Decompose & Send to 3D.", keyUrl: "meshy.ai/api-keys" },
];

type ConnectionState = { checking: boolean; result?: { reachable: boolean; authenticated: boolean; detail: string } };

export function SettingsPage() {
  const project = useAppStore((state) => state.project);
  const [tab, setTab] = useState<"providers" | "preferences">("providers");
  const [configured, setConfigured] = useState<Record<ProviderId, boolean>>({ fal: false, kie: false, wavespeed: false, gemini: false, elevenlabs: false, openai: false, tripo: false, meshy: false });
  const [drafts, setDrafts] = useState<Record<ProviderId, string>>({ fal: "", kie: "", wavespeed: "", gemini: "", elevenlabs: "", openai: "", tripo: "", meshy: "" });
  const [saving, setSaving] = useState<ProviderId | null>(null);
  const [connections, setConnections] = useState<Record<ProviderId, ConnectionState>>({ fal: { checking: false }, kie: { checking: false }, wavespeed: { checking: false }, gemini: { checking: false }, elevenlabs: { checking: false }, openai: { checking: false }, tripo: { checking: false }, meshy: { checking: false } });
  const [errors, setErrors] = useState<Record<ProviderId, string | null>>({ fal: null, kie: null, wavespeed: null, gemini: null, elevenlabs: null, openai: null, tripo: null, meshy: null });
  // Live credit balance for the two providers that actually expose one (Tripo/Meshy,
  // via Decompose's balance check) — shown inline rather than a vague "connected" pill.
  const [balances, setBalances] = useState<Record<string, number | null>>({});

  const refresh = async () => {
    const results = await Promise.all(
      PROVIDERS.map(async ({ id }) => {
        try {
          return [id, await api.providerKeyStatus(id)] as const;
        } catch (error) {
          console.error(`provider_key_status(${id}) failed:`, error);
          setErrors((current) => ({ ...current, [id]: error instanceof Error ? error.message : String(error) }));
          return [id, false] as const;
        }
      }),
    );
    setConfigured(Object.fromEntries(results) as Record<ProviderId, boolean>);
    void providerBalance().then(setBalances).catch(() => {});
  };

  useEffect(() => {
    void refresh();
  }, []);

  const save = async (id: ProviderId) => {
    if (!drafts[id].trim()) return;
    setSaving(id);
    setErrors((current) => ({ ...current, [id]: null }));
    try {
      await api.saveProviderKey(id, drafts[id].trim());
      setDrafts((current) => ({ ...current, [id]: "" }));
      await refresh();
    } catch (error) {
      console.error(`save_provider_key(${id}) failed:`, error);
      setErrors((current) => ({ ...current, [id]: error instanceof Error ? error.message : String(error) }));
    } finally {
      setSaving(null);
    }
  };

  const remove = async (id: ProviderId) => {
    try {
      await api.deleteProviderKey(id);
    } catch (error) {
      console.error(`delete_provider_key(${id}) failed:`, error);
      setErrors((current) => ({ ...current, [id]: error instanceof Error ? error.message : String(error) }));
      return;
    }
    setConnections((current) => ({ ...current, [id]: { checking: false } }));
    await refresh();
  };

  const testConnection = async (id: ProviderId) => {
    setConnections((current) => ({ ...current, [id]: { checking: true } }));
    try {
      const result = await api.checkProviderConnection(id);
      setConnections((current) => ({ ...current, [id]: { checking: false, result } }));
    } catch (error) {
      setConnections((current) => ({ ...current, [id]: { checking: false, result: { reachable: false, authenticated: false, detail: error instanceof Error ? error.message : String(error) } } }));
    }
  };

  const tripoBalance = balances.tripo;
  const meshyBalance = balances.meshy;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Settings</h1>
        <div className="h-[3px] w-14 rounded-full mt-2 mb-1 bg-gradient-to-r from-accent-500 to-accent-400/40" />
        <p className="text-sm text-slate-400 mt-1">Providers, balances, and how the app behaves by default.</p>
      </div>

      <div className="flex gap-1 mb-6 border-b border-base-700">
        <button
          onClick={() => setTab("providers")}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition ${
            tab === "providers" ? "border-accent-500 text-white" : "border-transparent text-slate-500 hover:text-slate-300"
          }`}
        >
          <KeyRound size={14} /> Providers &amp; Balance
        </button>
        <button
          onClick={() => setTab("preferences")}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition ${
            tab === "preferences" ? "border-accent-500 text-white" : "border-transparent text-slate-500 hover:text-slate-300"
          }`}
        >
          <SlidersHorizontal size={14} /> Preferences
        </button>
      </div>

      {tab === "preferences" ? (
        <PreferencesTab />
      ) : (
        <>
      <p className="text-xs text-slate-500 mb-4">
        Keys are stored in Windows Credential Manager, never inside a Cozyverse project file.
      </p>

      <div className="rounded-lg border border-base-700 bg-base-900 px-4 py-3 text-xs text-slate-400 mb-5">
        Currently wired for real generation, all via <b className="text-slate-300">fal.ai</b> except where noted: <b className="text-slate-300">Image Studio</b>{" "}
        (text-to-image + edit-based variants), <b className="text-slate-300">Motion Studio</b> (image-to-video), <b className="text-slate-300">Audio Studio</b>{" "}
        (ambience/music/SFX, plus dialogue via WaveSpeed). Every capability still has a Mock (local, free) option too — switch to it any time.
      </div>

      {project && (
        <div className="mb-5">
          <UsageSummary generations={project.generations} />
        </div>
      )}

      <div className="space-y-4">
        {PROVIDERS.map(({ id, label, description, keyUrl }) => {
          const connection = connections[id];
          const balance = id === "tripo" ? tripoBalance : id === "meshy" ? meshyBalance : undefined;
          return (
            <div key={id} className="rounded-xl border border-base-700 bg-base-900 p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="text-sm font-medium text-white">{label}</h3>
                  <p className="text-xs text-slate-500">{description}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${configured[id] ? "bg-green-950 text-green-400" : "bg-base-800 text-slate-500"}`}>
                  {configured[id]
                    ? typeof balance === "number"
                      ? `${Math.round(balance)} credits`
                      : "Connected"
                    : "Not connected"}
                </span>
              </div>

              {configured[id] ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void testConnection(id)}
                    disabled={connection.checking}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-base-600 text-slate-300 hover:text-white hover:border-accent-500 disabled:opacity-50"
                  >
                    {connection.checking ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />} Test Connection
                  </button>
                  <button onClick={() => void remove(id)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-base-600 text-slate-400 hover:text-red-400 hover:border-red-500">
                    <Trash2 size={13} /> Remove Key
                  </button>
                  {connection.result && (
                    <span className={`flex items-center gap-1 text-xs ${connection.result.authenticated ? "text-green-400" : "text-yellow-400"}`}>
                      {connection.result.authenticated ? <CheckCircle2 size={13} /> : <XCircle size={13} />} {connection.result.detail}
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={drafts[id]}
                    onChange={(event) => setDrafts((current) => ({ ...current, [id]: event.target.value }))}
                    placeholder="Paste API key…"
                    className="flex-1 bg-base-800 border border-base-600 rounded-md px-3 py-1.5 text-sm text-white outline-none focus:border-accent-500"
                  />
                  <button
                    onClick={() => void save(id)}
                    disabled={saving === id || !drafts[id].trim()}
                    className="text-xs px-3 py-1.5 rounded-md bg-accent-500 hover:bg-accent-400 disabled:opacity-50 text-accentText"
                  >
                    {saving === id ? "Saving…" : "Save"}
                  </button>
                  <span className="text-xs text-slate-500 shrink-0">Get a key at {keyUrl}</span>
                </div>
              )}
              {errors[id] && <p className="text-xs text-red-400 mt-2">{errors[id]}</p>}
            </div>
          );
        })}
      </div>

      <LocalModelsSection />
      <OllamaSection />
        </>
      )}
    </div>
  );
}

function PreferencesTab() {
  const [useReal, setUseReal] = useState(getDefaultRenderMode);

  const choose = (value: boolean) => {
    setUseReal(value);
    setDefaultRenderMode(value);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-base-700 bg-base-900 p-4">
        <div className="flex items-center gap-2 mb-1">
          <Wand2 size={14} className="text-accent-400" />
          <h3 className="text-sm font-medium text-white">Default rendering mode</h3>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          Image Studio, Motion Studio, and Audio Studio each start on this choice — pick Auto once
          here instead of flipping it in every studio. Each studio can still override it per session.
        </p>
        <div className="inline-flex rounded-md border border-base-600 overflow-hidden text-sm">
          <button
            className={`px-4 py-1.5 ${!useReal ? "bg-accent-500 text-accentText" : "text-slate-400 hover:text-white"}`}
            onClick={() => choose(false)}
          >
            Mock
          </button>
          <button
            className={`px-4 py-1.5 ${useReal ? "bg-accent-500 text-accentText" : "text-slate-400 hover:text-white"}`}
            onClick={() => choose(true)}
          >
            Auto
          </button>
        </div>
        <p className="text-[11px] text-slate-600 mt-2">
          Mock renders locally for free and always works offline. Auto uses whichever connected
          provider fits the job — add keys under Providers &amp; Balance first.
        </p>
      </div>

      <div className="rounded-xl border border-base-700 bg-base-900 p-4 text-xs text-slate-500">
        Decompose's own toggles (Stub mode, 4 side views) stay per-session in its panel — they're
        wiring/quality choices for one decomposition, not app-wide defaults.
      </div>
    </div>
  );
}
