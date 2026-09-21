import {
  UnipileAccount,
  UnipileHostedAuthResponse,
  UnipileProfile,
  UnipileSendInvitationParams,
  UnipileSendInvitationResponse,
  UnipileSendMessageParams,
  UnipileSendMessageResponse,
  UnipileStartChatParams,
  UnipileStartChatResponse,
  UnipileChat,
  UnipileChatAttendee,
  UnipileMessage,
  UnipilePostComment,
  UnipilePostReaction,
  UnipileLinkedInSearchParams,
  UnipileLinkedInSearchResponse,
  UnipileSearchParameter,
  UnipileCredentialsAuthResponse,
  UnipileLinkedInAuthParams,
  UnipileSolveCheckpointResponse,
} from './types';

export class UnipileClient {
  private dsn: string;
  private apiKey: string;

  constructor(dsn?: string, apiKey?: string) {
    // Tomar de variables de entorno o parámetros
    let rawDsn = (dsn || process.env.UNIPILE_DSN || '').trim().replace(/\/$/, '');
    if (rawDsn && !rawDsn.startsWith('http://') && !rawDsn.startsWith('https://')) {
      rawDsn = `https://${rawDsn}`;
    }
    this.dsn = rawDsn;
    this.apiKey = (apiKey || process.env.UNIPILE_API_KEY || '').trim();
  }

  public isConfigured(): boolean {
    return Boolean(this.dsn && this.apiKey);
  }

  private getHeaders(includeJsonContentType = true): Record<string, string> {
    return {
      'X-API-KEY': this.apiKey,
      'Accept': 'application/json',
      ...(includeJsonContentType ? { 'Content-Type': 'application/json' } : {}),
    };
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    if (!this.isConfigured()) {
      throw new Error(
        'El motor de LinkedIn no está configurado. Revisa la configuración del servicio.'
      );
    }

    const url = `${this.dsn}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const isMultipart = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const headers = {
      ...this.getHeaders(!isMultipart),
      ...(options.headers || {}),
    };

    const res = await fetch(url, {
      ...options,
      headers,
    });

    if (!res.ok) {
      let errorBody = '';
      try {
        errorBody = await res.text();
      } catch {
        // ignore
      }
      const error = new Error(
        `Error del motor de LinkedIn [${res.status} ${res.statusText}]: ${errorBody || 'Sin detalle'}`
      ) as Error & { status?: number; body?: string; endpoint?: string };
      error.status = res.status;
      error.body = errorBody;
      error.endpoint = endpoint;
      throw error;
    }

    return (await res.json()) as T;
  }

  /**
   * Genera un enlace de autenticación Hosted para que el usuario conecte su cuenta de LinkedIn
   */
  async getHostedAuthLink(params: {
    type?: 'create' | 'reconnect';
    reconnect_account?: string;
    providers?: string[];
    success_redirect_url?: string;
    failure_redirect_url?: string;
    notify_url?: string;
    name?: string;
  } = {}): Promise<UnipileHostedAuthResponse> {
    const type = params.type || 'create';
    const payload = {
      type,
      ...(type === 'reconnect'
        ? { reconnect_account: params.reconnect_account }
        : { providers: params.providers || ['LINKEDIN'] }),
      api_url: this.dsn,
      expiresOn: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      ...(params.success_redirect_url ? { success_redirect_url: params.success_redirect_url } : {}),
      ...(params.failure_redirect_url ? { failure_redirect_url: params.failure_redirect_url } : {}),
      ...(params.notify_url ? { notify_url: params.notify_url } : {}),
      ...(params.name ? { name: params.name } : {}),
    };

    return this.request<UnipileHostedAuthResponse>('/api/v1/hosted/accounts/link', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Conecta una cuenta de LinkedIn usando credenciales o cookies directas (Native Auth)
   * Soporta opciones avanzadas de país (proxy location) y proxy dedicado.
   * Puede retornar una Account creada (201) o un Checkpoint (202) requiriendo código 2FA.
   */
  async startCredentialsAuth(params: UnipileLinkedInAuthParams): Promise<UnipileCredentialsAuthResponse> {
    const payload: Record<string, unknown> = {
      provider: 'LINKEDIN',
      ...(params.name ? { name: params.name } : {}),
      ...(params.country?.trim() ? { country: params.country.trim().toUpperCase() } : {}),
      ...(params.proxy ? { proxy: params.proxy } : {}),
    };

    if (params.accessToken?.trim()) {
      payload.access_token = params.accessToken.trim();
      if (params.premiumToken?.trim()) payload.premium_token = params.premiumToken.trim();
      if (params.userAgent?.trim()) payload.user_agent = params.userAgent.trim();
    } else if (params.username && params.password) {
      payload.username = params.username.trim();
      payload.password = params.password;
    }

    return this.request<UnipileCredentialsAuthResponse>('/api/v1/accounts', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Resuelve el checkpoint de verificación (2FA / SMS / Authenticator) para una cuenta de LinkedIn
   */
  async solveCheckpoint(params: {
    accountId: string;
    code: string;
  }): Promise<UnipileSolveCheckpointResponse> {
    const payload = {
      provider: 'LINKEDIN',
      account_id: params.accountId,
      code: params.code.trim(),
    };

    return this.request<UnipileSolveCheckpointResponse>('/api/v1/accounts/checkpoint', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Lista todas las cuentas conectadas a Unipile
   */
  async listAccounts(): Promise<{ items: UnipileAccount[] }> {
    return this.request<{ items: UnipileAccount[] }>('/api/v1/accounts');
  }

  /**
   * Obtiene los detalles de una cuenta específica
   */
  async getAccount(accountId: string): Promise<UnipileAccount> {
    return this.request<UnipileAccount>(`/api/v1/accounts/${accountId}`);
  }

  /**
   * Elimina una cuenta de Unipile
   */
  async deleteAccount(accountId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/v1/accounts/${accountId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Resuelve el perfil y obtiene el provider_id a partir del identificador público o vanity URL
   * Ejemplo: para linkedin.com/in/satyanadella -> identifier = 'satyanadella'
   */
  async resolveProfile(identifier: string, accountId: string): Promise<UnipileProfile> {
    const rawIdentifier = identifier.trim();
    let cleanId = rawIdentifier;
    try {
      const url = new URL(rawIdentifier);
      const match = url.pathname.match(/\/in\/([^/]+)/i);
      cleanId = match?.[1] || url.pathname.split("/").filter(Boolean).pop() || rawIdentifier;
    } catch {
      cleanId = rawIdentifier
        .replace(/^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\//i, '')
        .split(/[/?#]/)[0];
    }
    cleanId = decodeURIComponent(cleanId).trim();
    if (!cleanId) throw new Error('La URL o identificador de LinkedIn no es válido');

    const query = new URLSearchParams({
      account_id: accountId,
      linkedin_sections: '*',
    });
    return this.request<UnipileProfile>(
      `/api/v1/users/${encodeURIComponent(cleanId)}?${query.toString()}`
    );
  }

  /**
   * Envía una solicitud de conexión (invitación) en LinkedIn
   */
  async sendInvitation(params: UnipileSendInvitationParams): Promise<UnipileSendInvitationResponse> {
    return this.request<UnipileSendInvitationResponse>('/api/v1/users/invite', {
      method: 'POST',
      body: JSON.stringify({
        account_id: params.account_id,
        provider_id: params.provider_id,
        ...(params.message ? { message: params.message } : {}),
      }),
    });
  }

  async startChat(params: UnipileStartChatParams): Promise<UnipileStartChatResponse> {
    const body = new FormData();
    body.append('account_id', params.account_id);
    for (const attendeeId of params.attendees_ids) {
      body.append('attendees_ids[]', attendeeId);
    }
    if (params.text) body.append('text', params.text);
    for (const attachment of params.attachments || []) {
      if (typeof attachment.file === 'string') {
        body.append('attachments', attachment.file);
      } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(attachment.file)) {
        const blob = new Blob([new Uint8Array(attachment.file)], { type: attachment.mime_type || 'application/octet-stream' });
        body.append('attachments', blob, attachment.filename);
      } else {
        body.append('attachments', attachment.file as Blob, attachment.filename);
      }
    }

    return this.request<UnipileStartChatResponse>('/api/v1/chats', {
      method: 'POST',
      body,
    });
  }

  /**
   * Envía un mensaje en un chat existente. Unipile responde con message_id.
   */
  async sendMessage(params: UnipileSendMessageParams): Promise<UnipileSendMessageResponse> {
    const body = new FormData();
    body.append('text', params.text);
    for (const attachment of params.attachments || []) {
      if (typeof attachment.file === 'string') {
        body.append('attachments', attachment.file);
      } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(attachment.file)) {
        const blob = new Blob([new Uint8Array(attachment.file)], { type: attachment.mime_type || 'application/octet-stream' });
        body.append('attachments', blob, attachment.filename);
      } else {
        body.append('attachments', attachment.file as Blob, attachment.filename);
      }
    }

    return this.request<UnipileSendMessageResponse>(`/api/v1/chats/${encodeURIComponent(params.chat_id)}/messages`, {
      method: 'POST',
      body,
    });
  }

  /**
   * Lista chats con paginación por cursor. accountId acepta una o varias cuentas.
   */
  async listChats(accountId?: string | string[], limit: number = 100, cursor?: string): Promise<{ items: UnipileChat[]; cursor?: string | null }> {
    const query = new URLSearchParams();
    if (accountId) query.set('account_id', Array.isArray(accountId) ? accountId.join(',') : accountId);
    query.set('limit', String(Math.min(250, Math.max(1, limit))));
    if (cursor) query.set('cursor', cursor);

    return this.request<{ items: UnipileChat[]; cursor?: string | null }>(`/api/v1/chats?${query.toString()}`);
  }

  /**
   * Lista los mensajes de un chat específico con paginación por cursor.
   */
  async listMessages(chatId: string, limit: number = 100, cursor?: string): Promise<{ items: UnipileMessage[]; cursor?: string | null }> {
    const query = new URLSearchParams();
    query.set('limit', String(Math.min(250, Math.max(1, limit))));
    if (cursor) query.set('cursor', cursor);

    return this.request<{ items: UnipileMessage[]; cursor?: string | null }>(
      `/api/v1/chats/${encodeURIComponent(chatId)}/messages?${query.toString()}`
    );
  }

  async listChatAttendees(chatId: string): Promise<{ items: UnipileChatAttendee[]; cursor?: string | null }> {
    return this.request<{ items: UnipileChatAttendee[]; cursor?: string | null }>(
      `/api/v1/chats/${encodeURIComponent(chatId)}/attendees`
    );
  }

  /**
   * Lista los mensajes más recientes a través de todas las conversaciones de una cuenta.
   * Utiliza el endpoint rápido GET /api/v1/messages?account_id=...
   */
  async listAccountMessages(accountId: string, limit: number = 50, cursor?: string): Promise<{ items: UnipileMessage[]; cursor?: string | null }> {
    const query = new URLSearchParams();
    query.set('account_id', accountId);
    query.set('limit', String(Math.min(250, Math.max(1, limit))));
    if (cursor) query.set('cursor', cursor);

    return this.request<{ items: UnipileMessage[]; cursor?: string | null }>(
      `/api/v1/messages?${query.toString()}`
    );
  }

  /**
   * Obtiene comentarios de una publicación en LinkedIn para detectar intención
   */
  async getPostComments(postId: string, accountId?: string, limit: number = 50): Promise<{ items: UnipilePostComment[] }> {
    const query = new URLSearchParams();
    if (accountId) query.set('account_id', accountId);
    query.set('limit', String(limit));

    const safePostId = encodeURIComponent(postId).replace(/%3A/gi, ':');
    const rawRes = await this.request<any>(
      `/api/v1/posts/${safePostId}/comments?${query.toString()}`
    );
    if (Array.isArray(rawRes)) return { items: rawRes };
    if (rawRes && Array.isArray(rawRes.items)) return rawRes;
    return { items: [] };
  }

  /**
   * Obtiene reacciones de una publicación en LinkedIn para detectar interés
   */
  async getPostReactions(postId: string, accountId?: string, limit: number = 50): Promise<{ items: UnipilePostReaction[] }> {
    const query = new URLSearchParams();
    if (accountId) query.set('account_id', accountId);
    query.set('limit', String(limit));

    const safePostId = encodeURIComponent(postId).replace(/%3A/gi, ':');
    const rawRes = await this.request<any>(
      `/api/v1/posts/${safePostId}/reactions?${query.toString()}`
    );
    if (Array.isArray(rawRes)) return { items: rawRes };
    if (rawRes && Array.isArray(rawRes.items)) return rawRes;
    return { items: [] };
  }

  /**
   * Realiza una búsqueda avanzada en LinkedIn (personas, publicaciones, filtros)
   */
  async searchLinkedIn(params: UnipileLinkedInSearchParams): Promise<UnipileLinkedInSearchResponse> {
    const { account_id, cursor, limit = 25, api = 'classic', category = 'people', ...filters } = params;
    const query = new URLSearchParams({
      account_id,
      limit: String(Math.min(100, Math.max(1, limit))),
    });
    if (cursor) query.set('cursor', cursor);
    return this.request<UnipileLinkedInSearchResponse>(`/api/v1/linkedin/search?${query.toString()}`, {
      method: 'POST',
      body: JSON.stringify({ api, category, ...filters }),
    });
  }

  async listLinkedInSearchParameters(params: {
    account_id: string;
    type: 'LOCATION' | 'INDUSTRY' | 'COMPANY' | 'SCHOOL' | 'SERVICE' | string;
    keywords: string;
    limit?: number;
  }): Promise<{ items: UnipileSearchParameter[] }> {
    const query = new URLSearchParams({
      account_id: params.account_id,
      type: params.type,
      keywords: params.keywords,
      limit: String(Math.min(100, Math.max(1, params.limit ?? 20))),
    });
    return this.request<{ items: UnipileSearchParameter[] }>(
      `/api/v1/linkedin/search/parameters?${query.toString()}`,
    );
  }
}

// Instancia singleton por defecto
export const unipile = new UnipileClient();
