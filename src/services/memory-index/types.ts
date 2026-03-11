import { EmbedderProvider } from "../code-index/interfaces/manager"

export type MemoryIndexStatus =
	| { state: "disabled"; reason?: string }
	| { state: "connecting" }
	| { state: "ready"; indexedRepos: number }
	| { state: "error"; error: string }

export type MemoryIndexConfig = {
	enabled: boolean
	memoryDirName: string
	memoryFileName: string
	includeMemoryDir: boolean
	includeMemoryFile: boolean
	providers: EmbedderProvider[]
	modelId?: string
	modelDimension?: number
	embeddingBatchSize: number
	searchMinScore: number
	searchMaxResults: number
	ollamaBaseUrl?: string
	openAiCompatibleBaseUrl?: string
	openRouterSpecificProvider?: string
	bedrockRegion?: string
	bedrockProfile?: string
}

export type MemoryIndexMarker = {
	indexId: string
	modelId: string
	modelDimension: number
	createdAt: string
	updatedAt?: string
}

export type MemoryIndexSearchResult = {
	filePath: string
	score: number
	startLine: number
	endLine: number
	content: string
}
