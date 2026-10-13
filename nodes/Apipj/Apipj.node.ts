import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { invalidCnpjReason, normalizeCnpj } from './shared/cnpj';
import { apipjRequest } from './shared/transport';

/** UI value of the 'Format' parameter => value of the API's `formato` query parameter. */
const API_FORMAT: Record<string, string> = {
	full: 'completo',
	simplified: 'simplificado',
};

export class Apipj implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'apipj (CNPJ)',
		name: 'apipj',
		icon: { light: 'file:../../icons/apipj.svg', dark: 'file:../../icons/apipj.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle:
			'={{ {"lookup": "Look Up CNPJ", "validate": "Validate CNPJ", "status": "Get Dataset Status"}[$parameter["operation"]] }}',
		description: 'Look up Brazilian companies by CNPJ (Receita Federal open data)',
		defaults: {
			name: 'apipj (CNPJ)',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'apipjApi',
				required: true,
				displayOptions: {
					show: {
						operation: ['lookup'],
					},
				},
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Look Up CNPJ',
						value: 'lookup',
						description:
							'Get the registration data of a company by CNPJ (requires an API key and uses quota)',
						action: 'Look up a company by CNPJ',
					},
					{
						name: 'Validate CNPJ',
						value: 'validate',
						description:
							'Check the format and check digits of a numeric or alphanumeric CNPJ (no API key, no quota)',
						action: 'Validate a CNPJ',
					},
					{
						name: 'Get Dataset Status',
						value: 'status',
						description:
							'Get the reference month and size of the CNPJ dataset (no API key, no quota)',
						action: 'Get the dataset status',
					},
				],
				default: 'lookup',
			},
			{
				displayName: 'CNPJ',
				name: 'cnpj',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. 00.000.000/0001-91',
				description:
					'CNPJ with or without punctuation. Alphanumeric CNPJs are accepted (e.g. 12.ABC.345/01DE-35).',
				displayOptions: {
					show: {
						operation: ['lookup', 'validate'],
					},
				},
			},
			{
				displayName: 'Format',
				name: 'format',
				type: 'options',
				options: [
					{
						name: 'Full',
						value: 'full',
						description:
							'Structured document: razao_social, situacao_cadastral, endereco (with IBGE city code), cnae_principal, socios, simples and more',
					},
					{
						name: 'Simplified',
						value: 'simplified',
						description:
							'Flat document with DD/MM/YYYY dates and formatted CNPJ, ZIP code and phone (nome, fantasia, situacao, atividade_principal, qsa and more)',
					},
				],
				default: 'full',
				description: 'Shape of the returned document (both count as one lookup)',
				displayOptions: {
					show: {
						operation: ['lookup'],
					},
				},
			},
			{
				displayName: 'Continue If Not Found',
				name: 'continueIfNotFound',
				type: 'boolean',
				default: false,
				description:
					'Whether to return { cnpj, found: false } instead of failing the item when the CNPJ is valid but not in the Receita Federal dataset',
				displayOptions: {
					show: {
						operation: ['lookup'],
					},
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const operation = this.getNodeParameter('operation', itemIndex) as string;
				let json: IDataObject;

				if (operation === 'status') {
					json = (await apipjRequest.call(this, '/v1/status', {}, itemIndex)).body;
				} else if (operation === 'validate') {
					const cnpj = normalizeCnpj(this.getNodeParameter('cnpj', itemIndex));
					if (cnpj.length === 0) {
						throw new NodeOperationError(this.getNode(), "The 'CNPJ' field is empty", {
							itemIndex,
							description: 'Enter the CNPJ to validate, with or without punctuation.',
						});
					}
					if (cnpj.length > 32) {
						// Same shape as the API response, without sending an oversized value.
						json = {
							cnpj: cnpj.slice(0, 32),
							valido: false,
							formatado: null,
							alfanumerico: false,
							erro: `CNPJ deve ter 14 caracteres (recebido ${cnpj.length})`,
						};
					} else {
						json = (
							await apipjRequest.call(this, `/v1/valida/${encodeURIComponent(cnpj)}`, {}, itemIndex)
						).body;
					}
				} else if (operation === 'lookup') {
					const cnpj = normalizeCnpj(this.getNodeParameter('cnpj', itemIndex));
					const format = this.getNodeParameter('format', itemIndex, 'full') as string;
					const continueIfNotFound = this.getNodeParameter(
						'continueIfNotFound',
						itemIndex,
						false,
					) as boolean;

					const reason = invalidCnpjReason(cnpj);
					if (reason !== null) {
						throw new NodeOperationError(
							this.getNode(),
							`The value of the 'CNPJ' field is not a valid CNPJ: ${reason}`,
							{
								itemIndex,
								description:
									"No lookup was used. Check the CNPJ (14 characters, with or without punctuation) or run 'Validate CNPJ' first.",
							},
						);
					}

					const apiFormat = API_FORMAT[format] ?? 'completo';
					const res = await apipjRequest.call(
						this,
						`/v1/cnpj/${cnpj}`,
						{
							authenticate: true,
							qs: apiFormat === 'simplificado' ? { formato: apiFormat } : undefined,
						},
						itemIndex,
					);

					if (res.statusCode === 404) {
						if (!continueIfNotFound) {
							throw new NodeApiError(this.getNode(), res.body as JsonObject, {
								itemIndex,
								httpCode: '404',
								message: `CNPJ ${cnpj} is not in the Receita Federal dataset`,
								description:
									"To keep the workflow going in this case, turn on 'Continue If Not Found': the node then returns { cnpj, found: false }.",
							});
						}
						json = { cnpj, found: false };
					} else {
						json = res.body;
					}
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, {
						itemIndex,
					});
				}

				returnData.push({ json, pairedItem: { item: itemIndex } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				// The node's own errors already carry message, description and itemIndex: rethrow them as they are.
				if (error instanceof NodeApiError || error instanceof NodeOperationError) {
					const nodeError = error;
					throw nodeError;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}

		return [returnData];
	}
}
