import {
  UnipileAccount,
  UnipileHostedAuthResponse,
  UnipileProfile,
  UnipileSendInvitationParams,
  UnipileSendInvitationResponse,
  UnipileSendMessageParams,
  UnipileStartChatParams,
  UnipileChat,
  UnipileMessage,
  UnipilePostComment,
  UnipilePostReaction,
  UnipileLinkedInSearchParams,
  UnipileSearchResultItem,
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

  private getHeaders(): Record<string, string> {
    return {
      'X-API-KEY': this.apiKey,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    if (!this.isConfigured()) {
      throw new Error(
        'Unipile no está configurado. Asegúrate de definir UNIPILE_DSN y UNIPILE_API_KEY en tu archivo de entorno.'
      );
    }

    const url = `${this.dsn}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const headers = {
      ...this.getHeaders(),
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
      throw new Error(
        `Error Unipile [${res.status} ${res.statusText}] en ${endpoint}: ${errorBody || 'Sin detalle'}`
      );
    }

    return (await res.json()) as T;
  }

  /**
   * Genera un enlace de autenticación Hosted para que el usuario conecte su cuenta de LinkedIn
   */
  async getHostedAuthLink(params: {
    type?: 'create' | 'reconnect';
    providers?: string[];
    success_redirect_url?: string;
    failure_redirect_url?: string;
    notify_url?: string;
    name?: string;
  } = {}): Promise<UnipileHostedAuthResponse> {
    const payload = {
      type: params.type || 'create',
      providers: params.providers || ['LINKEDIN'],
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
    const cleanId = identifier
      .replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//i, '')
      .replace(/\/.*$/, '')
      .trim();

    return this.request<UnipileProfile>(
      `/api/v1/users/${encodeURIComponent(cleanId)}?account_id=${encodeURIComponent(accountId)}`
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

  /**
   * Inicia un nuevo chat 1 a 1 con un contacto
   */
  async startChat(params: UnipileStartChatParams): Promise<UnipileChat> {
    return this.request<UnipileChat>('/api/v1/chats', {
      method: 'POST',
      body: JSON.stringify({
        account_id: params.account_id,
        attendees_ids: params.attendees_ids,
        text: params.text,
      }),
    });
  }

  /**
   * Envía un mensaje en un chat existente
   */
  async sendMessage(params: UnipileSendMessageParams): Promise<UnipileMessage> {
    return this.request<UnipileMessage>(`/api/v1/chats/${encodeURIComponent(params.chat_id)}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        text: params.text,
      }),
    });
  }

  /**
   * Lista los chats de la cuenta
   */
  async listChats(accountId?: string, limit: number = 20): Promise<{ items: UnipileChat[] }> {
    const query = new URLSearchParams();
    if (accountId) query.set('account_id', accountId);
    query.set('limit', String(limit));

    return this.request<{ items: UnipileChat[] }>(`/api/v1/chats?${query.toString()}`);
  }

  /**
   * Lista los mensajes de un chat específico
   */
  async listMessages(chatId: string, limit: number = 50): Promise<{ items: UnipileMessage[] }> {
    return this.request<{ items: UnipileMessage[] }>(
      `/api/v1/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}`
    );
  }

  /**
   * Obtiene comentarios de una publicación en LinkedIn para detectar intención
   */
  async getPostComments(postId: string, accountId?: string, limit: number = 50): Promise<{ items: UnipilePostComment[] }> {
    const query = new URLSearchParams();
    if (accountId) query.set('account_id', accountId);
    query.set('limit', String(limit));

    return this.request<{ items: UnipilePostComment[] }>(
      `/api/v1/posts/${encodeURIComponent(postId)}/comments?${query.toString()}`
    );
  }

  /**
   * Obtiene reacciones de una publicación en LinkedIn para detectar interés
   */
  async getPostReactions(postId: string, accountId?: string, limit: number = 50): Promise<{ items: UnipilePostReaction[] }> {
    const query = new URLSearchParams();
    if (accountId) query.set('account_id', accountId);
    query.set('limit', String(limit));

    return this.request<{ items: UnipilePostReaction[] }>(
      `/api/v1/posts/${encodeURIComponent(postId)}/reactions?${query.toString()}`
    );
  }

  /**
   * Realiza una búsqueda avanzada en LinkedIn (personas, publicaciones, filtros)
   */
  async searchLinkedIn(params: UnipileLinkedInSearchParams): Promise<{ items: UnipileSearchResultItem[]; cursor?: string }> {
    return this.request<{ items: UnipileSearchResultItem[]; cursor?: string }>('/api/v1/linkedin/search', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }
}

// Instancia singleton por defecto
export const unipile = new UnipileClient();
