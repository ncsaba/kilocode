const MEMORY_SEARCH_DESCRIPTION = `Semantic search over workspace memory files (MEMORY.md and memory/**/*.md by default). Use before answering questions about prior work, decisions, dates, people, preferences, or todos. Returns snippets with file paths and line ranges. Use read_file to pull exact lines if needed.`

const memorySearch = {
	name: "memory_search",
	description: MEMORY_SEARCH_DESCRIPTION,
	parameters: {
		type: "object",
		properties: {
			query: {
				type: "string",
				description: "Search query. Reuse the user's wording unless there's a clear reason not to.",
			},
			path: {
				type: "string",
				description: "Optional subdirectory or repo root to limit search scope.",
			},
		},
		required: ["query"],
	},
} as const

export default {
	type: "function",
	function: memorySearch,
} as const
