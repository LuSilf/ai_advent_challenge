export async function loadDotEnv(path = ".env"): Promise<void> {
  let content: string;

  try {
    const file = Bun.file(path);
    if (!(await file.exists())) {
      return;
    }
    content = await file.text();
  } catch {
    return;
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalized = line.startsWith("export ") ? line.slice(7).trimStart() : line;
    const eqIndex = normalized.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }

    const key = normalized.slice(0, eqIndex).trim();
    if (!key) {
      continue;
    }

    let value = normalized.slice(eqIndex + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
      value = value
        .replaceAll("\\n", "\n")
        .replaceAll("\\r", "\r")
        .replaceAll("\\t", "\t")
        .replaceAll('\\"', '"')
        .replaceAll("\\\\", "\\");
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
