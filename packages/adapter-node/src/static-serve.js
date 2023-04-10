import * as fs from 'node:fs';
import { resolve } from 'node:path';
import { totalist } from 'totalist/sync';
import { parse } from '@polka/url';
import { lookup } from 'mrmime';

/** @type {Array<string|number|string[]>} */
const TRANSLATABLE_TYPES = ["text/css", "application/javascript"];

const noop = () => {};

/**
 * @param {string} uri
 * @param {string[]} extns
 * @returns {string[]}
 */
function toAssume(uri, extns) {
	let i = 0,
		x,
		len = uri.length - 1;
	if (uri.charCodeAt(len) === 47) {
		uri = uri.substring(0, len);
	}

	let arr = [],
		tmp = `${uri}/index`;
	for (; i < extns.length; i++) {
		x = extns[i] ? `.${extns[i]}` : '';
		if (uri) arr.push(uri + x);
		arr.push(tmp + x);
	}

	return arr;
}

/**
 * @param {{ [key: string]: any; }} cache
 * @param {string} uri
 * @param {string[]} extns
 * @returns {any}
 */
function viaCache(cache, uri, extns) {
	let i = 0,
		data,
		arr = toAssume(uri, extns);
	for (; i < arr.length; i++) {
		if ((data = cache[arr[i]])) return data;
	}
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} file
 * @param {import('node:fs').Stats} stats
 * @param {{ [key: string]: string | number | string[]; }} headers
 * @returns {void | import('node:http').ServerResponse}
 */
function send(req, res, file, stats, headers) {
	let code = 200,
		tmp,
		opts = {};
	headers = { ...headers };

	for (let key in headers) {
		tmp = res.getHeader(key);
		if (tmp) headers[key] = tmp;
	}

	if ((tmp = res.getHeader('content-type'))) {
		headers['Content-Type'] = tmp;
	}

	if (req.headers.range) {
		code = 206;
		let [x, y] = req.headers.range.replace('bytes=', '').split('-');
		let end = (opts.end = parseInt(y, 10) || stats.size - 1);
		let start = (opts.start = parseInt(x, 10) || 0);

		if (start >= stats.size || end >= stats.size) {
			res.setHeader('Content-Range', `bytes */${stats.size}`);
			res.statusCode = 416;
			return res.end();
		}

		headers['Content-Range'] = `bytes ${start}-${end}/${stats.size}`;
		headers['Content-Length'] = end - start + 1;
		headers['Accept-Ranges'] = 'bytes';
	}

	if (TRANSLATABLE_TYPES.includes(headers['Content-Type'])) {
		fs.readFile(file, 'utf8', (_, data) => {
			let string = data.toString();

			// Force-Accept-Language -> cookie.lang -> Accept-Language
			// const cookies = cookie.parse(req.headers.cookie || '');

			// TODO If request has header, cookie that specifies a language, translate the file
			// TODO Fetch and cache translations internally for requested languages

			string = string.replaceAll('Email', 'E-mail');

			headers['Content-Length'] = string.length;

			res.writeHead(code, headers);
			res.end(string);
		});
	}
	else {
		res.writeHead(code, headers);
		fs.createReadStream(file, opts).pipe(res);
	}
}

/**
 * @param {string} name
 * @param {any} stats
 * @returns {{ [key: string]: string | number | string[]; }}
 */
function toHeaders(name, stats) {
	let ctype = lookup(name) || '';
	if (ctype === 'text/html') ctype += ';charset=utf-8';

	return {
		'Content-Length': stats.size,
		'Content-Type': ctype,
		'Last-Modified': stats.mtime.toUTCString()
	};
}

/**
 * @param {string} dir
 * @param {{setHeaders?: (res: import('node:http').ServerResponse, pathname: string, stats: import('node:fs').Stats) => void}} opts
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next?: () => void | Promise<void>) => void}
 */
export function sirv(dir, opts = {}) {
	dir = resolve(dir || '.');

	let setHeaders = opts.setHeaders || noop;

	let extensions = ['html', 'htm'];

	/** @type {any} */
	const FILES = {};

	let fallback = '/';

	let cc = `public,max-age=86400`;

	totalist(dir, (name, abs, stats) => {
		if (/\.well-known[\\+\/]/.test(name)) {
		} // keep
		else if (/(^\.|[\\+|\/+]\.)/.test(name)) return;

		let headers = toHeaders(name, stats);
		if (cc) headers['Cache-Control'] = cc;

		FILES['/' + name.normalize().replace(/\\+/g, '/')] = { abs, stats, headers };
	});

	let lookup = viaCache.bind(0, FILES);

	return function (req, res, next) {
		let extns = ['', ...extensions];
		let pathname = parse(req).pathname;

		if (pathname.indexOf('%') !== -1) {
			try {
				pathname = decodeURIComponent(pathname);
			} catch (err) {
				/* malform uri */
			}
		}

		let data = lookup(pathname, extns) || lookup(fallback, extns);
		if (!data) return next();

		setHeaders(res, pathname, data.stats);
		send(req, res, data.abs, data.stats, data.headers);
	};
}
