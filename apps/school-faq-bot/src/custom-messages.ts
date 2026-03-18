import type { Message } from "@mariozechner/pi-ai";
import type { AgentMessage, MessageRenderer } from "@mariozechner/pi-web-ui";
import { defaultConvertToLlm, registerMessageRenderer } from "@mariozechner/pi-web-ui";
import { html } from "lit";

export interface ParentHelpMessage {
	role: "parent-help";
	phone: string;
	schoolName: string;
	homepageUrl: string;
	sourceLabel?: string;
	sourceUrl?: string;
	timestamp: number;
}

declare module "@mariozechner/pi-agent-core" {
	interface CustomAgentMessages {
		"parent-help": ParentHelpMessage;
	}
}

const parentHelpRenderer: MessageRenderer<ParentHelpMessage> = {
	render: (message) => {
		return html`
			<div class="px-4 py-2">
				<div class="rounded-2xl border border-border bg-secondary/40 p-4">
					<div class="mb-3 text-xs font-medium tracking-wide text-muted-foreground">안내 바로가기</div>
					<div class="grid gap-2 ${message.sourceUrl ? "xl:grid-cols-3 md:grid-cols-2" : "md:grid-cols-2"}">
						${
							message.sourceUrl
								? html`<a
										href=${message.sourceUrl}
										target="_blank"
										rel="noreferrer"
										class="rounded-xl border border-border bg-background px-4 py-3 text-sm transition-colors hover:bg-secondary"
									>
										<div class="font-medium text-foreground">출처 확인</div>
										<div class="mt-1 text-xs text-muted-foreground">${message.sourceLabel || "학교 홈페이지 안내"}</div>
									</a>`
								: null
						}
						<a
							href=${message.homepageUrl}
							target="_blank"
							rel="noreferrer"
							class="rounded-xl border border-border bg-background px-4 py-3 text-sm transition-colors hover:bg-secondary"
						>
							<div class="font-medium text-foreground">학교 홈페이지</div>
							<div class="mt-1 text-xs text-muted-foreground">${message.homepageUrl}</div>
						</a>
						<a
							href=${`tel:${message.phone.replace(/-/g, "")}`}
							class="rounded-xl border border-border bg-background px-4 py-3 text-sm transition-colors hover:bg-secondary"
						>
							<div class="font-medium text-foreground">학교 문의</div>
							<div class="mt-1 text-xs text-muted-foreground">${message.schoolName} ${message.phone}</div>
						</a>
					</div>
				</div>
			</div>
		`;
	},
};

export function registerCustomMessageRenderers() {
	registerMessageRenderer("parent-help", parentHelpRenderer);
}

export function createParentHelpMessage(
	phone: string,
	schoolName: string,
	homepageUrl: string,
	sourceLabel?: string,
	sourceUrl?: string,
): ParentHelpMessage {
	return {
		role: "parent-help",
		phone,
		schoolName,
		homepageUrl,
		sourceLabel,
		sourceUrl,
		timestamp: Date.now(),
	};
}

export function customConvertToLlm(messages: AgentMessage[]): Message[] {
	return defaultConvertToLlm(messages.filter((message) => message.role !== "parent-help"));
}
