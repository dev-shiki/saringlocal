import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
  type AppCheck
} from 'firebase/app-check';
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  InferenceSource,
  type GenerativeModel
} from 'firebase/ai';
import { redactSensitiveText, type RedactionResult } from '../privacy/redactor';

export { InferenceMode, InferenceSource };

export type OnDeviceStatus =
  | 'available'
  | 'downloadable'
  | 'downloading'
  | 'unavailable'
  | 'unsupported';

export type ExecutionSource =
  | typeof InferenceSource.ON_DEVICE
  | typeof InferenceSource.IN_CLOUD
  | 'local_deterministic';

export interface FirebaseWebConfig {
  apiKey: string;
  projectId: string;
  appId: string;
  authDomain?: string;
  appCheckSiteKey?: string;
  appCheckDebugToken?: string;
}

export interface HybridTriageRequest {
  rawText: string;
  mode: InferenceMode;
  redactBeforeCloud: boolean;
  firebaseConfig?: FirebaseWebConfig | null;
  cloudModelName?: string;
}

export interface HybridTriageResponse {
  summary: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  actionItems: string[];
  inferenceSource: ExecutionSource;
  requestedMode: InferenceMode;
  latencyMs: number;
  redaction: RedactionResult;
  payloadSentToModel: string;
  cloudBoundaryProtected: boolean;
  engineNote: string;
}

interface ChromeLanguageModelSession {
  prompt: (input: string) => Promise<string>;
  destroy?: () => void;
}

interface ChromeLanguageModelGlobal {
  availability?: () => Promise<string>;
  create?: (options?: Record<string, unknown>) => Promise<ChromeLanguageModelSession>;
}

declare global {
  var FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string | undefined;
  interface Window {
    LanguageModel?: ChromeLanguageModelGlobal;
    ai?: {
      languageModel?: ChromeLanguageModelGlobal;
    };
  }
}

export async function probeOnDeviceAvailability(): Promise<OnDeviceStatus> {
  if (typeof window === 'undefined') return 'unsupported';
  const api = window.LanguageModel ?? window.ai?.languageModel;
  if (!api || typeof api.availability !== 'function') {
    return 'unsupported';
  }
  try {
    const status = await api.availability();
    if (
      status === 'available' ||
      status === 'downloadable' ||
      status === 'downloading' ||
      status === 'unavailable'
    ) {
      return status;
    }
    return 'unsupported';
  } catch {
    return 'unsupported';
  }
}

export function isFirebaseConfigComplete(
  config: Partial<FirebaseWebConfig> | null | undefined
): config is FirebaseWebConfig {
  return Boolean(
    config &&
      typeof config.apiKey === 'string' &&
      config.apiKey.trim().length > 0 &&
      typeof config.projectId === 'string' &&
      config.projectId.trim().length > 0 &&
      typeof config.appId === 'string' &&
      config.appId.trim().length > 0
  );
}

export interface HybridModelFactory {
  createModel: (
    config: FirebaseWebConfig,
    mode: InferenceMode,
    cloudModelName: string
  ) => Pick<GenerativeModel, 'generateContent'>;
}

const initializedAppChecks = new Map<string, AppCheck>();

export function ensureFirebaseAppCheck(
  app: FirebaseApp,
  config: FirebaseWebConfig
): AppCheck | null {
  const siteKey = config.appCheckSiteKey?.trim() ?? '';
  const debugToken = config.appCheckDebugToken?.trim() ?? '';
  if (!siteKey && !debugToken) {
    return null;
  }

  const existing = initializedAppChecks.get(app.name);
  if (existing) return existing;

  if (debugToken) {
    // Firebase App Check Web SDK activates its built-in debug provider when this global is set before initializeAppCheck.
    globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN =
      debugToken.toLowerCase() === 'true' ? true : debugToken;
  } else {
    globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = undefined;
  }

  const provider = new ReCaptchaV3Provider(siteKey || 'debug-token-mode-site-key');
  const appCheck = initializeAppCheck(app, {
    provider,
    isTokenAutoRefreshEnabled: true
  });
  initializedAppChecks.set(app.name, appCheck);
  return appCheck;
}

function getOrCreateFirebaseApp(config: FirebaseWebConfig): FirebaseApp {
  const apiKey = config.apiKey.trim();
  const projectId = config.projectId.trim();
  const appId = config.appId.trim();
  const authDomain = config.authDomain?.trim() || `${projectId}.firebaseapp.com`;
  const appCheckTag = `${config.appCheckSiteKey?.trim().slice(-6) ?? 'none'}-${config.appCheckDebugToken?.trim().slice(-6) ?? 'none'}`;
  const appName = `saringlocal-${projectId}-${appId.slice(-8)}-${apiKey.slice(-6)}-${appCheckTag}`;

  const existing = getApps().find((app) => app.name === appName);
  const app =
    existing ??
    initializeApp(
      {
        apiKey,
        projectId,
        appId,
        authDomain
      } satisfies FirebaseOptions,
      appName
    );

  ensureFirebaseAppCheck(app, config);
  return app;
}

export const defaultHybridModelFactory: HybridModelFactory = {
  createModel(config: FirebaseWebConfig, mode: InferenceMode, cloudModelName: string) {
    const app = getOrCreateFirebaseApp(config);
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    return getGenerativeModel(ai, {
      mode,
      onDeviceParams: {
        createOptions: {
          initialPrompts: [
            {
              role: 'system',
              content: [
                {
                  type: 'text',
                  value:
                    'You triage operational incidents and legal clauses. Return strict JSON with keys: severity (HIGH|MEDIUM|LOW), summary (one concise sentence), actionItems (array of 2-4 imperative steps).'
                }
              ]
            }
          ]
        }
      },
      inCloudParams: {
        model: cloudModelName,
        systemInstruction:
          'You triage operational incidents and legal clauses. Return strict JSON with keys: severity (HIGH|MEDIUM|LOW), summary (one concise sentence), actionItems (array of 2-4 imperative steps).',
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 400,
          responseMimeType: 'application/json'
        }
      }
    });
  }
};

export function runDeterministicTriage(sanitizedText: string, findingCount: number): {
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  summary: string;
  actionItems: string[];
} {
  const lower = sanitizedText.toLowerCase();
  const hasHighRiskKeyword =
    /\b(breach|outage|sev1|p0|credential|token|unauthorized|indemnity|unlimited liability|terminated)\b/.test(
      lower
    );
  const hasMediumRiskKeyword =
    /\b(degraded|timeout|delay|notice|sla|auto-renew|penalty|pii|audit)\b/.test(lower);

  const severity: 'HIGH' | 'MEDIUM' | 'LOW' =
    hasHighRiskKeyword || findingCount >= 3
      ? 'HIGH'
      : hasMediumRiskKeyword || findingCount >= 1
        ? 'MEDIUM'
        : 'LOW';

  const lines = sanitizedText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const lead = lines[0] ?? sanitizedText.trim();
  const clippedLead = lead.length > 140 ? `${lead.slice(0, 137)}...` : lead;

  const actionItems: string[] = [];
  if (findingCount > 0) {
    actionItems.push(
      `Keep ${findingCount} detected sensitive item(s) masked before sharing outside the device.`
    );
  }
  if (hasHighRiskKeyword) {
    actionItems.push('Escalate to the incident or legal owner for immediate review.');
  }
  if (/\b(token|secret|key|credential)\b/.test(lower)) {
    actionItems.push('Rotate any exposed credential referenced in the note.');
  }
  if (actionItems.length === 0) {
    actionItems.push('Log the sanitized note in the team tracker.');
  }

  return {
    severity,
    summary: `Local deterministic triage (${severity} priority): ${clippedLead}`,
    actionItems
  };
}

function parseModelJsonResponse(rawOutput: string): {
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  summary: string;
  actionItems: string[];
} {
  try {
    const cleaned = rawOutput.replace(/^```json\s*|\s*```$/g, '').trim();
    const parsed = JSON.parse(cleaned) as {
      severity?: unknown;
      summary?: unknown;
      actionItems?: unknown;
    };
    const severity =
      parsed.severity === 'HIGH' || parsed.severity === 'MEDIUM' || parsed.severity === 'LOW'
        ? parsed.severity
        : 'MEDIUM';
    const summary =
      typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
        ? parsed.summary.trim()
        : rawOutput.trim();
    const actionItems = Array.isArray(parsed.actionItems)
      ? parsed.actionItems.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
    return {
      severity,
      summary,
      actionItems: actionItems.length > 0 ? actionItems : ['Review the generated summary above.']
    };
  } catch {
    return {
      severity: 'MEDIUM',
      summary: rawOutput.trim() || 'Model returned an empty response.',
      actionItems: ['Inspect the raw output in the triage summary.']
    };
  }
}

export async function runHybridTriage(
  request: HybridTriageRequest,
  factory: HybridModelFactory = defaultHybridModelFactory
): Promise<HybridTriageResponse> {
  const trimmed = request.rawText.trim();
  if (!trimmed) {
    throw new Error('Document input is empty. Paste text or load a sample document first.');
  }

  const startedAt = performance.now();
  const redaction = redactSensitiveText(trimmed);

  const mayUseCloud = request.mode !== InferenceMode.ONLY_ON_DEVICE;
  const shouldUseSanitizedPayload = mayUseCloud && request.redactBeforeCloud;
  const payloadSentToModel = shouldUseSanitizedPayload ? redaction.sanitizedText : trimmed;
  const cloudBoundaryProtected = !mayUseCloud || request.redactBeforeCloud;

  const cloudModelName = request.cloudModelName?.trim() || 'gemini-2.5-flash';
  const hasFirebase = isFirebaseConfigComplete(request.firebaseConfig);

  // Use Firebase AI Logic SDK whenever Firebase config is present
  if (hasFirebase) {
    const model = factory.createModel(request.firebaseConfig!, request.mode, cloudModelName);
    const prompt = `Triage the following note and return JSON {severity, summary, actionItems}:\n\n${payloadSentToModel}`;
    const result = await model.generateContent(prompt);
    const rawText = result.response.text();
    const parsed = parseModelJsonResponse(rawText);
    const source: ExecutionSource =
      result.response.inferenceSource === InferenceSource.ON_DEVICE
        ? InferenceSource.ON_DEVICE
        : InferenceSource.IN_CLOUD;
    const restoredSummary = shouldUseSanitizedPayload
      ? redaction.restoreTokens(parsed.summary)
      : parsed.summary;
    const restoredActions = shouldUseSanitizedPayload
      ? parsed.actionItems.map((item) => redaction.restoreTokens(item))
      : parsed.actionItems;

    return {
      severity: parsed.severity,
      summary: restoredSummary,
      actionItems: restoredActions,
      inferenceSource: source,
      requestedMode: request.mode,
      latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
      redaction,
      payloadSentToModel,
      cloudBoundaryProtected,
      engineNote:
        source === InferenceSource.ON_DEVICE
          ? 'Executed on-device via Firebase AI Logic and Chrome Prompt API.'
          : `Executed via Firebase AI Logic cloud fallback (${cloudModelName}).`
    };
  }

  // When no Firebase project is configured:
  // ONLY_IN_CLOUD without Firebase config must fail clearly instead of faking cloud execution.
  if (request.mode === InferenceMode.ONLY_IN_CLOUD) {
    throw new Error(
      'ONLY_IN_CLOUD requires a Firebase Web config (apiKey, projectId, appId) in the Firebase SDK Setup tab.'
    );
  }

  // Try direct browser Prompt API check if on-device Gemini Nano is available
  const onDeviceStatus = await probeOnDeviceAvailability();
  if (request.mode === InferenceMode.ONLY_ON_DEVICE && onDeviceStatus !== 'available') {
    throw new Error(
      `On-device Gemini Nano is currently "${onDeviceStatus}" in this browser. Switch to PREFER_ON_DEVICE or configure Chrome Prompt API flags.`
    );
  }

  const nativeApi =
    typeof window !== 'undefined' ? (window.LanguageModel ?? window.ai?.languageModel) : undefined;
  if (
    onDeviceStatus === 'available' &&
    nativeApi &&
    typeof nativeApi.create === 'function' &&
    request.mode !== InferenceMode.PREFER_IN_CLOUD
  ) {
    const session = await nativeApi.create();
    try {
      const prompt = `You triage operational incidents and legal clauses. Return strict JSON with keys: severity (HIGH|MEDIUM|LOW), summary (one concise sentence), actionItems (array of 2-4 imperative steps).\n\n${trimmed}`;
      const rawText = await session.prompt(prompt);
      const parsed = parseModelJsonResponse(rawText);
      return {
        severity: parsed.severity,
        summary: parsed.summary,
        actionItems: parsed.actionItems,
        inferenceSource: InferenceSource.ON_DEVICE,
        requestedMode: request.mode,
        latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
        redaction,
        payloadSentToModel: trimmed,
        cloudBoundaryProtected: true,
        engineNote: 'Executed on-device via Chrome Built-in AI (Gemini Nano Prompt API).'
      };
    } finally {
      session.destroy?.();
    }
  }

  const fallback = runDeterministicTriage(redaction.sanitizedText, redaction.findings.length);
  return {
    severity: fallback.severity,
    summary: fallback.summary,
    actionItems: fallback.actionItems,
    inferenceSource: 'local_deterministic',
    requestedMode: request.mode,
    latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
    redaction,
    payloadSentToModel: redaction.sanitizedText,
    cloudBoundaryProtected: true,
    engineNote:
      'Local Deterministic Analyzer active (no Firebase Web config saved; zero network requests made).'
  };
}
