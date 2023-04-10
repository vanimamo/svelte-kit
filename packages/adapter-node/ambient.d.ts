declare module 'ENV' {
	export function env(key: string, fallback?: any): string;
}

declare module 'HANDLER' {
	export const handler: import('polka').Middleware;
}

declare module 'STATIC' {
	import type { Stats } from 'fs';
	import type { IncomingMessage, ServerResponse } from 'http';

	type Arrayable<T> = T | T[];
	export type NextHandler = () => void | Promise<void>;
	export type RequestHandler = (
		req: IncomingMessage,
		res: ServerResponse,
		next?: NextHandler
	) => void;

	export interface Options {
		dev?: boolean;
		etag?: boolean;
		maxAge?: number;
		immutable?: boolean;
		single?: string | boolean;
		ignores?: false | Arrayable<string | RegExp>;
		extensions?: string[];
		dotfiles?: boolean;
		brotli?: boolean;
		gzip?: boolean;
		onNoMatch?: (req: IncomingMessage, res: ServerResponse) => void;
		setHeaders?: (res: ServerResponse, pathname: string, stats: Stats) => void;
	}

	export function sirv(dir?: string, opts?: Options): RequestHandler;
}

declare module 'MANIFEST' {
	import { SSRManifest } from '@sveltejs/kit';

	export const manifest: SSRManifest;
	export const prerendered: Set<string>;
}

declare module 'SERVER' {
	export { Server } from '@sveltejs/kit';
}

declare namespace App {
	export interface Platform {
		/**
		 * The original Node request object (https://nodejs.org/api/http.html#class-httpincomingmessage)
		 */
		req: import('http').IncomingMessage;
	}
}
