# SaringLocal

SaringLocal is a privacy-first incident and document triage web app built for `#BuildHybridAI 2026` using the Firebase AI Logic hybrid inference SDK (`firebase/ai`) and Firebase App Check (`firebase/app-check`).

Live hosted demo: https://dev-shiki.github.io/saringlocal/

## Value Proposition

Teams reviewing production incident reports, vendor NDAs, or customer tickets cannot safely send raw secrets, API tokens, phone numbers, card numbers, or internal hostnames straight to a cloud LLM. At the same time, Chrome's on-device Gemini Nano model is not yet installed on every workstation.

SaringLocal solves both constraints with a single hybrid workflow:
- Runs inference locally on-device when Chrome Built-in AI (Gemini Nano) is available.
- Falls back to Gemini in the cloud through Firebase AI Logic (`GoogleAIBackend`) when on-device inference is unavailable or cloud mode is selected.
- Strips PII and credentials locally before any prompt leaves the browser, then re-hydrates placeholder tokens locally in the rendered output.

## How Firebase AI Logic and App Check Are Used at Runtime

1. **Firebase AI Logic (`src/ai/hybridClient.ts`)**: Imports and executes `getAI`, `getGenerativeModel`, `GoogleAIBackend`, `InferenceMode` (`PREFER_ON_DEVICE`, `ONLY_ON_DEVICE`, `PREFER_IN_CLOUD`, `ONLY_IN_CLOUD`), and `InferenceSource` from `firebase/ai`, wiring both `onDeviceParams` (Chrome Prompt API) and `inCloudParams` (`gemini-2.5-flash` structured JSON output).
2. **Firebase App Check (`src/ai/hybridClient.ts`)**: Imports and executes `initializeAppCheck` and `ReCaptchaV3Provider` from `firebase/app-check` with `isTokenAutoRefreshEnabled: true`, supporting both reCAPTCHA v3 site keys and App Check debug tokens (`FIREBASE_APPCHECK_DEBUG_TOKEN`) configured in the **Firebase SDK Setup** tab.
3. **Local PII & Secret Boundary (`src/privacy/redactor.ts`)**: Detects and masks emails, Indonesian and international phone numbers, 16-digit ID numbers, Luhn-valid payment card numbers, internal hostnames/IPv4 addresses, and API tokens before cloud egress.
4. **Runtime Transparency Inspector (`src/ui/app.ts`)**: Displays Chrome Prompt API availability, Firebase + App Check status, active `inferenceSource` (`on_device`, `in_cloud`, or `local_deterministic` when no Firebase Web config is saved), latency, and a side-by-side **Cloud Payload Diff** showing the exact bytes permitted past the device boundary.

## Quick Start

### Prerequisites
- Node.js 20+
- Optional for live cloud fallback: a Firebase project with **Firebase AI Logic** (Gemini Developer API) and **Firebase App Check** enabled. Enter `apiKey`, `projectId`, `appId`, and either an App Check reCAPTCHA v3 Site Key or an App Check Debug Token (`true` or a registered UUID) in the **Firebase SDK Setup** tab.
- Optional for live on-device Gemini Nano in Chrome: Chrome desktop with Prompt API flags enabled. Without Firebase config or Gemini Nano, SaringLocal runs its local deterministic analyzer with zero network requests.

### Commands

```bash
npm install
npm run typecheck
npm test
npm run build
npm run dev
```

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](./LICENSE).
