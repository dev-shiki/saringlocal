import { describe, expect, it, vi } from 'vitest';
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  ensureFirebaseAppCheck,
  InferenceMode,
  InferenceSource,
  runHybridTriage,
  type HybridModelFactory
} from '../src/ai/hybridClient';

describe('runHybridTriage', () => {
  it('rejects empty input clearly', async () => {
    await expect(
      runHybridTriage({
        rawText: '   ',
        mode: InferenceMode.PREFER_ON_DEVICE,
        redactBeforeCloud: true
      })
    ).rejects.toThrow(/Document input is empty/i);
  });

  it('runs local deterministic triage when no Firebase config is saved under PREFER_ON_DEVICE', async () => {
    const result = await runHybridTriage({
      rawText: 'SEV1 outage reported by ops@example.com with key AIzaSyExampleDemoKey1234567890abcd',
      mode: InferenceMode.PREFER_ON_DEVICE,
      redactBeforeCloud: true
    });

    expect(result.inferenceSource).toBe('local_deterministic');
    expect(result.severity).toBe('HIGH');
    expect(result.cloudBoundaryProtected).toBe(true);
    expect(result.payloadSentToModel).not.toContain('ops@example.com');
    expect(result.payloadSentToModel).not.toContain('AIzaSyExampleDemoKey1234567890abcd');
  });

  it('fails explicitly on ONLY_IN_CLOUD without Firebase config', async () => {
    await expect(
      runHybridTriage({
        rawText: 'Normal vendor clause review.',
        mode: InferenceMode.ONLY_IN_CLOUD,
        redactBeforeCloud: true
      })
    ).rejects.toThrow(/ONLY_IN_CLOUD requires a Firebase Web config/i);
  });

  it('passes only redacted text to Firebase AI Logic model when redactBeforeCloud is true', async () => {
    const generateContent = vi.fn().mockResolvedValue({
      response: {
        inferenceSource: InferenceSource.IN_CLOUD,
        text: () =>
          JSON.stringify({
            severity: 'MEDIUM',
            summary: 'Vendor contract contains auto-renewal notice clause.',
            actionItems: ['Review 60-day notice window.']
          })
      }
    });

    const mockFactory: HybridModelFactory = {
      createModel: vi.fn().mockReturnValue({ generateContent })
    };

    const result = await runHybridTriage(
      {
        rawText: 'Contact legal@vendor.example.com regarding 60-day auto-renew SLA.',
        mode: InferenceMode.PREFER_ON_DEVICE,
        redactBeforeCloud: true,
        firebaseConfig: {
          apiKey: 'test-api-key',
          projectId: 'test-project',
          appId: '1:123:web:abc'
        }
      },
      mockFactory
    );

    expect(mockFactory.createModel).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'test-project' }),
      InferenceMode.PREFER_ON_DEVICE,
      'gemini-3.1-flash-lite-preview'
    );
    const promptSent = generateContent.mock.calls[0]?.[0] as string;
    expect(promptSent).not.toContain('legal@vendor.example.com');
    expect(promptSent).toContain('[EMAIL_1]');
    expect(result.inferenceSource).toBe(InferenceSource.IN_CLOUD);
    expect(result.summary).toBe('Vendor contract contains auto-renewal notice clause.');
  });

  it('restores redacted tokens locally when cloud response references placeholder tokens', async () => {
    const generateContent = vi.fn().mockResolvedValue({
      response: {
        inferenceSource: InferenceSource.IN_CLOUD,
        text: () =>
          JSON.stringify({
            severity: 'HIGH',
            summary: 'Contact [EMAIL_1] regarding exposed token [SECRET_1].',
            actionItems: ['Notify [EMAIL_1] immediately.']
          })
      }
    });

    const mockFactory: HybridModelFactory = {
      createModel: vi.fn().mockReturnValue({ generateContent })
    };

    const result = await runHybridTriage(
      {
        rawText: 'Alert for secops@example.com about key sk-liveSecretToken1234567890',
        mode: InferenceMode.PREFER_IN_CLOUD,
        redactBeforeCloud: true,
        firebaseConfig: {
          apiKey: 'test-api-key',
          projectId: 'test-project',
          appId: '1:123:web:abc'
        }
      },
      mockFactory
    );

    expect(result.payloadSentToModel).toContain('[EMAIL_1]');
    expect(result.payloadSentToModel).toContain('[SECRET_1]');
    expect(result.summary).toBe('Contact secops@example.com regarding exposed token sk-liveSecretToken1234567890.');
    expect(result.actionItems[0]).toBe('Notify secops@example.com immediately.');
  });
});

describe('ensureFirebaseAppCheck', () => {
  it('returns null when neither site key nor debug token is configured', () => {
    const fakeApp = { name: 'appcheck-noop-test' } as FirebaseApp;
    const result = ensureFirebaseAppCheck(fakeApp, {
      apiKey: 'k',
      projectId: 'p',
      appId: '1:1:web:1'
    });
    expect(result).toBeNull();
  });

  it('initializes Firebase App Check once with debug token and remains idempotent', () => {
    const app = initializeApp(
      {
        apiKey: 'AIzaSyTestKeyForUnitCheck00000000000',
        projectId: 'saringlocal-unit-test',
        appId: '1:100000000000:web:abcdef123456'
      },
      'saringlocal-appcheck-unit'
    );

    const first = ensureFirebaseAppCheck(app, {
      apiKey: 'AIzaSyTestKeyForUnitCheck00000000000',
      projectId: 'saringlocal-unit-test',
      appId: '1:100000000000:web:abcdef123456',
      appCheckDebugToken: '11111111-2222-3333-4444-555555555555'
    });

    expect(first).not.toBeNull();
    expect(first?.app.name).toBe('saringlocal-appcheck-unit');
    expect(globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN).toBe(
      '11111111-2222-3333-4444-555555555555'
    );

    const second = ensureFirebaseAppCheck(app, {
      apiKey: 'AIzaSyTestKeyForUnitCheck00000000000',
      projectId: 'saringlocal-unit-test',
      appId: '1:100000000000:web:abcdef123456',
      appCheckDebugToken: '11111111-2222-3333-4444-555555555555'
    });
    expect(second).toBe(first);
  });
});
