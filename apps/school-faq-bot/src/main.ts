import "@mariozechner/mini-lit/dist/ThemeToggle.js";
import { Agent, type AgentMessage } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import {
	type AgentState,
	ApiKeyPromptDialog,
	AppStorage,
	ChatPanel,
	CustomProvidersStore,
	IndexedDBStorageBackend,
	ProviderKeysStore,
	SessionListDialog,
	SessionsStore,
	SettingsStore,
	setAppStorage,
} from "@mariozechner/pi-web-ui";
import { html, render } from "lit";
import { History, Plus, GraduationCap } from "lucide";
import "./app.css";
import { icon } from "@mariozechner/mini-lit";
import { Button } from "@mariozechner/mini-lit/dist/Button.js";
import { Input } from "@mariozechner/mini-lit/dist/Input.js";
import { createParentHelpMessage, customConvertToLlm, registerCustomMessageRenderers } from "./custom-messages.js";
import { schoolConfig } from "./school-config.js";
import { buildSystemPrompt } from "./system-prompt.js";

// ============================================================================
// STORAGE SETUP
// ============================================================================
const settings = new SettingsStore();
const providerKeys = new ProviderKeysStore();
const sessions = new SessionsStore();
const customProviders = new CustomProvidersStore();

const configs = [
	settings.getConfig(),
	SessionsStore.getMetadataConfig(),
	providerKeys.getConfig(),
	customProviders.getConfig(),
	sessions.getConfig(),
];

const backend = new IndexedDBStorageBackend({
	dbName: "school-faq-bot",
	version: 1,
	stores: configs,
});

settings.setBackend(backend);
providerKeys.setBackend(backend);
customProviders.setBackend(backend);
sessions.setBackend(backend);

const storage = new AppStorage(settings, providerKeys, sessions, customProviders, backend);
setAppStorage(storage);

// ============================================================================
// APP STATE
// ============================================================================
let currentSessionId: string | undefined;
let currentTitle = "";
let isEditingTitle = false;
let agent: Agent;
let chatPanel: ChatPanel;
let agentUnsubscribe: (() => void) | undefined;

const { schoolInfo, ui } = schoolConfig;
const faqEntries = schoolConfig.faq;

// ============================================================================
// HELPERS
// ============================================================================
const generateTitle = (messages: AgentMessage[]): string => {
	const firstUserMsg = messages.find((m) => m.role === "user" || m.role === "user-with-attachments");
	if (!firstUserMsg || (firstUserMsg.role !== "user" && firstUserMsg.role !== "user-with-attachments")) return "";

	let text = "";
	const content = firstUserMsg.content;

	if (typeof content === "string") {
		text = content;
	} else {
		for (const block of content) {
			if ("text" in block && typeof block.text === "string") {
				text += block.text + " ";
			}
		}
	}

	text = text.trim();
	if (!text) return "";

	const sentenceEnd = text.search(/[.!?]/);
	if (sentenceEnd > 0 && sentenceEnd <= 50) {
		return text.substring(0, sentenceEnd + 1);
	}
	return text.length <= 50 ? text : `${text.substring(0, 47)}...`;
};

const shouldSaveSession = (messages: AgentMessage[]): boolean => {
	const hasUserMsg = messages.some((m) => m.role === "user" || m.role === "user-with-attachments");
	const hasAssistantMsg = messages.some((m) => m.role === "assistant");
	return hasUserMsg && hasAssistantMsg;
};

const normalizeText = (text: string): string => {
	return text.toLowerCase().replace(/[^0-9a-z가-힣\s]/g, " ").replace(/\s+/g, " ").trim();
};

const extractMessageText = (message: AgentMessage | undefined): string => {
	if (!message) return "";
	if (message.role === "parent-help") return "";
	if (message.content === undefined) return "";
	if (typeof message.content === "string") return message.content;
	return message.content
		.map((block: { text?: string }) => (typeof block.text === "string" ? block.text : ""))
		.join(" ")
		.trim();
};

const findBestFaqSource = (questionText: string) => {
	const normalizedQuestion = normalizeText(questionText);
	if (!normalizedQuestion) return undefined;

	const tokens = new Set(normalizedQuestion.split(" ").filter((token) => token.length > 1));
	let bestMatch:
		| {
			question: string;
			sourceLabel?: string;
			sourceUrl?: string;
			score: number;
		  }
		| undefined;

	for (const item of faqEntries) {
		const normalizedFaqQuestion = normalizeText(item.question);
		if (!normalizedFaqQuestion) continue;

		let score = 0;
		if (normalizedFaqQuestion === normalizedQuestion) {
			score += 100;
		}

		for (const token of tokens) {
			if (normalizedFaqQuestion.includes(token)) {
				score += 10;
			}
		}

		if (normalizedQuestion.includes(normalizedFaqQuestion)) {
			score += 20;
		}

		if (!bestMatch || score > bestMatch.score) {
			bestMatch = {
				question: item.question,
				sourceLabel: item.sourceLabel,
				sourceUrl: item.sourceUrl,
				score,
			};
		}
	}

	if (!bestMatch || bestMatch.score < 20) {
		return undefined;
	}

	return bestMatch;
};

const syncHelpCard = () => {
	if (!agent) return;
	const messages = agent.state.messages;
	const lastMessage = messages.at(-1);
	if (!lastMessage || lastMessage.role !== "assistant") return;
	const lastUserMessage = [...messages].reverse().find((message) => message.role === "user" || message.role === "user-with-attachments");
	const matchedSource = findBestFaqSource(extractMessageText(lastUserMessage));

	agent.appendMessage(
		createParentHelpMessage(
			schoolInfo.phone,
			schoolInfo.name,
			schoolInfo.website,
			matchedSource?.sourceLabel,
			matchedSource?.sourceUrl,
		),
	);
};

const hasConversation = (messages: AgentMessage[]): boolean => {
	return messages.some((m) => m.role === "user" || m.role === "assistant" || m.role === "user-with-attachments");
};

const saveSession = async () => {
	if (!storage.sessions || !currentSessionId || !agent || !currentTitle) return;

	const state = agent.state;
	if (!shouldSaveSession(state.messages)) return;

	try {
		const sessionData = {
			id: currentSessionId,
			title: currentTitle,
			model: state.model!,
			thinkingLevel: state.thinkingLevel,
			messages: state.messages,
			createdAt: new Date().toISOString(),
			lastModified: new Date().toISOString(),
		};

		const metadata = {
			id: currentSessionId,
			title: currentTitle,
			createdAt: sessionData.createdAt,
			lastModified: sessionData.lastModified,
			messageCount: state.messages.length,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			modelId: state.model?.id || null,
			thinkingLevel: state.thinkingLevel,
			preview: generateTitle(state.messages),
		};

		await storage.sessions.save(sessionData, metadata);
	} catch (err) {
		console.error("세션 저장 실패:", err);
	}
};

const updateUrl = (sessionId: string) => {
	const url = new URL(window.location.href);
	url.searchParams.set("session", sessionId);
	window.history.replaceState({}, "", url);
};

// ============================================================================
// AGENT
// ============================================================================
const createAgent = async (initialState?: Partial<AgentState>) => {
	if (agentUnsubscribe) {
		agentUnsubscribe();
	}

	agent = new Agent({
		initialState: initialState || {
			systemPrompt: buildSystemPrompt(),
			model: getModel("cerebras", schoolConfig.model.modelId as "qwen-3-235b-a22b-instruct-2507"),
			thinkingLevel: "off",
			messages: [],
			tools: [],
		},
		convertToLlm: customConvertToLlm,
	});

	agentUnsubscribe = agent.subscribe((event) => {
		if (event.type === "message_end" && event.message.role === "assistant") {
			syncHelpCard();
			const messages = agent.state.messages;

			if (!currentTitle && shouldSaveSession(messages)) {
				currentTitle = generateTitle(messages);
			}

			if (!currentSessionId && shouldSaveSession(messages)) {
				currentSessionId = crypto.randomUUID();
				updateUrl(currentSessionId);
			}

			if (currentSessionId) {
				saveSession();
			}

			renderApp();
		}

		if (event.type === "agent_end") {
			const messages = agent.state.messages;

			if (!currentTitle && shouldSaveSession(messages)) {
				currentTitle = generateTitle(messages);
			}

			if (!currentSessionId && shouldSaveSession(messages)) {
				currentSessionId = crypto.randomUUID();
				updateUrl(currentSessionId);
			}

			if (currentSessionId) {
				saveSession();
			}

			renderApp();
		}
	});

	await chatPanel.setAgent(agent, {
		onApiKeyRequired: async (provider: string) => {
			return await ApiKeyPromptDialog.prompt(provider);
		},
	});
};

const loadSession = async (sessionId: string): Promise<boolean> => {
	if (!storage.sessions) return false;

	const sessionData = await storage.sessions.get(sessionId);
	if (!sessionData) {
		console.error("세션을 찾을 수 없습니다:", sessionId);
		return false;
	}

	currentSessionId = sessionId;
	const metadata = await storage.sessions.getMetadata(sessionId);
	currentTitle = metadata?.title || "";

	await createAgent({
		systemPrompt: buildSystemPrompt(),
		model: sessionData.model,
		thinkingLevel: sessionData.thinkingLevel,
		messages: sessionData.messages,
		tools: [],
	});

	updateUrl(sessionId);
	renderApp();
	return true;
};

const newSession = () => {
	const url = new URL(window.location.href);
	url.search = "";
	window.location.href = url.toString();
};

const submitRecommendedQuestion = async (question: string) => {
	if (!agent || agent.state.isStreaming) return;
	await agent.prompt(question);
	renderApp();
};

// ============================================================================
// RENDER
// ============================================================================
const renderApp = () => {
	const app = document.getElementById("app");
	if (!app) return;
	const showWelcomePanel = agent ? !hasConversation(agent.state.messages) : true;

	const appHtml = html`
		<div class="w-full h-screen flex flex-col bg-background text-foreground overflow-hidden">
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-border shrink-0">
				<div class="flex items-center gap-2 px-4 py-2">
					${Button({
						variant: "ghost",
						size: "sm",
						children: icon(History, "sm"),
						onClick: () => {
							SessionListDialog.open(
								async (sessionId: string) => {
									await loadSession(sessionId);
								},
								(deletedSessionId: string) => {
									if (deletedSessionId === currentSessionId) {
										newSession();
									}
								},
							);
						},
						title: "대화 기록",
					})}
					${Button({
						variant: "ghost",
						size: "sm",
						children: icon(Plus, "sm"),
						onClick: newSession,
						title: "새 대화",
					})}

					${
						currentTitle
							? isEditingTitle
								? html`<div class="flex items-center gap-2">
									${Input({
										type: "text",
										value: currentTitle,
										className: "text-sm w-64",
										onChange: async (e: Event) => {
											const newTitle = (e.target as HTMLInputElement).value.trim();
											if (newTitle && newTitle !== currentTitle && storage.sessions && currentSessionId) {
												await storage.sessions.updateTitle(currentSessionId, newTitle);
												currentTitle = newTitle;
											}
											isEditingTitle = false;
											renderApp();
										},
										onKeyDown: async (e: KeyboardEvent) => {
											if (e.key === "Enter") {
												const newTitle = (e.target as HTMLInputElement).value.trim();
												if (newTitle && newTitle !== currentTitle && storage.sessions && currentSessionId) {
													await storage.sessions.updateTitle(currentSessionId, newTitle);
													currentTitle = newTitle;
												}
												isEditingTitle = false;
												renderApp();
											} else if (e.key === "Escape") {
												isEditingTitle = false;
												renderApp();
											}
										},
									})}
								</div>`
								: html`<button
									class="px-2 py-1 text-sm text-foreground hover:bg-secondary rounded transition-colors"
									@click=${() => {
										isEditingTitle = true;
										renderApp();
										requestAnimationFrame(() => {
											const input = app?.querySelector('input[type="text"]') as HTMLInputElement;
											if (input) {
												input.focus();
												input.select();
											}
										});
									}}
									title="제목 수정"
								>
									${currentTitle}
								</button>`
							: html`<span class="flex items-center gap-2 text-base font-semibold text-foreground">
								${icon(GraduationCap, "sm")}
								${schoolInfo.name}
							</span>`
					}
				</div>
				<div class="flex items-center gap-1 px-2">
					<span class="hidden px-2 text-xs text-muted-foreground md:block">${ui.tagline}</span>
					<theme-toggle></theme-toggle>
				</div>
			</div>

			${
				showWelcomePanel
					? html`<div class="border-b border-border bg-gradient-to-br from-secondary/50 via-background to-background px-4 py-6 md:px-6">
						<div class="mx-auto flex max-w-5xl flex-col gap-5">
							<div class="flex flex-col gap-2">
								<div class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
									${icon(GraduationCap, "sm")}
									${ui.tagline}
								</div>
								<h1 class="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">${ui.welcomeTitle}</h1>
								<p class="max-w-3xl text-sm leading-6 text-muted-foreground md:text-base">${ui.welcomeDescription}</p>
								<p class="text-sm text-muted-foreground">문의: ${schoolInfo.name} ${schoolInfo.phone}</p>
							</div>
							<div class="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
								${ui.recommendedQuestions.map(
									(question) => html`<button
										class="rounded-xl border border-border bg-background px-4 py-3 text-left text-sm transition-colors hover:bg-secondary"
										@click=${() => submitRecommendedQuestion(question)}
									>
										${question}
									</button>`,
								)}
							</div>
						</div>
					</div>`
					: null
			}

			${chatPanel}
		</div>
	`;

	render(appHtml, app);
};

// ============================================================================
// INIT
// ============================================================================
async function initApp() {
	const app = document.getElementById("app");
	if (!app) throw new Error("앱 컨테이너를 찾을 수 없습니다");
	registerCustomMessageRenderers();

	render(
		html`
			<div class="w-full h-screen flex items-center justify-center bg-background text-foreground">
				<div class="flex flex-col items-center gap-4">
					<div class="text-4xl">${icon(GraduationCap, "lg")}</div>
					<div class="text-muted-foreground">${schoolInfo.name} 안내 도우미를 불러오는 중...</div>
				</div>
			</div>
		`,
		app,
	);

	chatPanel = new ChatPanel();

	const urlParams = new URLSearchParams(window.location.search);
	const sessionIdFromUrl = urlParams.get("session");

	if (sessionIdFromUrl) {
		const loaded = await loadSession(sessionIdFromUrl);
		if (!loaded) {
			newSession();
			return;
		}
	} else {
		await createAgent();
	}

	renderApp();
}

initApp();
