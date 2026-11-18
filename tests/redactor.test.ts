import { describe, expect, it } from 'vitest';
import { redactSensitiveText } from '../src/privacy/redactor';

describe('redactSensitiveText', () => {
  it('masks emails, Indonesian phone numbers, 16-digit IDs, internal hosts, and API keys while allowing restoration', () => {
    const sample =
      'Contact sinta@example.org or +62 812-3456-7890 for NIK 3174051208950001 on https://auth.internal:8443 using AIzaSyExampleDemoKey1234567890abcd.';

    const result = redactSensitiveText(sample);

    expect(result.hasSensitiveData).toBe(true);
    expect(result.sanitizedText).not.toContain('sinta@example.org');
    expect(result.sanitizedText).not.toContain('812-3456-7890');
    expect(result.sanitizedText).not.toContain('3174051208950001');
    expect(result.sanitizedText).not.toContain('auth.internal');
    expect(result.sanitizedText).not.toContain('AIzaSyExampleDemoKey1234567890abcd');

    expect(result.countsByCategory.EMAIL).toBe(1);
    expect(result.countsByCategory.PHONE).toBe(1);
    expect(result.countsByCategory.ID_NUMBER).toBe(1);
    expect(result.countsByCategory.INTERNAL_HOST).toBe(1);
    expect(result.countsByCategory.SECRET).toBe(1);

    expect(result.restoreTokens(result.sanitizedText)).toBe(sample);
  });

  it('reuses identical token for repeated sensitive values and skips non-Luhn 16-digit IDs as cards', () => {
    const sample = 'Email a@example.com twice: a@example.com and ID 1234567890123456';
    const result = redactSensitiveText(sample);

    expect(result.countsByCategory.EMAIL).toBe(1);
    expect(result.countsByCategory.CARD).toBe(0);
    expect(result.countsByCategory.ID_NUMBER).toBe(1);
    expect(result.sanitizedText).toBe('Email [EMAIL_1] twice: [EMAIL_1] and ID [ID_NUMBER_1]');
  });
});
