import 'SHIMS';
import fs from 'node:fs';
import path from 'node:path';
import { sirv } from 'STATIC';
import { fileURLToPath } from 'node:url';
import { parse as polka_url_parser } from '@polka/url';
import { getRequest, setResponse } from '@sveltejs/kit/node';
import { Server } from 'SERVER';
import { manifest, prerendered } from 'MANIFEST';
import { env } from 'ENV';

/* global ENV_PREFIX */

const server = new Server(manifest);
await server.init({ env: process.env });
const origin = env('ORIGIN', undefined);
const xff_depth = parseInt(env('XFF_DEPTH', '1'));
const address_header = env('ADDRESS_HEADER', '').toLowerCase();
const protocol_header = env('PROTOCOL_HEADER', '').toLowerCase();
const host_header = env('HOST_HEADER', 'host').toLowerCase();
const body_size_limit = parseInt(env('BODY_SIZE_LIMIT', '524288'));

const dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {string} path
 * @param {boolean} client
 * @returns {import('polka').Middleware}
 */
function serve(path, client = false) {
	return (
		fs.existsSync(path) &&
		sirv(path, {
			setHeaders:
				client &&
				((res, pathname) => {
					// only apply to build directory, not e.g. version.json
					if (pathname.startsWith(`/${manifest.appPath}/immutable/`) && res.statusCode === 200) {
						res.setHeader('cache-control', 'public,max-age=31536000,immutable');
					}
				})
		})
	);
}

// required because the static file server ignores trailing slashes
/** @returns {import('polka').Middleware} */
function serve_prerendered() {
	const handler = serve(path.join(dir, 'prerendered'));

	return (req, res, next) => {
		let { pathname, search, query } = polka_url_parser(req);

		try {
			pathname = decodeURIComponent(pathname);
		} catch {
			// ignore invalid URI
		}

		if (prerendered.has(pathname)) {
			return handler(req, res, next);
		}

		// remove or add trailing slash as appropriate
		let location = pathname.at(-1) === '/' ? pathname.slice(0, -1) : pathname + '/';
		if (prerendered.has(location)) {
			if (query) location += search;
			res.writeHead(308, { location }).end();
		} else {
			next();
		}
	};
}

/** @type {import('polka').Middleware} */
const ssr = async (req, res) => {
	/** @type {Request | undefined} */
	let request;

	try {
		request = await getRequest({
			base: origin || get_origin(req.headers),
			request: req,
			bodySizeLimit: body_size_limit
		});
	} catch (err) {
		res.statusCode = err.status || 400;
		res.end('Invalid request body');
		return;
	}

	if (address_header && !(address_header in req.headers)) {
		throw new Error(
			`Address header was specified with ${
				ENV_PREFIX + 'ADDRESS_HEADER'
			}=${address_header} but is absent from request`
		);
	}

	// TODO If request has header, cookie that specifies a language, translate the file

	const response = await server.respond(request, {
			platform: { req },
			getClientAddress: () => {
				if (address_header) {
					const value = /** @type {string} */ (req.headers[address_header]) || '';

					if (address_header === 'x-forwarded-for') {
						const addresses = value.split(',');

						if (xff_depth < 1) {
							throw new Error(`${ENV_PREFIX + 'XFF_DEPTH'} must be a positive integer`);
						}

						if (xff_depth > addresses.length) {
							throw new Error(
								`${ENV_PREFIX + 'XFF_DEPTH'} is ${xff_depth}, but only found ${
									addresses.length
								} addresses`
							);
						}
						return addresses[addresses.length - xff_depth].trim();
					}

					return value;
				}

				return (
					req.connection?.remoteAddress ||
					// @ts-expect-error
					req.connection?.socket?.remoteAddress ||
					req.socket?.remoteAddress ||
					// @ts-expect-error
					req.info?.remoteAddress
				);
			}
		});

	const headers = Object.fromEntries(response.headers);

	// Don't pass content-length as it will be translated
	delete headers['content-length'];

	/*if (response.headers.has('set-cookie')) {
		const header = /!** @type {string} *!/ (response.headers.get('set-cookie'));
		headers['set-cookie'] = set_cookie_parser.splitCookiesString(header);
	}*/

	res.writeHead(response.status, headers);

	if (!response.body) {
		res.end();
		return;
	}

	if (response.body.locked) {
		res.write(
			'Fatal error: Response body is locked. ' +
				`This can happen when the response was already read (for example through 'response.json()' or 'response.text()').`
		);
		res.end();
		return;
	}

	const reader = response.body.getReader();

	if (res.destroyed) {
		reader.cancel();
		return;
	}

	const cancel = (/** @type {Error|undefined} */ error) => {
		res.off('close', cancel);
		res.off('error', cancel);

		// If the reader has already been interrupted with an error earlier,
		// then it will appear here, it is useless, but it needs to be catch.
		reader.cancel(error).catch(() => {});
		if (error) res.destroy(error);
	};

	res.on('close', cancel);
	res.on('error', cancel);

	next();
	async function next() {
		try {
			for (;;) {
				const { done, value } = await reader.read();

				if (done) break;

				let text = new TextDecoder('utf-8').decode(value);

				text = text.replaceAll('Email', 'E-mail');

				if (!res.write(text)) {
					res.once('drain', next);
					return;
				}
			}
			res.end();
		} catch (error) {
			cancel(error instanceof Error ? error : new Error(String(error)));
		}
	}
};

/** @param {import('polka').Middleware[]} handlers */
function sequence(handlers) {
	/** @type {import('polka').Middleware} */
	return (req, res, next) => {
		/** @param {number} i */
		function handle(i) {
			handlers[i](req, res, () => {
				if (i < handlers.length) handle(i + 1);
				else next();
			});
		}

		handle(0);
	};
}

/**
 * @param {import('http').IncomingHttpHeaders} headers
 * @returns
 */
function get_origin(headers) {
	const protocol = (protocol_header && headers[protocol_header]) || 'https';
	const host = headers[host_header];
	return `${protocol}://${host}`;
}

export const handler = sequence(
	[
		serve(path.join(dir, 'client'), true),
		serve(path.join(dir, 'static')),
		serve_prerendered(),
		ssr
	].filter(Boolean)
);
