import { getGmailInboxMessagesForUser } from "../models/GmailMessage.js";
import { getInboxMails } from "../models/Mail.js";
import { adaptGmailMessage } from "../utils/gmailMessageAdapter.js";

export const GMAIL_SOURCE_PREFIX = "gmail:";

export const qualifyGmailMessageId = (gmailMessageId) =>
  `${GMAIL_SOURCE_PREFIX}${gmailMessageId}`;

export const parseGmailSourceMessageId = (messageId) => {
  if (
    typeof messageId !== "string" ||
    !messageId.startsWith(GMAIL_SOURCE_PREFIX)
  ) {
    return null;
  }

  return messageId.slice(GMAIL_SOURCE_PREFIX.length);
};

export const adaptGmailInboxMessage = (message) => {
  const adapted = adaptGmailMessage(message);

  return {
    ...adapted,
    id: qualifyGmailMessageId(adapted.gmailMessageId),
    sourceMessageId: adapted.gmailMessageId,
  };
};

export const adaptInternalInboxMessage = (message) => ({
  ...message,
  source: "internal",
  sourceMessageId: String(message.id),
});

const compareInboxMessages = (left, right) => {
  const dateDifference =
    new Date(right.created_at).getTime() - new Date(left.created_at).getTime();

  if (dateDifference !== 0) return dateDifference;
  if (left.source !== right.source) {
    return left.source.localeCompare(right.source);
  }
  return String(right.sourceMessageId).localeCompare(
    String(left.sourceMessageId),
    undefined,
    { numeric: true }
  );
};

export const mergeInboxMessages = ({
  internalMails,
  gmailMessages,
  offset,
  limit,
}) => [
  ...internalMails.map(adaptInternalInboxMessage),
  ...gmailMessages.map(adaptGmailInboxMessage),
]
  .sort(compareInboxMessages)
  .slice(offset, offset + limit);

export const getCombinedInbox = async ({
  userId,
  page,
  limit,
  getInternalInbox = getInboxMails,
  getGmailInbox = getGmailInboxMessagesForUser,
}) => {
  const offset = (page - 1) * limit;
  const candidateLimit = offset + limit;

  const [internalResult, gmailResult] = await Promise.all([
    getInternalInbox(userId, candidateLimit, 0),
    getGmailInbox(userId, candidateLimit, 0),
  ]);

  const totalMails =
    Number(internalResult.totalMails) + Number(gmailResult.totalMails);

  return {
    mails: mergeInboxMessages({
      internalMails: internalResult.mails,
      gmailMessages: gmailResult.messages,
      offset,
      limit,
    }),
    totalMails,
  };
};
