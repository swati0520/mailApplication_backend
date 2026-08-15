import { GMAIL_SEND_SCOPE } from "../config/gmailOAuth.js";
import { buildGmailRawMessage, GmailMimeError } from "../utils/gmailMimeBuilder.js";
import {
  getAuthenticatedGmailClient,
  GmailConnectionError,
} from "./gmailClientService.js";

export class GmailComposeDeliveryError extends Error {
  constructor(code, message, statusCode, deliveryStatus, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "GmailComposeDeliveryError";
    this.code = code;
    this.statusCode = statusCode;
    this.deliveryStatus = deliveryStatus;
  }
}

const getGoogleStatus = (error) => {
  const value = error?.response?.status ?? error?.status ?? error?.code;
  const status = Number(value);
  return Number.isInteger(status) ? status : null;
};

const gmailSendError = (error) => {
  const googleStatus = getGoogleStatus(error);
  if (googleStatus === 401 || googleStatus === 403) {
    return new GmailComposeDeliveryError(
      "gmail_authorization_failed",
      "Gmail authorization failed; reconnect Gmail and try again",
      409,
      "failed",
      error
    );
  }
  if (googleStatus && googleStatus >= 400 && googleStatus < 500) {
    return new GmailComposeDeliveryError(
      "gmail_delivery_rejected",
      "Gmail rejected the composed message",
      502,
      "failed",
      error
    );
  }
  return new GmailComposeDeliveryError(
    "gmail_delivery_unconfirmed",
    "Gmail delivery could not be confirmed; do not resend automatically",
    503,
    "pending",
    error
  );
};

export const sendNewGmailMessage = async ({
  userId,
  to,
  cc = [],
  bcc = [],
  subject,
  body,
  attachments = [],
  getGmailClient = getAuthenticatedGmailClient,
}) => {
  let gmailClient;
  try {
    gmailClient = await getGmailClient({
      userId,
      requiredScopes: [GMAIL_SEND_SCOPE],
    });
  } catch (error) {
    if (
      error instanceof GmailConnectionError &&
      error.code === "gmail_not_connected"
    ) {
      return { deliveryStatus: "internal_only" };
    }
    if (error?.code === "gmail_not_connected") {
      return { deliveryStatus: "internal_only" };
    }
    if (error?.code === "gmail_scope_missing") {
      throw new GmailComposeDeliveryError(
        "gmail_scope_missing",
        "Reconnect Gmail to grant permission to send composed messages",
        409,
        "failed",
        error
      );
    }
    throw new GmailComposeDeliveryError(
      "gmail_authentication_failed",
      "Gmail authentication failed",
      502,
      "failed",
      error
    );
  }

  let raw;
  try {
    raw = buildGmailRawMessage({
      from: gmailClient.gmailEmail,
      to,
      cc,
      bcc,
      subject,
      body,
      attachments,
    });
  } catch (error) {
    if (error instanceof GmailMimeError) {
      throw new GmailComposeDeliveryError(
        error.code,
        error.message,
        error.code === "gmail_message_too_large" ? 413 : 400,
        "failed",
        error
      );
    }
    throw new GmailComposeDeliveryError(
      "gmail_message_invalid",
      "The composed Gmail message could not be encoded",
      400,
      "failed",
      error
    );
  }

  let data;
  try {
    ({ data } = await gmailClient.gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    }));
  } catch (error) {
    throw gmailSendError(error);
  }

  if (!data?.id) {
    throw new GmailComposeDeliveryError(
      "gmail_delivery_unconfirmed",
      "Gmail delivery could not be confirmed; do not resend automatically",
      503,
      "pending"
    );
  }

  return {
    deliveryStatus: "sent",
    gmailMessageId: data.id,
    gmailThreadId: data.threadId ?? null,
  };
};
