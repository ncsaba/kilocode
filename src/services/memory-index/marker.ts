import * as fs from "fs/promises"
import * as path from "path"
import { randomUUID } from "crypto"
import { MemoryIndexMarker } from "./types"

export const MEMORY_INDEX_MARKER_FILE = ".kilocode-memory-index.json"

export function getMarkerPath(repoRoot: string): string {
	return path.join(repoRoot, MEMORY_INDEX_MARKER_FILE)
}

export async function readMarker(repoRoot: string): Promise<MemoryIndexMarker | null> {
	const markerPath = getMarkerPath(repoRoot)
	try {
		const raw = await fs.readFile(markerPath, "utf8")
		const parsed = JSON.parse(raw) as MemoryIndexMarker
		if (!parsed?.indexId || !parsed.modelId || !parsed.modelDimension) {
			return null
		}
		return parsed
	} catch {
		return null
	}
}

export async function writeMarker(repoRoot: string, marker: MemoryIndexMarker): Promise<void> {
	const markerPath = getMarkerPath(repoRoot)
	const payload = JSON.stringify(marker, null, 2)
	await fs.writeFile(markerPath, payload)
}

export async function getOrCreateMarker(
	repoRoot: string,
	modelId: string,
	modelDimension: number,
): Promise<{ marker: MemoryIndexMarker; created: boolean; path: string }> {
	const existing = await readMarker(repoRoot)
	const markerPath = getMarkerPath(repoRoot)
	if (existing) {
		if (existing.modelId !== modelId || existing.modelDimension !== modelDimension) {
			throw new Error(
				`Memory index marker mismatch for ${repoRoot}: expected ${existing.modelId}/${existing.modelDimension}, got ${modelId}/${modelDimension}`,
			)
		}
		return { marker: existing, created: false, path: markerPath }
	}

	const marker: MemoryIndexMarker = {
		indexId: randomUUID(),
		modelId,
		modelDimension,
		createdAt: new Date().toISOString(),
	}
	await writeMarker(repoRoot, marker)
	return { marker, created: true, path: markerPath }
}
