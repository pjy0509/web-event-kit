import typescript from '@rollup/plugin-typescript'
import json from '@rollup/plugin-json'
import terser from '@rollup/plugin-terser'
import dts from 'rollup-plugin-dts'
import path from 'path'

const input = 'index.ts'
const jsOutBase = 'dist/event-kit.'
const dtsOutFile = 'dist/index.d.ts'
const umdName = 'EventKit'

const formats = [
	{format: 'es', extension: 'mjs', minExtension: 'min.mjs'},
	{format: 'cjs', extension: 'cjs', minExtension: 'min.cjs', exports: 'named'},
	{format: 'umd', extension: 'umd.js', minExtension: 'umd.min.js', exports: 'named'},
]

const jsBundles = formats.map((fmt) => {
	const outputs = [
		{
			file: jsOutBase + fmt.extension,
			format: fmt.format,
			exports: fmt.exports,
			name: umdName,
			sourcemap: true,
		},
	]
	
	if (fmt.minExtension) {
		outputs.push({
			file: jsOutBase + fmt.minExtension,
			format: fmt.format,
			exports: fmt.exports,
			name: umdName,
			sourcemap: true,
			plugins: [terser()],
		})
	}
	
	return {
		input,
		plugins: [
			typescript({tsconfig: './tsconfig.json'}),
			json(),
		],
		output: outputs,
	}
})

const dtsBundle = {
	input,
	plugins: [dts()],
	output: {
		file: path.resolve(dtsOutFile),
		format: 'es',
	},
}

export default [...jsBundles, dtsBundle]
