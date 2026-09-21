export interface UnipileAccountSource {
  id?: string;
  status?: 'OK' | 'STOPPED' | 'ERROR' | 'CREDENTIALS' | 'PERMISSIONS' | 'CONNECTING' | string;
}

export interface UnipileAccount {
  id: string;
  /** Unipile's current v1 account discriminator. */
  type?: 'LINKEDIN' | 'WHATSAPP' | 'INSTAGRAM' | 'MESSENGER' | 'TELEGRAM' | 'GOOGLE' | 'MICROSOFT' | 'IMAP' | string;
  /** Legacy adapter alias retained for existing callers. */
  provider?: 'LINKEDIN' | 'WHATSAPP' | 'INSTAGRAM' | 'MESSENGER' | 'TELEGRAM' | 'GOOGLE' | 'MICROSOFT' | 'IMAP' | string;
  status?: string;
  sources?: UnipileAccountSource[];
  name?: string;
  created_at?: string;
  connection_params?: Record<string, unknown>;
}

export interface UnipileHostedAuthResponse {
  object: 'HostedAuthLink' | 'HostedAuthURL' | string;
  url: string;
}

export interface UnipileHostedAuthCallback {
  status: 'CREATION_SUCCESS' | 'RECONNECTED' | string;
  account_id: string;
  name?: string;
}

export interface UnipileCredentialsAuthResponse {
  object?: 'Account' | 'Checkpoint' | string;
  id?: string;
  account_id?: string;
  checkpoint?: {
    type?: '2FA' | string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface UnipileProxyConfig {
  host: string;
  port: number;
  protocol?: 'http' | 'https' | 'socks5';
  username?: string;
  password?: string;
}

export interface UnipileLinkedInAuthParams {
  username?: string;
  password?: string;
  accessToken?: string;
  premiumToken?: string;
  country?: string;
  proxy?: UnipileProxyConfig;
  userAgent?: string;
  name?: string;
}

export interface UnipileSolveCheckpointResponse {
  object?: string;
  id?: string;
  account_id?: string;
  [key: string]: unknown;
}

export interface UnipileProfileWorkExperience {
  id?: string;
  position?: string;
  company?: string;
  company_id?: string;
  company_url?: string;
  company_picture_url?: string;
  location?: string;
  current?: boolean;
  start?: string | null;
  end?: string | null;
  [key: string]: unknown;
}

export interface UnipileProfile {
  object: 'UserProfile' | string;
  provider: string;
  provider_id: string;
  public_identifier?: string | null;
  public_profile_url?: string | null;
  profile_url?: string | null;
  member_urn?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  headline?: string | null;
  summary?: string | null;
  picture_url?: string | null;
  profile_picture_url?: string | null;
  profile_picture_url_large?: string | null;
  location?: string | null;
  network_distance?: 'FIRST_DEGREE' | 'SECOND_DEGREE' | 'THIRD_DEGREE' | 'OUT_OF_NETWORK' | string;
  is_relationship?: boolean;
  connected_at?: number | string | null;
  invitation?: { type?: 'SENT' | 'RECEIVED' | string; status?: 'PENDING' | 'IGNORED' | 'WITHDRAWN' | string } | null;
  work_experience?: UnipileProfileWorkExperience[];
  throttled_sections?: string[];
  [key: string]: unknown;
}

export interface UnipileSendInvitationParams {
  account_id: string;
  provider_id: string;
  message?: string;
}

export interface UnipileSendInvitationResponse {
  object: 'UserInvitationSent' | string;
  invitation_id: string;
  usage?: number;
  /** Legacy mock/provider compatibility; v1 success is represented by HTTP 200. */
  status?: 'sent' | 'pending' | 'failed' | string;
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

export interface UnipileSendMessageResponse {
  object: 'MessageSent' | string;
  message_id: string | null;
}

export interface UnipileStartChatParams {
  account_id: string;
  attendees_ids: string[];
  text: string;
  attachments?: Array<{
    file: Buffer | Blob | string;
    filename: string;
    mime_type?: string;
  }>;
}

export interface UnipileStartChatResponse {
  object: 'ChatStarted' | string;
  chat_id: string | null;
  message_id: string | null;
}

export interface UnipileChat {
  object?: 'Chat' | string;
  id: string;
  account_id: string;
  account_type?: string;
  provider_id?: string;
  name?: string | null;
  type?: number;
  unread_count?: number;
  timestamp?: string | null;
  attendee_provider_id?: string;
  attendees?: Array<{
    id?: string;
    name?: string;
    provider_id?: string;
    picture_url?: string;
    profile_url?: string;
    is_self?: number;
  }>;
  [key: string]: unknown;
}

export interface UnipileChatAttendee {
  object?: 'ChatAttendee' | string;
  id: string;
  account_id: string;
  provider_id: string;
  name: string;
  is_self: number;
  picture_url?: string;
  profile_url?: string;
  specifics?: {
    provider?: string;
    member_urn?: string;
    occupation?: string;
    network_distance?: string;
    pending_invitation?: boolean;
    location?: string;
    headline?: string;
    [key: string]: unknown;
  };
}

export interface UnipileMessage {
  object?: 'Message' | string;
  id: string;
  message_id?: string;
  provider_id?: string;
  chat_id: string;
  chat_provider_id?: string;
  account_id: string;
  sender_id: string;
  sender_attendee_id?: string;
  sender_urn?: string;
  text: string | null;
  timestamp: string;
  is_sender?: boolean | 0 | 1;
  attachments?: unknown[];
  [key: string]: unknown;
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

export type UnipileLinkedInSearchApi = 'classic' | 'sales_navigator' | 'recruiter';
export type UnipileLinkedInSearchCategory = 'people' | 'posts' | 'companies' | 'jobs';

export interface UnipileLinkedInSearchParams {
  account_id: string;
  api?: UnipileLinkedInSearchApi;
  category?: UnipileLinkedInSearchCategory;
  cursor?: string;
  limit?: number;
  keywords?: string;
  [key: string]: unknown;
}

export interface UnipileSearchPersonPosition {
  company?: string | null;
  company_id?: string | null;
  description?: string | null;
  location?: string | null;
  role?: string | null;
  tenure_at_company?: { years?: number; months?: number };
  tenure_at_role?: { years?: number; months?: number };
}

export interface UnipileSearchPerson {
  type: 'PEOPLE';
  id: string;
  name: string;
  first_name?: string;
  last_name?: string;
  member_urn?: string;
  public_identifier?: string;
  public_profile_url?: string;
  profile_url?: string;
  profile_picture_url?: string;
  network_distance?: string;
  location?: string;
  headline?: string;
  industry?: string | null;
  pending_invitation?: boolean;
  current_positions?: UnipileSearchPersonPosition[];
}

export interface UnipileSearchPostAuthor {
  id?: string;
  public_identifier?: string;
  name?: string;
  is_company?: boolean;
  headline?: string;
  profile_picture_url?: string;
}

export interface UnipileSearchPost {
  type: 'POST';
  id: string;
  social_id?: string;
  share_url?: string;
  date?: string;
  parsed_datetime?: string;
  text?: string;
  comment_counter?: number;
  reaction_counter?: number;
  repost_counter?: number;
  author?: UnipileSearchPostAuthor;
  is_repost?: boolean;
}

export interface UnipileSearchCompany {
  type: 'COMPANY';
  id: string;
  name: string;
  profile_url?: string;
  summary?: string | null;
  industry?: string;
  location?: string;
  followers_count?: number;
  job_offers_count?: number;
  headcount?: number;
  headcount_growth?: number;
}

export type UnipileSearchResultItem = UnipileSearchPerson | UnipileSearchPost | UnipileSearchCompany | Record<string, unknown>;

export interface UnipileLinkedInSearchResponse {
  object?: 'LinkedinSearch' | string;
  items: UnipileSearchResultItem[];
  cursor?: string | null;
  paging?: { start?: number; page_count?: number; total_count?: number };
  config?: { params?: Record<string, unknown> };
}

export interface UnipileSearchParameter {
  object?: 'LinkedinSearchParameter' | string;
  id: string;
  title: string;
}

export interface UnipileWebhookSender {
  attendee_id?: string;
  attendee_name?: string;
  attendee_provider_id?: string;
  attendee_profile_url?: string;
  provider_id?: string;
  name?: string;
  profile_url?: string;
  [key: string]: unknown;
}

export interface UnipileWebhookData {
  id?: string;
  message_id?: string;
  chat_id?: string;
  message?: string;
  text?: string;
  timestamp?: string;
  sender_id?: string;
  sender_name?: string;
  sender_profile_url?: string;
  sender?: UnipileWebhookSender;
  account_id?: string;
  account_info?: { user_id?: string; [key: string]: unknown };
  attachments?: unknown[];
  is_sender?: boolean | 0 | 1;
  user_provider_id?: string;
  provider_id?: string;
  user_id?: string;
  status?: string;
  [key: string]: unknown;
}

export interface UnipileWebhookPayload {
  event?: 'message_received' | 'chat_updated' | 'account_status_changed' | 'invitation_accepted' | 'new_relation' | string;
  account_id?: string;
  account_type?: string;
  timestamp?: string;
  status?: string;
  data?: UnipileWebhookData;
  chat_id?: string;
  message_id?: string;
  message?: string;
  attachments?: unknown[];
  account_info?: { user_id?: string; [key: string]: unknown };
  sender?: UnipileWebhookSender;
  user_provider_id?: string;
  user_public_identifier?: string;
  user_profile_url?: string;
  AccountStatus?: { account_id?: string; account_type?: string; message?: string; [key: string]: unknown };
  [key: string]: unknown;
}
