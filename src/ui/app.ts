import {
  DEFAULT_FIREBASE_CONFIG,
  InferenceMode,
  isFirebaseConfigComplete,
  probeOnDeviceAvailability,
  runHybridTriage,
  type FirebaseWebConfig,
  type HybridTriageResponse,
  type OnDeviceStatus
} from '../ai/hybridClient';
import { SAMPLE_DOCUMENTS } from '../data/samples';
import { redactSensitiveText } from '../privacy/redactor';

const THEME_STORAGE_KEY = 'saringlocal_theme';
const FIREBASE_CONFIG_STORAGE_KEY = 'saringlocal_firebase_config';
const FIREBASE_DISABLED_SENTINEL = 'disabled';

type TabId = 'triage' | 'diff' | 'setup';
type ViewStatus = 'empty' | 'loading' | 'error' | 'ready';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function loadSavedFirebaseConfig(
  fallbackConfig: FirebaseWebConfig | null
): FirebaseWebConfig | null {
  try {
    const raw = window.localStorage.getItem(FIREBASE_CONFIG_STORAGE_KEY);
    if (raw === FIREBASE_DISABLED_SENTINEL) return null;
    if (!raw) return fallbackConfig;
    const parsed = JSON.parse(raw) as Partial<FirebaseWebConfig>;
    return isFirebaseConfigComplete(parsed) ? parsed : fallbackConfig;
  } catch {
    return fallbackConfig;
  }
}

function saveFirebaseConfig(config: FirebaseWebConfig | null): void {
  try {
    if (!config) {
      window.localStorage.setItem(FIREBASE_CONFIG_STORAGE_KEY, FIREBASE_DISABLED_SENTINEL);
      return;
    }
    window.localStorage.setItem(FIREBASE_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage quota errors in restricted sandboxes
  }
}

function resetSavedFirebaseConfig(): void {
  try {
    window.localStorage.removeItem(FIREBASE_CONFIG_STORAGE_KEY);
  } catch {
    // Ignore storage quota errors in restricted sandboxes
  }
}

function readInitialTheme(): 'light' | 'dark' {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // Ignore storage read errors
  }
  return 'light';
}

export interface MountWorkbenchOptions {
  defaultFirebaseConfig?: FirebaseWebConfig | null;
}

export interface MountedWorkbench {
  destroy: () => void;
}

export function mountWorkbench(
  root: HTMLElement,
  options: MountWorkbenchOptions = {}
): MountedWorkbench {
  const defaultConfig =
    options.defaultFirebaseConfig === undefined
      ? DEFAULT_FIREBASE_CONFIG
      : options.defaultFirebaseConfig;
  let theme: 'light' | 'dark' = readInitialTheme();
  let activeTab: TabId = 'triage';
  let selectedMode: InferenceMode = InferenceMode.PREFER_ON_DEVICE;
  let redactBeforeCloud = true;
  let rawText = SAMPLE_DOCUMENTS[0].text;
  let viewStatus: ViewStatus = 'empty';
  let errorMessage = '';
  let lastResult: HybridTriageResponse | null = null;
  let onDeviceStatus: OnDeviceStatus = 'unsupported';
  let firebaseConfig: FirebaseWebConfig | null = loadSavedFirebaseConfig(defaultConfig);
  let setupFeedback = '';

  const applyTheme = (): void => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage write errors
    }
  };

  applyTheme();

  root.innerHTML = `
    <div class="page-shell">
      <header class="masthead">
        <div class="brand-block">
          <h1 class="brand-title">SaringLocal</h1>
          <p class="brand-subtitle">Hybrid AI privacy triage desk using Firebase AI Logic and local PII redaction.</p>
        </div>
        <nav class="masthead-nav" aria-label="Workspace controls">
          <a href="#workbench-main" class="btn">Document Desk</a>
          <button type="button" id="theme-toggle" class="btn" aria-pressed="${theme === 'dark'}">
            ${theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          </button>
        </nav>
      </header>

      <section class="boundary-strip" aria-label="Runtime diagnostics">
        <div class="boundary-item">
          <span class="boundary-label">Chrome Prompt API:</span>
          <span id="nano-status" class="mono-tag">checking...</span>
        </div>
        <div class="boundary-item">
          <span class="boundary-label">Firebase Cloud Fallback:</span>
          <span id="firebase-status" class="mono-tag"></span>
        </div>
        <div class="boundary-item">
          <span class="boundary-label">Active Mode:</span>
          <span id="active-mode-tag" class="mono-tag"></span>
        </div>
      </section>

      <main id="main-content" tabindex="-1">
        <div id="workbench-main" class="workbench">
          <section class="panel" aria-labelledby="input-heading">
            <h2 id="input-heading" class="panel-heading">1. Source Document and Routing Policy</h2>

            <div class="sample-toolbar" role="group" aria-label="Sample documents">
              <button type="button" class="btn" data-sample="incident">Load Incident Report</button>
              <button type="button" class="btn" data-sample="nda">Load Vendor NDA</button>
              <button type="button" id="clear-doc-btn" class="btn">Clear Document</button>
            </div>

            <label for="doc-input" class="field-label">Document or Incident Note</label>
            <textarea id="doc-input" class="doc-textarea" spellcheck="false"></textarea>

            <fieldset class="mode-fieldset">
              <legend>Firebase AI Logic InferenceMode</legend>
              <div class="mode-grid">
                <label class="mode-option">
                  <input type="radio" name="inference-mode" value="prefer_on_device" checked />
                  <span>
                    <span class="mode-option-title">PREFER_ON_DEVICE</span>
                    <span class="mode-option-desc">Try Chrome Gemini Nano first; fall back to cloud if unavailable.</span>
                  </span>
                </label>
                <label class="mode-option">
                  <input type="radio" name="inference-mode" value="only_on_device" />
                  <span>
                    <span class="mode-option-title">ONLY_ON_DEVICE</span>
                    <span class="mode-option-desc">Strict local boundary. Throws an error if on-device model is absent.</span>
                  </span>
                </label>
                <label class="mode-option">
                  <input type="radio" name="inference-mode" value="prefer_in_cloud" />
                  <span>
                    <span class="mode-option-title">PREFER_IN_CLOUD</span>
                    <span class="mode-option-desc">Use Gemini cloud model when online; fall back to local when offline.</span>
                  </span>
                </label>
                <label class="mode-option">
                  <input type="radio" name="inference-mode" value="only_in_cloud" />
                  <span>
                    <span class="mode-option-title">ONLY_IN_CLOUD</span>
                    <span class="mode-option-desc">Require configured Firebase GoogleAIBackend cloud inference.</span>
                  </span>
                </label>
              </div>
            </fieldset>

            <label class="checkbox-row" for="redact-cloud-toggle">
              <input type="checkbox" id="redact-cloud-toggle" checked />
              <span>Mask detected PII and secrets locally before any cloud fallback</span>
            </label>

            <div class="action-row">
              <span id="live-pii-summary" class="live-counts" aria-live="polite"></span>
              <button type="button" id="run-triage-btn" class="btn btn-primary">
                Run Hybrid Triage
              </button>
            </div>
          </section>

          <section class="panel" aria-labelledby="inspector-heading">
            <h2 id="inspector-heading" class="panel-heading">2. Hybrid Inference Inspector</h2>

            <div class="tablist" role="tablist" aria-label="Inspection views">
              <button
                type="button"
                role="tab"
                id="tab-triage"
                class="tab-btn"
                aria-selected="true"
                aria-controls="panel-triage"
                tabindex="0"
              >
                Triage Output
              </button>
              <button
                type="button"
                role="tab"
                id="tab-diff"
                class="tab-btn"
                aria-selected="false"
                aria-controls="panel-diff"
                tabindex="-1"
              >
                Cloud Payload Diff
              </button>
              <button
                type="button"
                role="tab"
                id="tab-setup"
                class="tab-btn"
                aria-selected="false"
                aria-controls="panel-setup"
                tabindex="-1"
              >
                Firebase SDK Setup
              </button>
            </div>

            <div
              role="tabpanel"
              id="panel-triage"
              aria-labelledby="tab-triage"
              aria-live="polite"
            ></div>

            <div
              role="tabpanel"
              id="panel-diff"
              aria-labelledby="tab-diff"
              hidden
            ></div>

            <div
              role="tabpanel"
              id="panel-setup"
              aria-labelledby="tab-setup"
              hidden
            ></div>
          </section>
        </div>
      </main>

      <footer class="site-footer">
        <span>SaringLocal Hybrid Inference Workbench | Built for #BuildHybridAI 2026</span>
        <a href="https://firebase.google.com/docs/ai-logic/hybrid" target="_blank" rel="noreferrer">
          Firebase AI Logic Hybrid Docs
        </a>
      </footer>
    </div>
  `;

  const docInput = root.querySelector<HTMLTextAreaElement>('#doc-input')!;
  const runBtn = root.querySelector<HTMLButtonElement>('#run-triage-btn')!;
  const themeToggleBtn = root.querySelector<HTMLButtonElement>('#theme-toggle')!;
  const clearBtn = root.querySelector<HTMLButtonElement>('#clear-doc-btn')!;
  const redactCheckbox = root.querySelector<HTMLInputElement>('#redact-cloud-toggle')!;
  const nanoStatusEl = root.querySelector<HTMLElement>('#nano-status')!;
  const firebaseStatusEl = root.querySelector<HTMLElement>('#firebase-status')!;
  const activeModeTagEl = root.querySelector<HTMLElement>('#active-mode-tag')!;
  const livePiiSummaryEl = root.querySelector<HTMLElement>('#live-pii-summary')!;

  const tabButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const panelTriage = root.querySelector<HTMLElement>('#panel-triage')!;
  const panelDiff = root.querySelector<HTMLElement>('#panel-diff')!;
  const panelSetup = root.querySelector<HTMLElement>('#panel-setup')!;

  docInput.value = rawText;

  const buildSdkSnippet = (): string => {
    const hasDebugToken = Boolean(firebaseConfig?.appCheckDebugToken?.trim());
    const hasSiteKey = Boolean(firebaseConfig?.appCheckSiteKey?.trim());
    const appCheckLines = hasDebugToken
      ? [
          `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;`,
          `initializeAppCheck(app, {`,
          `  provider: new ReCaptchaV3Provider("${hasSiteKey ? '<RECAPTCHA_V3_SITE_KEY>' : 'debug-token-mode-site-key'}"),`,
          `  isTokenAutoRefreshEnabled: true`,
          `});`
        ]
      : [
          `initializeAppCheck(app, {`,
          `  provider: new ReCaptchaV3Provider("<RECAPTCHA_V3_SITE_KEY>"),`,
          `  isTokenAutoRefreshEnabled: true`,
          `});`
        ];

    return [
      `import { initializeApp } from "firebase/app";`,
      `import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";`,
      `import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from "firebase/ai";`,
      ``,
      `const app = initializeApp(firebaseConfig);`,
      ...appCheckLines,
      `const ai = getAI(app, { backend: new GoogleAIBackend() });`,
      `const model = getGenerativeModel(ai, {`,
      `  mode: InferenceMode.${selectedMode.toUpperCase()},`,
      `  inCloudParams: { model: "gemini-3.1-flash-lite-preview" }`,
      `});`
    ].join('\n');
  };

  const renderDiagnostics = (): void => {
    nanoStatusEl.textContent = onDeviceStatus;
    if (!firebaseConfig) {
      firebaseStatusEl.textContent = 'not configured (local analyzer only)';
    } else {
      const appCheckMode = firebaseConfig.appCheckDebugToken?.trim()
        ? 'App Check debug token'
        : firebaseConfig.appCheckSiteKey?.trim()
          ? 'App Check reCAPTCHA v3'
          : 'App Check not set';
      firebaseStatusEl.textContent = `configured (${firebaseConfig.projectId} | ${appCheckMode})`;
    }
    activeModeTagEl.textContent = selectedMode;

    const preview = redactSensitiveText(rawText);
    if (!rawText.trim()) {
      livePiiSummaryEl.textContent = '0 characters entered';
    } else if (preview.findings.length === 0) {
      livePiiSummaryEl.textContent = `${rawText.length} chars | 0 sensitive items detected`;
    } else {
      livePiiSummaryEl.textContent = `${rawText.length} chars | ${preview.findings.length} sensitive item(s) masked locally`;
    }
  };

  const renderTriagePanel = (): void => {
    if (viewStatus === 'loading') {
      panelTriage.innerHTML = `
        <div class="state-box">
          <h3 class="state-title">Running hybrid inference</h3>
          <p class="state-detail">Scanning local PII patterns and executing ${escapeHtml(selectedMode)} routing.</p>
        </div>
      `;
      return;
    }

    if (viewStatus === 'error') {
      panelTriage.innerHTML = `
        <div class="state-box state-box-error" role="alert">
          <h3 class="state-title">Triage halted</h3>
          <p class="state-detail">${escapeHtml(errorMessage)}</p>
        </div>
      `;
      return;
    }

    if (viewStatus === 'empty' || !lastResult) {
      panelTriage.innerHTML = `
        <div class="state-box">
          <h3 class="state-title">No triage run yet</h3>
          <p class="state-detail">Edit the document or choose a sample, then select Run Hybrid Triage to inspect the routing path and output.</p>
        </div>
      `;
      return;
    }

    const actionsHtml = lastResult.actionItems
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join('');

    panelTriage.innerHTML = `
      <div class="result-meta">
        <span class="meta-pill">Source: ${escapeHtml(lastResult.inferenceSource)}</span>
        <span class="meta-pill">Priority: ${escapeHtml(lastResult.severity)}</span>
        <span class="meta-pill">Latency: ${lastResult.latencyMs} ms</span>
        <span class="meta-pill">Masked locally: ${lastResult.redaction.findings.length}</span>
      </div>
      <p class="result-summary">${escapeHtml(lastResult.summary)}</p>
      <h3 class="state-title">Recommended Actions</h3>
      <ul class="action-list">${actionsHtml}</ul>
      <p class="state-detail">${escapeHtml(lastResult.engineNote)}</p>
    `;
  };

  const renderDiffPanel = (): void => {
    if (!rawText.trim()) {
      panelDiff.innerHTML = `
        <div class="state-box">
          <h3 class="state-title">Empty document</h3>
          <p class="state-detail">Enter text on the left to preview which tokens are masked before cloud fallback.</p>
        </div>
      `;
      return;
    }

    const preview = redactSensitiveText(rawText);
    const payloadForCloud =
      selectedMode === InferenceMode.ONLY_ON_DEVICE
        ? 'Blocked from cloud egress by ONLY_ON_DEVICE mode.'
        : redactBeforeCloud
          ? preview.sanitizedText
          : rawText;

    const rows =
      preview.findings.length === 0
        ? `<tr><td colspan="3">No sensitive items detected in current text.</td></tr>`
        : preview.findings
            .map(
              (f) => `
                <tr>
                  <td><code>${escapeHtml(f.token)}</code></td>
                  <td>${escapeHtml(f.category)}</td>
                  <td><code>${escapeHtml(f.originalValue)}</code></td>
                </tr>
              `
            )
            .join('');

    panelDiff.innerHTML = `
      <h3 class="state-title">Payload Permitted Beyond Device</h3>
      <pre class="pre-block">${escapeHtml(payloadForCloud)}</pre>
      <div class="findings-table-wrap">
        <table class="findings-table">
          <thead>
            <tr>
              <th>Token</th>
              <th>Category</th>
              <th>Held Locally</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  };

  const renderSetupPanel = (): void => {
    const snippet = buildSdkSnippet();

    panelSetup.innerHTML = `
      <form id="firebase-config-form" class="config-form" novalidate>
        <div>
          <label for="fb-api-key" class="field-label">Firebase Web API Key</label>
          <input id="fb-api-key" name="apiKey" class="text-input" type="text" autocomplete="off"
            placeholder="AIzaSy..." value="${escapeHtml(firebaseConfig?.apiKey ?? '')}" />
        </div>
        <div>
          <label for="fb-project-id" class="field-label">Firebase Project ID</label>
          <input id="fb-project-id" name="projectId" class="text-input" type="text" autocomplete="off"
            placeholder="your-project-id" value="${escapeHtml(firebaseConfig?.projectId ?? '')}" />
        </div>
        <div>
          <label for="fb-app-id" class="field-label">Firebase App ID</label>
          <input id="fb-app-id" name="appId" class="text-input" type="text" autocomplete="off"
            placeholder="1:123456:web:abcdef" value="${escapeHtml(firebaseConfig?.appId ?? '')}" />
        </div>
        <div>
          <label for="fb-appcheck-site-key" class="field-label">App Check reCAPTCHA v3 Site Key (optional)</label>
          <input id="fb-appcheck-site-key" name="appCheckSiteKey" class="text-input" type="text" autocomplete="off"
            placeholder="6Lc..." value="${escapeHtml(firebaseConfig?.appCheckSiteKey ?? '')}" />
        </div>
        <div>
          <label for="fb-appcheck-debug-token" class="field-label">App Check Debug Token (optional, or "true")</label>
          <input id="fb-appcheck-debug-token" name="appCheckDebugToken" class="text-input" type="text" autocomplete="off"
            placeholder="debug token UUID or true" value="${escapeHtml(firebaseConfig?.appCheckDebugToken ?? '')}" />
        </div>
        <div class="config-actions">
          <button type="submit" class="btn btn-secondary">Save Firebase Config</button>
          <button type="button" id="reset-fb-config" class="btn">Use Live Demo Project</button>
          <button type="button" id="clear-fb-config" class="btn">Disable Cloud (Local Only)</button>
        </div>
        <p id="setup-feedback" class="state-detail" aria-live="polite">${escapeHtml(setupFeedback)}</p>
      </form>
      <h3 class="state-title" style="margin-top: 16px;">Active SDK Configuration</h3>
      <pre id="sdk-snippet-block" class="pre-block">${escapeHtml(snippet)}</pre>
    `;

    const form = panelSetup.querySelector<HTMLFormElement>('#firebase-config-form')!;
    const resetConfigBtn = panelSetup.querySelector<HTMLButtonElement>('#reset-fb-config')!;
    const clearConfigBtn = panelSetup.querySelector<HTMLButtonElement>('#clear-fb-config')!;

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const appCheckSiteKey = String(data.get('appCheckSiteKey') ?? '').trim();
      const appCheckDebugToken = String(data.get('appCheckDebugToken') ?? '').trim();
      const next: FirebaseWebConfig = {
        apiKey: String(data.get('apiKey') ?? '').trim(),
        projectId: String(data.get('projectId') ?? '').trim(),
        appId: String(data.get('appId') ?? '').trim(),
        ...(appCheckSiteKey ? { appCheckSiteKey } : {}),
        ...(appCheckDebugToken ? { appCheckDebugToken } : {})
      };
      if (!isFirebaseConfigComplete(next)) {
        setupFeedback = 'Provide API Key, Project ID, and App ID to enable Firebase cloud fallback.';
        renderSetupPanel();
        return;
      }
      firebaseConfig = next;
      saveFirebaseConfig(next);
      const appCheckNote = appCheckDebugToken
        ? ' with App Check debug token'
        : appCheckSiteKey
          ? ' with App Check reCAPTCHA v3'
          : '';
      setupFeedback = `Saved Firebase config for ${next.projectId}${appCheckNote} in localStorage.`;
      renderDiagnostics();
      renderSetupPanel();
    });

    resetConfigBtn.addEventListener('click', () => {
      firebaseConfig = defaultConfig;
      resetSavedFirebaseConfig();
      setupFeedback = defaultConfig
        ? `Restored live demo Firebase project (${defaultConfig.projectId}) with App Check.`
        : 'No default Firebase config configured.';
      renderDiagnostics();
      renderSetupPanel();
    });

    clearConfigBtn.addEventListener('click', () => {
      firebaseConfig = null;
      saveFirebaseConfig(null);
      setupFeedback = 'Disabled cloud fallback. Running in local analyzer mode.';
      renderDiagnostics();
      renderSetupPanel();
    });
  };

  const switchTab = (nextTab: TabId, focusTab = false): void => {
    activeTab = nextTab;
    const mapping: Record<TabId, { btnId: string; panel: HTMLElement }> = {
      triage: { btnId: 'tab-triage', panel: panelTriage },
      diff: { btnId: 'tab-diff', panel: panelDiff },
      setup: { btnId: 'tab-setup', panel: panelSetup }
    };

    for (const btn of tabButtons) {
      const isSelected = btn.id === mapping[nextTab].btnId;
      btn.setAttribute('aria-selected', String(isSelected));
      btn.setAttribute('tabindex', isSelected ? '0' : '-1');
      if (isSelected && focusTab) btn.focus();
    }

    panelTriage.hidden = nextTab !== 'triage';
    panelDiff.hidden = nextTab !== 'diff';
    panelSetup.hidden = nextTab !== 'setup';
  };

  const renderAll = (): void => {
    renderDiagnostics();
    renderTriagePanel();
    renderDiffPanel();
    renderSetupPanel();
  };

  themeToggleBtn.addEventListener('click', () => {
    theme = theme === 'light' ? 'dark' : 'light';
    applyTheme();
    themeToggleBtn.setAttribute('aria-pressed', String(theme === 'dark'));
    themeToggleBtn.textContent = theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
  });

  docInput.addEventListener('input', () => {
    rawText = docInput.value;
    renderDiagnostics();
    renderDiffPanel();
  });

  for (const sampleBtn of root.querySelectorAll<HTMLButtonElement>('[data-sample]')) {
    sampleBtn.addEventListener('click', () => {
      const id = sampleBtn.getAttribute('data-sample');
      const found = SAMPLE_DOCUMENTS.find((item) => item.id === id);
      if (!found) return;
      rawText = found.text;
      docInput.value = found.text;
      viewStatus = 'empty';
      errorMessage = '';
      lastResult = null;
      renderDiagnostics();
      renderTriagePanel();
      renderDiffPanel();
    });
  }

  clearBtn.addEventListener('click', () => {
    rawText = '';
    docInput.value = '';
    viewStatus = 'empty';
    errorMessage = '';
    lastResult = null;
    renderDiagnostics();
    renderTriagePanel();
    renderDiffPanel();
  });

  for (const radio of root.querySelectorAll<HTMLInputElement>('input[name="inference-mode"]')) {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        selectedMode = radio.value as InferenceMode;
        renderDiagnostics();
        renderDiffPanel();
        const snippetEl = panelSetup.querySelector<HTMLElement>('#sdk-snippet-block');
        if (snippetEl) {
          snippetEl.textContent = buildSdkSnippet();
        }
      }
    });
  }

  redactCheckbox.addEventListener('change', () => {
    redactBeforeCloud = redactCheckbox.checked;
    renderDiffPanel();
  });

  for (const [index, btn] of tabButtons.entries()) {
    btn.addEventListener('click', () => {
      const tabId: TabId =
        btn.id === 'tab-diff' ? 'diff' : btn.id === 'tab-setup' ? 'setup' : 'triage';
      switchTab(tabId);
    });

    btn.addEventListener('keydown', (event) => {
      let targetIdx = -1;
      if (event.key === 'ArrowRight') targetIdx = (index + 1) % tabButtons.length;
      if (event.key === 'ArrowLeft') targetIdx = (index - 1 + tabButtons.length) % tabButtons.length;
      if (event.key === 'Home') targetIdx = 0;
      if (event.key === 'End') targetIdx = tabButtons.length - 1;
      if (targetIdx === -1) return;
      event.preventDefault();
      const targetBtn = tabButtons[targetIdx];
      const nextId: TabId =
        targetBtn.id === 'tab-diff' ? 'diff' : targetBtn.id === 'tab-setup' ? 'setup' : 'triage';
      switchTab(nextId, true);
    });
  }

  runBtn.addEventListener('click', async () => {
    switchTab('triage');
    viewStatus = 'loading';
    errorMessage = '';
    runBtn.disabled = true;
    runBtn.textContent = 'Running Hybrid Triage...';
    renderTriagePanel();

    try {
      const result = await runHybridTriage({
        rawText,
        mode: selectedMode,
        redactBeforeCloud,
        firebaseConfig
      });
      lastResult = result;
      viewStatus = 'ready';
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Unexpected hybrid inference error.';
      viewStatus = 'error';
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = 'Run Hybrid Triage';
      renderTriagePanel();
      renderDiffPanel();
    }
  });

  renderAll();
  void probeOnDeviceAvailability().then((status) => {
    onDeviceStatus = status;
    renderDiagnostics();
  });

  return {
    destroy: () => {
      root.innerHTML = '';
    }
  };
}
