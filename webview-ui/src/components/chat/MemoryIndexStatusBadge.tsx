import React, { useEffect, useMemo, useState } from "react"
import { Brain } from "lucide-react"

import type { MemoryIndexStatus } from "@roo-code/types"

import { cn } from "@src/lib/utils"
import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { PopoverTrigger, StandardTooltip, Button } from "@src/components/ui"

import { MemoryIndexPopover } from "./MemoryIndexPopover"

interface MemoryIndexStatusBadgeProps {
	className?: string
}

const DEFAULT_STATUS: MemoryIndexStatus = { state: "disabled", reason: "Not initialized" }

export const MemoryIndexStatusBadge: React.FC<MemoryIndexStatusBadgeProps> = ({ className }) => {
	const { t } = useAppTranslation()
	const [status, setStatus] = useState<MemoryIndexStatus>(DEFAULT_STATUS)

	useEffect(() => {
		vscode.postMessage({ type: "requestMemoryIndexStatus" })

		const handleMessage = (event: MessageEvent) => {
			if (event.data.type === "memoryIndexStatusUpdate") {
				setStatus(event.data.values as MemoryIndexStatus)
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	const tooltipText = useMemo(() => {
		switch (status.state) {
			case "ready":
				return t("chat:memoryIndexStatus.ready", { count: status.indexedRepos })
			case "connecting":
				return t("chat:memoryIndexStatus.connecting")
			case "error":
				return t("chat:memoryIndexStatus.error")
			case "disabled":
				return t("chat:memoryIndexStatus.disabled")
			default:
				return t("chat:memoryIndexStatus.status")
		}
	}, [status, t])

	const statusColorClass = useMemo(() => {
		const colors = {
			disabled: "bg-vscode-descriptionForeground/60",
			connecting: "bg-yellow-500 animate-pulse",
			ready: "bg-green-500",
			error: "bg-red-500",
		}

		return colors[status.state] || colors.disabled
	}, [status.state])

	return (
		<MemoryIndexPopover status={status}>
			<StandardTooltip content={tooltipText}>
				<PopoverTrigger asChild>
					<Button
						variant="ghost"
						size="sm"
						aria-label={tooltipText}
						className={cn(
							"relative h-5 w-5 p-0",
							"text-vscode-foreground opacity-60",
							"hover:opacity-100 hover:bg-[rgba(255,255,255,0.03)]",
							"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
							className,
						)}>
						<Brain className="w-4 h-4" />
						<span
							className={cn(
								"absolute top-0 right-0 w-1.5 h-1.5 rounded-full transition-colors duration-200",
								statusColorClass,
							)}
						/>
					</Button>
				</PopoverTrigger>
			</StandardTooltip>
		</MemoryIndexPopover>
	)
}
