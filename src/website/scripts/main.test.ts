import { describe, it, expect } from 'vitest';
import { generateMarkdown, parseGitHubResponse, groupResults } from './main';

describe('main.ts', () => {
    describe('generateMarkdown', () => {
        it('should correctly generate markdown with markers', () => {
            const text = 'console.log("hello")';
            const langs = [
                { name: 'JavaScript', alias: 'js' },
                { name: 'Python', alias: 'python' }
            ];
            const markdown = generateMarkdown(text, langs);
            
            expect(markdown).toContain('## LANG_NAME:JavaScript');
            expect(markdown).toContain('```js\nconsole.log("hello")\n```');
            expect(markdown).toContain('## LANG_NAME:Python');
            expect(markdown).toContain('```python\nconsole.log("hello")\n```');
        });
    });

    describe('parseGitHubResponse', () => {
        it('should parse modern GitHub Markdown API response (with markdown-heading div)', () => {
            const html = `
                <div class="markdown-heading">
                    <h2 class="heading-element">LANG_NAME:JavaScript</h2>
                    <a id="user-content-lang_namejavascript" class="anchor" href="#lang_namejavascript"></a>
                </div>
                <div class="highlight highlight-source-js">
                    <pre><span class="pl-k">console</span>.log("test")</pre>
                </div>
            `;
            const results = parseGitHubResponse(html);
            expect(results).toHaveLength(1);
            expect(results[0].langName).toBe('JavaScript');
            expect(results[0].codeBlockHTML).toContain('highlight-source-js');
        });

        it('should parse old-style GitHub Markdown API response (no markdown-heading div)', () => {
            const html = `
                <h2>LANG_NAME:Ruby</h2>
                <div class="highlight highlight-source-ruby">
                    <pre><span class="pl-k">puts</span> "test"</pre>
                </div>
            `;
            const results = parseGitHubResponse(html);
            expect(results).toHaveLength(1);
            expect(results[0].langName).toBe('Ruby');
            expect(results[0].codeBlockHTML).toContain('highlight-source-ruby');
        });

        it('should correctly handle the problematic __LANG__ marker', () => {
            // This tests that our new parser still handles the old marker if it appears
            const html = `
                <div class="markdown-heading">
                    <h2 class="heading-element"><strong>LANG</strong>:JavaScript</h2>
                </div>
                <div class="highlight highlight-source-js">
                    <pre><span class="pl-k">console</span>.log("test")</pre>
                </div>
            `;
            const results = parseGitHubResponse(html);
            expect(results).toHaveLength(1);
            expect(results[0].langName).toBe('JavaScript');
        });

        it('should ignore code blocks without highlighting (no span[class])', () => {
            const html = `
                <h2>LANG_NAME:Text</h2>
                <pre>Plain text</pre>
            `;
            const results = parseGitHubResponse(html);
            expect(results).toHaveLength(0);
        });
    });

    describe('groupResults', () => {
        it('should group results with identical HTML', () => {
            const results = [
                { langName: 'JavaScript', codeBlockHTML: '<pre>code1</pre>' },
                { langName: 'Python', codeBlockHTML: '<pre>code2</pre>' },
                { langName: 'TypeScript', codeBlockHTML: '<pre>code1</pre>' },
                { langName: 'Ruby', codeBlockHTML: '<pre>code3</pre>' },
                { langName: 'ActionScript', codeBlockHTML: '<pre>code2</pre>' },
            ];
            
            const grouped = groupResults(results);
            
            expect(grouped).toHaveLength(3);
            expect(grouped[0].langNames).toEqual(['JavaScript', 'TypeScript']);
            expect(grouped[0].codeBlockHTML).toBe('<pre>code1</pre>');
            
            expect(grouped[1].langNames).toEqual(['Python', 'ActionScript']);
            expect(grouped[1].codeBlockHTML).toBe('<pre>code2</pre>');
            
            expect(grouped[2].langNames).toEqual(['Ruby']);
            expect(grouped[2].codeBlockHTML).toBe('<pre>code3</pre>');
        });

        it('should maintain order of first appearance', () => {
            const results = [
                { langName: 'B', codeBlockHTML: 'html2' },
                { langName: 'A', codeBlockHTML: 'html1' },
                { langName: 'C', codeBlockHTML: 'html2' },
            ];
            const grouped = groupResults(results);
            expect(grouped[0].codeBlockHTML).toBe('html2');
            expect(grouped[1].codeBlockHTML).toBe('html1');
        });

        it('should group results with different highlight-source- classes but identical content', () => {
            const results = [
                { langName: '4D', codeBlockHTML: '<div class="highlight highlight-source-4dm"><pre>code</pre></div>' },
                { langName: 'C++', codeBlockHTML: '<div class="highlight highlight-source-c++"><pre>code</pre></div>' },
                { langName: 'F#', codeBlockHTML: '<div class="highlight highlight-source-fsharp"><pre>code</pre></div>' },
            ];
            
            const grouped = groupResults(results);
            
            expect(grouped).toHaveLength(1);
            expect(grouped[0].langNames).toEqual(['4D', 'C++', 'F#']);
            expect(grouped[0].codeBlockHTML).toBe('<div class="highlight highlight-source-4dm"><pre>code</pre></div>');
        });

        it('should group results from the user examples (nested spans and minor tokenization differences)', () => {
            const results = [
                // Ex 1: Nested spans with same class
                { langName: '4D', codeBlockHTML: '<div class="highlight highlight-source-4dm"><pre>https:<span class="pl-c"><span class="pl-c">//</span>bing.npanuhin.me/{country}-{language}.json</span></pre></div>' },
                // Ex 2: Flat span
                { langName: 'ASL', codeBlockHTML: '<div class="highlight highlight-source-asl"><pre>https:<span class="pl-c">//bing.npanuhin.me/{country}-{language}.json</span></pre></div>' },
                // Ex 3: Additional pl-smi span
                { langName: 'Apex', codeBlockHTML: '<div class="highlight highlight-source-apex"><pre><span class="pl-smi">https</span>:<span class="pl-c"><span class="pl-c">//</span>bing.npanuhin.me/{country}-{language}.json</span></pre></div>' },
            ];

            const grouped = groupResults(results);

            expect(grouped).toHaveLength(1);
            expect(grouped[0].langNames).toEqual(['4D', 'ASL', 'Apex']);
        });
    });
});
