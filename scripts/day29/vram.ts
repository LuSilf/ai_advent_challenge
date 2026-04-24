import { spawnSync } from "node:child_process";

export type VramSnapshot = {
  takenAt: string;
  gpuMemoryUsedMb: number | null;
  gpuMemoryTotalMb: number | null;
  ollamaProcesses: OllamaProcessInfo[];
  partialOffload: boolean;
};

export type OllamaProcessInfo = {
  name: string;
  size: string;
  processor: string;
};

function readNvidiaSmi(): { usedMb: number | null; totalMb: number | null } {
  try {
    const result = spawnSync(
      "nvidia-smi",
      ["--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"],
      { encoding: "utf8", timeout: 5000 },
    );
    if (result.status !== 0) {
      return { usedMb: null, totalMb: null };
    }
    const firstLine = result.stdout.split("\n")[0]?.trim();
    if (!firstLine) return { usedMb: null, totalMb: null };
    const [usedRaw, totalRaw] = firstLine.split(",").map((s) => s.trim());
    const usedMb = Number(usedRaw);
    const totalMb = Number(totalRaw);
    return {
      usedMb: Number.isFinite(usedMb) ? usedMb : null,
      totalMb: Number.isFinite(totalMb) ? totalMb : null,
    };
  } catch {
    return { usedMb: null, totalMb: null };
  }
}

function readOllamaPs(): { procs: OllamaProcessInfo[]; partial: boolean } {
  try {
    const result = spawnSync("ollama", ["ps"], { encoding: "utf8", timeout: 5000 });
    if (result.status !== 0) {
      return { procs: [], partial: false };
    }
    const lines = result.stdout.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length <= 1) return { procs: [], partial: false };
    const procs: OllamaProcessInfo[] = [];
    let partial = false;
    for (const line of lines.slice(1)) {
      const parts = line.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
      if (parts.length < 3) continue;
      const name = parts[0] ?? "";
      const size = parts[2] ?? "";
      const processor = parts[3] ?? "";
      procs.push({ name, size, processor });
      if (/cpu/i.test(processor) && /gpu/i.test(processor)) {
        partial = true;
      }
    }
    return { procs, partial };
  } catch {
    return { procs: [], partial: false };
  }
}

export function captureVramSnapshot(): VramSnapshot {
  const { usedMb, totalMb } = readNvidiaSmi();
  const { procs, partial } = readOllamaPs();
  return {
    takenAt: new Date().toISOString(),
    gpuMemoryUsedMb: usedMb,
    gpuMemoryTotalMb: totalMb,
    ollamaProcesses: procs,
    partialOffload: partial,
  };
}
