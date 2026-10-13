import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	IN8nHttpFullResponse,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, sleep } from 'n8n-workflow';

export const BASE_URL = 'https://apipj.com.br';
/** Keep in sync with "version" in package.json (only used in the User-Agent header). */
export const VERSION = '0.1.1';

export const SIGNUP_URL = 'https://apipj.com.br/criar-conta';
export const UPGRADE_DEV_URL = 'https://apipj.com.br/painel?assinar=dev';
export const UPGRADE_PRO_URL = 'https://apipj.com.br/painel?assinar=pro';

/** Retries after the first attempt (429 rate_limited, 5xx and network failures). */
const MAX_RETRIES = 3;
/** Upper bound for a Retry-After wait, in seconds (apipj rate limits are per minute). */
const MAX_WAIT_S = 65;
const TIMEOUT_MS = 15000;

export interface ApipjResponse {
	statusCode: number;
	body: IDataObject;
}

function asObject(body: unknown): IDataObject {
	if (body && typeof body === 'object' && !Array.isArray(body)) return body as IDataObject;
	if (typeof body === 'string' && body.length > 0) {
		try {
			const parsed = JSON.parse(body) as unknown;
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
				return parsed as IDataObject;
		} catch {
			// not JSON (e.g. an HTML page from a proxy): returned as text below
		}
		return { message: body.slice(0, 500) };
	}
	return {};
}

function retryAfterSeconds(value: unknown, body: IDataObject): number {
	const raw = Array.isArray(value) ? value[0] : value;
	if (raw !== undefined && raw !== null && raw !== '') {
		const n = Number(raw);
		if (Number.isFinite(n)) return Math.min(MAX_WAIT_S, Math.max(0, n));
		const date = Date.parse(String(raw));
		if (Number.isFinite(date)) {
			return Math.min(MAX_WAIT_S, Math.max(0, Math.ceil((date - Date.now()) / 1000)));
		}
	}
	const fromBody = Number(body.retry_after);
	if (Number.isFinite(fromBody) && fromBody >= 0) return Math.min(MAX_WAIT_S, fromBody);
	return 1;
}

function header(res: IN8nHttpFullResponse, name: string): unknown {
	const headers = (res.headers ?? {}) as IDataObject;
	const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
	return key === undefined ? undefined : headers[key];
}

/**
 * Sends a GET request to the apipj API.
 *
 * - `authenticate: true` uses the `apipjApi` credential (Authorization: Bearer header).
 * - Returns the response for 2xx and for 404 `not_found` (the caller decides what to do).
 * - 429 `rate_limited`: waits for Retry-After and tries again (up to 3 times).
 * - 429 `quota_exceeded`: no retry; throws with the link to upgrade the plan.
 * - 5xx and network failures: tries again after 1 s, 2 s and 4 s.
 */
export async function apipjRequest(
	this: IExecuteFunctions,
	path: string,
	{ authenticate = false, qs }: { authenticate?: boolean; qs?: IDataObject },
	itemIndex: number,
): Promise<ApipjResponse> {
	const options: IHttpRequestOptions = {
		method: 'GET',
		url: `${BASE_URL}${path}`,
		qs,
		headers: {
			Accept: 'application/json',
			'User-Agent': `n8n-nodes-apipj/${VERSION}`,
		},
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		timeout: TIMEOUT_MS,
	};

	for (let attempt = 0; ; attempt++) {
		const canRetry = attempt < MAX_RETRIES;
		let res: IN8nHttpFullResponse;
		try {
			res = authenticate
				? ((await this.helpers.httpRequestWithAuthentication.call(
						this,
						'apipjApi',
						options,
					)) as IN8nHttpFullResponse)
				: ((await this.helpers.httpRequest(options)) as IN8nHttpFullResponse);
		} catch (error) {
			if (canRetry) {
				await sleep(1000 * 2 ** attempt);
				continue;
			}
			throw new NodeApiError(this.getNode(), error as JsonObject, {
				itemIndex,
				message: 'The apipj API did not respond',
				description:
					'Could not reach https://apipj.com.br after 4 attempts. Check that n8n can make outbound HTTPS requests and try again in a few minutes.',
			});
		}

		const statusCode = res.statusCode;
		const body = asObject(res.body);
		const code = typeof body.code === 'string' ? body.code : '';
		const apiMessage = typeof body.message === 'string' ? body.message : '';

		if (statusCode >= 200 && statusCode < 300) return { statusCode, body };
		if (statusCode === 404 && code === 'not_found') return { statusCode, body };

		if (statusCode === 429 && code === 'quota_exceeded') {
			const upgradeUrl = typeof body.upgrade_url === 'string' ? body.upgrade_url : UPGRADE_DEV_URL;
			throw new NodeApiError(this.getNode(), body as JsonObject, {
				itemIndex,
				httpCode: '429',
				message: 'The monthly lookup quota of your apipj plan is used up',
				description: `To keep looking up CNPJs now, upgrade your plan: Dev (R$ 12.90/month, 200,000 lookups) at ${upgradeUrl} or Pro (R$ 59.90/month, 600,000 lookups) at ${UPGRADE_PRO_URL}. The quota resets at the start of next month. 'Validate CNPJ' and 'Get Dataset Status' keep working without quota.`,
			});
		}

		if (statusCode === 429) {
			if (canRetry) {
				await sleep(retryAfterSeconds(header(res, 'retry-after'), body) * 1000);
				continue;
			}
			throw new NodeApiError(this.getNode(), body as JsonObject, {
				itemIndex,
				httpCode: '429',
				message: 'The per-minute rate limit of your apipj plan was reached',
				description: `The node waited as requested by the API and tried again 3 times. Slow down (e.g. with Loop Over Items + Wait) or upgrade to a plan with more lookups per minute: Dev (30/min) at ${UPGRADE_DEV_URL} or Pro (200/min) at ${UPGRADE_PRO_URL}. The free plan allows 10 lookups per minute.`,
			});
		}

		if (statusCode >= 500 && canRetry) {
			await sleep(1000 * 2 ** attempt);
			continue;
		}

		if (statusCode === 401) {
			throw new NodeApiError(this.getNode(), body as JsonObject, {
				itemIndex,
				httpCode: '401',
				message: 'The apipj API key was rejected',
				description: `${apiMessage ? `API message: "${apiMessage}". ` : ''}Check the key in the 'Apipj API' credential (it starts with apipj_live_). If you don't have one yet, create a free account at ${SIGNUP_URL}.`,
			});
		}

		if (statusCode === 400) {
			throw new NodeApiError(this.getNode(), body as JsonObject, {
				itemIndex,
				httpCode: '400',
				message: 'The apipj API rejected the request',
				description: `${apiMessage ? `API message: "${apiMessage}". ` : ''}Check the value of the 'CNPJ' field (API code: ${code || 'bad_request'}).`,
			});
		}

		throw new NodeApiError(this.getNode(), body as JsonObject, {
			itemIndex,
			httpCode: String(statusCode),
			message: `The apipj API responded with HTTP ${statusCode}`,
			description:
				statusCode >= 500
					? `The apipj API is unavailable right now (the node tried 4 times). Check https://apipj.com.br/v1/status and try again in a few minutes.${apiMessage ? ` API message: "${apiMessage}".` : ''}`
					: `API code: ${code || 'unknown'}.${apiMessage ? ` API message: "${apiMessage}".` : ''}`,
		});
	}
}
