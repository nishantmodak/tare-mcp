const SECRET_KEY_PATTERN = /(authorization|api[_-]?key|token|secret|password|credential|bearer)/i;

export function collectSecretValues(
  ...records: Array<Record<string, string> | undefined>
): string[] {
  const values = new Set<string>();

  for (const record of records) {
    for (const value of Object.values(record ?? {})) {
      if (value && value.length > 2) {
        values.add(value);
      }
    }
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (value && value.length > 2 && SECRET_KEY_PATTERN.test(key)) {
      values.add(value);
    }
  }

  return [...values].sort((a, b) => b.length - a.length);
}

export function redactText(input: unknown, secrets: string[] = []): string {
  let text = input instanceof Error ? input.message : String(input ?? "");

  for (const secret of secrets) {
    text = text.split(secret).join("[REDACTED]");
  }

  text = text.replace(/(Authorization\s*:\s*)([^\r\n]+)/gi, "$1[REDACTED]");
  text = text.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]");
  text = text.replace(
    /((?:api[_-]?key|token|secret|password)\s*[=:]\s*)[^\s,;]+/gi,
    "$1[REDACTED]"
  );

  return text;
}

export function isLikelyCredentialError(text: string): boolean {
  return /(auth|credential|unauthori[sz]ed|forbidden|api key|token|permission|access denied)/i.test(
    text
  );
}
