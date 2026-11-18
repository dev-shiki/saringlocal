export type SensitiveCategory =
  | 'EMAIL'
  | 'PHONE'
  | 'ID_NUMBER'
  | 'SECRET'
  | 'CARD'
  | 'INTERNAL_HOST';

export interface RedactionFinding {
  token: string;
  category: SensitiveCategory;
  originalValue: string;
  start: number;
  end: number;
}

export interface RedactionResult {
  sanitizedText: string;
  findings: RedactionFinding[];
  countsByCategory: Record<SensitiveCategory, number>;
  hasSensitiveData: boolean;
  restoreTokens: (text: string) => string;
}

interface PatternSpec {
  category: SensitiveCategory;
  regex: RegExp;
  validate?: (match: string) => boolean;
}

function passesLuhn(digitsOnly: string): boolean {
  if (digitsOnly.length < 13 || digitsOnly.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digitsOnly.length - 1; i >= 0; i -= 1) {
    let digit = Number(digitsOnly[i]);
    if (Number.isNaN(digit)) return false;
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

const PATTERN_SPECS: PatternSpec[] = [
  {
    category: 'SECRET',
    regex: /\b(?:AIza[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z_-]{16,}|ghp_[0-9A-Za-z]{20,}|Bearer\s+[A-Za-z0-9._-]{16,})\b/g
  },
  {
    category: 'EMAIL',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
  },
  {
    category: 'INTERNAL_HOST',
    regex: /\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:internal|local|corp)(?::\d{2,5})?(?:\/[^\s,;)]*)?\b|\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(?::\d{2,5})?\b/gi
  },
  {
    category: 'CARD',
    regex: /\b(?:\d[ -]?){13,19}\b/g,
    validate: (match: string) => passesLuhn(match.replace(/\D/g, ''))
  },
  {
    category: 'ID_NUMBER',
    regex: /\b\d{16}\b/g
  },
  {
    category: 'PHONE',
    regex: /(?:\+62|62|0)8\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{3,5}\b|\+\d{1,3}[-.\s]?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g
  }
];

function emptyCategoryCounts(): Record<SensitiveCategory, number> {
  return {
    EMAIL: 0,
    PHONE: 0,
    ID_NUMBER: 0,
    SECRET: 0,
    CARD: 0,
    INTERNAL_HOST: 0
  };
}

export function redactSensitiveText(input: string): RedactionResult {
  const candidates: Array<{
    start: number;
    end: number;
    category: SensitiveCategory;
    value: string;
  }> = [];

  for (const spec of PATTERN_SPECS) {
    const regex = new RegExp(spec.regex.source, spec.regex.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(input)) !== null) {
      const value = match[0];
      if (spec.validate && !spec.validate(value)) {
        continue;
      }
      candidates.push({
        start: match.index,
        end: match.index + value.length,
        category: spec.category,
        value
      });
    }
  }

  // Keep earliest start first, then longest span, and skip overlapping matches
  candidates.sort((a, b) => a.start - b.start || b.end - a.end);
  const nonOverlapping: typeof candidates = [];
  let cursor = 0;
  for (const item of candidates) {
    if (item.start >= cursor) {
      nonOverlapping.push(item);
      cursor = item.end;
    }
  }

  const counts = emptyCategoryCounts();
  const findings: RedactionFinding[] = [];
  const tokenMap = new Map<string, string>();
  const valueToToken = new Map<string, string>();

  let output = '';
  let lastIndex = 0;

  for (const item of nonOverlapping) {
    output += input.slice(lastIndex, item.start);
    const cacheKey = `${item.category}:${item.value}`;
    let token = valueToToken.get(cacheKey);
    if (!token) {
      counts[item.category] += 1;
      token = `[${item.category}_${counts[item.category]}]`;
      valueToToken.set(cacheKey, token);
      tokenMap.set(token, item.value);
    }
    output += token;
    findings.push({
      token,
      category: item.category,
      originalValue: item.value,
      start: item.start,
      end: item.end
    });
    lastIndex = item.end;
  }

  output += input.slice(lastIndex);

  const restoreTokens = (text: string): string => {
    let restored = text;
    for (const [token, original] of tokenMap.entries()) {
      restored = restored.split(token).join(original);
    }
    return restored;
  };

  return {
    sanitizedText: output,
    findings,
    countsByCategory: counts,
    hasSensitiveData: findings.length > 0,
    restoreTokens
  };
}
