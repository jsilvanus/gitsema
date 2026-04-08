declare module '@jsilvanus/embedeer' {
	const _default: any
	export default _default
	export function embed(text: string | string[], opts?: any): any
	export function embedBatch(texts: string[], opts?: any): any
	export function listModels(): any
	export function hasModel(name: string): any
	export function isModelDownloaded(name: string): any
	export function download(opts: any): any
}
