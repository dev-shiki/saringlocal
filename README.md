# SaringLocal

SaringLocal is a privacy-first incident and document triage workbench built for the `#BuildHybridAI 2026` challenge using the Firebase AI Logic hybrid inference SDK (`firebase/ai`).

## What It Does

1. **Local PII and Secret Boundary (`src/privacy/redactor.ts`)**: Scans text locally before any inference call to mask emails, Indonesian and international phone numbers, 16-digit ID numbers, Luhn-valid card numbers, internal hostnames/IPv4 addresses, and API tokens.
2. **Firebase AI Logic Hybrid Routing (`src/ai/hybridClient.ts`)**: Configures `getGenerativeModel` with `GoogleAIBackend`, `InferenceMode` (`PREFER_ON_DEVICE`, `ONLY_ON_DEVICE`, `PREFER_IN_CLOUD`, `ONLY_IN_CLOUD`), `onDeviceParams`, and `inCloudParams`.
3. **Explicit Runtime Transparency (`src/ui/app.ts`)**: Displays Chrome Built-in AI (`LanguageModel`) availability, active `inferenceSource` (`on_device`, `in_cloud`, or `local_deterministic` when no Firebase Web config is saved), latency, and the exact sanitized payload permitted past the device boundary.

## Requirements

- Node.js 20+
- Optional for live cloud fallback: a Firebase project with Firebase AI Logic enabled (Gemini Developer API) and Web config (`apiKey`, `projectId`, `appId`) entered in the **Firebase SDK Setup** tab.
- Optional for live on-device Gemini Nano in Chrome: Chrome desktop with Prompt API flags enabled. Without Firebase config or Gemini Nano, the app runs the local deterministic analyzer with zero network requests.

## Commands

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Verification

- TypeScript check: `npm run typecheck`
- Unit and DOM tests: `npm test`
- Production bundle: `npm run build`
