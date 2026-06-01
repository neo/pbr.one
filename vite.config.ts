import { defineConfig } from 'vite';
import { viteSingleFile } from "vite-plugin-singlefile"

export default defineConfig({
    plugins: [viteSingleFile({ removeViteModuleLoader: true })],
    build: { minify: false, rollupOptions: { input: 'src/index.html', external: [/^three/] } },
    resolve: { preserveSymlinks: true },
})
