import {
  processDueScheduledMails,
  wakeExpiredSnoozedMails,
} from "../models/Mail.js";

const SCHEDULED_MAIL_INTERVAL_MS = 30 * 1000;

export const startScheduledMailWorker = () => {
  let isProcessing = false;

  const processScheduledMail = async () => {
    if (isProcessing) return;
    isProcessing = true;
    try {
      await Promise.all([
        processDueScheduledMails(),
        wakeExpiredSnoozedMails(),
      ]);
    } catch (error) {
      console.error("Scheduled mail processing failed:", error.message);
    } finally {
      isProcessing = false;
    }
  };

  processScheduledMail();
  const timer = setInterval(
    processScheduledMail,
    SCHEDULED_MAIL_INTERVAL_MS
  );
  timer.unref();
  return timer;
};
