export interface UnipileAccount {
  id: string;
  provider: 'LINKEDIN' | 'WHATSAPP' | 'INSTAGRAM' | 'MESSENGER' | 'TELEGRAM' | 'GOOGLE' | 'MICROSOFT' | 'IMAP';
  status: 'OK' | 'CHECKPOINT' | 'DISCONNECTED' | 'ERROR' | 'SYNCING';
  name?: string;
  created_at?: string;
  connection_params?: Record<string, any>;
}

export interface UnipileHostedAuthResponse {
  object: 'HostedAuthLink';
  url: string;
}

export interface UnipileProfile {
  object: 'UserProfile';
  provider: string;
  provider_id: string;
  public_identifier?: string;
  member_urn?: string;
  first_name?: string;
  last_name?: string;
  headline?: string;
  profile_url?: string;
  picture_url?: string;
}

export interface UnipileSendInvitationParams {
  account_id: string;
  provider_id: string;
  message?: string;
}

export interface UnipileSendInvitationResponse {
  object: string;
  id?: string;
  status: 'sent' | 'pending' | 'failed';
}

export interface UnipileSendMessageParams {
  chat_id: string;
  text: string;
  attachments?: Array<{
    file: Buffer | Blob | string;
    filename: string;
    mime_type?: string;
  }>;
}

export interface UnipileStartChatParams {
  account_id: string;
  attendees_ids: string[];
  text: string;
}

export interface UnipileMessage {
  id: string;
  chat_id: string;
  account_id: string;
  sender_id: string;
  text: string;
  timestamp: string;
  attachments?: any[];
  is_sender?: boolean;
}

export interface UnipileChat {
  id: string;
  account_id: string;
  unread_count: number;
  timestamp: string;
  attendee_provider_id?: string;
  attendees?: Array<{
    id: string;
    name?: string;
    provider_id?: string;
    picture_url?: string;
  }>;
}

export interface UnipileWebhookPayload {
  event: 'message_received' | 'chat_updated' | 'account_status_changed' | 'invitation_accepted';
  account_id: string;
  data: any;
  timestamp: string;
}

export interface UnipilePostComment {
  id: string;
  post_id?: string;
  text: string;
  created_at?: string;
  author: {
    id: string;
    name?: string;
    first_name?: string;
    last_name?: string;
    headline?: string;
    public_identifier?: string;
    profile_url?: string;
    picture_url?: string;
  };
}

export interface UnipilePostReaction {
  id?: string;
  reaction_type?: 'LIKE' | 'CELEBRATE' | 'SUPPORT' | 'LOVE' | 'INSIGHTFUL' | 'CURIOUS' | string;
  author: {
    id: string;
    name?: string;
    headline?: string;
    public_identifier?: string;
    profile_url?: string;
    picture_url?: string;
  };
}

export interface UnipileLinkedInSearchParams {
  account_id: string;
  category?: 'PEOPLE' | 'POSTS' | 'COMPANIES';
  keywords?: string;
  title?: string;
  company?: string;
  location?: string;
  limit?: number;
  cursor?: string;
}

export interface UnipileSearchResultItem {
  id: string;
  name: string;
  headline?: string;
  location?: string;
  public_identifier?: string;
  profile_url?: string;
  picture_url?: string;
  company?: string;
}
