import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { GMAIL_READONLY_SCOPE } from "../config/gmailOAuth.js";
import { createGetGmailAttachmentController } from "../controllers/gmailMessageController.js";
import checkToken from "../middleware/CheckToken.js";
import {
  getGmailAttachmentContent,
  GmailAttachmentError,
} from "../services/gmailAttachmentService.js";
import { GmailConnectionError } from "../services/gmailClientService.js";

const attachmentRecord = {
  gmail_connection_id: 9,
  gmail_message_id: "message-1",
  gmail_attachment_id: "attachment-1",
  mime_part_id: "1",
  filename: "report.pdf",
  mime_type: "application/pdf",
  size: 4,
};

const allowed = async () => ({
  status: "allowed",
  attachment: attachmentRecord,
});

const gmailClient = (data = Buffer.from([0, 1, 2, 255]).toString("base64url")) => ({
  gmailConnectionId: 9,
  gmail: {
    users: {
      messages: {
        attachments: {
          get: async () => ({ data: { data } }),
        },
      },
    },
  },
});

const getContent = (overrides = {}) => getGmailAttachmentContent({
  gmailMessageId: "message-1",
  gmailAttachmentId: "attachment-1",
  userId: 42,
  findAttachment: allowed,
  getGmailClient: async () => gmailClient(),
  ...overrides,
});

const createResponse = () => ({
  statusCode: 200,
  headers: {},
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  setHeader(name, value) {
    this.headers[name.toLowerCase()] = String(value);
  },
  json(value) {
    this.body = value;
    return this;
  },
  send(value) {
    this.body = value;
    return this;
  },
});

describe("Gmail attachment access", () => {
  test("authenticated owner fetches their attachment through Gmail API", async () => {
    let lookup;
    let clientOptions;
    let apiRequest;
    const result = await getContent({
      findAttachment: async (value) => {
        lookup = value;
        return allowed();
      },
      getGmailClient: async (options) => {
        clientOptions = options;
        const client = gmailClient();
        client.gmail.users.messages.attachments.get = async (request) => {
          apiRequest = request;
          return { data: { data: "AAEC_w" } };
        };
        return client;
      },
    });

    assert.deepEqual(lookup, {
      gmailMessageId: "message-1",
      gmailAttachmentId: "attachment-1",
      userId: 42,
    });
    assert.deepEqual(clientOptions.requiredScopes, [GMAIL_READONLY_SCOPE]);
    assert.deepEqual(apiRequest, {
      userId: "me",
      messageId: "message-1",
      id: "attachment-1",
    });
    assert.ok(Buffer.isBuffer(result.buffer));
  });

  test("unauthenticated request is rejected by existing authentication middleware", () => {
    const req = { cookies: {}, headers: {} };
    const res = createResponse();
    let nextCalled = false;
    checkToken(req, res, () => { nextCalled = true; });
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.message, "Token not found");
    assert.equal(nextCalled, false);
  });

  test("another user's Gmail message is not accessible", async () => {
    let gmailCalled = false;
    await assert.rejects(
      getContent({
        findAttachment: async ({ userId }) => {
          assert.equal(userId, 42);
          return { status: "message_not_found" };
        },
        getGmailClient: async () => {
          gmailCalled = true;
          return gmailClient();
        },
      }),
      (error) => error.code === "gmail_message_not_found" && error.statusCode === 404
    );
    assert.equal(gmailCalled, false);
  });

  test("attachment ID belonging to another message is rejected", async () => {
    await assert.rejects(
      getContent({ findAttachment: async () => ({ status: "attachment_not_found" }) }),
      (error) => error.code === "gmail_attachment_not_found" && error.statusCode === 404
    );
  });

  test("missing Gmail message returns 404", async () => {
    await assert.rejects(
      getContent({ findAttachment: async () => ({ status: "message_not_found" }) }),
      { code: "gmail_message_not_found", statusCode: 404 }
    );
  });

  test("missing Gmail attachment returns 404", async () => {
    await assert.rejects(
      getContent({ findAttachment: async () => ({ status: "attachment_not_found" }) }),
      { code: "gmail_attachment_not_found", statusCode: 404 }
    );
  });

  test("rejects invalid Gmail message and attachment IDs before lookup", async () => {
    let lookupCalled = false;
    const findAttachment = async () => {
      lookupCalled = true;
      return allowed();
    };
    await assert.rejects(
      getContent({ gmailMessageId: "not valid!", findAttachment }),
      { code: "gmail_message_id_invalid", statusCode: 400 }
    );
    await assert.rejects(
      getContent({ gmailAttachmentId: "not valid!", findAttachment }),
      { code: "gmail_attachment_id_invalid", statusCode: 400 }
    );
    assert.equal(lookupCalled, false);
  });

  test("accepts full Gmail attachment tokens longer than the old column limit", async () => {
    const longAttachmentId = `ANGjdJ${"A".repeat(398)}`;
    let requestedId;
    await getContent({
      gmailAttachmentId: longAttachmentId,
      getGmailClient: async () => {
        const client = gmailClient();
        client.gmail.users.messages.attachments.get = async ({ id }) => {
          requestedId = id;
          return { data: { data: "AAEC_w" } };
        };
        return client;
      },
    });
    assert.equal(requestedId, longAttachmentId);
  });

  test("refreshes a truncated or stale Gmail attachment token by MIME part", async () => {
    const calls = [];
    const freshData = Buffer.from("fresh attachment").toString("base64url");
    const result = await getContent({
      getGmailClient: async () => ({
        gmailConnectionId: 9,
        gmail: {
          users: {
            messages: {
              get: async (request) => {
                calls.push({ operation: "message", request });
                return {
                  data: {
                    payload: {
                      partId: "",
                      parts: [{
                        partId: "1",
                        filename: "report.pdf",
                        body: { attachmentId: "fresh-token" },
                      }],
                    },
                  },
                };
              },
              attachments: {
                get: async (request) => {
                  calls.push({ operation: "attachment", request });
                  if (request.id === "attachment-1") {
                    const error = new Error("Invalid attachment token");
                    error.response = {
                      status: 400,
                      data: { error: { message: error.message, errors: [{ reason: "invalidArgument" }] } },
                    };
                    throw error;
                  }
                  return { data: { data: freshData } };
                },
              },
            },
          },
        },
      }),
    });

    assert.deepEqual(result.buffer, Buffer.from("fresh attachment"));
    assert.equal(calls[1].request.format, "FULL");
    assert.equal(calls[2].request.id, "fresh-token");
  });

  test("decodes Gmail base64url attachment data exactly", async () => {
    const expected = Buffer.from([0, 255, 128, 64, 1]);
    const result = await getContent({
      getGmailClient: async () => gmailClient(expected.toString("base64url")),
    });
    assert.deepEqual(result.buffer, expected);
  });

  test("returns the stored safe Content-Type", async () => {
    const result = await getContent();
    assert.equal(result.contentType, "application/pdf");
  });

  test("controller sets inline Content-Disposition with the attachment filename", async () => {
    const controller = createGetGmailAttachmentController({
      getAttachment: async () => ({
        buffer: Buffer.from("pdf"),
        filename: "report.pdf",
        contentType: "application/pdf",
      }),
    });
    const req = {
      user: { id: 42 },
      params: { gmailMessageId: "message-1", gmailAttachmentId: "attachment-1" },
    };
    const res = createResponse();
    await controller(req, res, (error) => { throw error; });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "application/pdf");
    assert.equal(
      res.headers["content-disposition"],
      "inline; filename=\"report.pdf\"; filename*=UTF-8''report.pdf"
    );
    assert.deepEqual(res.body, Buffer.from("pdf"));
  });

  test("Gmail authentication and API failures use safe endpoint errors", async () => {
    await assert.rejects(
      getContent({
        getGmailClient: async () => {
          throw new GmailConnectionError("gmail_scope_missing", "Reconnect Gmail");
        },
      }),
      (error) => error instanceof GmailConnectionError
    );

    const apiError = new Error("private Google failure");
    apiError.response = { status: 500 };
    await assert.rejects(
      getContent({
        getGmailClient: async () => {
          const client = gmailClient();
          client.gmail.users.messages.attachments.get = async () => {
            throw apiError;
          };
          return client;
        },
      }),
      (error) =>
        error instanceof GmailAttachmentError &&
        error.code === "gmail_attachment_fetch_failed" &&
        error.statusCode === 502
    );
  });

  test("maps Gmail 404 and 401/403 responses without generic masking", async () => {
    for (const [status, expectedCode] of [
      [404, "gmail_attachment_not_found"],
      [401, "gmail_authorization_failed"],
      [403, "gmail_authorization_failed"],
    ]) {
      await assert.rejects(
        getContent({
          getGmailClient: async () => {
            const client = gmailClient();
            client.gmail.users.messages.attachments.get = async () => {
              const error = new Error("Gmail API error");
              error.response = { status };
              throw error;
            };
            return client;
          },
        }),
        (error) => error.code === expectedCode
      );
    }
  });
});
