import { ToolArgs } from "./types"

export function getMemorySearchDescription(args: ToolArgs): string {
	return `## memory_search
Description: Semantic search over workspace memory files (\"${args.cwd}/MEMORY.md\" and \"${args.cwd}/memory/**/*.md\" by default). Use this before answering questions about prior work, decisions, dates, people, preferences, or todos. This tool returns relevant snippets with file paths and line ranges. Use read_file afterward if you need full context.

Parameters:
- query: (required) The search query. Reuse the user's exact wording unless there's a clear reason not to.
- path: (optional) Limit search to a specific subdirectory or repo root (relative to ${args.cwd}). Leave empty to search the current repo's memory by default.

Usage:
<memory_search>
<query>Your memory query here</query>
<path>Optional subdirectory path</path>
</memory_search>

Example: Searching memory for a prior decision
<memory_search>
<query>decision about database choice</query>
<path></path>
</memory_search>
`
}
