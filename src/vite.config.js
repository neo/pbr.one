import { defineConfig } from 'vite';
import { viteSingleFile } from "vite-plugin-singlefile"

export default defineConfig({
	plugins: [viteSingleFile()],
	build: {
		rollupOptions: {
			input: {
				// "index": 'index.html',
				// "hdri-exposure": 'hdri-exposure.html',
				"hdri-shading": 'hdri-shading.html',
				// "material-shading": 'material-shading.html',
				// "texture-tiling": 'texture-tiling.html'
			}
		}
	},

});