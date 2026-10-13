import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { motivoCnpjInvalido, normalizarCnpj } from './shared/cnpj';
import { apipjRequest } from './shared/transport';

export class Apipj implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'apipj (CNPJ)',
		name: 'apipj',
		icon: { light: 'file:../../icons/apipj.svg', dark: 'file:../../icons/apipj.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle:
			'={{ {"consultar": "Consultar CNPJ", "validar": "Validar CNPJ", "status": "Status da base"}[$parameter["operation"]] }}',
		description:
			'Consulta dados de empresas pelo CNPJ (razão social, situação cadastral, endereço, CNAE, sócios, Simples) na base da Receita Federal',
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
						operation: ['consultar'],
					},
				},
			},
		],
		properties: [
			{
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Consultar CNPJ',
						value: 'consultar',
						description:
							'Busca os dados cadastrais de uma empresa pelo CNPJ (usa a chave de API e consome cota)',
						action: 'Consultar dados de um CNPJ',
					},
					{
						name: 'Validar CNPJ',
						value: 'validar',
						description:
							'Confere formato e dígitos verificadores de um CNPJ numérico ou alfanumérico (sem chave e sem cota)',
						action: 'Validar um CNPJ',
					},
					{
						name: 'Status Da Base',
						value: 'status',
						description:
							'Mostra o mês de referência e o tamanho da base de CNPJs (sem chave e sem cota)',
						action: 'Ver o status da base',
					},
				],
				default: 'consultar',
			},
			{
				displayName: 'CNPJ',
				name: 'cnpj',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. 00.000.000/0001-91',
				description:
					'CNPJ com ou sem máscara. Aceita o CNPJ alfanumérico (por exemplo 12.ABC.345/01DE-35).',
				displayOptions: {
					show: {
						operation: ['consultar', 'validar'],
					},
				},
			},
			{
				displayName: 'Formato',
				name: 'formato',
				type: 'options',
				options: [
					{
						name: 'Completo',
						value: 'completo',
						description:
							'Documento estruturado: razao_social, situacao_cadastral, endereco (com código IBGE), cnae_principal, socios, simples e mais',
					},
					{
						name: 'Simplificado',
						value: 'simplificado',
						description:
							'Formato plano com datas DD/MM/AAAA e CNPJ, CEP e telefone já formatados (nome, fantasia, situacao, atividade_principal, qsa e mais)',
					},
				],
				default: 'completo',
				description: 'Formato do documento devolvido pela consulta (os dois custam uma consulta)',
				displayOptions: {
					show: {
						operation: ['consultar'],
					},
				},
			},
			{
				displayName: 'Quando Não Encontrado',
				name: 'quandoNaoEncontrado',
				type: 'options',
				options: [
					{
						name: 'Parar Com Erro',
						value: 'parar',
						description: 'O item falha se o CNPJ não está na base da Receita Federal',
					},
					{
						name: 'Continuar Se Não Encontrado',
						value: 'continuar',
						description: 'Devolve { cnpj, encontrado: false } e segue o workflow',
					},
				],
				default: 'parar',
				description: 'O que fazer quando o CNPJ é válido mas não está na base da Receita Federal',
				displayOptions: {
					show: {
						operation: ['consultar'],
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
				} else if (operation === 'validar') {
					const cnpj = normalizarCnpj(this.getNodeParameter('cnpj', itemIndex));
					if (cnpj.length === 0) {
						throw new NodeOperationError(this.getNode(), "O campo 'CNPJ' está vazio", {
							itemIndex,
							description: 'Informe o CNPJ a validar, com ou sem máscara.',
						});
					}
					if (cnpj.length > 32) {
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
				} else if (operation === 'consultar') {
					const cnpj = normalizarCnpj(this.getNodeParameter('cnpj', itemIndex));
					const formato = this.getNodeParameter('formato', itemIndex, 'completo') as string;
					const continuar =
						this.getNodeParameter('quandoNaoEncontrado', itemIndex, 'parar') === 'continuar';

					const motivo = motivoCnpjInvalido(cnpj);
					if (motivo !== null) {
						throw new NodeOperationError(
							this.getNode(),
							`O valor do campo 'CNPJ' não é um CNPJ válido: ${motivo}`,
							{
								itemIndex,
								description:
									'Nenhuma consulta foi gasta. Confira o CNPJ (14 caracteres, com ou sem máscara) ou use a operação Validar CNPJ antes de consultar.',
							},
						);
					}

					const res = await apipjRequest.call(
						this,
						`/v1/cnpj/${cnpj}`,
						{ autenticar: true, qs: formato === 'simplificado' ? { formato } : undefined },
						itemIndex,
					);

					if (res.statusCode === 404) {
						if (!continuar) {
							throw new NodeApiError(this.getNode(), res.body as JsonObject, {
								itemIndex,
								httpCode: '404',
								message: `O CNPJ ${cnpj} não está na base da Receita Federal`,
								description:
									"Para seguir o workflow nesses casos, escolha 'Continuar Se Não Encontrado' em 'Quando Não Encontrado': o node devolve { cnpj, encontrado: false }.",
							});
						}
						json = { cnpj, encontrado: false };
					} else {
						json = res.body;
					}
				} else {
					throw new NodeOperationError(this.getNode(), `Operação desconhecida: ${operation}`, {
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
				// Erros do próprio node já têm mensagem, descrição e itemIndex: repassa sem embrulhar.
				if (error instanceof NodeApiError || error instanceof NodeOperationError) {
					const erroDoNode = error;
					throw erroDoNode;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}

		return [returnData];
	}
}
