import { Pool } from "pg"

export type MemoryChunk = {
	chunkId: string
	filePath: string
	startLine: number
	endLine: number
	content: string
	embedding: number[]
}

export type MemorySearchRow = {
	filePath: string
	startLine: number
	endLine: number
	content: string
	score: number
}

function vectorLiteral(embedding: number[]): string {
	return `[${embedding.join(",")}]`
}

export class PgVectorStore {
	private pool: Pool | null = null
	private vectorDim: number | null = null

	constructor(private readonly connectionString: string) {}

	async connect(): Promise<void> {
		if (this.pool) return
		this.pool = new Pool({ connectionString: this.connectionString })
		await this.pool.query("SELECT 1")
	}

	async close(): Promise<void> {
		if (!this.pool) return
		await this.pool.end()
		this.pool = null
	}

	private requirePool(): Pool {
		if (!this.pool) {
			throw new Error("PgVectorStore is not connected")
		}
		return this.pool
	}

	async ensureSchema(vectorDim: number): Promise<void> {
		const pool = this.requirePool()
		if (!this.vectorDim) {
			this.vectorDim = vectorDim
		} else if (this.vectorDim !== vectorDim) {
			throw new Error(`Vector dimension mismatch: ${this.vectorDim} vs ${vectorDim}`)
		}

		await pool.query("CREATE EXTENSION IF NOT EXISTS vector")

		await pool.query(`
			CREATE TABLE IF NOT EXISTS kilo_memory_index_meta (
				index_id TEXT PRIMARY KEY,
				model_id TEXT NOT NULL,
				vector_dim INT NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`)

		await pool.query(`
			CREATE TABLE IF NOT EXISTS kilo_memory_index_files (
				index_id TEXT NOT NULL REFERENCES kilo_memory_index_meta(index_id) ON DELETE CASCADE,
				file_path TEXT NOT NULL,
				file_hash TEXT NOT NULL,
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				PRIMARY KEY (index_id, file_path)
			)
		`)

		await pool.query(`
			CREATE TABLE IF NOT EXISTS kilo_memory_index_chunks (
				index_id TEXT NOT NULL REFERENCES kilo_memory_index_meta(index_id) ON DELETE CASCADE,
				chunk_id TEXT NOT NULL,
				file_path TEXT NOT NULL,
				start_line INT NOT NULL,
				end_line INT NOT NULL,
				content TEXT NOT NULL,
				embedding VECTOR(${vectorDim}) NOT NULL,
				PRIMARY KEY (index_id, chunk_id)
			)
		`)

		await pool.query(
			"CREATE INDEX IF NOT EXISTS kilo_memory_index_chunks_vec_idx ON kilo_memory_index_chunks USING ivfflat (embedding vector_cosine_ops)",
		)
	}

	async ensureIndexMeta(indexId: string, modelId: string, vectorDim: number): Promise<void> {
		const pool = this.requirePool()
		const existing = await pool.query(
			"SELECT model_id, vector_dim FROM kilo_memory_index_meta WHERE index_id = $1",
			[indexId],
		)
		if (existing.rowCount) {
			const row = existing.rows[0]
			if (row.model_id !== modelId || Number(row.vector_dim) !== vectorDim) {
				throw new Error(
					`Memory index meta mismatch for ${indexId}: ${row.model_id}/${row.vector_dim} vs ${modelId}/${vectorDim}`,
				)
			}
			await pool.query("UPDATE kilo_memory_index_meta SET updated_at = now() WHERE index_id = $1", [indexId])
			return
		}

		await pool.query("INSERT INTO kilo_memory_index_meta (index_id, model_id, vector_dim) VALUES ($1, $2, $3)", [
			indexId,
			modelId,
			vectorDim,
		])
	}

	async listIndexedFiles(indexId: string): Promise<Map<string, string>> {
		const pool = this.requirePool()
		const res = await pool.query("SELECT file_path, file_hash FROM kilo_memory_index_files WHERE index_id = $1", [
			indexId,
		])
		const map = new Map<string, string>()
		for (const row of res.rows) {
			map.set(row.file_path, row.file_hash)
		}
		return map
	}

	async upsertFile(indexId: string, filePath: string, fileHash: string, chunks: MemoryChunk[]): Promise<void> {
		const pool = this.requirePool()
		const client = await pool.connect()
		try {
			await client.query("BEGIN")
			await client.query("DELETE FROM kilo_memory_index_chunks WHERE index_id = $1 AND file_path = $2", [
				indexId,
				filePath,
			])

			for (const chunk of chunks) {
				await client.query(
					`INSERT INTO kilo_memory_index_chunks (index_id, chunk_id, file_path, start_line, end_line, content, embedding)
					 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
					[
						indexId,
						chunk.chunkId,
						chunk.filePath,
						chunk.startLine,
						chunk.endLine,
						chunk.content,
						vectorLiteral(chunk.embedding),
					],
				)
			}

			await client.query(
				`INSERT INTO kilo_memory_index_files (index_id, file_path, file_hash)
				 VALUES ($1, $2, $3)
				 ON CONFLICT (index_id, file_path) DO UPDATE SET file_hash = $3, updated_at = now()`,
				[indexId, filePath, fileHash],
			)
			await client.query("COMMIT")
		} catch (error) {
			await client.query("ROLLBACK")
			throw error
		} finally {
			client.release()
		}
	}

	async deleteFile(indexId: string, filePath: string): Promise<void> {
		const pool = this.requirePool()
		await pool.query("DELETE FROM kilo_memory_index_chunks WHERE index_id = $1 AND file_path = $2", [
			indexId,
			filePath,
		])
		await pool.query("DELETE FROM kilo_memory_index_files WHERE index_id = $1 AND file_path = $2", [
			indexId,
			filePath,
		])
	}

	async deleteMissingFiles(indexId: string, currentPaths: string[]): Promise<void> {
		const pool = this.requirePool()
		const res = await pool.query("SELECT file_path FROM kilo_memory_index_files WHERE index_id = $1", [indexId])
		const current = new Set(currentPaths)
		for (const row of res.rows) {
			if (!current.has(row.file_path)) {
				await this.deleteFile(indexId, row.file_path)
			}
		}
	}

	async search(
		indexIds: string[],
		queryEmbedding: number[],
		options: { limit: number; minScore: number },
	): Promise<MemorySearchRow[]> {
		if (indexIds.length === 0) return []
		const pool = this.requirePool()
		const vector = vectorLiteral(queryEmbedding)
		const res = await pool.query(
			`
			SELECT file_path, start_line, end_line, content,
				1 - (embedding <=> $1) AS score
			FROM kilo_memory_index_chunks
			WHERE index_id = ANY($2)
			AND 1 - (embedding <=> $1) >= $3
			ORDER BY embedding <=> $1
			LIMIT $4
			`,
			[vector, indexIds, options.minScore, options.limit],
		)
		return res.rows.map((row) => ({
			filePath: row.file_path,
			startLine: Number(row.start_line),
			endLine: Number(row.end_line),
			content: row.content,
			score: Number(row.score),
		}))
	}
}
