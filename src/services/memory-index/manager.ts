import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import * as fsSync from "fs"
import { createHash } from "crypto"

import { CodeParser } from "../code-index/processors/parser"
import { getDefaultModelId, getModelDimension } from "../../shared/embeddingModels"
import { ContextProxy } from "../../core/config/ContextProxy"
import { OpenAiEmbedder } from "../code-index/embedders/openai"
import { CodeIndexOllamaEmbedder } from "../code-index/embedders/ollama"
import { OpenAICompatibleEmbedder } from "../code-index/embedders/openai-compatible"
import { GeminiEmbedder } from "../code-index/embedders/gemini"
import { MistralEmbedder } from "../code-index/embedders/mistral"
import { VercelAiGatewayEmbedder } from "../code-index/embedders/vercel-ai-gateway"
import { BedrockEmbedder } from "../code-index/embedders/bedrock"
import { OpenRouterEmbedder } from "../code-index/embedders/openrouter"
import { VoyageEmbedder } from "../code-index/embedders/voyage"
import type { IEmbedder } from "../code-index/interfaces"

import { loadMemoryIndexConfig } from "./config"
import { getOrCreateMarker } from "./marker"
import { MemoryIndexConfig, MemoryIndexSearchResult, MemoryIndexStatus } from "./types"
import { PgVectorStore, MemoryChunk } from "./pgvector-store"

const DEFAULT_PG_URL = "postgresql://kilocode@localhost:5432/kilocode"

function toPosix(p: string): string {
	return p.split(path.sep).join("/")
}

function hashText(text: string): string {
	return createHash("sha256").update(text).digest("hex")
}

function normalizeRepoRoot(repoRoot: string): string {
	return path.normalize(repoRoot)
}

function isGitRootDir(dirPath: string): boolean {
	try {
		const stat = fsSync.lstatSync(path.join(dirPath, ".git"))
		return stat.isDirectory() || stat.isFile()
	} catch {
		return false
	}
}

async function findRepoRoots(): Promise<string[]> {
	const roots: string[] = []
	const workspaceFolders = vscode.workspace.workspaceFolders ?? []
	for (const folder of workspaceFolders) {
		const root = folder.uri.fsPath
		if (isGitRootDir(root)) {
			roots.push(root)
			continue
		}
		try {
			const entries = await fs.readdir(root, { withFileTypes: true })
			for (const entry of entries) {
				if (!entry.isDirectory()) continue
				if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
				const candidate = path.join(root, entry.name)
				if (isGitRootDir(candidate)) {
					roots.push(candidate)
				}
			}
		} catch {
			continue
		}
	}
	return Array.from(new Set(roots.map(normalizeRepoRoot)))
}

async function listMemoryFiles(repoRoot: string, config: MemoryIndexConfig): Promise<string[]> {
	const files: string[] = []
	const addFile = async (filePath: string) => {
		try {
			const stat = await fs.stat(filePath)
			if (stat.isFile() && filePath.endsWith(".md")) {
				files.push(filePath)
			}
		} catch {}
	}

	if (config.includeMemoryFile) {
		await addFile(path.join(repoRoot, config.memoryFileName))
	}

	if (config.includeMemoryDir) {
		const dirPath = path.join(repoRoot, config.memoryDirName)
		const walk = async (dir: string) => {
			let entries
			try {
				entries = await fs.readdir(dir, { withFileTypes: true })
			} catch {
				return
			}
			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name)
				if (entry.isDirectory()) {
					await walk(fullPath)
				} else if (entry.isFile() && fullPath.endsWith(".md")) {
					files.push(fullPath)
				}
			}
		}
		await walk(dirPath)
	}

	return files
}

function getRepoRootForPath(repoRoots: string[], filePath: string): string | undefined {
	const normalized = path.normalize(filePath)
	return repoRoots.find((root) => normalized.startsWith(root + path.sep))
}

function isMemoryPath(repoRoot: string, config: MemoryIndexConfig, filePath: string): boolean {
	const normalized = path.normalize(filePath)
	const memoryFile = path.join(repoRoot, config.memoryFileName)
	if (config.includeMemoryFile && normalized === memoryFile) return true
	if (config.includeMemoryDir) {
		const memoryDir = path.join(repoRoot, config.memoryDirName)
		return normalized.startsWith(memoryDir + path.sep)
	}
	return false
}

export class MemoryIndexManager implements vscode.Disposable {
	private static instance: MemoryIndexManager | null = null
	private readonly parser = new CodeParser()
	private status: MemoryIndexStatus = { state: "disabled", reason: "Not initialized" }
	private readonly statusEmitter = new vscode.EventEmitter<MemoryIndexStatus>()
	private pgStore: PgVectorStore | null = null
	private config: MemoryIndexConfig | null = null
	private repoRoots: string[] = []
	private indexIds = new Map<string, string>()
	private embedder: IEmbedder | null = null
	private modelId: string | null = null
	private modelDimension: number | null = null
	private watchers: vscode.FileSystemWatcher[] = []
	private contextProxy: ContextProxy | null = null
	private pendingIndex = new Map<string, NodeJS.Timeout>()

	static getInstance(context?: vscode.ExtensionContext): MemoryIndexManager | null {
		if (!MemoryIndexManager.instance && context) {
			MemoryIndexManager.instance = new MemoryIndexManager(context)
		}
		return MemoryIndexManager.instance
	}

	private constructor(private readonly context: vscode.ExtensionContext) {}

	public getStatus(): MemoryIndexStatus {
		return this.status
	}

	public onStatusUpdate(listener: (status: MemoryIndexStatus) => void): vscode.Disposable {
		return this.statusEmitter.event(listener)
	}

	private setStatus(status: MemoryIndexStatus): void {
		this.status = status
		this.statusEmitter.fire(status)
	}

	async initialize(): Promise<void> {
		this.setStatus({ state: "connecting" })
		this.contextProxy = await ContextProxy.getInstance(this.context)
		const config = loadMemoryIndexConfig()
		this.config = config
		if (!config.enabled) {
			this.setStatus({ state: "disabled", reason: "Memory index disabled by settings" })
			return
		}

		const pgUrl = await this.resolvePgConnectionString()
		if (!pgUrl) {
			this.setStatus({ state: "disabled", reason: "Postgres not available" })
			return
		}

		this.pgStore = new PgVectorStore(pgUrl)
		try {
			await this.pgStore.connect()
		} catch (error) {
			this.setStatus({ state: "error", error: error instanceof Error ? error.message : String(error) })
			return
		}

		try {
			await this.resolveEmbedder(config)
			if (!this.modelId || !this.modelDimension) {
				throw new Error("Memory embedder is not configured")
			}

			await this.pgStore.ensureSchema(this.modelDimension)
			this.repoRoots = await findRepoRoots()
			await this.indexAllRepos()
			this.setupWatchers()
			this.setStatus({ state: "ready", indexedRepos: this.repoRoots.length })
		} catch (error) {
			this.setStatus({ state: "error", error: error instanceof Error ? error.message : String(error) })
		}
	}

	async retryConnection(): Promise<void> {
		await this.disposeWatchers()
		if (this.pgStore) {
			await this.pgStore.close()
		}
		this.pgStore = null
		this.embedder = null
		this.modelId = null
		this.modelDimension = null
		this.indexIds.clear()
		await this.initialize()
	}

	async search(query: string, cwd?: string): Promise<MemoryIndexSearchResult[]> {
		if (!this.pgStore || !this.embedder || !this.modelId || !this.modelDimension) {
			throw new Error("Memory index is not available")
		}
		if (!this.config) {
			throw new Error("Memory index configuration missing")
		}

		const embeddingResult = await this.embedder.createEmbeddings([query], this.modelId)
		const embedding = embeddingResult.embeddings[0]
		if (!embedding) return []

		const targetRepo = cwd ? getRepoRootForPath(this.repoRoots, cwd) : undefined
		const indexIds = targetRepo ? [this.indexIds.get(targetRepo)].filter(Boolean) : [...this.indexIds.values()]

		const rows = await this.pgStore.search(indexIds as string[], embedding, {
			limit: this.config.searchMaxResults,
			minScore: this.config.searchMinScore,
		})

		return rows.map((row) => ({
			filePath: row.filePath,
			score: row.score,
			startLine: row.startLine,
			endLine: row.endLine,
			content: row.content,
		}))
	}

	async notifyFileWritten(filePath: string): Promise<void> {
		if (!this.config || !this.pgStore) return
		const repoRoot = getRepoRootForPath(this.repoRoots, filePath)
		if (!repoRoot) return
		if (!isMemoryPath(repoRoot, this.config, filePath)) return
		await this.indexFile(repoRoot, filePath)
	}

	dispose(): void {
		void this.disposeWatchers()
		if (this.pgStore) {
			void this.pgStore.close()
		}
		this.pgStore = null
	}

	private async disposeWatchers(): Promise<void> {
		this.watchers.forEach((watcher) => watcher.dispose())
		this.watchers = []
		this.pendingIndex.forEach((timer) => clearTimeout(timer))
		this.pendingIndex.clear()
	}

	private async resolvePgConnectionString(): Promise<string | null> {
		const fromEnv = process.env.KILO_PGVECTOR_URL
		if (fromEnv && fromEnv.trim()) {
			return fromEnv.trim()
		}
		const probe = new PgVectorStore(DEFAULT_PG_URL)
		try {
			await probe.connect()
			await probe.close()
			return DEFAULT_PG_URL
		} catch {
			return null
		}
	}

	private async resolveEmbedder(config: MemoryIndexConfig): Promise<void> {
		if (!this.contextProxy) {
			throw new Error("ContextProxy unavailable")
		}
		const modelId = config.modelId || getDefaultModelId(config.providers[0] ?? "openai")
		const modelDimension = config.modelDimension || getModelDimension(config.providers[0] ?? "openai", modelId)
		if (!modelDimension) {
			throw new Error("Unable to determine embedding dimension for memory index")
		}

		for (const provider of config.providers) {
			const providerDimension = config.modelDimension || getModelDimension(provider, modelId)
			if (!providerDimension || providerDimension !== modelDimension) {
				continue
			}
			const embedder = this.createEmbedder(provider, config)
			if (!embedder) {
				continue
			}
			try {
				const result = await embedder.validateConfiguration()
				if (!result.valid) {
					continue
				}
				this.embedder = embedder
				this.modelId = modelId
				this.modelDimension = modelDimension
				return
			} catch {
				continue
			}
		}

		throw new Error("No valid memory index embedder configuration found")
	}

	private createEmbedder(
		provider: MemoryIndexConfig["providers"][number],
		config: MemoryIndexConfig,
	): IEmbedder | null {
		if (!this.contextProxy) return null
		const secrets = this.contextProxy
		switch (provider) {
			case "openai": {
				const apiKey =
					secrets.getSecret("memoryIndexOpenAiKey") ||
					secrets.getSecret("openAiNativeApiKey") ||
					secrets.getSecret("openAiApiKey") ||
					""
				if (!apiKey) return null
				return new OpenAiEmbedder({ openAiNativeApiKey: apiKey, openAiEmbeddingModelId: config.modelId })
			}
			case "ollama": {
				const baseUrl = config.ollamaBaseUrl || ""
				if (!baseUrl) return null
				return new CodeIndexOllamaEmbedder({
					ollamaBaseUrl: baseUrl,
					ollamaModelId: config.modelId,
					ollamaNumCtx: config.modelDimension,
				})
			}
			case "openai-compatible": {
				const baseUrl = config.openAiCompatibleBaseUrl || ""
				const apiKey = secrets.getSecret("memoryIndexOpenAiCompatibleApiKey") || ""
				if (!baseUrl || !apiKey) return null
				return new OpenAICompatibleEmbedder(baseUrl, apiKey, config.modelId || "")
			}
			case "gemini": {
				const apiKey = secrets.getSecret("memoryIndexGeminiApiKey") || secrets.getSecret("geminiApiKey") || ""
				if (!apiKey) return null
				return new GeminiEmbedder(apiKey, config.modelId || "")
			}
			case "mistral": {
				const apiKey = secrets.getSecret("memoryIndexMistralApiKey") || secrets.getSecret("mistralApiKey") || ""
				if (!apiKey) return null
				return new MistralEmbedder(apiKey, config.modelId || "")
			}
			case "vercel-ai-gateway": {
				const apiKey =
					secrets.getSecret("memoryIndexVercelAiGatewayApiKey") ||
					secrets.getSecret("vercelAiGatewayApiKey") ||
					""
				if (!apiKey) return null
				return new VercelAiGatewayEmbedder(apiKey, config.modelId || "")
			}
			case "bedrock": {
				if (!config.bedrockRegion) return null
				return new BedrockEmbedder(config.bedrockRegion, config.bedrockProfile || "", config.modelId || "")
			}
			case "openrouter": {
				const apiKey =
					secrets.getSecret("memoryIndexOpenRouterApiKey") || secrets.getSecret("openRouterApiKey") || ""
				if (!apiKey) return null
				return new OpenRouterEmbedder(
					apiKey,
					config.modelId || "",
					undefined,
					config.openRouterSpecificProvider,
				)
			}
			case "voyage": {
				const apiKey = secrets.getSecret("memoryIndexVoyageApiKey") || ""
				if (!apiKey) return null
				return new VoyageEmbedder(apiKey, config.modelId || "")
			}
			default:
				return null
		}
	}

	private async indexAllRepos(): Promise<void> {
		if (!this.pgStore || !this.modelId || !this.modelDimension || !this.config) return
		for (const repoRoot of this.repoRoots) {
			await this.indexRepo(repoRoot)
		}
	}

	private async indexRepo(repoRoot: string): Promise<void> {
		if (!this.pgStore || !this.modelId || !this.modelDimension || !this.config) return
		const { marker } = await getOrCreateMarker(repoRoot, this.modelId, this.modelDimension)
		this.indexIds.set(repoRoot, marker.indexId)
		await this.pgStore.ensureIndexMeta(marker.indexId, marker.modelId, marker.modelDimension)

		const files = await listMemoryFiles(repoRoot, this.config)
		const indexedFiles = await this.pgStore.listIndexedFiles(marker.indexId)

		for (const filePath of files) {
			const relPath = toPosix(path.relative(repoRoot, filePath))
			const content = await fs.readFile(filePath, "utf8")
			const fileHash = hashText(content)
			const existingHash = indexedFiles.get(relPath)
			if (existingHash && existingHash === fileHash) {
				continue
			}
			await this.indexFile(repoRoot, filePath, content, fileHash)
		}

		await this.pgStore.deleteMissingFiles(
			marker.indexId,
			files.map((file) => toPosix(path.relative(repoRoot, file))),
		)
	}

	private async indexFile(repoRoot: string, filePath: string, content?: string, fileHash?: string): Promise<void> {
		if (!this.pgStore || !this.embedder || !this.modelId || !this.modelDimension || !this.config) return
		const indexId = this.indexIds.get(repoRoot)
		if (!indexId) return
		const resolvedContent = content ?? (await fs.readFile(filePath, "utf8"))
		const resolvedHash = fileHash ?? hashText(resolvedContent)
		const blocks = await this.parser.parseFile(filePath, {
			content: resolvedContent,
			fileHash: resolvedHash,
		})
		if (!blocks.length) {
			await this.pgStore.deleteFile(indexId, toPosix(path.relative(repoRoot, filePath)))
			return
		}

		const chunks = await this.embedChunks(repoRoot, filePath, blocks)
		await this.pgStore.upsertFile(indexId, toPosix(path.relative(repoRoot, filePath)), resolvedHash, chunks)
	}

	private async embedChunks(repoRoot: string, filePath: string, blocks: any[]): Promise<MemoryChunk[]> {
		if (!this.embedder || !this.modelId || !this.config) return []
		const chunks = blocks.map((block: any) => ({
			chunkId:
				block.segmentHash ||
				hashText(`${block.file_path}:${block.start_line}:${block.end_line}:${block.content}`),
			filePath: toPosix(path.relative(repoRoot, filePath)),
			startLine: block.start_line,
			endLine: block.end_line,
			content: block.content,
		}))

		const embeddings: number[][] = []
		for (let i = 0; i < chunks.length; i += this.config.embeddingBatchSize) {
			const batch = chunks.slice(i, i + this.config.embeddingBatchSize)
			const response = await this.embedder.createEmbeddings(
				batch.map((chunk) => chunk.content),
				this.modelId,
			)
			embeddings.push(...response.embeddings)
		}

		return chunks.map((chunk, idx) => ({
			chunkId: chunk.chunkId,
			filePath: chunk.filePath,
			startLine: chunk.startLine,
			endLine: chunk.endLine,
			content: chunk.content,
			embedding: embeddings[idx] ?? [],
		}))
	}

	private setupWatchers(): void {
		if (!this.config) return
		for (const repoRoot of this.repoRoots) {
			if (this.config.includeMemoryDir) {
				const pattern = new vscode.RelativePattern(repoRoot, `${this.config.memoryDirName}/**/*.md`)
				const watcher = vscode.workspace.createFileSystemWatcher(pattern)
				this.registerWatcher(watcher, repoRoot)
			}
			if (this.config.includeMemoryFile) {
				const pattern = new vscode.RelativePattern(repoRoot, this.config.memoryFileName)
				const watcher = vscode.workspace.createFileSystemWatcher(pattern)
				this.registerWatcher(watcher, repoRoot)
			}
		}
	}

	private registerWatcher(watcher: vscode.FileSystemWatcher, repoRoot: string): void {
		watcher.onDidCreate((uri) => this.queueIndex(repoRoot, uri.fsPath))
		watcher.onDidChange((uri) => this.queueIndex(repoRoot, uri.fsPath))
		watcher.onDidDelete((uri) => this.handleDelete(repoRoot, uri.fsPath))
		this.watchers.push(watcher)
	}

	private queueIndex(repoRoot: string, filePath: string): void {
		const key = `${repoRoot}:${filePath}`
		const existing = this.pendingIndex.get(key)
		if (existing) {
			clearTimeout(existing)
		}
		const timer = setTimeout(() => {
			this.pendingIndex.delete(key)
			void this.indexFile(repoRoot, filePath)
		}, 300)
		this.pendingIndex.set(key, timer)
	}

	private async handleDelete(repoRoot: string, filePath: string): Promise<void> {
		if (!this.pgStore) return
		const indexId = this.indexIds.get(repoRoot)
		if (!indexId) return
		const relPath = toPosix(path.relative(repoRoot, filePath))
		await this.pgStore.deleteFile(indexId, relPath)
	}
}
