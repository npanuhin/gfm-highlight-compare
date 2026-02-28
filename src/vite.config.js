import {defineConfig} from 'vite';
import legacy from '@vitejs/plugin-legacy';
import htmlMinifier from 'vite-plugin-html-minifier';

export default defineConfig({
	base: './',
	root: 'website',

	plugins: [
		htmlMinifier({
			minifyURLs: false,
		}),
		legacy(),
	],

	build: {
		outDir: '../_website',
		emptyOutDir: false,
	},
});
