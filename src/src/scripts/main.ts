import { Octokit } from "@octokit/core";
import jsYaml from "js-yaml";

const codeInput = document.getElementById('codeInput') as HTMLTextAreaElement;
const resultsContainer = document.getElementById('results') as HTMLDivElement;
const statusText = document.getElementById('status') as HTMLParagraphElement;
const tokenSection = document.getElementById('tokenSection') as HTMLDivElement;
const tokenToggle = document.getElementById('tokenToggle') as HTMLDivElement;
const tokenInput = document.getElementById('tokenInput') as HTMLInputElement;

let currentToken = '';
try {
	currentToken = typeof localStorage !== 'undefined' ? localStorage.getItem('gh_token') || '' : '';
} catch (e) {
	console.warn('localStorage not available');
}

if (tokenInput) tokenInput.value = currentToken;

let octokit = new Octokit({ auth: currentToken || undefined });

if (tokenToggle && tokenSection) {
	tokenToggle.addEventListener('click', () => {
		tokenSection.classList.toggle('open');
	});
}

interface LanguageInfo {
	type: string;
	aliases?: string[];

	[key: string]: any;
}

interface Language {
	name: string;
	alias: string;
}

let languages: Language[] = [];
let aliasMap = new Map<string, string>();
let debounceTimer: ReturnType<typeof setTimeout>;

const getDefaultStatus = () => `Loaded ${languages.length} languages. Start typing to see highlighting.`;

function autoResize() {
	if (!codeInput) return;
	codeInput.style.height = 'auto';
	codeInput.style.height = codeInput.scrollHeight + 'px';
}

// Initializing
if (statusText && codeInput) {
	statusText.textContent = "Fetching languages from Linguist...";
	fetch('https://raw.githubusercontent.com/github-linguist/linguist/refs/heads/main/lib/linguist/languages.yml')
		.then(response => {
			if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
			return response.text();
		})
		.then(yamlText => {
			const data = jsYaml.load(yamlText) as Record<string, LanguageInfo>;

			languages = Object.entries(data)
				.map(([name, info]) => ({
					name,
					alias: info.aliases ? info.aliases[0] : name.toLowerCase()
				}));

			statusText.textContent = getDefaultStatus();

			aliasMap = new Map(languages.map(l => [l.name, l.alias]));

			if (codeInput) {
				codeInput.addEventListener('input', () => {
					autoResize();
					clearTimeout(debounceTimer);
					debounceTimer = setTimeout(() => {
						updateHighlighting(aliasMap).catch(err => {
							console.error('Update highlighting failed:', err);
						});
					}, 1000);
				});
			}

			if (tokenInput) {
				tokenInput.addEventListener('input', () => {
					currentToken = tokenInput.value.trim();
					octokit = new Octokit({ auth: currentToken || undefined });
					clearTimeout(debounceTimer);
					debounceTimer = setTimeout(() => {
						updateHighlighting(aliasMap).catch(err => {
							console.error('Update highlighting failed:', err);
						});
					}, 1000);
				});
			}
		})
		.catch(error => {
			console.error('Initialization error:', error);
			if (statusText) statusText.textContent = "Error loading languages. Check console.";
		});
}

export function generateMarkdown(text: string, langs: Language[]): string {
	let markdown = '';
	langs.forEach(lang => {
		markdown += `\n\n## LANG_NAME:${lang.name}\n\n`;
		markdown += `\`\`\`${lang.alias || lang.name}\n${text}\n\`\`\`\n`;
	});
	return markdown;
}

export function parseGitHubResponse(html: string): { langName: string, codeBlockHTML: string }[] {
	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = html;
	const results: { langName: string, codeBlockHTML: string }[] = [];

	const headers = Array.from(tempDiv.querySelectorAll('h2')).filter(h => {
		const text = h.textContent?.trim();
		return text?.startsWith('LANG_NAME:') || text?.startsWith('__LANG__:') || text?.startsWith('LANG:');
	});

	headers.forEach((header) => {
		const langName = header.textContent?.trim()
			.replace('LANG_NAME:', '')
			.replace('__LANG__:', '')
			.replace('LANG:', '');
		let current = header.parentElement?.classList.contains('markdown-heading')
			? header.parentElement.nextElementSibling
			: header.nextElementSibling;
		let codeBlock: Element | null = null;

		while (current && current.tagName !== 'H2' && !current.classList.contains('markdown-heading')) {
			if (current.classList.contains('highlight') || current.tagName === 'PRE') {
				codeBlock = current;
				break;
			}
			current = current.nextElementSibling;
		}

		if (codeBlock && langName) {
			const hasHighlighting = codeBlock.querySelector('span[class]') !== null;
			if (hasHighlighting) {
				results.push({
					langName,
					codeBlockHTML: codeBlock.outerHTML
				});
			}
		}
	});

	return results;
}

export function groupResults(results: { langName: string, codeBlockHTML: string }[]): { langNames: string[], codeBlockHTML: string }[] {
	const grouped = new Map<string, { langNames: string[], originalHTML: string }>();
	const order: string[] = [];

	results.forEach(result => {
		// Normalize HTML to group by content, ignoring language-specific classes and minor differences
		const tempDiv = document.createElement('div');
		tempDiv.innerHTML = result.codeBlockHTML;

		// 1. Normalize container class
		const container = tempDiv.querySelector('.highlight');
		if (container) {
			container.className = container.className.replace(/highlight-source-[\w+#.-]+/g, 'highlight-source-normalized');
		}

		// 2. Remove "neutral" spans that look like plain text in dark theme (pl-smi)
		tempDiv.querySelectorAll('span.pl-smi').forEach(span => {
			if (span.childNodes.length > 0) {
				while (span.firstChild) {
					span.parentNode?.insertBefore(span.firstChild, span);
				}
			}
			span.parentNode?.removeChild(span);
		});

		// 3. Flatten nested spans with same class
		let changed = true;
		while (changed) {
			changed = false;
			const spans = tempDiv.querySelectorAll('span span');
			for (const innerSpan of Array.from(spans)) {
				const outerSpan = innerSpan.parentElement;
				if (outerSpan && outerSpan.tagName === 'SPAN' && outerSpan.className === innerSpan.className) {
					while (innerSpan.firstChild) {
						outerSpan.insertBefore(innerSpan.firstChild, innerSpan);
					}
					outerSpan.removeChild(innerSpan);
					changed = true;
				}
			}
		}

		// 4. Clean up: normalize text nodes and remove empty spans
		tempDiv.normalize();
		tempDiv.querySelectorAll('span').forEach(span => {
			if (span.textContent === '' && span.children.length === 0) {
				span.parentNode?.removeChild(span);
			}
		});

		const normalizedHTML = tempDiv.innerHTML;

		if (!grouped.has(normalizedHTML)) {
			grouped.set(normalizedHTML, {
				langNames: [],
				originalHTML: result.codeBlockHTML
			});
			order.push(normalizedHTML);
		}
		grouped.get(normalizedHTML)!.langNames.push(result.langName);
	});

	return order.map(normalized => {
		const entry = grouped.get(normalized)!;
		return {
			langNames: entry.langNames,
			codeBlockHTML: entry.originalHTML
		};
	});
}

async function updateHighlighting(aliasMap: Map<string, string>) {
	if (!codeInput || !resultsContainer || !statusText) return;

	const text = codeInput.value.trim();
	if (!text) {
		resultsContainer.innerHTML = '';
		statusText.textContent = getDefaultStatus();
		return;
	}

	statusText.textContent = "Rendering via GitHub API...";
	resultsContainer.innerHTML = '';

	const markdown = generateMarkdown(text, languages);

	console.log(`Sending markdown (${markdown.length} chars) to GitHub API for ${languages.length} languages...`);
	try {
		const res = await octokit.request('POST /markdown', {
			text: markdown,
			mode: 'markdown'
		});

		// Success!
		if (currentToken) {
			try {
				if (typeof localStorage !== 'undefined') localStorage.setItem('gh_token', currentToken);
			} catch (e) {}
			if (tokenSection) tokenSection.classList.remove('open');
		}

		const highlightedResults = parseGitHubResponse(res.data);
		const grouped = groupResults(highlightedResults);

		// Sort by number of languages in group (descending)
		grouped.sort((a, b) => b.langNames.length - a.langNames.length);

		grouped.forEach(result => {
			const container = document.createElement('div');
			container.className = 'code-block-container';

			const blockHeader = document.createElement('div');
			blockHeader.className = 'code-block-header';

			result.langNames.forEach((langName, index) => {
				const langSpan = document.createElement('span');
				langSpan.textContent = langName;
				const alias = aliasMap.get(langName);
				if (alias) {
					langSpan.title = alias;
				}
				blockHeader.appendChild(langSpan);
				if (index < result.langNames.length - 1) {
					blockHeader.appendChild(document.createTextNode(', '));
				}
			});

			const content = document.createElement('div');
			content.className = 'code-block-content markdown-body';
			content.innerHTML = result.codeBlockHTML;

			container.appendChild(blockHeader);
			container.appendChild(content);
			resultsContainer.appendChild(container);
		});

		const totalLanguages = highlightedResults.length;
		if (totalLanguages > 0) {
			statusText.textContent = `Showing ${totalLanguages}/${languages.length} languages with highlighting`;
		} else {
			statusText.textContent = `None of the ${languages.length} languages highlighted this code`;
		}

	} catch (error: any) {
		console.error('Render error:', error);
		const tokenUrl = 'https://github.com/settings/personal-access-tokens/new?name=gfm-highlight-compare&expires_in=none';
		if (error.status === 403 && error.headers && error.headers['x-ratelimit-remaining'] === '0') {
			if (tokenSection) tokenSection.classList.add('open');
			statusText.innerHTML = `API Rate limit exceeded. Please <a href="${tokenUrl}" target="_blank">generate a personal access token</a> and paste it below to continue.`;
		} else if (error.status === 401) {
			statusText.innerHTML = `Invalid token. Please check your GitHub API key or <a href="${tokenUrl}" target="_blank">generate a new one</a>.`;
			if (tokenSection) tokenSection.classList.add('open');
		} else {
			statusText.textContent = "Error rendering. You might have hit the GitHub API rate limit.";
		}
	}
}
