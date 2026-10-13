import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class ApipjApi implements ICredentialType {
	name = 'apipjApi';

	displayName = 'Apipj API';

	icon: Icon = { light: 'file:../icons/apipj.svg', dark: 'file:../icons/apipj.dark.svg' };

	documentationUrl = 'https://apipj.com.br/docs';

	properties: INodeProperties[] = [
		{
			displayName:
				'Crie uma conta grátis em <a href="https://apipj.com.br/criar-conta" target="_blank">apipj.com.br/criar-conta</a> e copie a chave de API no painel. O plano grátis tem 50.000 consultas por mês.',
			name: 'notice',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'Chave De API',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'e.g. apipj_live_...',
			description: 'Chave de API do apipj (começa com apipj_live_)',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://apipj.com.br',
			url: '/v1/cnpj/00000000000191',
			method: 'GET',
			qs: { formato: 'simplificado' },
		},
	};
}
