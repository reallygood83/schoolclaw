export interface FaqItem {
	category: string;
	question: string;
	answer: string;
	sourceLabel?: string;
	sourceUrl?: string;
}

export interface SchoolInfo {
	name: string;
	address: string;
	phone: string;
	fax: string;
	principal: string;
	vicePrincipal: string;
	website: string;
	foundedYear: number;
	studentCount: number;
	classCount: number;
	teacherCount: number;
}

export interface SchoolModelConfig {
	provider: string;
	modelId: string;
}

export interface SchoolUiConfig {
	tagline: string;
	welcomeTitle: string;
	welcomeDescription: string;
	recommendedQuestions: string[];
}

export interface SchoolConfig {
	schoolInfo: SchoolInfo;
	model: SchoolModelConfig;
	ui: SchoolUiConfig;
	faq: FaqItem[];
}
