const NAMED_SECRET_ASSIGNMENT =
  /\b(?:api[_-]?key|token|secret|password|passwd|pwd|authorization)\b\s*[:=]\s*(?:"[^"]+"|'[^']+'|[^\s,;]+)/gi;

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /ghp_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /AIzaSy[A-Za-z0-9_-]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

const HIGH_ENTROPY_CANDIDATE = /(?<![A-Za-z0-9+/=_-])(?:[A-Za-z0-9+/=_-]{32,})(?![A-Za-z0-9+/=_-])/g;
const MIN_ENTROPY = 4.25;
const MIN_SECRET_LENGTH = 40;

export function redactSecrets(text: string): string {
  let redacted = text.replace(NAMED_SECRET_ASSIGNMENT, (match) => {
    const separator = match.includes('=') ? '=' : ':';
    const [name] = match.split(separator, 1);
    return `${name}${separator}[REDACTED]`;
  });

  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED_SECRET]');
  }

  return redacted.replace(HIGH_ENTROPY_CANDIDATE, (candidate) => {
    if (candidate.length < MIN_SECRET_LENGTH) {
      return candidate;
    }
    return shannonEntropy(candidate) >= MIN_ENTROPY ? '[REDACTED_SECRET]' : candidate;
  });
}

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}
