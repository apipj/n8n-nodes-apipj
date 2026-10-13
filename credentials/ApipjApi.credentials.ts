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
				'Create a free account at <a href="https://apipj.com.br/criar-conta" target="_blank">apipj.com.br/criar-conta</a> and copy your API key from the dashboard. The free plan includes 50,000 lookups per month.',
			name: 'notice',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'e.g. apipj_live_...',
			description: 'Your apipj API key (starts with apipj_live_)',
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
