import * as vscode from "vscode"
import { EmbedderProvider } from "../code-index/interfaces/manager"
import { Package } from "../../shared/package"
import { MemoryIndexConfig } from "./types"

const DEFAULT_PROVIDERS: EmbedderProvider[] = [
	"openai",
	"openrouter",
	"gemini",
	"mistral",
	"voyage",
	"ollama",
	"openai-compatible",
	"vercel-ai-gateway",
	"bedrock",
]

const DEFAULT_CONFIG: MemoryIndexConfig = {
	enabled: true,
	memoryDirName: "memory",
	memoryFileName: "MEMORY.md",
	includeMemoryDir: true,
	includeMemoryFile: true,
	providers: DEFAULT_PROVIDERS,
	modelId: undefined,
	modelDimension: undefined,
	embeddingBatchSize: 60,
	searchMinScore: 0.15,
	searchMaxResults: 10,
	ollamaBaseUrl: "",
	openAiCompatibleBaseUrl: "",
	openRouterSpecificProvider: "",
	bedrockRegion: "us-east-1",
	bedrockProfile: "",
}

function normalizeProviders(input?: unknown): EmbedderProvider[] {
	if (!Array.isArray(input)) {
		return DEFAULT_PROVIDERS
	}
	const normalized = input
		.map((value) => (typeof value === "string" ? value.trim() : ""))
		.filter(Boolean) as EmbedderProvider[]
	return normalized.length > 0 ? normalized : DEFAULT_PROVIDERS
}

export function loadMemoryIndexConfig(scope?: vscode.ConfigurationScope): MemoryIndexConfig {
	const config = vscode.workspace.getConfiguration(Package.name, scope)
	return {
		enabled: config.get<boolean>("memoryIndex.enabled", DEFAULT_CONFIG.enabled),
		memoryDirName: config.get<string>("memoryIndex.memoryDirName", DEFAULT_CONFIG.memoryDirName),
		memoryFileName: config.get<string>("memoryIndex.memoryFileName", DEFAULT_CONFIG.memoryFileName),
		includeMemoryDir: config.get<boolean>("memoryIndex.includeMemoryDir", DEFAULT_CONFIG.includeMemoryDir),
		includeMemoryFile: config.get<boolean>("memoryIndex.includeMemoryFile", DEFAULT_CONFIG.includeMemoryFile),
		providers: normalizeProviders(config.get("memoryIndex.providers")),
		modelId: config.get<string>("memoryIndex.modelId") || undefined,
		modelDimension: config.get<number>("memoryIndex.modelDimension") || undefined,
		embeddingBatchSize: config.get<number>("memoryIndex.embeddingBatchSize", DEFAULT_CONFIG.embeddingBatchSize),
		searchMinScore: config.get<number>("memoryIndex.searchMinScore", DEFAULT_CONFIG.searchMinScore),
		searchMaxResults: config.get<number>("memoryIndex.searchMaxResults", DEFAULT_CONFIG.searchMaxResults),
		ollamaBaseUrl: config.get<string>("memoryIndex.ollamaBaseUrl", DEFAULT_CONFIG.ollamaBaseUrl),
		openAiCompatibleBaseUrl: config.get<string>(
			"memoryIndex.openAiCompatibleBaseUrl",
			DEFAULT_CONFIG.openAiCompatibleBaseUrl,
		),
		openRouterSpecificProvider: config.get<string>(
			"memoryIndex.openRouterSpecificProvider",
			DEFAULT_CONFIG.openRouterSpecificProvider,
		),
		bedrockRegion: config.get<string>("memoryIndex.bedrockRegion", DEFAULT_CONFIG.bedrockRegion),
		bedrockProfile: config.get<string>("memoryIndex.bedrockProfile", DEFAULT_CONFIG.bedrockProfile),
	}
}

export const MEMORY_INDEX_DEFAULTS = DEFAULT_CONFIG
